# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **`custom_network_aliases` on `application` update** (#254) — gives an app container a stable DNS name for app-to-app traffic on a shared network. App containers get `<uuid>-<deploy-suffix>` container names that change every deploy (only databases get a uuid hostname), so this field is the only way to wire e.g. `ASR_URL=http://edator-asr:9000` between apps. Added to `UpdateApplicationRequest` and the `application` tool schema (update only — Coolify's create endpoints don't accept it).
- **MCPB bundle for one-click Claude Desktop install** — every release now attaches `coolify-mcp.mcpb` to the GitHub release; drag it into Claude Desktop Settings → Extensions and enter your Coolify URL + token. Built from `manifest.json` via `@anthropic-ai/mcpb` in the publish workflow. No Node install or JSON config editing needed.
- **Automated MCP Registry publishing** — the publish workflow now pushes `server.json` to registry.modelcontextprotocol.io via `mcp-publisher` (GitHub OIDC) on every release, so the registry listing can no longer go stale.

### Fixed

- **`server.json` drift** — the registry manifest was stuck at 2.7.3 / "38 tools" while npm was on 2.13.0 / 42 tools. Now synced, and `npm version` runs `scripts/sync-manifests.mjs` to bump `server.json` + `manifest.json` in the same commit; `src/__tests__/manifests.test.ts` fails CI if they ever diverge from `package.json` again.

### Security

