#!/usr/bin/env node

// Compares minified real-world pages (backtest/input) with their sources, by option set, and
// reports what differs; slower than `npm test`, and depends on what the corpus holds, so run
// by hand (`npm run test:equivalence`, optionally with a number of files)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPreset } from '../../src/htmlminifier.js';
import { check, OPTIONS_CODE, OPTIONS_STRUCTURAL, reduce, signatureOf } from './runner.js';

const REDUCTION_STEPS = 400;
const REDUCED_MAX = 25;

const dirInput = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../backtest/input');
const countFiles = Number(process.argv[2]) || Infinity;
const OPTION_SETS = {
  structural: OPTIONS_STRUCTURAL,
  conservative: getPreset('conservative') ?? {},
  comprehensive: { ...getPreset('comprehensive'), minifyJS: OPTIONS_CODE.minifyJS }
};

if (!fs.existsSync(dirInput)) {
  console.error('No corpus at backtest/input—run `npm run benchmark` in backtest first');
  process.exit(1);
}

/** @type {Map<string, {count: number, html: string, options: Record<string, unknown>, file: string}>} */
const signatures = new Map();
const thrown = [];
let compared = 0;
let differing = 0;

for (const fileName of fs.readdirSync(dirInput).filter(name => name.endsWith('.html')).slice(0, countFiles)) {
  const html = fs.readFileSync(path.join(dirInput, fileName), 'utf8');
  for (const [nameSet, options] of Object.entries(OPTION_SETS)) {
    const result = await check(html, options);
    if (result.thrown) {
      thrown.push(`${fileName} (${nameSet}): ${result.thrown.split('\n')[0]}`);
      continue;
    }
    compared++;
    if (result.differences.length) differing++;
    for (const difference of result.differences) {
      const signature = signatureOf(difference);
      const entry = signatures.get(signature) ?? { count: 0, file: fileName, html, options };
      entry.count++;
      signatures.set(signature, entry);
    }
  }
}

console.log(`Compared ${compared} results, ${differing} with differences, ${thrown.length} failing to parse`);
for (const line of thrown) console.log(`  Parse failure: ${line}`);
const ranked = [...signatures.entries()].sort(([, a], [, b]) => b.count - a.count);
for (const [index, [signature, entry]] of ranked.entries()) {
  console.log(`\n[${entry.count}] ${signature} (${entry.file})`);
  if (index < REDUCED_MAX) {
    const reduced = await reduce(entry.html, entry.options, signature, REDUCTION_STEPS);
    const { output } = await check(reduced.html, reduced.options);
    console.log(`  options: ${JSON.stringify(reduced.options).slice(0, 300)}\n  input:   ${JSON.stringify(reduced.html).slice(0, 300)}\n  output:  ${JSON.stringify(output).slice(0, 300)}`);
  }
}