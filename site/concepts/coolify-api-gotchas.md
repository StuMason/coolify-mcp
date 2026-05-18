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

## `listApplicationDeployments` response shape

Coolify's `GET /api/v1/deployments/applications/{uuid}` returns `{ count, deployments: [] }`, not `Deployment[]` as the OpenAPI suggests. Any caller using `.length` / `.map()` on the response would crash against a real Coolify server. Fixed in #158: the client method now correctly parses the envelope and returns `{ count, deployments }`.

By default the response uses `DeploymentEssential[]` (no raw `logs` blobs) to keep token usage sane on a 35-deployment list. Pass `include_logs: true` to opt back in.
