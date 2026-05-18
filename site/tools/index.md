# Tools reference

All 42 tools in coolify-mcp v2.11, grouped by concern. The full canonical list is registered in [`src/lib/mcp-server.ts`](https://github.com/StuMason/coolify-mcp/blob/main/src/lib/mcp-server.ts).

> Tools marked **read-only** are safe to let your MCP client run without per-call confirmation. Tools marked **destructive** change state and should be confirmed — v3 will surface these via `destructiveHint` annotations (see [v3 vision](/roadmap/v3-vision)).

## Infrastructure

| Tool                          | Type  | What it does                                                            |
| ----------------------------- | ----- | ----------------------------------------------------------------------- |
| `get_version`                 | read  | Coolify API version                                                     |
| `get_mcp_version`             | read  | This MCP server's version                                               |
| `system`                      | mixed | `action: 'health' \| 'list_resources' \| 'enable_api' \| 'disable_api'` |
| `get_infrastructure_overview` | read  | Compact map of every server / project / app                             |
| `find_issues`                 | read  | Scan infrastructure for problems                                        |

## Servers

| Tool               | Type  | What it does                                   |
| ------------------ | ----- | ---------------------------------------------- |
| `list_servers`     | read  | All servers with uuid + name + status          |
| `get_server`       | read  | Full server detail                             |
| `server_resources` | read  | Apps / databases / services on a server        |
| `server_domains`   | read  | Domains configured on a server                 |
| `validate_server`  | read  | Verify connection / config                     |
| `diagnose_server`  | read  | Aggregated health snapshot                     |
| `private_keys`     | mixed | List / get / create / update / delete SSH keys |

## Projects + Environments

| Tool                   | Type            | What it does                                               |
| ---------------------- | --------------- | ---------------------------------------------------------- |
| `projects`             | mixed           | List / get / create / update / delete                      |
| `environments`         | mixed           | List / get / create / delete environments within a project |
| `redeploy_project`     | destructive     | Redeploy every app in a project                            |
| `restart_project_apps` | destructive     | Restart every app in a project                             |
| `stop_all_apps`        | **DESTRUCTIVE** | Emergency: stop every running app                          |

## Applications

| Tool                | Type        | What it does                                                                                                                                                                                |
| ------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_applications` | read        | All apps with summaries                                                                                                                                                                     |
| `get_application`   | read        | Full app detail                                                                                                                                                                             |
| `application`       | mixed       | The big one. `action: 'create_public' \| 'create_github' \| 'create_key' \| 'create_dockerimage' \| 'update' \| 'delete' \| 'start' \| 'stop' \| 'restart' \| 'deploy' \| 'delete_preview'` |
| `application_logs`  | read        | Stream/fetch logs                                                                                                                                                                           |
| `deploy`            | destructive | Deploy by tag or uuid                                                                                                                                                                       |
| `deployment`        | mixed       | List / get / cancel deployments                                                                                                                                                             |
| `diagnose_app`      | read        | Aggregated app health + deployment + log snapshot                                                                                                                                           |

## Databases

| Tool               | Type  | What it does                                                                                                                        |
| ------------------ | ----- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `list_databases`   | read  | All databases                                                                                                                       |
| `get_database`     | read  | Full database detail                                                                                                                |
| `database`         | mixed | `action: 'create_postgresql' \| 'create_mysql' \| ... 'update' \| 'delete' \| 'start' \| 'stop' \| 'restart'` (8 engines supported) |
| `database_backups` | mixed | List / get / create / update / delete backups + executions                                                                          |

## Services

| Tool            | Type  | What it does                         |
| --------------- | ----- | ------------------------------------ |
| `list_services` | read  | All services                         |
| `get_service`   | read  | Full service detail                  |
| `service`       | mixed | Create / update / delete / lifecycle |

## Environment variables

| Tool              | Type        | What it does                                                                                                                                        |
| ----------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `env_vars`        | mixed       | `action: 'list' \| 'create' \| 'update' \| 'delete'` for app / service / database. List masks values by default; pass `reveal: true` for plaintext. |
| `bulk_env_update` | destructive | Set one key across many apps in a single call                                                                                                       |

## Operations

| Tool              | Type        | What it does                                                                                                                                     |
| ----------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `storages`        | mixed       | Persistent or file storages for app / database / service                                                                                         |
| `scheduled_tasks` | mixed       | CRUD + `list_executions` for app or service                                                                                                      |
| `control`         | destructive | Generic start / stop / restart by uuid                                                                                                           |
| `hetzner`         | mixed       | `action: 'list_locations' \| 'list_server_types' \| 'list_images' \| 'list_ssh_keys' \| 'create_server'` (requires hetzner cloud-provider token) |

## Cloud + auth

| Tool           | Type  | What it does                                                     |
| -------------- | ----- | ---------------------------------------------------------------- |
| `cloud_tokens` | mixed | CRUD for cloud-provider tokens (Hetzner, AWS, etc.)              |
| `github_apps`  | mixed | List / create / update / delete + `list_repos` / `list_branches` |
| `teams`        | read  | List teams, members, current user's team                         |

## Documentation

| Tool          | Type | What it does                                                                                                   |
| ------------- | ---- | -------------------------------------------------------------------------------------------------------------- |
| `search_docs` | read | Local MiniSearch over the chunked Coolify OpenAPI — answers "what fields does X accept?" without network calls |
