/**
 * Script and style merging
 */

import { isStyleLinkTypeAttribute } from './attributes.js';

// Rules that only work at the start of a style sheet (a stray one in a string or comment
// merely keeps the style sheets apart)
const RE_LEADING_AT_RULE = /@(?:import|namespace)/i;

const RE_CSS_WS_START = /^[ \t\n\f\r]+/;
const RE_CSS_WS_END = /[ \t\n\f\r]+$/;

const ATTRS_MERGEABLE = new Set(['blocking', 'media', 'nonce', 'type']);

/**
 * What a `style` element’s attributes make of its style sheet, equal for style sheets that
 * may be merged, or `null` for one that is to stay apart
 *
 * @param {Array<{name: string, value?: string, customAssign?: string, customOpen?: string}>} attrs
 * @param {string[]} markers - Custom fragment and `htmlmin:ignore` placeholder markers
 * @returns {string | null}
 */
function getStyleMergeKey(attrs, markers) {
  /** @type {Record<string, string>} */
  const values = {};
  for (const attr of attrs) {
    const name = attr.name.toLowerCase();
    const value = attr.value ?? '';
    if (!ATTRS_MERGEABLE.has(name) || (attr.customAssign && attr.customAssign !== '=') || attr.customOpen ||
        markers.some(marker => name.includes(marker) || value.includes(marker))) {
      return null;
    }
    // The first of repeated attributes counts
    if (name in values) continue;
    if (name === 'type') {
      if (!isStyleLinkTypeAttribute(value)) return null;
      continue;
    }
    values[name] = value;
  }
  // As written, without one, or empty, the media query list matches all
  const media = values.media?.trim();
  values.media = media && media.toLowerCase() !== 'all' ? media : '';
  return JSON.stringify([values.blocking, values.media, values.nonce]);
}

/**
 * Whether CSS ends where nothing appended to it can become part of what it holds: outside
 * comments, strings, and blocks, and after a complete rule
 *
 * @param {string} css
 * @returns {boolean}
 */
function isStyleSheetClosed(css) {
  let depth = 0;
  // Whether a top-level rule has begun that hasn’t ended, and whether it is an at-rule,
  // which a semicolon ends (a qualified rule only ends with its block)
  let isRuleOpen = false;
  let isAtRule = false;
  const open = (/** @type {boolean} */ isAt) => {
    if (!isRuleOpen) {
      isRuleOpen = true;
      isAtRule = isAt;
    }
  };
  const length = css.length;
  for (let i = 0; i < length; i++) {
    const char = css.charCodeAt(i);
    if (char === 47 /* / */ && css.charCodeAt(i + 1) === 42 /* * */) {
      const end = css.indexOf('*/', i + 2);
      if (end === -1) return false;
      i = end + 1;
    } else if (char === 34 /* " */ || char === 39 /* ' */) {
      // A line break ends a string, too, as an invalid one
      let j = i + 1;
      for (; j < length; j++) {
        const next = css.charCodeAt(j);
        if (next === 92 /* \ */) {
          j++;
        } else if (next === char || next === 10 || next === 12 || next === 13) {
          break;
        }
      }
      if (j >= length) return false;
      i = j;
      open(false);
    } else if (char === 92 /* \ */) {
      if (i + 1 >= length) return false;
      i++;
      open(false);
    } else if (char === 123 /* { */ || char === 40 /* ( */ || char === 91 /* [ */) {
      depth++;
      open(false);
    } else if (char === 125 /* } */ || char === 41 /* ) */ || char === 93 /* ] */) {
      if (depth > 0) {
        depth--;
        if (!depth && char === 125) isRuleOpen = false;
      } else {
        // Outside a block, a closing bracket is part of the next rule’s prelude
        open(false);
      }
    } else if (depth) {
      continue;
    } else if (char === 59 /* ; */) {
      if (isAtRule) isRuleOpen = false;
    } else if (char === 32 || char === 9 || char === 10 || char === 12 || char === 13) {
      continue;
    } else if (!isRuleOpen && css.startsWith('<!--', i)) {
      i += 3;
    } else if (!isRuleOpen && css.startsWith('-->', i)) {
      i += 2;
    } else {
      open(char === 64 /* @ */);
    }
  }
  return !depth && !isRuleOpen;
}

/**
 * Style sheets joined as one, without the whitespace where they meet (CSS whitespace only, as
 * other spaces may be part of a name)
 *
 * @param {string[]} parts
 * @returns {string}
 */
function joinStyleSheets(parts) {
  const last = parts.length - 1;
  return parts.map((part, i) => {
    if (i > 0) part = part.replace(RE_CSS_WS_START, '');
    return i < last ? part.replace(RE_CSS_WS_END, '') : part;
  }).join('');
}

/**
 * Whether CSS may follow another style sheet’s
 *
 * @param {string} css
 * @returns {boolean}
 */
function canStyleSheetFollow(css) {
  return !RE_LEADING_AT_RULE.test(css);
}

export {
  canStyleSheetFollow,
  getStyleMergeKey,
  isStyleSheetClosed,
  joinStyleSheets
};