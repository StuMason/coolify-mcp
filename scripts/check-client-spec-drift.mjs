#!/usr/bin/env node
/**
 * Client-vs-spec drift check.
 *
 * `docs/coolify-openapi.yaml` (the upstream Coolify OpenAPI spec bundled in
 * this repo) is meant to be ground truth for "does Coolify support X"
 * decisions. It drifts in two directions:
 *
 *   1. Upstream adds/changes paths we haven't pulled in yet.
 *      -> covered by .github/workflows/openapi-drift.yml (weekly diff
 *         against a baseline copy of the upstream spec).
 *   2. `src/lib/coolify-client.ts` calls a path that the bundled spec
 *      doesn't document at all (upstream may itself be lagging, or the
 *      spec here is stale).
 *      -> this script.
 *
 * This is intentionally a lightweight, no-network check: it extracts every
 * path template `coolify-client.ts` passes to `this.request(...)`, extracts
 * every path key from the bundled spec's `paths:` section, normalises both
 * to segment lists (with `${var}`/`{param}` segments treated as wildcards),
 * and reports any client route that doesn't match a spec path by segment
 * count + literal-segment equality. Route params don't need matching names
 * — only position and literal segments matter.
 *
 * A documented allowlist covers endpoints upstream genuinely hasn't
 * specced yet (see ALLOWLIST below). Keep it small — it's meant to shrink
 * over time as upstream catches up, not grow.
 *
 * Known limitation: matching is HTTP-method-blind and params are pure
 * wildcards, so a client literal can satisfy a spec param in the same
 * position — e.g. the deprecated `/applications/dockercompose` route
 * (removed upstream in v4.1.0, see #235) still "matches" via
 * `/applications/{uuid}`. This check catches whole path *shapes* the spec
 * has never heard of; it cannot catch a removed sibling of a parameterised
 * route without method-aware matching, which isn't worth the complexity
 * for the one known case.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

export const SPEC_PATH = path.join(ROOT, 'docs/coolify-openapi.yaml');
export const CLIENT_PATH = path.join(ROOT, 'src/lib/coolify-client.ts');

/**
 * Client routes that are known to be missing from the bundled upstream
 * spec. Every entry here should have a short reason — if upstream adds the
 * path, remove the entry (the script will start failing loudly if you
 * forget and the path later disappears again).
 */
export const ALLOWLIST = [
  // Currently empty: refreshing docs/coolify-openapi.yaml from upstream
  // main (see #236) closed every gap that existed at the time. Add entries
  // here only when upstream's openapi.yaml genuinely hasn't caught up with
  // a client-called endpoint yet.
];

/** Extract every top-level path key from the spec's `paths:` block. */
export function extractSpecPaths(specText) {
  const lines = specText.split('\n');
  const pathsIdx = lines.findIndex((l) => /^paths:\s*$/.test(l));
  if (pathsIdx === -1) {
    throw new Error("Could not find a top-level 'paths:' key in the OpenAPI spec");
  }

  let end = lines.length;
  for (let i = pathsIdx + 1; i < lines.length; i++) {
    // Next top-level YAML key (column 0, e.g. `components:`) ends the block.
    if (/^[A-Za-z]/.test(lines[i])) {
      end = i;
      break;
    }
  }

  const keyRe = /^ {2}(?:'([^']+)'|"([^"]+)"|(\/\S+)):\s*$/;
  const paths = [];
  for (let i = pathsIdx + 1; i < end; i++) {
    const m = lines[i].match(keyRe);
    if (m) paths.push(m[1] ?? m[2] ?? m[3]);
  }
  return paths;
}

/**
 * Extract every path template literal passed as the first argument to
 * `this.request(...)` / `this.request<T>(...)` in the client source.
 */
