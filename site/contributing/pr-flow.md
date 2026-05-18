# PR flow

## Branch naming

- `feat/<short-description>` — new functionality
- `fix/<short-description>` — bug fixes
- `chore/<short-description>` — internal / tooling
- `docs/<short-description>` — site or README changes only

## Commit messages

Conventional commits, lowercase scope:

```text
feat(env_vars): add reveal option for plaintext access
fix(client): handle non-JSON responses defensively
chore(deps): bump typescript from 5.9.3 to 5.9.4
docs: clarify env-var masking behaviour in the gotchas page
```

The CHANGELOG follows the same shape (`### Added`, `### Fixed`, `### Changed`, `### Security`, `### Internal`).

## Before opening the PR

1. `npm test` passes locally
2. `npm run lint` clean
3. `npm run format:check` clean
4. CHANGELOG `[Unreleased]` section updated with your change
5. README updated if tool count changed or new tool is user-facing
6. If you can, run `/smoke-test` against a live Coolify

## PR description

Aim for:

- **What changes** — brief
- **Why** — link to the issue, or explain the bug / use case
- **How verified** — `npm test` + (ideally) live smoke results
- **Closes #N** if applicable

The maintainer (currently [@StuMason](https://github.com/StuMason)) reviews PRs on a best-effort basis. The repo also runs a Claude review bot on most PRs. Its feedback is advisory but often catches real issues.

## After approval

The maintainer admin-merges (squash). Releases are bundled: a release PR follows shortly after notable changes, version bumps `package.json`, and the `publish.yml` workflow auto-publishes to npm via trusted publishing.

## Contributor recognition

Every CHANGELOG entry credits the PR author (`thanks @username`). This is not a formality. These are real contributions that have shipped fixes affecting production users.

## Stale PRs

If your PR sits without movement for two weeks, post a comment asking the maintainer for status. If it sits longer, the scope is probably stalled. Open a follow-up issue to discuss the blocker.
