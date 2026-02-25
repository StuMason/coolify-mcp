import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { DocsSearchEngine, parseDocs } from '../lib/docs-search.js';

// Sample llms-full.txt content for testing
const SAMPLE_DOCS = `---
url: /docs/get-started/installation.md
description: >-
  Install Coolify self-hosted PaaS on Linux servers with automated Docker setup
  script and SSH access.
---

# Installation

Coolify can be installed on any Linux server.

## Requirements

You need a server with at least 2GB RAM and 2 CPU cores.
SSH access is required for the installation process.

## Quick Install

Run the following command to install Coolify:

\`\`\`bash
curl -fsSL https://cdn.coolify.io/install.sh | bash
\`\`\`

---

---
url: /docs/applications/docker-compose.md
description: >-
  Deploy Docker Compose applications on Coolify with environment variables,
  build packs, and custom domains.
---

# Docker Compose

You can deploy any Docker Compose based application with Coolify.

## Environment Variables

Define environment variables in your docker-compose.yml or through the Coolify UI.
Variables defined in the UI take precedence over those in the compose file.

## Custom Domains

Set custom domains for your Docker Compose services through the Coolify dashboard.
Each service can have its own domain configuration.

---

---
url: /docs/troubleshoot/applications/502-error.md
description: >-
  Fix 502 Bad Gateway errors in Coolify applications caused by health check
  failures, port mismatches, and proxy configuration issues.
---

# 502 Bad Gateway Error

A 502 error usually means your application is not responding to the reverse proxy.

## Common Causes

Check the following:
- Your application is listening on the correct port
- Health checks are configured properly
- The container is actually running

## Port Configuration

Make sure your application listens on the port specified in the Coolify settings.
The default exposed port is 3000 for most build packs.`;

describe('parseDocs', () => {
  it('should parse pages from llms-full.txt format', () => {
    const chunks = parseDocs(SAMPLE_DOCS);
    expect(chunks.length).toBeGreaterThan(0);
  });

  it('should extract title, url, and description from frontmatter', () => {
    const chunks = parseDocs(SAMPLE_DOCS);
    const installChunk = chunks.find((c) => c.title === 'Installation');
    expect(installChunk).toBeDefined();
    expect(installChunk!.url).toBe('https://coolify.io/docs/get-started/installation');
    expect(installChunk!.description).toContain('Install Coolify');
  });

  it('should split pages into sub-chunks at ## headers', () => {
    const chunks = parseDocs(SAMPLE_DOCS);
    const subChunks = chunks.filter((c) => c.title.includes('>'));
    expect(subChunks.length).toBeGreaterThan(0);
    expect(subChunks.some((c) => c.title.includes('Requirements'))).toBe(true);
  });

  it('should strip .md extension from URLs', () => {
    const chunks = parseDocs(SAMPLE_DOCS);
    chunks.forEach((c) => {
      expect(c.url).not.toContain('.md');
    });
  });

  it('should handle empty input', () => {
    const chunks = parseDocs('');
    expect(chunks).toEqual([]);
  });

  it('should assign sequential IDs', () => {
    const chunks = parseDocs(SAMPLE_DOCS);
    chunks.forEach((chunk, index) => {
      expect(chunk.id).toBe(index);
    });
  });
});

describe('DocsSearchEngine', () => {
  let engine: DocsSearchEngine;
  let mockFetch: jest.Spied<typeof fetch>;

  beforeEach(() => {
    engine = new DocsSearchEngine();
    mockFetch = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    mockFetch.mockRestore();
  });

  it('should fetch and index docs on first search', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => SAMPLE_DOCS,
    } as Response);

    const results = await engine.search('installation');
    expect(results.length).toBeGreaterThan(0);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('should deduplicate concurrent loading', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => SAMPLE_DOCS,
    } as Response);

    const [results1, results2] = await Promise.all([
      engine.search('installation'),
      engine.search('docker'),
    ]);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(results1.length).toBeGreaterThan(0);
    expect(results2.length).toBeGreaterThan(0);
  });

  it('should only fetch once across multiple searches', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => SAMPLE_DOCS,
    } as Response);

    await engine.search('installation');
    await engine.search('docker compose');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('should return results with title, url, description, snippet, score', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => SAMPLE_DOCS,
    } as Response);

    const results = await engine.search('502 error');
    expect(results.length).toBeGreaterThan(0);
    const r = results[0];
    expect(r).toHaveProperty('title');
    expect(r).toHaveProperty('url');
    expect(r).toHaveProperty('description');
    expect(r).toHaveProperty('snippet');
    expect(r).toHaveProperty('score');
    expect(typeof r.score).toBe('number');
  });

  it('should rank relevant results higher', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => SAMPLE_DOCS,
    } as Response);

    const results = await engine.search('docker compose environment variables');
    expect(results[0].url).toContain('docker-compose');
  });

  it('should return empty array for no matches', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => SAMPLE_DOCS,
    } as Response);

    const results = await engine.search('xyznonexistent12345');
    expect(results).toEqual([]);
  });

  it('should respect limit parameter', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => SAMPLE_DOCS,
    } as Response);

    const results = await engine.search('coolify', 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it('should throw on fetch failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
    } as Response);

    await expect(engine.search('test')).rejects.toThrow('Failed to fetch Coolify docs');
  });

  it('should retry after fetch failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
    } as Response);

    await expect(engine.search('test')).rejects.toThrow();

    // Second attempt should try fetching again (loading was reset)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => SAMPLE_DOCS,
    } as Response);

    const results = await engine.search('installation');
    expect(results.length).toBeGreaterThan(0);
  });

  it('should report chunk count after loading', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => SAMPLE_DOCS,
    } as Response);

    expect(engine.getChunkCount()).toBe(0);
    await engine.search('test');
    expect(engine.getChunkCount()).toBeGreaterThan(0);
  });
});