export function extractClientRoutes(clientText) {
  const callRe = /this\.request(?:<[^>]*>)?\(\s*(`[^`]*`|'[^']*'|"[^"]*")/g;
  const routes = new Set();
  let m;
  while ((m = callRe.exec(clientText))) {
    routes.add(m[1].slice(1, -1)); // strip surrounding quote/backtick
  }
  // getVersion() builds its URL by hand and calls fetch() directly instead
  // of going through this.request() (the /version endpoint returns plain
  // text, not JSON) — add it explicitly so it's still checked.
  routes.add('/version');
  return [...routes];
}

/**
 * Turn a raw client route template into a list of segments, using `null`
 * for a param/wildcard segment.
 *
 * `${...}` interpolations are treated as:
 *   - a real path segment (-> null) when immediately preceded by `/`
 *   - dropped entirely otherwise — these are query-string builders glued
 *     onto the previous segment (e.g. `` `/applications${query}` `` where
 *     `query` is `buildQueryString()` output: `''` or `'?...'`)
 * Anything from a literal `?` onward (a hardcoded query string) is also
 * stripped.
 */
export function normaliseClientRoute(raw) {
  const qIdx = raw.indexOf('?');
  const withoutQuery = qIdx === -1 ? raw : raw.slice(0, qIdx);
  const withoutInterpolations = withoutQuery.replace(/(\/?)\$\{[^}]*\}/g, (_, slash) =>
    slash ? '/{param}' : '',
  );
  return segmentsOf(withoutInterpolations);
}

/** Turn a spec path key into a list of segments, using `null` for `{param}` segments. */
export function normaliseSpecPath(specPath) {
  return segmentsOf(specPath);
}

function segmentsOf(p) {
  return p
    .split('/')
    .filter((s) => s.length > 0)
    .map((s) => (/^\{[^}]+\}$/.test(s) ? null : s));
}

/** Do two normalised segment lists match (params act as wildcards)? */
export function segmentsMatch(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === null || b[i] === null) continue;
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Compare every client route against the spec's path list. Returns the
 * client routes (raw templates) that don't match any spec path.
 */
export function findUnmatchedRoutes(clientText, specText) {
  const specSegLists = extractSpecPaths(specText).map(normaliseSpecPath);
  const clientRoutes = extractClientRoutes(clientText);
  return clientRoutes.filter((raw) => {
    const segs = normaliseClientRoute(raw);
    return !specSegLists.some((specSegs) => segmentsMatch(segs, specSegs));
  });
}

function main() {
  const specText = fs.readFileSync(SPEC_PATH, 'utf8');
  const clientText = fs.readFileSync(CLIENT_PATH, 'utf8');

  const unmatched = findUnmatchedRoutes(clientText, specText);
  const stillMissing = unmatched.filter((route) => !ALLOWLIST.includes(route));
  const staleAllowlist = ALLOWLIST.filter((route) => !unmatched.includes(route));

  if (stillMissing.length > 0) {
    console.error(
      `\nFound ${stillMissing.length} route(s) coolify-client.ts calls that are not in ${path.relative(ROOT, SPEC_PATH)}:\n`,
    );
    for (const route of stillMissing) console.error(`  - ${route}`);
    console.error(
      '\nEither the bundled spec needs refreshing from upstream, or (if upstream genuinely ' +
        `has no spec for this endpoint yet) add it to ALLOWLIST in ${path.relative(ROOT, __filename)} with a reason.\n`,
    );
    process.exitCode = 1;
  }

  if (staleAllowlist.length > 0) {
    console.error(
      `\nALLOWLIST in ${path.relative(ROOT, __filename)} has ${staleAllowlist.length} entr${staleAllowlist.length === 1 ? 'y' : 'ies'} that now match the spec — remove them:\n`,
    );
    for (const route of staleAllowlist) console.error(`  - ${route}`);
    console.error('');
    process.exitCode = 1;
  }

  if (!process.exitCode) {
    console.log(
      `OK: all ${extractClientRoutes(clientText).length} client route(s) match a path in the bundled OpenAPI spec.`,
    );
  }
}

const isMain = process.argv[1] === __filename;
if (isMain) {
  main();
}
