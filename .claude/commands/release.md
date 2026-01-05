# Release Version Bump

Create a new version release for coolify-mcp.

## Instructions

1. Determine the version bump type from the argument: $ARGUMENTS (should be "patch", "minor", or "major")
2. Read the current version from package.json
3. Calculate the new version based on semver
4. Create a new branch: `release/v{new-version}`
5. Update version in:
   - package.json
   - src/lib/mcp-server.ts (the VERSION constant)
6. Add a changelog entry to CHANGELOG.md for the new version with today's date
7. Run `npm run build && npm test` to verify everything works
8. Commit with message: `chore: bump version to {new-version}`
9. Push and create a PR

If no argument is provided, default to "patch".

Ask the user what changes should be included in the changelog entry before creating it.
