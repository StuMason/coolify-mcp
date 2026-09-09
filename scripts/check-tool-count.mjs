#!/usr/bin/env node
// Keeps every hand-written "N tools" claim in step with the real tool roster.
//
// Source of truth: evals/src/contract/__toolsnaps__/_roster.json — the tool
// names a default (single-instance) install exposes, snapshotted by the evals
// contract test and gated in CI. Fleet-only tools (list_instances) are not in
// it, deliberately: a default install never sees them, so counting them would
// advertise a tool most users cannot call.
//
// Usage:  npm run check:tool-count        # exit 1 on drift
//         npm run check:tool-count:fix    # rewrite the claims
//
// Also checks that every roster tool appears in the docs/tools.md table; that
// one is never auto-fixed (the table needs a description, not just a name).
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
let drift = 0; // wrong numbers: --fix repairs these
let unfixable = 0; // things --fix cannot repair: always exit non-zero

for (const { file, pattern } of CLAIMS) {
  const path = join(root, file);
  const text = readFileSync(path, 'utf8');
  const matches = [...text.matchAll(pattern)];
  if (matches.length === 0) {
    console.error(`${file}: no tool-count claim matched ${pattern} — update CLAIMS in this script`);
    unfixable++;
    continue;
  }
  const wrong = matches.filter((m) => Number(m[1]) !== expected);
  if (wrong.length === 0) continue;
  drift++;
  if (fix) {
    // Rebuild from the match's own offsets rather than `whole.replace(n, …)`,
    // which would hit the first occurrence of that number anywhere in the
    // match — fine while every capture leads its pattern, silent corruption
    // the day one does not.
    let out = '';
    let cursor = 0;
    for (const m of matches) {
      const start = m.index + m[0].indexOf(m[1]);
      out += text.slice(cursor, start) + String(expected);
      cursor = start + m[1].length;
    }
    writeFileSync(path, out + text.slice(cursor));
    console.log(`${file}: ${wrong.map((m) => m[1]).join(', ')} → ${expected}`);
  } else {
    console.error(
      `${file}: says ${wrong.map((m) => m[1]).join(', ')} tools, roster has ${expected}`,
    );
  }
}

// The count being right is not enough: docs/tools.md is the canonical list,
// and a tool missing from its table is the same failure one level down.
const table = readFileSync(join(root, 'docs/tools.md'), 'utf8');
const missing = roster.filter((name) => !table.includes(`\`${name}\``));
if (missing.length > 0) {
  console.error(`docs/tools.md: table is missing ${missing.map((n) => `\`${n}\``).join(', ')}`);
  unfixable++;
}

if (unfixable > 0) {
  console.error(`\n${unfixable} problem(s) this script cannot fix — see above.`);
  process.exit(1);
}
if (drift > 0 && !fix) {
  console.error(`\n${drift} file(s) out of step. Run: npm run check:tool-count:fix`);
  process.exit(1);
}
console.log(
  `tool count: ${expected} (${drift ? 'fixed' : 'in step'}); docs/tools.md lists all ${expected}`,
);
