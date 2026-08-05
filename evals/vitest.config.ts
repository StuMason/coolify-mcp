import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.{test,eval}.ts'],
    // One agent loop can take a while: real model + real MCP server + fixture.
    testTimeout: 120_000,
    hookTimeout: 60_000,
    // Model calls are rate-limited; keep suites sequential.
    fileParallelism: false,
  },
});
