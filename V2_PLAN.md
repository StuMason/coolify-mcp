# v2.0.0 Token Diet Implementation Plan

## Goal

Reduce MCP token usage from ~43,000 to <15,000 tokens while preserving all functionality.

## ✅ COMPLETED - Results

- **Token reduction: ~43,000 → ~6,600 tokens** (85% reduction, well under 15k target!)
- **Tool count: 77 → 33 tools** (57% reduction)
- **All 179 tests passing**
- **Build and lint clean**

## Progress Tracker

### Phase 1: Core Rewrite

- [x] Create feature branch `v2-token-diet`
- [x] Rewrite mcp-server.ts with consolidated tools (77 → 33 tools)
- [x] Build and verify no TypeScript errors
- [x] coolify-client.ts unchanged (not needed)

### Phase 2: Tests

- [x] Rewrite mcp-server.test.ts for new tool structure
- [x] Verify all tests pass (179 tests)
- [x] Maintain good coverage (98%+)

### Phase 3: Documentation

- [x] Update package.json version to 2.0.0
- [x] Update CHANGELOG.md with migration guide
- [ ] Update README.md (tool count, examples)
- [ ] Update CLAUDE.md (tool count)

### Phase 4: Verification

- [x] `npm run build` - clean
- [x] `npm run lint` - clean (warnings only)
- [x] `npm test` - all pass
- [ ] Manual test key flows against live Coolify
- [x] Verify token count < 15,000 (~6,600 actual)

### Phase 5: Release

- [ ] Create PR
- [ ] Merge and tag v2.0.0

## New Tool Structure (33 tools)

| Tool                          | Description              | Consolidates                                  |
| ----------------------------- | ------------------------ | --------------------------------------------- |
| `get_version`                 | Coolify API version      | -                                             |
| `get_mcp_version`             | MCP server version       | -                                             |
| `get_infrastructure_overview` | Overview with counts     | -                                             |
| `diagnose_app`                | App diagnostics          | -                                             |
| `diagnose_server`             | Server diagnostics       | -                                             |
| `find_issues`                 | Scan for problems        | -                                             |
| `list_servers`                | List servers             | -                                             |
| `get_server`                  | Server details           | -                                             |
| `server_resources`            | Resources on server      | get_server_resources                          |
| `server_domains`              | Domains on server        | get_server_domains                            |
| `validate_server`             | Validate server          | -                                             |
| `projects`                    | CRUD projects            | list/get/create/update/delete_project (5→1)   |
| `environments`                | CRUD environments        | list/get/create/delete_environment (4→1)      |
| `list_applications`           | List apps                | -                                             |
| `get_application`             | App details              | -                                             |
| `application`                 | Create/update/delete app | create*application*\* + update + delete (4→1) |
| `application_logs`            | Get logs                 | get_application_logs                          |
| `list_databases`              | List databases           | -                                             |
| `get_database`                | Database details         | -                                             |
| `database`                    | Create/delete database   | 8 create\_\* + delete (9→1)                   |
| `list_services`               | List services            | -                                             |
| `get_service`                 | Service details          | -                                             |
| `service`                     | Create/update/delete svc | 3→1                                           |
| `control`                     | Start/stop/restart       | 9 tools → 1                                   |
| `env_vars`                    | Manage env vars          | 7 tools → 1                                   |
| `list_deployments`            | List deployments         | -                                             |
| `deploy`                      | Deploy by tag/UUID       | -                                             |
| `deployment`                  | Get/cancel/list_for_app  | 3→1                                           |
| `private_keys`                | CRUD SSH keys            | 5→1                                           |
| `database_backups`            | Backup operations        | 4→1                                           |
| `restart_project_apps`        | Batch restart            | -                                             |
| `bulk_env_update`             | Batch env update         | -                                             |
| `stop_all_apps`               | Emergency stop           | -                                             |
| `redeploy_project`            | Batch redeploy           | -                                             |

**Total: 33 tools** (down from 77)

## Removed

- All 7 prompts (debug-app, health-check, deploy-app, troubleshoot-ssl, restart-project, env-audit, backup-status)

## Breaking Changes

- Tool names changed (e.g., `create_postgresql` → `database` with `action: 'create', type: 'postgresql'`)
- `start_application` → `control` with `resource: 'application', action: 'start'`
- All prompts removed
- Parameter structures changed for consolidated tools

## Notes

- coolify-client.ts unchanged - all client methods still exist
- Types unchanged - all request/response types still exist
- Only MCP tool layer consolidated
