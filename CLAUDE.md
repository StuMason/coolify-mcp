# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MCP (Model Context Protocol) server for Coolify that provides 67 tools and 7 workflow prompts for AI assistants to manage infrastructure through natural language. Tools cover servers, projects, environments, applications, databases, services, deployments, private keys, smart diagnostics, and batch operations. Prompts provide guided workflows for debugging, deployment, health checks, and more.

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
5. Add mocked test

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
   - Tool count changes (update "67 tools" in Features section)
   - New tools added (add to appropriate category in Available Tools)
   - New example prompts needed
   - Response size improvements made (update comparison table)

3. **This file (CLAUDE.md)** - Update tool count if changed

Always work on a feature branch and include documentation updates in the same PR as code changes.
