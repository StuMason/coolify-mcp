# Testing

The codebase has three tiers of tests, each with a different cost / signal trade-off.

## 1. Mocked client tests (`coolify-client.test.ts`)

Every new client method must have a mocked test asserting:

- HTTP method (GET / POST / PATCH / DELETE)
- Endpoint path
- Request body (if applicable)
- Response shape parsing

These are fast (~10 ms each) and catch regressions in wire-level behaviour. Pattern:

```typescript
it('should call POST with the correct body', async () => {
  mockFetch.mockResolvedValueOnce(mockResponse({ uuid: 'new-uuid' }));

  await client.createSomething({ name: 'test' });

  expect(mockFetch).toHaveBeenCalledWith(
    'http://localhost:3000/api/v1/something',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ name: 'test' }),
    }),
  );
});
```

## 2. Method-existence tests (`mcp-server.test.ts`)

For each new client method, add an existence check:

```typescript
expect(typeof client.createSomething).toBe('function');
```

These keep the MCP server's interface from drifting silently. They run in the same suite as the client tests.

For tool _handlers_, the project pattern is to test them via the SDK's internal `_registeredTools` map:

```typescript
const tool = (server as any)._registeredTools['env_vars'];
await tool.handler({ resource: 'application', action: 'create', ... }, {});
```

This exercises the full handler routing without standing up the MCP transport.

## 3. Integration tests (`src/__tests__/integration/`)

Excluded from `npm test`, run only via `npm run test:integration`. Require a live Coolify instance via `.env`:

```bash
COOLIFY_URL=https://your-coolify.example.com
COOLIFY_TOKEN=your-api-token
```

These actually hit the network. Use them for:

- Confirming a new endpoint shape matches reality (the OpenAPI lies)
- Smoke-testing after a Coolify upgrade
- Verifying complex workflows (create app → set env vars → deploy → check status)

## The /smoke-test slash command

After fixing a bug that involves API interaction, always run `/smoke-test` (the Claude Code slash command for this repo) before marking the work complete. It builds the project, runs the integration suite, and verifies fixes work end-to-end against the live instance.

## Coverage requirements

codecov is strict on patch coverage. New lines in `src/lib/*.ts` must hit ~90%+. New lines in `src/lib/mcp-server.ts` are excluded from coverage collection by design: that file is the MCP SDK wrapper layer, and the logic lives in `coolify-client.ts`.

If your patch coverage fails, the typical cause is missing branch coverage on `?? default` fallbacks. Add a test that hits the fallback path.

## Running locally

```bash
npm test                    # mocked tests, fast (~10s)
npm run test:watch          # watch mode for TDD
npm run test:coverage       # coverage report
npm run test:integration    # hit live Coolify (~30-60s)
npm run lint                # eslint
npm run format              # prettier
npx tsc --noEmit            # type-check only (no emit)
npm run build               # produces dist/
```
