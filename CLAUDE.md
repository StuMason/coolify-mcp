# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MCP (Model Context Protocol) server for Coolify that provides 35 token-optimized tools for AI assistants to manage infrastructure through natural language. Tools cover servers, projects, environments, applications, databases, services, deployments, private keys, smart diagnostics, and batch operations. v2.0.0 reduced token usage by 85% (from ~43,000 to ~6,600 tokens) by consolidating related operations into single tools with action parameters.

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
- **docs/openapi-chunks/** - OpenAPI spec chunks for reference

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
- **Endpoint paths can be misleading** — Some endpoints have unconventional paths (e.g., `/deployments/applications/{uuid}` not `/applications/{uuid}/deployments`). Always verify against `docs/coolify-openapi.yaml`.
- **OpenAPI chunks may be incomplete** — The chunked files in `docs/openapi-chunks/` may not include all endpoints. The main `docs/coolify-openapi.yaml` is the source of truth.

### Endpoint Verification Workflow

Before adding or modifying client methods:

1. **Search the main OpenAPI spec** — Use grep to find the exact endpoint path in `docs/coolify-openapi.yaml`:
   ```bash
   grep -n "operationId: your-operation" docs/coolify-openapi.yaml
   ```

2. **Verify the path pattern** — Coolify doesn't always follow REST conventions. Resource paths can be inverted (e.g., `/deployments/applications/{uuid}` instead of `/applications/{uuid}/deployments`).

3. **Test against live server** — After implementation, use `/smoke-test` or `npm run test:integration` to verify the endpoint works against a real Coolify instance. Unit tests with mocked responses won't catch path errors.

4. **Document non-obvious paths** — If an endpoint path is surprising, add a comment in the client method explaining the correct path and why.

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
   - Tool count changes (update "34 tools" in Features section)
   - New tools added (add to appropriate category in Available Tools)
   - New example prompts needed
   - Response size improvements made (update comparison table)

3. **This file (CLAUDE.md)** - Update tool count if changed (currently 35 tools)

Always work on a feature branch and include documentation updates in the same PR as code changes.
