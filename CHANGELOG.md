# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.1] - 2026-01-05

### Fixed

- `delete_environment` now uses correct API path `/projects/{project_uuid}/environments/{environment_name_or_uuid}` (breaking: now requires `project_uuid` parameter)

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
