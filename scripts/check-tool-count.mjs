#!/usr/bin/env node
// Keeps every hand-written "N tools" claim in step with the real tool roster.
//
// Source of truth: evals/src/contract/__toolsnaps__/_roster.json — the tool
// names a default (single-instance) install exposes, snapshotted by the evals
// contract test and gated in CI. Fleet-only tools (list_instances) are not in
// it, deliberately: a default install never sees them, so counting them would
// advertise a tool most users cannot call.
//
// Usage:  node scripts/check-tool-count.mjs          # exit 1 on drift
//         node scripts/check-tool-count.mjs --fix    # rewrite the claims
//
// The old site said "42 consolidated tools" in one block and "44" in the hero
// of the same page. Anything a human has to remember to update drifts.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const roster = JSON.parse(
  readFileSync(join(root, 'evals/src/contract/__toolsnaps__/_roster.json'), 'utf8'),
);
if (!Array.isArray(roster) || roster.length < 20) {
  console.error(`roster looks wrong (${roster.length} entries) — refusing to rewrite anything`);
  process.exit(2);
}
const expected = roster.length;

// Every place a count is stated, with the pattern that locates it. Each pattern
// must match at least once, so a reworded sentence fails loudly instead of
// silently escaping the check.
const CLAIMS = [
  { file: 'README.md', pattern: /(\d+) tools for deploying/g },
  { file: 'CLAUDE.md', pattern: /provides (\d+) token-optimized tools/g },
  { file: 'CLAUDE.md', pattern: /currently (\d+) tools/g },
  { file: 'package.json', pattern: /(\d+) optimized tools/g },
  { file: 'server.json', pattern: /(\d+) optimized tools/g },
  { file: 'manifest.json', pattern: /(\d+) optimized tools/g },
];

const fix = process.argv.includes('--fix');
let drift = 0;
for (const { file, pattern } of CLAIMS) {
  const path = join(root, file);
  const text = readFileSync(path, 'utf8');
  const matches = [...text.matchAll(pattern)];
  if (matches.length === 0) {
    console.error(`${file}: no tool-count claim matched ${pattern} — update CLAIMS in this script`);
    drift++;
    continue;
  }
  const wrong = matches.filter((m) => Number(m[1]) !== expected);
  if (wrong.length === 0) continue;
  drift++;
  if (fix) {
    writeFileSync(
      path,
      text.replace(pattern, (whole, n) => whole.replace(n, String(expected))),
    );
    console.log(`${file}: ${wrong.map((m) => m[1]).join(', ')} → ${expected}`);
  } else {
    console.error(
      `${file}: says ${wrong.map((m) => m[1]).join(', ')} tools, roster has ${expected}`,
    );
  }
}

if (drift && !fix) {
  console.error(`\n${drift} file(s) out of step. Run: node scripts/check-tool-count.mjs --fix`);
  process.exit(1);
}
console.log(`tool count: ${expected} (${drift ? 'fixed' : 'in step'})`);
