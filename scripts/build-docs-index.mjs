#!/usr/bin/env node
/**
 * Bundle the Coolify docs index (#372).
 *
 * `search_docs` used to fetch https://coolify.io/docs/llms.txt at call time,
 * so it failed offline, behind egress rules, and whenever coolify.io
 * hiccupped. Now the index ships inside the package: this script fetches the
 * live file and writes it to src/data/coolify-docs.json, which the build
 * copies into dist/ and DocsSearchEngine serves immediately, refreshing from
 * the live URL in the background when it can.
 *
 *   node scripts/build-docs-index.mjs          refresh the bundle from live
 *   node scripts/build-docs-index.mjs --check  report whether live differs
 *                                              (exit 1 if it does, 2 if live
 *                                              could not be fetched)
 *
 * The file is validated with the SAME parser the server uses at runtime
 * (src/lib/docs-index-parse.mjs): a fetch that parses to too few pages, or
 * has link lines the parser rejects, never overwrites a good bundle. The
 * publish workflow runs the refresh before `npm run build`; a weekly
 * workflow opens a PR when the committed copy falls behind.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocsIndex, countUnparsedLinkLines } from '../src/lib/docs-index-parse.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SOURCE_URL = 'https://coolify.io/docs/llms.txt';
export const BUNDLE_PATH = path.join(ROOT, 'src/data/coolify-docs.json');
/** llms.txt has ~270 pages; anything far below that is a format change, not a smaller site. */
export const MIN_ENTRIES = 100;

/**
 * Validate a candidate index with the runtime parser. Throws with the reason
 * when it must not be shipped.
 */
export function validateIndex(text) {
  const entries = parseDocsIndex(text).length;
  const unparsed = countUnparsedLinkLines(text);
  // The specific reason first: a reshaped file usually parses to zero AND
  // has every link line unparsed, and the second fact is the useful one.
  if (unparsed > 0) {
    throw new Error(
      `${unparsed} link line(s) do not parse with the runtime parser; format may have changed`,
    );
  }
  if (entries < MIN_ENTRIES) {
    throw new Error(
      `parsed to ${entries} entries (expected at least ${MIN_ENTRIES}); format may have changed`,
    );
  }
  return entries;
}

export async function fetchLive(fetchImpl = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetchImpl(SOURCE_URL, {
      signal: controller.signal,
      headers: { accept: 'text/plain, text/markdown' },
    });
    if (!response.ok) throw new Error(`${SOURCE_URL} answered HTTP ${response.status}`);
    const text = await response.text();
    const entries = validateIndex(text);
    return {
      source: SOURCE_URL,
      fetched_at: new Date().toISOString(),
      etag: response.headers.get('etag') ?? null,
      last_modified: response.headers.get('last-modified') ?? null,
      entries,
      text,
    };
  } finally {
    clearTimeout(timer);
  }
}

function ageDays(iso, now) {
  return Math.round((now - Date.parse(iso)) / 86_400_000);
}

/**
 * The whole operation, injectable for tests. Returns { code, message, wrote }
 * where code is the process exit code: 0 done/current, 1 (--check) live
 * differs, 2 live unreachable or unusable.
 */
export async function refreshDocsIndex({
  check = false,
  bundlePath = BUNDLE_PATH,
  fetchLiveImpl = fetchLive,
  now = Date.now(),
} = {}) {
  let live;
  try {
    live = await fetchLiveImpl();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      code: 2,
      wrote: false,
      message: check
        ? `docs index: could not compare against live (${message})`
        : `docs index: refresh failed, bundle left untouched (${message})`,
    };
  }

  const current = fs.existsSync(bundlePath)
    ? JSON.parse(fs.readFileSync(bundlePath, 'utf8'))
    : null;
  const same = current !== null && current.text === live.text;

  if (check) {
    if (same) {
      return {
        code: 0,
        wrote: false,
        message: `docs index: bundle matches live (${live.entries} pages, fetched ${ageDays(current.fetched_at, now)} day(s) ago)`,
      };
    }
    return {
      code: 1,
      wrote: false,
      message: `docs index: live differs from the bundle (${current?.entries ?? 0} → ${live.entries} pages; bundled ${current ? ageDays(current.fetched_at, now) + ' day(s) ago' : 'never'}). Run: npm run docs:index`,
    };
  }

  if (same) {
    // Keep the old fetched_at: the content is what dates the bundle, and a
    // no-op refresh should not produce a diff.
    return {
      code: 0,
      wrote: false,
      message: `docs index: already current (${live.entries} pages)`,
    };
  }
  fs.mkdirSync(path.dirname(bundlePath), { recursive: true });
  fs.writeFileSync(bundlePath, JSON.stringify(live, null, 2) + '\n');
  return {
    code: 0,
    wrote: true,
    message: `docs index: bundled ${live.entries} pages from ${SOURCE_URL} (${(Buffer.byteLength(live.text) / 1024).toFixed(0)} KB)`,
  };
}

async function main(argv) {
  const result = await refreshDocsIndex({ check: argv.includes('--check') });
  (result.code === 0 ? console.log : console.error)(result.message);
  process.exit(result.code);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
