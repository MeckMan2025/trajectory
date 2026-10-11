import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Meckman house rule: no em dashes or en dashes anywhere we write (vendor code excluded).
const ROOTS = ['public', 'test', 'tools', 'README.md', 'CLAUDE.md', 'wrangler.jsonc', 'package.json'];
const SKIP = new Set(['vendor', 'node_modules', 'output']);
const TEXT = /\.(js|mjs|html|css|json|jsonc|md|txt)$/;

function walk(p, out) {
  if (!existsSync(p)) return out;
  if (statSync(p).isDirectory()) {
    for (const f of readdirSync(p)) if (!SKIP.has(f)) walk(join(p, f), out);
  } else if (TEXT.test(p)) out.push(p);
  return out;
}

test('no em or en dashes in our files', () => {
  const bad = [];
  for (const file of ROOTS.flatMap((r) => walk(r, []))) {
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      if (/[\u2013\u2014]/.test(line)) bad.push(`${file}:${i + 1}`);
    });
  }
  assert.deepEqual(bad, []);
});
