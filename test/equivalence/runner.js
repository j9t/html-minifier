// Runs markup through the minifier, compares the result with its source, and reduces what differs
// to a small case

import { parse } from 'parse5';
import { minify } from '../../src/htmlminifier.js';
import { compareMarkup } from './compare.js';
import { createRandom } from './generate.js';

const REDUCTION_STEPS = 3000;
const SEPARATOR = '\u0001';

// Each on its own and in random combinations; what needs a value has it here
export const OPTIONS_STRUCTURAL = {
  collapseAttributeWhitespace: true,
  collapseBooleanAttributes: true,
  collapseEmptyAttributes: true,
  collapseInlineTagWhitespace: true,
  collapseNoBreakSpaces: true,
  collapseWhitespace: true,
  conservativeCollapse: true,
  decodeEntities: true,
  keepClosingSlash: true,
  maxLineLength: 40,
  mergeScripts: true,
  minifyURLs: 'https://example.org/dir/page.html',
  noNewlinesBeforeTagClose: true,
  preserveLineBreaks: true,
  removeAttributeQuotes: true,
  removeComments: true,
  removeDefaultTypeAttributes: true,
  removeEmptyAttributes: true,
  removeEmptyElements: true,
  removeOptionalTags: true,
  removeRedundantAttributes: true,
  removeTagWhitespace: true,
  selfCloseForeignElements: true,
  sortAttributes: true,
  sortClassNames: true,
  useShortDoctype: true
};

export const OPTIONS_CODE = {
  minifyCSS: true,
  minifyJS: { compress: false, mangle: false },
  minifyJSON: true
};

/**
 * @param {() => number} random
 * @returns {Record<string, unknown>}
 */
export function randomOptions(random) {
  /** @type {Record<string, unknown>} */
  const options = {};
  const share = 0.15 + random() * 0.6;
  for (const [name, value] of Object.entries(OPTIONS_STRUCTURAL)) {
    if (random() < share) options[name] = value;
  }
  return random() < 0.15 ? { ...options, ...OPTIONS_CODE } : options;
}

export { createRandom };

// A grouping for differences that are alike, regardless of the content involved
export function signatureOf(/** @type {{kind: string, input: string, output: string}} */ difference) {
  const clip = (/** @type {string} */ line) => (line.split(SEPARATOR)[0] ?? '')
    .replace(/#(text|raw|comment):.*/s, '#$1')
    .replace(/@(\w*)(?:\[|«).*/s, '@$1')
    .replace(/.*\//s, '');
  return `${difference.kind}:${clip(difference.input)} / ${clip(difference.output)}`;
}

// The message’s first line, as the rest quotes the markup
export function signatureOfThrown(/** @type {string} */ message) {
  return `thrown:${message.split('\n', 1)[0]}`;
}

/**
 * @param {string} html
 * @param {Record<string, unknown>} options
 * @returns {Promise<{output?: string, differences: Array<{kind: string, input: string, output: string}>, thrown?: string}>}
 */
export async function check(html, options) {
  let output;
  try {
    output = await minify(html, /** @type {any} */ ({ ...options, log() {} }));
  } catch (err) {
    return { differences: [], thrown: String(/** @type {Error} */ (err).message) };
  }
  return { differences: compareMarkup(html, output, options), output };
}

function parseErrorsOf(/** @type {string} */ html) {
  /** @type {Set<string>} */
  const codes = new Set();
  parse(html, { onParseError: err => codes.add(err.code) });
  return codes;
}

/**
 * Shrinks options, then markup, while the same difference remains and no new parse error appears
 * @param {string} html
 * @param {Record<string, unknown>} options
 * @param {string} signature
 * @param {number} [steps]
 * @returns {Promise<{html: string, options: Record<string, unknown>}>}
 */
export async function reduce(html, options, signature, steps = REDUCTION_STEPS) {
  const parseErrors = parseErrorsOf(html);
  const stillDiffers = async (/** @type {string} */ candidate, /** @type {Record<string, unknown>} */ candidateOptions) => {
    for (const code of parseErrorsOf(candidate)) {
      if (!parseErrors.has(code)) return false;
    }
    const { differences, thrown } = await check(candidate, candidateOptions);
    // The position moves along with what is removed
    return signature.startsWith('thrown:') ? thrown !== undefined : differences.some(difference => signatureOf(difference) === signature);
  };

  let optionsReduced = { ...options };
  for (const name of Object.keys(optionsReduced)) {
    const candidate = { ...optionsReduced };
    delete candidate[name];
    if (await stillDiffers(html, candidate)) optionsReduced = candidate;
  }

  let htmlReduced = html;
  let chunk = Math.max(1, htmlReduced.length >> 1);
  let budget = steps;
  while (budget > 0) {
    let index = 0;
    let changed = false;
    while (index < htmlReduced.length && budget-- > 0) {
      const candidate = htmlReduced.slice(0, index) + htmlReduced.slice(index + chunk);
      if (await stillDiffers(candidate, optionsReduced)) {
        htmlReduced = candidate;
        changed = true;
      } else {
        index += chunk;
      }
    }
    if (chunk === 1 && !changed) break;
    if (!changed) chunk = Math.max(1, chunk >> 1);
  }
  return { html: htmlReduced, options: optionsReduced };
}