- **`list_resources include_full` masks database passwords, connection URLs, compose bodies, and nested env vars** (#209) — a source audit of Coolify v4.1.2 found that no `Standalone*` model defines `$hidden` and Laravel serializes `encrypted` casts as decrypted plaintext, so every database row on `/api/v1/resources` carried its password in the clear. `SENSITIVE_RESOURCE_FIELDS` now additionally masks: the nine database password columns (`postgres_password`, `mysql_password`, `mysql_root_password`, `mariadb_password`, `mariadb_root_password`, `mongo_initdb_root_password`, `redis_password`, `keydb_password`, `dragonfly_password`, `clickhouse_admin_password`), the `internal_db_url` / `external_db_url` appends that embed the password in a connection URL on all eight database types (the only place Redis's password surfaces — its column was moved to env vars in 2024), compose bodies (`docker_compose_raw`, `docker_compose`, `docker_compose_pr_raw`, `docker_compose_pr`) since Coolify resolves `SERVICE_PASSWORD_*` placeholders into them, and `custom_labels` (Traefik basic-auth htpasswd hashes). A defensive walker also masks `value` / `real_value` on any nested `environment_variables[]` collection — absent at v4.1.2 but a leak vector on versions that inline it. `reveal: true` still round-trips plaintext. Mirrors the #204 / #206 posture.

## [2.13.0] - 2026-07-02

### Added

- **`scheduled_tasks` gains `run_once`** (#233, #245; closes #208) — one call runs a one-off command in an app/service container: creates a throwaway `* * * * *` task, polls `list_executions` every ~5s for the first terminal execution (poll budget `wait_seconds`, default 90), returns its `status` + `message` (the command's stdout), and deletes the task on success, timeout, _and_ error paths — with a loud warning carrying the task UUID if the delete itself fails. Caveat in the tool description: the underlying cron may fire more than once before cleanup completes, so make the command idempotent. Replaces the error-prone manual create → wait → list_executions → delete dance (documented as a gotcha in `site/concepts/coolify-api-gotchas.md`).
- **`deploy` gains `wait` + `timeout_seconds`** (#238, #246) — opt-in polling of the triggered deployment to a terminal status. On failure the response includes a bounded log tail (never the raw upstream payload); on timeout, the current status plus a hint to keep polling `deployment get`. Kills the "site returns 200 so the deploy worked" false positive — a deploy can fail while the old container keeps serving. When a tag matches several apps, the first deployment is watched and the rest are surfaced as `additional_deployment_uuids`.
- **`diagnose_app` cross-checks the latest deployment** (#239, #241) — an app that is `running` while its most recent deployment `failed`/`cancelled` is now flagged explicitly ("running container predates the last (failed) deployment — the app is serving stale code"), with the failed deployment's UUID and a pointer to its logs. No new API calls — reuses the deployments already fetched.
- **`application` tool gains `create_dockerfile`** (#235, #244) — exposes the existing `createApplicationDockerfile` client method (required: `project_uuid`, `server_uuid`, `dockerfile`). Note: `create_dockercompose` was deliberately NOT added — Coolify removed `POST /applications/dockercompose` upstream in v4.1.0; compose-based apps are created via the `service` tool. `CoolifyClient#createApplicationDockerCompose` is deprecated.
- **Client-vs-spec drift check** (#236, #247) — `npm run check:spec-drift` (wired into CI) extracts every path `coolify-client.ts` calls and fails if the bundled OpenAPI spec doesn't document it, closing the drift direction the weekly upstream-diff workflow couldn't see.

### Fixed

- **Scheduled-task `command` longer than 255 chars now fails locally with an actionable message** (#234, #243) — Coolify stores `command` in a varchar(255) column (confirmed from the upstream `create_scheduled_tasks_table` migration) and rejects longer commands with a bodyless HTTP 500. The tool schema now enforces `.max(255)` on create and update, before any HTTP call.
- **Bodyless HTTP errors carry hints for known causes** (#234, #243) — `request()` appends actionable context: 500 on scheduled-task paths → the command-length limit; 401/403 → check `COOLIFY_ACCESS_TOKEN` validity/scopes; 404 on a uuid-shaped route → the uuid may belong to a different resource type.
- **Bundled OpenAPI spec refreshed from upstream** (#236, #247) — 79 → 96 paths; scheduled-tasks, storages, and `/databases/{uuid}/envs*` endpoints (all called by the client) are now documented. All 101 client routes match the spec.

### Documentation

- **README documents multi-Coolify setups** (#164) — per-workspace MCP config (recommended) and named instances in global config. An in-server settings screen / repo auto-detection isn't possible in the MCP architecture (headless child processes, no repo context from clients).

## [2.12.1] - 2026-07-02

### Security

- **`deployment get` with `lines` no longer returns the raw upstream payload** (#232, #242) — requesting logs used to bypass the `toDeploymentEssential()` projection and return the full Coolify deployment object, embedding the application graph (rendered `docker_compose`, `custom_labels`, webhook secrets) and the destination server's settings including `logdrain_custom_config` (a live log-drain bearer token) and `sentinel_token` — ~78 KB for 5 log lines. `getDeployment()` and `listApplicationDeployments()` now always project through `toDeploymentEssential()` and attach only the log string when logs are requested; the raw upstream object never escapes the client. Regression tests assert no `logdrain` / `sentinel_token` / `manual_webhook_secret*` / `docker_compose` keys in the response and that a logs-included `get` stays under 20 KB against a bloated upstream payload.

### Fixed

- **`database create` accepts `destination_uuid`** (#217, #240, thanks @xwork1) — the Coolify API requires `destination_uuid` when a server has multiple destinations ("Server has multiple destinations. Please provide a destination_uuid."), but the `database` tool schema didn't expose it, so creates on such servers always failed. The client and types already supported the field end-to-end; it is now on the tool schema and forwarded through all 8 database create variants.

### Changed (typed-only)

- **`getDeployment` / `listApplicationDeployments` return types narrowed** (#242): `Promise<Deployment | DeploymentEssential>` → `Promise<DeploymentEssential>` (with optional `logs?: string` on `DeploymentEssential`). Programmatic consumers relying on raw `Deployment` fields from these methods must fetch what they need explicitly — the raw shape was the leak vector.

## [2.12.0] - 2026-05-30

### Security

- **`list_resources` masks webhook secrets and basic-auth credentials by default** (#204) — when `system({ action: 'list_resources', include_full: true })` is called, the per-resource fields `manual_webhook_secret_github` / `manual_webhook_secret_gitlab` / `manual_webhook_secret_gitea` / `manual_webhook_secret_bitbucket` and `http_basic_auth_password` are now replaced with `'***'` so an MCP client / LLM granted "list resources" cannot silently exfiltrate webhook HMAC signing keys or front-of-app passwords. Pass `reveal: true` alongside `include_full: true` to round-trip plaintext. Mirrors the v2.9.0 `env_vars` masking posture from #159 / #182. Applied at the API boundary in `listResources()` so any other code path also inherits masking by default.

### Fixed

- **`system list_resources` returns essential projection by default** (#203) — previously typed as `Promise<ResourceListItem[]>` but actually returned the full Coolify `/api/v1/resources` payload (~95 fields per row, ~16 KB per item, 500+ KB on instances with 30+ resources) which blew MCP token budgets and made the tool unusable for LLM-driven workflows. Now defaults to a true `{ uuid, name, type, status? }` projection applied at the API boundary. Set `include_full: true` to opt back into the raw Coolify payload. Mirrors the `include_logs` opt-in pattern from #158.
- **`is_build_time` typo bleed-in from #172** (#205) — test mock at `src/__tests__/coolify-client.test.ts:4335` and the `[2.11.0]` CHANGELOG entry both referenced the wrong underscored field name (`is_build_time`). The correct name is `is_buildtime` (one word) per #174 / v2.9.0; runtime code was already correct, this is doc + test-mock cleanup only.
- **`toResourceListItemEssential` guards `status` with `typeof`** — replaces an unchecked `item.status as string` cast. If a future Coolify version emits `status` as an object/null, the field is now dropped from the essential projection instead of silently violating the `ResourceListItem` interface.

### Changed (breaking, typed-only)

- **`listResources` signature** (#203, #204): `Promise<ResourceListItem[]>` → `Promise<ResourceListItem[] | ResourceListItemFull[]>` with new optional `options?: { include_full?: boolean; reveal?: boolean }` parameter. Programmatic consumers of `@masonator/coolify-mcp` will need to widen their result type (or narrow at the call site with `include_full`). Note: the previous type was wrong-at-runtime against real Coolify (claimed 4 fields, returned ~95), so any caller that worked end-to-end was already accommodating the bloated shape.

### Added (types)

- **`ResourceListItemFull` type** — `ResourceListItem & Record<string, unknown>`. Surfaces only when `include_full: true` is passed; documents that the full Coolify row carries arbitrary additional fields beyond the typed essentials.

## [2.11.0] - 2026-05-18

### Added (#172, thanks @opastorello)

Net tool count: 38 → 42 (after consolidation; original PR proposed 45 before review).

- **`storages` tool** — list/create/update/delete persistent or file storages for application/database/service. Single consolidated tool with action+resource pattern.
- **`scheduled_tasks` tool** — list/create/update/delete/list_executions for application or service. Consolidated.
- **`hetzner` tool** — list_locations, list_server_types, list_images, list_ssh_keys, create_server against the Coolify Hetzner cloud-provider endpoints. Requires a configured cloud-provider token UUID. The Coolify Hetzner routes are auth-scope-gated; the wiring is correct but the calling user needs the right token.
- **`system` tool** — health, list_resources, enable_api, disable_api against the instance. Consolidates what would have been three separate tools.
- **`env_vars` expanded** — adds `database` resource, `bulk_update` action, plus `is_preview` and `data[]` params on the existing actions. (`is_buildtime` and `is_runtime` have been on the schema since v2.9.0 / #174 — they are not new in this release.)
- **`github_apps` expanded** — adds `list_repos`, `list_branches` actions.
- **`database_backups` expanded** — adds `delete_execution` action.
- **`ResourceListItem` type** — concrete interface for `/api/v1/resources` responses with `uuid`, `name`, `type`, optional `status`. Replaces `Promise<unknown>` on the client method (no-implicit-any policy compliance).

### Changed (breaking, behavioural)

- **`delete_preview` moved into `application` tool** (#172) — was a standalone top-level tool, now `action: 'delete_preview'` on the existing `application` tool alongside create/update/delete/get/start/stop/restart. Callers must update tool invocations: `delete_preview({ application_uuid, pull_request_id })` → `application({ action: 'delete_preview', uuid, pull_request_id })`.
- **`health`, `list_resources`, `api_control` consolidated into `system` tool** (#172) — three standalone tools merged into one. Callers must update: `health()` → `system({ action: 'health' })`, `list_resources()` → `system({ action: 'list_resources' })`, `api_control({ enabled: true/false })` → `system({ action: 'enable_api' | 'disable_api' })`.
- **`storages` `update` action now requires `storage_uuid`** (#172) — previously not validated; the PATCH would send without the required field and silently fail. Now zod-validated; missing `storage_uuid` returns a guard error before the request is built.

### Internal

- Dependency bumps via dependabot (#184, #188): minor-and-patch group across two cycles — @types/node, eslint, lint-staged.
- Live-verified the new `system` tool's `health` and `list_resources` actions against a real Coolify instance; Hetzner routes confirmed wired (401 not 404) but require an instance with a properly-scoped token.

## [2.10.0] - 2026-05-14

### Added

- **Application build-config and `health_check_*` fields now wired through `create_*`** (#185 / #178, thanks @kashik0i) — eight build-config fields (`dockerfile_location`, `dockerfile_target_build`, `base_directory`, `publish_directory`, `install_command`, `build_command`, `start_command`, `watch_paths`) added to the `application` tool's zod schema; all twelve `health_check_*` fields plus the build-config fields now forwarded by `create_public`, `create_github`, `create_key`, and `create_dockerimage` handlers. Previously these were silently stripped, so e.g. `create_key` with `health_check_enabled: true, health_check_path: '/health'` produced an app with healthcheck off and default `/` path. Live-tested against Coolify v4 with GET round-trip verification of every field.

### Fixed

- **`dockerfile_target_build` accepted on `update`** (#185) — verified against Coolify's `ApplicationsController.php` allowlists that this field is UPDATE-only (present on the update allowlist at line 2497, absent from create allowlist at line 1014). Now correctly forwarded on the `update` action; intentionally not forwarded on any `create_*` action (Coolify would silently drop it).

### Internal

- **CLAUDE.md gotcha** (#185) — documented the CREATE vs UPDATE `$allowedFields` asymmetry in Coolify's `ApplicationsController.php`, with concrete examples for `dockerfile_target_build` and `create_dockerimage`. Captures the practical reality that Coolify's `openapi.yaml` is an incomplete projection of the real allowlists — always check the controller source before trusting the spec.

## [2.9.0] - 2026-05-11

### Security

- **`env_vars` list now masks values by default** (#159 / #182, thanks @daniel-rudaev for reporting) — `value` and `real_value` on `env_vars` list responses are now replaced with `***` so plaintext secrets are not leaked to MCP clients / LLMs. Metadata (uuid, key, `is_buildtime`, `is_runtime`, timestamps, ids) is untouched. Applied at the API boundary in `listApplicationEnvVars` and `listServiceEnvVars` so both the summary and full projections are protected. `bulk_env_update` continues to return `MessageResponse`-shape data with no values echoed.

### Changed (behavioural, may surprise existing callers)

- **`env_vars` list values are masked by default.** Callers that need the plaintext value must pass `reveal: true` on the `env_vars` list action (e.g. "what is FOO set to right now?"). The underlying client methods `listApplicationEnvVars(uuid, options)` and `listServiceEnvVars(uuid, options)` now accept `reveal?: boolean` on the options object.
- **Env var field names renamed to match Coolify API** (#174 / #135, thanks @kashik0i) — `is_build_time` → `is_buildtime` (one word) and new `is_runtime` flag. The previous `is_build_time` name was being rejected by the Coolify API with HTTP 422 on single endpoints and silently dropped on the bulk endpoint. Callers that were passing `is_build_time` were getting either errors or unchanged variables. Documented as a permanent gotcha in CLAUDE.md.

### Fixed

- **Defensive parsing for non-JSON responses** (#177 / #163, thanks @zxyasfas, @Erudition for reporting) — `request<T>()` now checks `Content-Type` and falls back to raw text when the server returns plain text or malformed JSON. Previously threw `SyntaxError: Unexpected token` on Coolify 4.0.0-beta.474 endpoints that started returning plain text. `application/json` and `+json` variants both supported; empty content-type treated as JSON for backward compat.
- **`is_runtime` flag now flows through `bulkEnvUpdate`** (#174) — was previously missing from the bulk-update signature, so PEM-key-shaped multiline secrets couldn't be set as runtime-only across multiple apps in one call.

### Internal

- Dependency bumps via dependabot (#170, #176, #180, #181): jest-junit, jest, lint-staged, and the minor-and-patch group of 8 dev-deps.
- Dependabot config now ignores TypeScript major-version bumps (#179) — TS 6.0.3 (#171) broke the build matrix; majors will be taken as deliberate migration PRs from now on.

## [2.8.1] - 2026-04-28

### Added

- **`--header` CLI flag for custom HTTP headers** (#167, thanks @imantsk) — Inject extra headers (e.g. `--header "CF-Access-Client-Id: ..." --header "CF-Access-Client-Secret: ..."`) on every outbound request. Useful for Cloudflare Zero Trust, custom auth proxies, and other middleware sitting in front of Coolify. Multiple `--header` flags can be combined. Reserved headers (`Authorization`, `Content-Type`) are filtered with a warning to prevent silently overriding the Coolify bearer token.

## [2.8.0] - 2026-04-28

### Added

- **`destination_uuid` on application create** (#161, thanks @barbe1bc) — Specify which Docker network destination on multi-destination Coolify hosts. Without it, hosts with multiple destinations silently fell back to the default destination.
- **`domains` field accepted on application create** (#162, thanks @barbe1bc) — Pass `domains` directly alongside the existing `fqdn` alias. Explicit `domains` wins when both are set.
- **`instant_deploy`, `custom_docker_run_options`, `custom_labels` on application create** (#162, thanks @barbe1bc) — All three were already accepted by Coolify; now exposed on the MCP tool surface.
- **`include_logs` opt-in on `deployment list_for_app`** (#158, thanks @kashik0i) — Set `include_logs: true` to retrieve raw build logs (default: false).

### Fixed

- **Silent drop of `fqdn` on dockerfile/dockerimage/dockercompose creates** (#162, thanks @barbe1bc) — `mapFqdnToDomains()` was applied on public/github/key paths but not on the docker-\* paths. Calls passing `fqdn` got an app with no domain and no error surfaced.
- **`listApplicationDeployments` response shape** (#158, thanks @kashik0i) — Now correctly parses Coolify's actual `{ count, deployments: [] }` envelope. Previously typed as `Promise<Deployment[]>` which was wrong-at-runtime — any caller using `.length` / `.map()` would crash against a real Coolify server.
- **MCP token budget on deployment listing** (#158, thanks @kashik0i) — `list_for_app` now returns `DeploymentEssential` summaries by default (no raw `logs` blobs). A typical 35-deployment response shrinks from ~1 MB to ~4 KB (~250×). Pass `include_logs: true` to opt back in.

### Changed (breaking, typed-only)

- **`listApplicationDeployments` signature** (#158): `Promise<Deployment[]>` → `Promise<{ count: number; deployments: Deployment[] | DeploymentEssential[] }>`. Programmatic consumers of `@masonator/coolify-mcp` will need to update destructuring. Note: the previous type was wrong-at-runtime against real Coolify, so any caller that worked end-to-end was already accommodating the envelope shape.

### Internal

- Fixed Claude Code workflows broken on OIDC token fetch (#165) — explicit `github_token`, current model IDs.
- Dependency bumps: dependabot/fetch-metadata 3, actions/github-script 9, action-gh-release 3 (#154, #155, #156); npm minor-and-patch group of 9 dev-deps (#160).

## [2.7.3] - 2026-02-25

### Changed

- **Repository metadata** - Updated GitHub repo description, homepage (stumason.dev), and topics
- **Package metadata** - Added author URL, homepage, bugs URL, and expanded keywords in package.json
- **MCP Registry** - Added `websiteUrl` to server.json
- **README** - Added stumason.dev to Related Links, MCP Registry link, author attribution in footer

## [2.7.2] - 2026-02-25

### Added

- **MCP Registry publishing** - Added `mcpName` field and `server.json` for publishing to the official MCP Registry as `io.github.StuMason/coolify`

## [2.7.1] - 2026-02-25

### Fixed

- **Documentation overhaul** - Comprehensive update to all project documentation:
  - Fixed stale tool counts across README.md and CLAUDE.md (35 → 38)
  - Fixed incorrect tool names in README (`get_server_resources` → `server_resources`, `get_server_domains` → `server_domains`)
  - Added detailed Available Tools entries for `teams`, `cloud_tokens`, `search_docs`, `github_apps`
  - Added deployment log `page` param and `logs_meta` to deployment tool docs
  - Added example prompts for documentation search, teams, and cloud provider management
  - Removed hardcoded tool count references from CLAUDE.md documentation standards

## [2.7.0] - 2026-02-25

### Added

- **`teams` tool** - Manage teams: list, get, get_members, get_current, get_current_members
- **`cloud_tokens` tool** - Manage cloud provider tokens (Hetzner/DigitalOcean): list, get, create, update, delete, validate
- **`search_docs` tool** - Search Coolify documentation using local full-text search (BM25 via MiniSearch). Fetches docs from coolify.io on first search, indexes 1500+ chunks, returns token-efficient results (~849 tokens for 5 results)
- **Version caching** - Cache Coolify server version on first API call, reducing redundant requests

## [2.6.6] - 2026-02-25

### Fixed

- **Deployment log truncation** - `lines` param now works correctly (#115):
  - Coolify returns deployment logs as a JSON array in a single line — `truncateLogs` was splitting on newlines and finding none
  - Now parses JSON array format, filters hidden entries (docker internals), formats as readable `[timestamp] output` lines
  - 96KB raw JSON → 771 chars for `lines: 10` (99.2% reduction)

### Added

- **Log pagination** - `page` param on deployment get with logs (#115):
  - Page 1 = most recent entries, page 2 = older batch, etc.
  - Returns `logs_meta` with `total_entries` and `showing` range
  - `_pagination` hints with `next`/`prev` tool calls, consistent with list endpoints

## [2.6.5] - 2026-02-25

### Changed

- **ESLint 10** - Upgraded from ESLint 9 to ESLint 10, added `@eslint/js` as explicit dependency (#123)
- **Dependency updates** - Bumped minor/patch dependencies (#127)

## [2.6.4] - 2026-02-25

### Fixed

- **Application deployments API path** - Correct endpoint path for listing application deployments (#120)
- **fqdn → domains mapping** - Map `fqdn` field to `domains` for Coolify API compatibility:
  - Coolify API uses `domains` field for setting application domain, not `fqdn`
  - Added `mapFqdnToDomains` helper that transparently converts `fqdn` to `domains`
  - Applied to `createApplicationPublic`, `createApplicationPrivateGH`, `createApplicationPrivateKey`, and `updateApplication`
  - Callers using `fqdn` field now work correctly without breaking changes

## [2.6.2] - 2026-01-31

### Fixed

- **Zod v4 Compatibility** - Require MCP SDK >=1.23.0 (#109):
  - SDK versions below 1.23.0 call `._parse()` which doesn't exist on Zod v4 schemas
  - Causes `keyValidator._parse is not a function` on all tools with parameters
  - Bumped SDK floor from `^1.6.1` to `^1.23.0` (first version with Zod v4 support)

## [2.6.1] - 2026-01-31

### Fixed

- **Version Mismatch** - Read VERSION dynamically from package.json (#106):
  - `get_mcp_version` was returning hardcoded `2.5.0` instead of `2.6.0`
  - VERSION is now read from `package.json` at runtime via `createRequire`
  - Added regression test to prevent future drift

- **Validation Error Crash** - Handle string validation errors from Coolify API (#107):
  - `messages.join is not a function` when creating services with `docker_compose_raw`
  - Coolify returns validation errors as plain strings for some fields, not arrays
  - Added `Array.isArray` guard before `.join()`
  - Widened `ErrorResponse.errors` type to `Record<string, string[] | string>`

- **Auto Base64 Encoding** - Encode `docker_compose_raw` automatically (#107):
  - Coolify API requires base64-encoded YAML but field name implies raw content
  - Client now auto-encodes in `createService`, `updateService`, `createApplicationDockerCompose`, and `updateApplication`
  - Passes through values that are already base64

### Added

- **Smoke Test Command** - `/smoke-test` slash command for live server verification
- **Integration Tests** - Smoke tests against real Coolify instance in `src/__tests__/integration/`

## [2.6.0] - 2026-01-27

### Added

- **HATEOAS-style Response Actions** - Add `_actions` to responses (#98, #99):
  - Responses now include contextual `_actions` array with suggested next tool calls
  - `get_application` returns actions like "View logs", "Restart", "Stop" based on app status
  - `deployment get` returns actions like "Cancel", "View app", "App logs"
  - `control` tool returns follow-up actions after start/stop/restart
  - `deploy` returns action to check deployment status
  - List endpoints (`list_applications`, `list_deployments`) include `_pagination` for next/prev

### Fixed

- **Deploy by UUID Broken** - Fix `deploy` tool UUID detection (#99):
  - Previously, `deployByTagOrUuid` always used `tag` query param
  - Now correctly detects Coolify-style UUIDs (24 char alphanumeric) and standard UUIDs
  - UUIDs use `uuid` query param, tag names use `tag` query param

- **Deployment Response Size** - Reduce default response from ~13k to <1k tokens (#98):
  - `deployment get` now returns essential fields by default (no logs)
  - Use `lines` parameter to include truncated logs when needed
  - Response includes `logs_info` field indicating log availability and size

- **env_vars Create Validation Error** - Remove `is_build_time` parameter (#97):
  - Coolify API rejects `is_build_time` on env var create despite OpenAPI docs
  - Removed parameter from schema to avoid misleading users

- **Environment Missing Database Types** - Include dragonfly/keydb/clickhouse in `environments get` (#88):
  - Coolify API omits these newer database types from environment endpoint
  - Cross-references with `list_databases` using lightweight summaries
  - Only adds fields if databases of those types exist in the environment

## [2.5.0] - 2026-01-15

### Added

- **Codecov Test Analytics** - Enable test result tracking (#84):
  - Added `jest-junit` reporter for JUnit XML output
  - CI workflow now uploads test results to Codecov
  - Enables flaky test detection and test performance tracking

### Fixed

- **Deployment Logs Massive Payload** - Add character-based truncation (#82):
  - `deployment` tool's `lines` parameter only limited line count, not characters
  - Giant log lines (base64, docker build output) could still return 900K+ chars
  - Fix: Default to last 200 lines AND cap at 50K characters
  - Added `max_chars` parameter for customization

- **Type Safety** - Eliminate all `as any` casts in MCP tool handlers (#81):
  - `application` handlers (create_public, create_github, create_key, create_dockerimage) now use explicit typed objects
  - `service` create handler uses explicit typed object
  - Removed `eslint-disable @typescript-eslint/no-explicit-any` directive
  - Fixed type definitions: `build_pack` and `ports_exposes` now optional for GitHub/Key deploys
  - Verified against Coolify v4.0.0-beta.460

## [2.4.0] - 2026-01-15

### Added

- **GitHub Apps Management** - Full CRUD operations for GitHub App integrations (#75):
  - `github_apps` tool with `list`, `get`, `create`, `update`, `delete` actions
  - `get` action returns full details by filtering list (no single-item API endpoint exists)
  - Uses integer ID (not UUID) for get/update/delete per Coolify API requirements
  - Token-optimized summary mode for list operations
  - Total tool count increased from 34 to 35 tools

### Fixed

- **MCP Tool Routing Fields Leak** - Strip `action` field before API calls (#76):
  - `application` and `service` tools were passing MCP-internal `action` field to Coolify API
  - Coolify API rejected with "action: This field is not allowed"
  - Fix: Destructure `{ action, uuid, delete_volumes, ...apiData }` and use `apiData` for API calls

## [2.3.0] - 2026-01-14

### Added

- **Public Repository Deployment** - Deploy from public Git repos without SSH keys (#70):
  - `application` tool now supports `create_public` action
  - Required fields: `project_uuid`, `server_uuid`, `git_repository`, `git_branch`, `build_pack`, `ports_exposes`
  - Thanks to [@gorquan](https://github.com/gorquan) for the contribution!

## [2.2.0] - 2026-01-14

### Added

- **Docker Image Deployment** - Deploy pre-built images from Docker Hub or registries (#69):
  - `application` tool now supports `create_dockerimage` action
  - Required fields: `project_uuid`, `server_uuid`, `docker_registry_image_name`, `ports_exposes`
  - Optional: `docker_registry_image_tag` (defaults to `latest`)

- **Health Check Configuration** - Configure application health checks during create/update (#62):
  - 12 health check fields now supported in `application` tool:
    - `health_check_enabled` - Enable/disable health checks
    - `health_check_path` - URL path for health check (e.g., `/up`, `/health`)
    - `health_check_port` - Port to check
    - `health_check_host` - Host for health check
    - `health_check_method` - HTTP method (GET, POST, etc.)
    - `health_check_return_code` - Expected HTTP status code
    - `health_check_scheme` - HTTP or HTTPS
    - `health_check_response_text` - Expected response text
    - `health_check_interval` - Seconds between checks
    - `health_check_timeout` - Seconds to wait for response
    - `health_check_retries` - Number of retries before marking unhealthy
    - `health_check_start_period` - Seconds to wait before starting checks

- **Deployment Log Line Limiting** - Reduce token usage for large deployment logs (#68):
  - `deployment` tool `get` action now supports `lines` parameter
  - Returns only the last N lines of logs when specified
  - Example: `deployment(action: 'get', uuid: 'xxx', lines: 50)`

### Changed

- **Improved Validation Errors** - API validation errors now include field-level details (#69):
  - Errors like "Validation failed." now include: "Validation failed. - field: error message"
  - Multiple validation errors per field are comma-separated
  - Multiple fields are semicolon-separated

## [2.1.0] - 2026-01-07

### Added

- **Full Database Backup Management** - Complete lifecycle management for database backup schedules:
  - `database_backups` tool now supports `create`, `update`, and `delete` actions
  - Configure backup frequency (hourly, daily, weekly, monthly)
  - Set retention policies (days or amount limits for local and S3 storage)
  - Enable/disable backup schedules without deletion
  - S3 storage integration for off-server backups
  - All backup configuration parameters supported:
    - `frequency` - Cron expression or predefined schedule
    - `enabled` - Enable/disable the backup schedule
    - `save_s3` - Store backups in S3-compatible storage
    - `s3_storage_uuid` - Which S3 storage to use
    - `database_backup_retention_days_locally` - Days to keep backups locally (0 = unlimited)
    - `database_backup_retention_days_s3` - Days to keep backups in S3 (0 = unlimited)
    - `database_backup_retention_amount_locally` - Number of most recent backups to keep locally
    - `database_backup_retention_amount_s3` - Number of most recent backups to keep in S3
    - `databases_to_backup` - Specific databases to backup (for applicable database types)
    - `dump_all` - Dump all databases (for applicable database types)

### Changed

- `database_backups` tool actions expanded from 4 to 7: `list_schedules`, `get_schedule`, `list_executions`, `get_execution`, `create`, `update`, `delete`

## [2.0.0] - 2026-01-06

### Breaking Changes - Token Diet Release 🏋️

**v2.0.0 is a complete rewrite of the MCP tool layer focused on drastically reducing token usage.**

- **Token reduction: ~43,000 → ~6,600 tokens** (85% reduction)
- **Tool count: 77 → 34 tools** (56% reduction)
- All prompts removed (7 prompts were unused)

### Changed

- **Consolidated tools** - Related operations now share a single tool with action parameters:
  - Server: `server_resources`, `server_domains`, `validate_server` (separate focused tools)
  - Projects: `projects` tool with `action: list|get|create|update|delete`
  - Environments: `environments` tool with `action: list|get|create|delete`
  - Applications: `application` tool with `action: create_github|create_key|update|delete`
  - Databases: `database` tool with `action: create|delete` and `type: postgresql|mysql|mariadb|mongodb|redis|keydb|clickhouse|dragonfly`
  - Services: `service` tool with `action: create|update|delete`
  - Control: `control` tool for start/stop/restart across applications, databases, services
  - Env vars: `env_vars` tool for CRUD across applications and services
  - Private keys: `private_keys` tool with `action: list|get|create|update|delete`
  - Backups: `database_backups` tool with `action: list|get|list_executions|get_execution`
  - Deployments: `deployment` tool with `action: get|cancel|list_for_app`

- **Terse descriptions** - All tool descriptions minimized for token efficiency

### Removed

- All 7 MCP prompts (`debug-app`, `health-check`, `deploy-app`, `troubleshoot-ssl`, `restart-project`, `env-audit`, `backup-status`)
- `get_infrastructure_overview` moved to inline implementation in `get_infrastructure_overview` tool (simpler)

### Migration Guide

Most v1.x tool names still exist unchanged:

- `get_version`, `get_mcp_version` - unchanged
- `list_servers`, `get_server` - unchanged
- `list_applications`, `get_application`, `get_application_logs` - unchanged
- `list_databases`, `get_database` - unchanged
- `list_services`, `get_service` - unchanged
- `list_deployments`, `deploy` - unchanged
- `diagnose_app`, `diagnose_server`, `find_issues` - unchanged
- `restart_project_apps`, `bulk_env_update`, `stop_all_apps`, `redeploy_project` - unchanged

Consolidated tools (use action parameter):

- `create_project` → `projects` with `action: 'create'`
- `delete_project` → `projects` with `action: 'delete'`
- `create_postgresql` → `database` with `action: 'create', type: 'postgresql'`
- `start_application` → `control` with `resource: 'application', action: 'start'`
- `create_application_env` → `env_vars` with `resource: 'application', action: 'create'`

## [1.6.0] - 2026-01-06

### Added

- **Database Creation Tools** - Full CRUD support for all database types:
  - `create_postgresql` - Create PostgreSQL databases
  - `create_mysql` - Create MySQL databases
  - `create_mariadb` - Create MariaDB databases
  - `create_mongodb` - Create MongoDB databases
  - `create_redis` - Create Redis databases
  - `create_keydb` - Create KeyDB databases
  - `create_clickhouse` - Create ClickHouse databases
  - `create_dragonfly` - Create Dragonfly databases (Redis-compatible)

### Changed

- Total tool count increased from 67 to 75 tools
- Database tools section now has 14 tools (was 6)

## [1.5.0] - 2026-01-06

### Fixed

- `delete_environment` now uses correct API path `/projects/{project_uuid}/environments/{environment_name_or_uuid}` (breaking: now requires `project_uuid` parameter)

### Changed

- Claude Code review workflow now only runs on PR creation (not every push)
- Upgraded to Prettier 4.0

### Removed

- Obsolete documentation files in `docs/features/` (14 ADR files) and `docs/mcp-*.md` files (~7,700 lines removed)

## [1.1.1] - 2026-01-05

### Changed

- **Dependency Updates** - Major upgrade to latest secure versions:
  - ESLint 8→9 with new flat config format
  - zod 3→4
  - @types/node 20→25
  - dotenv 16→17
  - lint-staged 15→16
  - eslint-config-prettier 9→10
  - @typescript-eslint packages 7→8

### Added

- Auto-delete branches on merge
- Dependabot auto-merge for patch/minor updates
- Weekly OpenAPI drift detection (monitors Coolify API changes)
- Claude Code review on PRs
- CONTRIBUTING.md with maintenance documentation

## [1.1.0] - 2026-01-05

### Added

- `delete_database` - Delete databases with optional volume cleanup (completes database CRUD)
- `get_mcp_version` - Get the coolify-mcp server version (useful to verify which version is installed)

### Changed

- Total tool count increased from 65 to 67 tools

## [1.0.0] - 2026-01-03

### Added

- **MCP Prompts - Workflow Templates** - Pre-built guided workflows that users can invoke:
  - `debug-app` - Comprehensive application debugging (gathers logs, status, env vars, deployments)
  - `health-check` - Full infrastructure health analysis
  - `deploy-app` - Step-by-step deployment wizard from Git repository
  - `troubleshoot-ssl` - SSL/TLS certificate diagnosis workflow
  - `restart-project` - Safely restart all apps in a project with status monitoring
  - `env-audit` - Audit and compare environment variables across applications
  - `backup-status` - Check database backup status and history

### Changed

- **v1.0.0 Milestone** - Production-ready with 65 tools and 7 prompt templates

## [0.9.0] - 2026-01-03

### Added

- **Batch Operations** - Power user tools for operating on multiple resources at once:
  - `restart_project_apps` - Restart all applications in a project
  - `bulk_env_update` - Update or create an environment variable across multiple applications (upsert behavior)
  - `stop_all_apps` - Emergency stop all running applications (requires confirmation)
  - `redeploy_project` - Redeploy all applications in a project with force rebuild

- `BatchOperationResult` type for standardized batch operation responses with success/failure tracking

### Changed

- Total tool count increased from 61 to 65 tools

## [0.8.1] - 2026-01-03

### Changed

- **Environment variable responses now use summary mode** - `list_application_envs` now returns only essential fields (uuid, key, value, is_build_time) instead of 20+ fields, reducing response sizes by ~80% and preventing context window exhaustion

### Added

- `EnvVarSummary` type for optimized env var responses

## [0.8.0] - 2026-01-03

### Added

- **Smart Diagnostic Tools** - Composite tools that aggregate multiple API calls into single, context-optimized responses for debugging:
  - `diagnose_app` - Get comprehensive app diagnostics (status, logs, env vars, deployments). Accepts UUID, name, or domain (e.g., "stuartmason.co.uk")
  - `diagnose_server` - Get server diagnostics (status, resources, domains, validation). Accepts UUID, name, or IP address
  - `find_issues` - Scan infrastructure for unhealthy apps, databases, services, and unreachable servers

- **Smart Lookup** - Diagnostic tools now accept human-friendly identifiers:
  - Applications: UUID, name, or domain (FQDN)
  - Servers: UUID, name, or IP address

### Changed

- Total tool count increased from 58 to 61 tools

## [0.7.1] - 2026-01-02

### Fixed

- Add `repository` field to package.json for npm trusted publishing

## [0.7.0] - 2026-01-02

### Added

- **Private Keys CRUD** - Full management of SSH deploy keys:
  - `list_private_keys` - List all private keys
  - `get_private_key` - Get private key details
  - `create_private_key` - Create a new private key for deployments
  - `update_private_key` - Update a private key
  - `delete_private_key` - Delete a private key

- **Database Backups** - Monitor and manage database backup schedules and executions:
  - `list_database_backups` - List scheduled backups for a database
  - `get_database_backup` - Get details of a scheduled backup
  - `list_backup_executions` - List execution history for a scheduled backup
  - `get_backup_execution` - Get details of a specific backup execution

- **Deployment Control**:
  - `cancel_deployment` - Cancel a running deployment

### Changed

- Total tool count increased from 47 to 58 tools
- Updated to Coolify API v460 specification

## [0.6.0] - 2026-01-02

### Changed

- **BREAKING: List endpoints now return summaries by default** - All `list_*` tools now return optimized summary responses instead of full API responses. This reduces response sizes by 90-99%, preventing context window exhaustion in AI assistants.
  - `list_servers` returns: uuid, name, ip, status, is_reachable
  - `list_projects` returns: uuid, name, description
  - `list_applications` returns: uuid, name, status, fqdn, git_repository, git_branch
  - `list_databases` returns: uuid, name, type, status, is_public
  - `list_services` returns: uuid, name, type, status, domains
  - `list_deployments` returns: uuid, deployment_uuid, application_name, status, created_at

### Added

- `get_infrastructure_overview` - New composite tool that returns a high-level view of all infrastructure (servers, projects, applications, databases, services) in a single call with graceful error handling. If one resource type fails to load, the others still return. Start here to understand your Coolify setup.

### Fixed

- Improved type safety in `get_infrastructure_overview` - removed `as unknown[]` casts
- Added defensive `Array.isArray()` checks to all summary transformers for robustness
- `get_infrastructure_overview` now uses `Promise.allSettled` for graceful degradation - if one API call fails, others still return with errors reported separately

### Migration from v0.5.0

No code changes required! The changes are automatic:

- All `list_*` tools now return summaries instead of full responses
- If you need full details, use `get_*` tools (e.g., `get_server(uuid)` instead of relying on `list_servers`)
- The `summary` parameter has been removed from tool inputs - summaries are now always returned for list operations
- New recommended workflow: `get_infrastructure_overview` → `list_*` → `get_*` → action

### Why This Change?

The Coolify API returns extremely verbose responses. A single application contains 91 fields including embedded 3KB server objects, 2-4KB base64 Traefik labels, and docker-compose files up to 47KB. When listing 20+ applications, responses exceeded 200KB, which quickly exhausted the context window of AI assistants like Claude Desktop, making the MCP server unusable for real infrastructure.

**Before v0.6.0:**

- `list_applications` (21 apps): ~170KB response
- `list_services` (13 services): ~367KB response

**After v0.6.0:**

- `list_applications` (21 apps): ~4.4KB response (97% reduction)
- `list_services` (13 services): ~1.2KB response (99% reduction)

Use `get_*` tools (e.g., `get_application`) when you need full details for a specific resource.

## [0.5.0] - 2026-01-02

### Added

- `create_service` - Create one-click services (pocketbase, mysql, redis, wordpress, etc.) via type or docker_compose_raw
- `delete_service` - Delete a service with options for cleanup

## [0.4.0] - 2025-12-XX

### Added

- Summary transformers for all list endpoints (client-side support)
- Pagination support for list endpoints
- 100% test coverage

## [0.3.0] - 2025-12-XX

### Added

- Initial release with 46 tools for Coolify management
- Server, Project, Environment, Application, Database, Service, and Deployment management
- Environment variable CRUD operations
- Application deployment from private GitHub repos
