# Contributing to Coolify MCP

Thanks for your interest in contributing! This document covers how the project maintains itself and how you can help.

## Project Maintenance

This project is designed to be low-maintenance while staying secure and up-to-date.

### Automated Security & Dependencies

**Dependabot** runs daily to keep dependencies secure:

- **Patch/Minor updates** → Auto-merged after CI passes
- **Major updates** → PR created with review checklist, requires manual approval
- **GitHub Actions** → Weekly updates on Mondays

Configuration: [`.github/dependabot.yml`](.github/dependabot.yml)

### API Drift Detection

**Weekly OpenAPI Drift Check** monitors Coolify's API for changes:

- Runs every Monday at 7am UK time
- Compares current Coolify OpenAPI spec against our baseline
- Creates GitHub issues when changes are detected
- Labels issues with `api-drift` and `maintenance`

This ensures we know when Coolify adds/removes/changes endpoints so we can update our tools accordingly.

Configuration: [`.github/workflows/openapi-drift.yml`](.github/workflows/openapi-drift.yml)

### Branch Protection

The `main` branch is protected:

- All CI checks must pass (Node 20.x, 22.x, 24.x)
- Admin bypass enabled for maintainers
- No force pushes (except admins)

### CI Pipeline

Every PR runs:

1. **Security audit** - `npm audit`
2. **Format check** - Prettier
3. **Lint** - ESLint
4. **Build** - TypeScript compilation
5. **Test** - Jest with coverage

## How to Contribute

### Reporting Issues

- **Bugs**: Open an issue with reproduction steps
- **Feature requests**: Open an issue describing the use case
- **API drift**: Check existing `api-drift` issues before reporting

### Making Changes

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Make your changes
4. Run tests: `npm test`
5. Run lint: `npm run lint`
6. Commit with conventional commits: `feat:`, `fix:`, `chore:`, etc.
7. Open a PR against `main`

### Adding New Tools

When Coolify adds new API endpoints:

1. Check the [Coolify OpenAPI spec](https://github.com/coollabsio/coolify/blob/main/openapi.yaml)
2. Add the client method in `src/lib/coolify-client.ts`
3. Add the MCP tool in `src/lib/mcp-server.ts`
4. Add tests in `src/__tests__/`
5. Update tool count in README.md and CLAUDE.md
6. Add changelog entry

### Code Style

- TypeScript strict mode
- Prettier for formatting
- ESLint for linting
- Conventional commits

## Architecture Overview

```text
src/
├── index.ts              # Entry point
├── lib/
│   ├── coolify-client.ts # HTTP client for Coolify API
│   └── mcp-server.ts     # MCP server with tool definitions
├── types/
│   └── coolify.ts        # TypeScript types
└── __tests__/            # Jest tests
```

### Key Patterns

- **Summary mode**: List operations return minimal fields to reduce token usage
- **Smart lookup**: Diagnostic tools accept name/domain/IP, not just UUIDs
- **Context-optimized**: Responses are trimmed to essential fields
- **Batch operations**: Use `Promise.allSettled` for partial failure handling

## Release Process

1. Update version in `package.json`
2. Update `VERSION` constant in `src/lib/mcp-server.ts`
3. Add changelog entry
4. Merge to main
5. GitHub Actions auto-publishes to npm on version bump

## Questions?

- Open a [GitHub Issue](https://github.com/stumason/coolify-mcp/issues)
- Check the [Coolify Community](https://coolify.io/docs/contact)
