# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.1] - 2026-01-02

### Changed

- **BREAKING: List endpoints now return summaries by default** - All `list_*` tools now return optimized summary responses instead of full API responses. This reduces response sizes by 90-99%, preventing context window exhaustion in AI assistants.
  - `list_servers` returns: uuid, name, ip, status
  - `list_projects` returns: uuid, name, description
  - `list_applications` returns: uuid, name, status, fqdn, git_repository
  - `list_databases` returns: uuid, name, type, status
  - `list_services` returns: uuid, name, type, status, domains
  - `list_deployments` returns: uuid, deployment_uuid, application_name, status

### Added

- `get_infrastructure_overview` - New composite tool that returns a high-level view of all infrastructure (servers, projects, applications, databases, services) in a single call. Start here to understand your Coolify setup.

### Why This Change?

The Coolify API returns extremely verbose responses. A single application contains 91 fields including embedded 3KB server objects, 2-4KB base64 Traefik labels, and docker-compose files up to 47KB. When listing 20+ applications, responses exceeded 200KB, which quickly exhausted the context window of AI assistants like Claude Desktop, making the MCP server unusable for real infrastructure.

**Before v0.5.1:**

- `list_applications` (21 apps): ~170KB response
- `list_services` (13 services): ~367KB response

**After v0.5.1:**

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
