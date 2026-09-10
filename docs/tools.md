# Tool reference

Every tool a default install exposes, grouped by what it touches. Run any tool
with no arguments and it lists the actions and parameters it accepts; that
listing is generated from the schema, so it is always current.

The count is not hand-maintained: `npm run check:tool-count` reads the
CI-gated tool roster (`evals/src/contract/__toolsnaps__/_roster.json`) and
fails if the README, `package.json` or `CLAUDE.md` disagree with it, or if
the table below misses a tool the roster has.

## The surface

| Category             | Tools                                                                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Infrastructure**   | `get_infrastructure_overview`, `get_mcp_version`, `get_version`, `system` (health, list_resources, enable/disable API)                                                    |
| **Diagnostics**      | `diagnose_app`, `diagnose_server`, `find_issues`                                                                                                                          |
| **Batch Operations** | `restart_project_apps`, `bulk_env_update`, `stop_all_apps`, `redeploy_project`                                                                                            |
| **Servers**          | `list_servers`, `get_server`, `validate_server`, `server_resources`, `server_domains`, `list_destinations`                                                                |
| **Projects**         | `projects` (list, get, create, update, delete via action param)                                                                                                           |
| **Environments**     | `environments` (list, get, create, delete, verify_app — prove an app is bound to an exact project environment — via action param)                                         |
| **Applications**     | `list_applications`, `get_application`, `application` (CRUD + delete_preview)                                                                                             |
| **Databases**        | `list_databases`, `get_database`, `database` (create 8 types, update incl. public port, delete), `database_backups` (CRUD schedules, executions incl. delete)             |
| **Services**         | `list_services`, `get_service`, `service` (create, update, delete, list_containers; per-container `update_application` + `start/stop/restart_application`, Coolify v4.2+) |
| **Control**          | `control` (start/stop/restart for apps, databases, services)                                                                                                              |
| **Logs**             | `logs` (container logs for app, database, service; services need `container`), `application_logs` (superseded by `logs`)                                                  |
| **Tags**             | `tags` (list, attach, detach for apps, databases, services; tag resources then `deploy` them together; Coolify v4.2+)                                                     |
| **Env Vars**         | `env_vars` (CRUD + bulk_update for application, service, and database env vars)                                                                                           |
| **Storages**         | `storages` (list, create, update, delete persistent/file storages for apps, databases, services)                                                                          |
| **Scheduled Tasks**  | `scheduled_tasks` (list, create, update, delete, list_executions, run_once for apps and services)                                                                         |
| **Deployments**      | `list_deployments`, `deploy` (incl. wait-to-terminal-status), `deployment` (get, cancel, list_for_app)                                                                    |
| **Private Keys**     | `private_keys` (list, get, create, update, delete via action param)                                                                                                       |
| **GitHub Apps**      | `github_apps` (list, get, create, update, delete, list_repos, list_branches)                                                                                              |
| **Teams**            | `teams` (list, get, get_members, get_current, get_current_members)                                                                                                        |
| **Cloud Tokens**     | `cloud_tokens` (Hetzner/DigitalOcean: list, get, create, update, delete, validate)                                                                                        |
| **Hetzner Cloud**    | `hetzner` (list_locations, list_server_types, list_images, list_ssh_keys, create_server)                                                                                  |
| **Documentation**    | `search_docs` (full-text search across Coolify docs)                                                                                                                      |

With two or more instances configured ([fleet mode](fleet.md)) every tool
also takes an optional `instance`, and one extra tool, `list_instances`,
appears. Single-instance installs never see either.

## How the surface is shaped

- **Consolidated by action.** Related operations share one tool with an
  `action` parameter, so the whole tool list costs roughly 6,600 tokens
  instead of the 43,000 a tool-per-endpoint design cost in v1. The server
  should not eat your context window before you have asked anything.
- **Summaries by default.** `list_*` tools return `uuid`/`name`/`status`
  projections, 90–99% smaller than the raw API measured against a real 21-app
  estate. `get_*` tools fetch full detail for one resource.
- **Smart lookup.** `diagnose_app` takes a UUID, name or domain;
  `diagnose_server` takes a UUID, name or IP.
- **Actionable responses.** Results carry `_actions` hints (view logs,
  restart, next page) so the assistant knows the logical next step without
  extra tokens.
- **Verified deploys.** `deploy` with `wait: true` polls to a terminal status
  and returns a log tail on failure, instead of "the site returns 200 so it
  probably worked".
- **Oriented.** The server's `instructions` field (sent on `initialize`,
  before any tool definition) describes this shape, the safety boundary and
  the version-sensitive calls, so a client that defers tool definitions still
  starts with the map. Snapshotted in `evals/` like the tool list.
- **Measured.** Tool descriptions are prompts, so `evals/` checks that a model
  picks the right tool from this surface and that attacker-controlled tool
  output cannot make it misbehave. See [evals/README.md](../evals/README.md).

## Coolify version compatibility

Tested against Coolify v4.0 through v4.3 (`doctor` reports the exact range
for the release you have). Two v4.2 changes are worth knowing about:

- **Secrets are hidden by default.** From v4.2 Coolify strips sensitive
  fields from API responses unless the token has sensitive-read scope. For
  `env_vars`, the exact-key `reveal: true` path reports a capability error
  when the server withholds the value; issue a token with sensitive-read
  scope if you need plaintext back.
- **Member-role tokens are read-only.** From v4.2 a token belonging to a
  Member-role user can view resources but cannot deploy, start, stop, create,
  update or delete. Those calls return 403. Promote the user or use a token
  from a role with write access. `doctor` names this case when it sees it.

State-changing endpoints also moved from GET to POST in v4.2. The client
handles this for you across both eras, so no action is needed.

## Gotchas the tools already handle

These are the upstream quirks that cost users time before the tools absorbed
them. You should not have to think about any of them, but they explain some
otherwise odd-looking behaviour.

- **`delete_volumes` defaults to `true` upstream** on every delete endpoint.
  Leaving it unset is the destructive choice, not the cautious one, and the
  confirmation prompt says so. Only an explicit `false` preserves data.
- **Every production application env var has a preview twin.** Coolify
  auto-creates an `is_preview` row alongside each production row and lists
  both. Two rows per key is normal; never "dedupe" them.
- **`env_vars` uses `is_buildtime` and `is_runtime`** (one word each). The
  two-word spelling is silently ignored by the bulk endpoint upstream.
- **`docker_compose_raw` must be base64.** The client encodes plain YAML for
  you.
- **`GET /applications` carries neither `project_uuid` nor `server_uuid`.**
  Project filtering goes through the project's environment ids; server counts
  go through `destination.server_id` (and Coolify's built-in localhost server
  is id `0`, which is falsy).
- **Compose-based applications are services.** `POST /applications/dockercompose`
  was removed upstream in v4.1.0; use the `service` tool.

The full list, with the upstream references, lives in [CLAUDE.md](../CLAUDE.md#coolify-api-gotchas).
