// The markup and option combinations that `npm test` compares, the same on every run

import fs from 'node:fs';
import { getPreset } from '../../src/htmlminifier.js';
import { generateMarkup } from './generate.js';
import { createRandom, OPTIONS_CODE, OPTIONS_STRUCTURAL, randomOptions } from './runner.js';

const GENERATED_COUNT = 1500;
const SEED_MARKUP = 1000000;
const SEED_OPTIONS = 7;
// Every this-many generated documents go through each option on its own
const SINGLE_OPTION_EVERY = 25;

const fileInputs = new URL('../fixtures/html5lib-inputs.json', import.meta.url);

// NUL characters are read differently in script data, which nothing authored relies on
const inputsHtml5lib = /** @type {string[]} */ (JSON.parse(fs.readFileSync(fileInputs, 'utf8')).inputs)
  .filter(input => !input.includes('\0'));

// `minifyJS` without compression, as only then the result can be compared with its source
const OPTIONS_NAMED = [{}, getPreset('conservative') ?? {}, { ...getPreset('comprehensive'), minifyJS: OPTIONS_CODE.minifyJS }];
const OPTIONS_SINGLE = Object.entries({ ...OPTIONS_STRUCTURAL, ...OPTIONS_CODE }).map(([name, value]) => ({ [name]: value }));

/**
 * @returns {Generator<{html: string, options: Record<string, unknown>}>}
 */
export function* equivalenceCases() {
  const random = createRandom(SEED_OPTIONS);
  for (let index = 0; index < GENERATED_COUNT; index++) {
    const html = generateMarkup(SEED_MARKUP + index);
    yield { html, options: randomOptions(random) };
    yield { html, options: OPTIONS_NAMED[index % OPTIONS_NAMED.length] ?? {} };
    if (index % SINGLE_OPTION_EVERY === 0) {
      for (const options of OPTIONS_SINGLE) yield { html, options };
    }
  }
  for (const html of inputsHtml5lib) {
    for (const options of OPTIONS_NAMED) yield { html, options };
    yield { html, options: randomOptions(random) };
  }
}