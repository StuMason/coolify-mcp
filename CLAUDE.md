# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MCP (Model Context Protocol) server for Coolify that provides 44 token-optimized tools for AI assistants to manage infrastructure through natural language. Tools cover servers, projects, environments, applications, databases, services, deployments, private keys, teams, cloud tokens, documentation search, smart diagnostics, and batch operations. v2.0.0 reduced token usage by 85% (from ~43,000 to ~6,600 tokens) by consolidating related operations into single tools with action parameters.

## Commands

```bash
npm install          # Install dependencies
npm run build        # Build TypeScript to dist/
npm test             # Run all tests
npm run lint         # Run ESLint
npm run format       # Run Prettier

# Run locally
COOLIFY_BASE_URL="https://your-coolify.com" COOLIFY_ACCESS_TOKEN="token" node dist/index.js
```

## Architecture

### File Structure Pattern

When adding new Coolify API endpoints, follow this order:

1. **src/types/coolify.ts** - Add TypeScript interfaces
2. **src/lib/coolify-client.ts** - Add API client method with explicit return type
3. **src/lib/mcp-server.ts** - Add MCP tool definition
4. **src/**tests**/mcp-server.test.ts** - Add mocked test

### Key Files

- **src/index.ts** - Entry point, starts MCP server
- **src/lib/coolify-client.ts** - HTTP client wrapping Coolify REST API
- **src/lib/mcp-server.ts** - MCP tool definitions and handlers
- **src/types/coolify.ts** - All Coolify API type definitions
- **docs/coolify-openapi.yaml** - vendored upstream OpenAPI spec; ground truth for "does Coolify support X"
- **docs/openapi-chunks/** - the same spec split by resource for reference. **Generated** — run `npm run build:chunks` after re-vendoring the spec, never hand-edit. `npm run check:chunk-drift` fails CI if they diverge.

### Context-Optimized Responses

List endpoints return summaries (uuid, name, status) not full objects. This reduces response sizes by 90-99%. Use `get_*` tools for full details of a single resource.

## Adding New Endpoints

1. Verify endpoint exists in `docs/openapi-chunks/`
2. Add types to `src/types/coolify.ts`
3. Add client method with explicit return type
4. Add MCP tool to `src/lib/mcp-server.ts`
5. Add mocked tests (required for codecov coverage)

### Testing Requirements

**IMPORTANT**: All new client methods MUST have test coverage to pass codecov checks.

When adding new client methods, you must add:

1. **Client method tests** in `src/__tests__/coolify-client.test.ts`:
   - Test the HTTP method (GET, POST, PATCH, DELETE)
   - Test the endpoint path
   - Test the request body if applicable
   - Follow the existing test patterns in the file

2. **Method existence tests** in `src/__tests__/mcp-server.test.ts`:
   - Add `expect(typeof client.methodName).toBe('function');` in the appropriate section
   - Ensures the method is properly exported and accessible

**codecov will fail PRs with uncovered lines.** Always run `npm test` before committing.

### Client Method Example

```typescript
async getResource(uuid: string): Promise<Resource> {
  return this.request<Resource>(`/resources/${uuid}`);
}
```

### Test Example

```typescript
it('should call client method', async () => {
  const spy = jest.spyOn(server['client'], 'getResource').mockResolvedValue({ uuid: 'test' });
  await server.get_resource('test-uuid');
  expect(spy).toHaveBeenCalledWith('test-uuid');
});
```

### Smoke Testing Against Live Server

After fixing bugs, always verify fixes work against the real Coolify instance — not just unit tests.

- **`/smoke-test`** — Slash command that builds the project and runs integration smoke tests against the live server. Use this after any bug fix to confirm the fix works end-to-end.
- **`npm run test:integration`** — Runs all integration tests (requires `.env` with `COOLIFY_URL` and `COOLIFY_TOKEN`).
- Integration test files live in `src/__tests__/integration/` and are excluded from `npm test` (CI). Add new smoke tests there when fixing bugs that involve API interaction.

### Coolify API Gotchas

The Coolify OpenAPI docs are unreliable — always test against the real API. Known issues:

- **`docker_compose_raw` requires base64** — The API expects base64-encoded YAML, but the field name suggests raw content. The client auto-encodes this field so models and callers can pass plain YAML.
- **Validation errors vary in format** — The `errors` field in API error responses can contain `string[]` or plain `string` values. The client handles both.
- **Env var field names are `is_buildtime` and `is_runtime`** (one word each), not `is_build_time` (two words). On `POST /applications/{uuid}/envs` and `PATCH /applications/{uuid}/envs` the wrong name returns HTTP 422 `"This field is not allowed."`; on `PATCH /applications/{uuid}/envs/bulk` the wrong name is silently ignored (request returns 201 but the flag stays at the default). Verified against Coolify v4.0.0-beta.473 in #174 / #135. When adding env-var related code or tests, mirror the API field names exactly — do not paraphrase to `is_build_time`.
- **Application CREATE and UPDATE accept different field sets.** Coolify's `app/Http/Controllers/Api/ApplicationsController.php` has two separate `$allowedFields` arrays — one used by every `create_*` endpoint (`create_application` helper around line 1014) and a different one used by `update_by_uuid` (around line 2497). `removeUnnecessaryFieldsFromRequest()` runs that allowlist BEFORE the shared `sharedDataApplications()` validation rules apply, so fields outside the allowlist are silently dropped, never validated, never reach the DB. Practical effects:
  - `dockerfile_target_build` is **UPDATE-only**: present in the update allowlist, absent from the create allowlist. Sending it on any `create_*` is silently dropped. The `application` tool exposes it in the zod schema but only wires it through `update`.
  - `create_dockerimage` accepts `health_check_*` + `ports_mappings` but NOT `base_directory`/`publish_directory`/`install_command`/`build_command`/`start_command`/`watch_paths`/`dockerfile_location` — the endpoint is for pre-built registry images and has no build step. The `application` tool's `create_dockerimage` handler intentionally forwards only health-check fields, even though the shared zod schema accepts build-config inputs.
  - Coolify's `openapi.yaml` request bodies are an incomplete projection of the real allowlists. Check both controller `$allowedFields` arrays before assuming a field is accepted on a given action. Verified against `coollabsio/coolify` `main` while fixing #178.
- **State-changing endpoints changed HTTP method in v4.2, and not uniformly.** v4.2 (`coollabsio/coolify#10872`) requires `POST` on start/stop/restart/deploy/enable/disable/validate and returns `405` for `GET`. But the endpoints split into two groups, verified against upstream `routes/api.php` at v4.1.2, v4.0.0 and older betas:
  - Application/database/service `start`/`stop`/`restart` and `/deploy` were already `Route::match(['get','post'])` long before v4.2 — send `POST` unconditionally, it works on every version.
  - `/enable`, `/disable` and `/servers/{uuid}/validate` were `Route::get` **only** up to v4.1.2 and `Route::post` **only** from v4.2 — no single method works across both. These go through `postWithLegacyGetFallback`, which sends POST, retries GET when the router rejects the method, and caches the resolved method per endpoint. The cache self-heals if a remembered GET is later rejected (instance upgraded mid-session).

  **A rejected method does not always mean 405.** `routes/api.php` ends with `Route::any('/{any}', ...)` returning `404 {"message":"Not found.","docs":"..."}`, which swallows an unmatched method+path before Laravel can raise a 405 — so a pre-4.2 instance answers POST on a GET-only route with **404**. Verified live against 4.1.2; a 405-only fallback silently never fired, which is how #296 shipped broken. The fallback therefore triggers on a 405 _or_ on a 404 carrying the catch-all's `docs` key, and that body-shape check is what keeps a controller's genuine "resource not found" out of the retry path.

  Only ever trigger the fallback on those two: both mean no controller ran, so nothing executed. Retrying a `500` could double-fire a state change. When adding a new endpoint from the v4.2 breaking list, check which group it belongs to before assuming a blanket `POST` is safe.

- **v4.2 hides secrets and makes Member-role tokens read-only.** From v4.2, sensitive fields are stripped from responses unless the token has sensitive-read scope (`coollabsio/coolify#9893`), so response types holding secrets (`PrivateKey.private_key`, `EnvironmentVariable.value`) must be optional — a required type turns a withheld secret into a silent `undefined`. Separately, Member-role tokens can read but not write, so a sudden `403` on every write after an upgrade is a role problem, not a token problem.

- **`is_preview` only means anything on application env vars.** Preview deployments are an application concept. Upstream's service env-var controller does not validate or persist `is_preview` at all, so passing it to a service or database env var is silently ignored rather than rejected — `ServicesController::create_env` has no `$allowedFields`/`extraFields` allowlist, unlike the application endpoints, so an unknown field does not 422 there. The `env_vars` tool accepts it on all three resources for a consistent surface; it is a no-op on two of them. (`cleanRequestData` strips `undefined`, so it is only ever sent when a caller explicitly passes it.)

- **Coolify auto-creates a preview twin for every production application env var.** `EnvironmentVariable::booted()` has a `static::created` hook: creating a production env var on an **Application** (not services/databases) also creates a matching row with `is_preview = true`, and `GET /applications/{uuid}/envs` merges both scopes into one flat list. So two rows per variable is normal, not a duplicate-write bug. **Never dedupe env vars by `key` alone** — a key existing in both scopes is valid config, and deleting the "extra" row destroys preview configuration. Present since at least v4.0.0. `update_env_by_uuid` also scopes by `is_preview`, so an update that omits the flag only ever touches the production row and lets the twin drift.

- **`POST /applications/dockercompose` no longer exists upstream.** Coolify deprecated it (`7c0cb2f5`, Jan 2026) and removed the route + controller method entirely (`6ee75cfa`, "remove deprecated docker compose application endpoint") in favour of `POST /services`. The removal shipped in `v4.1.0`, so it 404s against any current self-hosted Coolify release. Compose-based apps are created through the `service` tool / `POST /services` instead. `CoolifyClient#createApplicationDockerCompose` still exists but is deprecated and deliberately NOT exposed as an `application` tool action — do not wire it up (see #235). It only works on instances still on `v4.0.x` or older.

## TypeScript Standards

- Always include explicit return types on functions
- No implicit any types
- Follow existing patterns in the codebase

## Git Workflow

- Commit frequently to trigger pre-commit hooks (linting, formatting, tests)
- Always stage all modified files after making changes
- Push changes to remote after committing
- Work on feature branches, not main

## Publishing

CI auto-publishes to npm via trusted publishing on version bump. Use:

```bash
npm version patch|minor|major
git push origin main --tags
```

## Documentation Standards

When making changes to the codebase, ensure documentation is updated:

1. **CHANGELOG.md** - Add entry under appropriate version with:
   - `### Added` - New features
   - `### Changed` - Breaking changes or significant modifications
   - `### Fixed` - Bug fixes
   - Follow [Keep a Changelog](https://keepachangelog.com/) format

2. **README.md** - Update if:
   - Tool count changes (update tool count in Features section)
   - New tools added (add to appropriate category in Available Tools)
   - New example prompts needed
   - Response size improvements made (update comparison table)

3. **This file (CLAUDE.md)** - Update tool count if changed (currently 44 tools)

Always work on a feature branch and include documentation updates in the same PR as code changes.
