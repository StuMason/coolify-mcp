# Coolify API gotchas

The Coolify OpenAPI docs are an incomplete projection of the real allowlists — always cross-reference with the controller source before trusting the spec. This page captures the gotchas we've hit while building coolify-mcp, so contributors don't have to re-discover them.

> Most of this content is mirrored from `CLAUDE.md` in the repo root, so AI assistants working in the codebase see the same warnings.

## `docker_compose_raw` requires base64

The API expects base64-encoded YAML, but the field name suggests raw content. The client auto-encodes this field so models and callers can pass plain YAML.

## Validation errors vary in format

The `errors` field in API error responses can contain `string[]` or plain `string` values. The client handles both shapes.

## Env var field names: `is_buildtime` / `is_runtime` (one word each)

Not `is_build_time` (two words). Documented behaviour:

- On `POST /applications/{uuid}/envs` and `PATCH /applications/{uuid}/envs`, the wrong name returns **HTTP 422** `"This field is not allowed."`
- On `PATCH /applications/{uuid}/envs/bulk`, the wrong name is **silently ignored** (request returns 201, but the flag stays at default).

Verified against Coolify v4.0.0-beta.473 in #174 / #135. When adding env-var related code or tests, mirror the API field names exactly. Do not paraphrase to `is_build_time`.

## Application CREATE and UPDATE accept different field sets

Coolify's `app/Http/Controllers/Api/ApplicationsController.php` has **two separate `$allowedFields` arrays**:

- The `create_application` helper around line 1014, used by every `create_*` endpoint
- `update_by_uuid` around line 2497, used by the update endpoint

`removeUnnecessaryFieldsFromRequest()` runs that allowlist _before_ the shared `sharedDataApplications()` validation rules apply, so fields outside the allowlist are silently dropped, never validated, never reach the DB.

### Practical effects

**`dockerfile_target_build` is UPDATE-only.** Present in the update allowlist, absent from the create allowlist. Sending it on any `create_*` is silently dropped. The `application` tool exposes it in the zod schema but only wires it through `update`.

**`create_dockerimage` accepts `health_check_*` + `ports_mappings` but NOT `base_directory` / `publish_directory` / `install_command` / `build_command` / `start_command` / `watch_paths` / `dockerfile_location`.** The endpoint is for pre-built registry images and has no build step. The `application` tool's `create_dockerimage` handler intentionally forwards only health-check fields, even though the shared zod schema accepts build-config inputs.

**Coolify's `openapi.yaml` request bodies are an incomplete projection of the real allowlists.** Check both controller `$allowedFields` arrays before assuming a field is accepted on a given action. Verified against `coollabsio/coolify` `main` while fixing #178.

## Some endpoints return plain text on Coolify 4.0.0-beta.474+

`/api/v1/version` and similar started returning plain text rather than JSON. `request<T>()` checks `Content-Type` and falls back to raw text when the server returns plain text or malformed JSON. Both `application/json` and `+json` variants are accepted. An empty content-type is treated as JSON for backward compatibility.

Fixed in #177.

## Hetzner endpoints exist but are auth-scope-gated

The new `hetzner` tool's endpoints (`/api/v1/hetzner/locations`, `server-types`, `images`, `ssh-keys`, plus `/api/v1/servers/hetzner`) live on Coolify but require a **higher-privilege token scope** than the team-level tokens most users have. Calls return 401 "Unauthenticated" rather than 404, so the routes exist; they just need the right token.

Also: the path uses `server-types` (hyphen). `server_types` (underscore) returns 404.

## Scheduled task `command` is limited to 255 chars

Coolify's `scheduled_tasks` table stores `command` as `$table->string('command')` — a plain Laravel `string()` column, i.e. `varchar(255)` — per [`database/migrations/2023_12_31_173041_create_scheduled_tasks_table.php`](https://github.com/coollabsio/coolify/blob/main/database/migrations/2023_12_31_173041_create_scheduled_tasks_table.php) in `coollabsio/coolify`. No later migration changes the column type. Commands longer than the limit fail with a **bodyless HTTP 500** (`Internal Server Error`, no validation message) rather than a 422 — the worst possible error for an agent to act on.

Empirically (Coolify 4.1.2): 132/155/165/247-char commands created fine; ~265/~270/~320/~330-char commands all 500'd, confirming the ~255-char ceiling.

The `scheduled_tasks` tool now validates `command` client-side with `.max(255, ...)` on both `create` and `update`, and `request()` appends a hint to the error message when a bare 500 on a `/scheduled-tasks` path is seen. Workaround for longer commands: split into multiple scheduled tasks, or bake a script into the container image and invoke it by a short path/name instead of inlining the full command. Fixed in #234.

## `listApplicationDeployments` response shape

Coolify's `GET /api/v1/deployments/applications/{uuid}` returns `{ count, deployments: [] }`, not `Deployment[]` as the OpenAPI suggests. Any caller using `.length` / `.map()` on the response would crash against a real Coolify server. Fixed in #158: the client method now correctly parses the envelope and returns `{ count, deployments }`.

By default the response uses `DeploymentEssential[]` (no raw `logs` blobs) to keep token usage sane on a 35-deployment list. Pass `include_logs: true` to opt back in.

## Scheduled tasks have no "run now" — and the every-minute dance is dangerous

There is no upstream trigger/run-now endpoint for scheduled tasks: the bundled `docs/coolify-openapi.yaml` has no scheduled-task trigger (the only `trigger` in the spec is database backups), and `coolify-client.ts` has no such method. The only way to run a one-off command in a container is the manual dance: create a task with `frequency: "* * * * *"`, wait for the minute tick, read `list_executions`, delete the task.

Sharp edges hit doing this manually (2026-07-02, applying a missed migration on the crunch app):

- The task fires **every minute until deleted** — a non-idempotent SQL statement ran twice before the delete landed. Write commands as idempotent (`where not exists`, `insert ... on conflict`) or expect re-execution.
- Timing the tick by hand (create → wait ~60-70s → `list_executions` → delete) is boilerplate every caller reimplements badly, and it's easy to delete too early (before the first execution lands) or too late (after a second tick fires).

The `scheduled_tasks` tool's `run_once` action (#233) automates this: it creates the throwaway task, polls `list_executions` every ~5s for the first terminal execution (default 90s budget), deletes the task in a cleanup step that always runs (success, timeout, or error), and returns `status` + `message` (the command's stdout — see below). It still carries the same idempotency caveat, since the underlying cron can fire more than once before cleanup completes; deleting immediately after the first observed execution shrinks the window but does not close it.

Also: `list_executions` returns a `message` field per execution that carries the command's **stdout** — easy to miss since nothing else in the response looks like output.

Separately, Coolify silently rejects scheduled-task `command` values longer than ~255 chars as a bare `HTTP 500` with no body (#234) — keep commands short, or write a script into the container image and call that instead.
