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
 * The publish workflow runs the refresh before `npm run build` so a release
 * carries the docs as they stood that day; a weekly workflow opens a PR when
 * the committed copy falls behind. A fetch that fails, or parses to too few
 * pages, never overwrites a good bundle.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SOURCE_URL = 'https://coolify.io/docs/llms.txt';
export const BUNDLE_PATH = path.join(ROOT, 'src/data/coolify-docs.json');
/** llms.txt has ~270 pages; anything far below that is a format change, not a smaller site. */
const MIN_ENTRIES = 100;

const LINK_LINE = /^\s*-\s*\[[^\]]+\]\([^)\s]+\)/;

export function countEntries(text) {
  return text.split('\n').filter((line) => LINK_LINE.test(line)).length;
}

export async function fetchLive() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(SOURCE_URL, {
      signal: controller.signal,
      headers: { accept: 'text/plain, text/markdown' },
    });
    if (!response.ok) throw new Error(`${SOURCE_URL} answered HTTP ${response.status}`);
    const text = await response.text();
    const entries = countEntries(text);
    if (entries < MIN_ENTRIES) {
      throw new Error(
        `${SOURCE_URL} parsed to ${entries} link entries (expected at least ${MIN_ENTRIES}); format may have changed, bundle left untouched`,
      );
    }
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

export function readBundle() {
  return JSON.parse(fs.readFileSync(BUNDLE_PATH, 'utf8'));
}

function ageDays(iso) {
  return Math.round((Date.now() - Date.parse(iso)) / 86_400_000);
}

async function main(argv) {
  const check = argv.includes('--check');
  let live;
  try {
    live = await fetchLive();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (check) {
      console.warn(`docs index: could not compare against live (${message})`);
      process.exit(2);
    }
    console.error(`docs index: refresh failed, bundle left untouched (${message})`);
    process.exit(2);
  }

  const current = fs.existsSync(BUNDLE_PATH) ? readBundle() : null;
  const same = current !== null && current.text === live.text;

  if (check) {
    if (same) {
      console.log(
        `docs index: bundle matches live (${live.entries} pages, fetched ${ageDays(current.fetched_at)} day(s) ago)`,
      );
      process.exit(0);
    }
    console.log(
      `docs index: live differs from the bundle (${current?.entries ?? 0} → ${live.entries} pages; bundled ${current ? ageDays(current.fetched_at) + ' day(s) ago' : 'never'}). Run: npm run docs:index`,
    );
    process.exit(1);
  }

  if (same) {
    // Keep the old fetched_at: the content is what dates the bundle, and a
    // no-op refresh should not produce a diff.
    console.log(`docs index: already current (${live.entries} pages)`);
    return;
  }
  fs.mkdirSync(path.dirname(BUNDLE_PATH), { recursive: true });
  fs.writeFileSync(BUNDLE_PATH, JSON.stringify(live, null, 2) + '\n');
  console.log(
    `docs index: bundled ${live.entries} pages from ${SOURCE_URL} (${(Buffer.byteLength(live.text) / 1024).toFixed(0)} KB)`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
