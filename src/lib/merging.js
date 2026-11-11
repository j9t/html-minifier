/**
 * Script and style merging
 */

import { RE_WS_END, RE_WS_START } from './constants.js';
import { isClassicScriptType, isStyleLinkTypeAttribute } from './attributes.js';

// Rules that only work at the start of a style sheet, and those that apply to the rest of it,
// each also as any at-rule whose name holds an escape (a stray one in a string or comment
// merely keeps the style sheets apart)
const RE_LEADING_AT_RULE = /@(?:import|namespace)|@[\w-]*\\/i;
const RE_NAMESPACE_RULE = /@namespace|@[\w-]*\\/i;

// After `<!--`, `<script` opens a state `</script>` doesn’t end
const RE_SCRIPT_START_TEXT = /<script[\t\n\f\r />]/i;
const RE_SCRIPT_HASHBANG = /^\s*#!/;

/** @typedef {{name: string, value?: string, customAssign?: string, customOpen?: string}} MergeAttribute */

/**
 * Attribute values by lowercased name, the first of repeated attributes counting, with custom
 * fragments as written; `null` where a custom fragment stands for attributes, or assigns one
 *
 * @param {MergeAttribute[]} attrs
 * @param {(text: string) => string} resolve - Restores custom fragments
 * @returns {Record<string, string> | null}
 */
function readAttrs(attrs, resolve) {
  // Without a prototype, so that names like `constructor` are attributes, too
  /** @type {Record<string, string>} */
  const values = Object.create(null);
  for (const attr of attrs) {
    if ((attr.customAssign && attr.customAssign !== '=') || attr.customOpen) return null;
    const name = resolve(attr.name);
    if (name !== attr.name) return null;
    const nameLower = name.toLowerCase();
    if (!(nameLower in values)) values[nameLower] = resolve(attr.value ?? '');
  }
  return values;
}

/**
 * What a `script` or `style` element’s attributes make of it, equal for elements that may be
 * merged: classic inline scripts and CSS style sheets whose attributes match, as tools that
 * rewrite the page in the browser or at the edge may read them (e.g., `data-cfasync`); `null`
 * for one that is to stay apart, as one with an `id`, which two elements can’t share
 *
 * @param {'script' | 'style'} kind
 * @param {MergeAttribute[]} attrs
 * @param {(text: string) => string} resolve - Restores custom fragments
 * @returns {string | null}
 */
function getMergeKey(kind, attrs, resolve) {
  const values = readAttrs(attrs, resolve);
  if (!values || 'id' in values) return null;
  if (kind === 'script'
    ? 'src' in values || !isClassicScriptType(values.type)
    : 'type' in values && !isStyleLinkTypeAttribute(values.type)) {
    return null;
  }
  delete values.type;
  // As written, without one, or empty, the media query list matches all
  if ('media' in values) {
    const media = (values.media ?? '').trim();
    if (media && media.toLowerCase() !== 'all') values.media = media;
    else delete values.media;
  }
  return JSON.stringify([kind, ...Object.entries(values).sort(([nameA], [nameB]) => nameA < nameB ? -1 : 1)]);
}

/**
 * Whether script code starts with a hashbang, which only works at the very start of a script,
 * so that the script stays apart (where whitespace comes first, it’s an error, which would
 * spread to what is merged with it)
 *
 * @param {string} code
 * @returns {boolean}
 */
function holdsHashbang(code) {
  return RE_SCRIPT_HASHBANG.test(code);
}

/**
 * Whether a script may follow merged script code, which, holding `<!--`, would not end at
 * `</script>` after one holding `<script`
 *
 * @param {boolean} holdsCommentStart - Whether the merged script holds `<!--` so far
 * @param {string} next
 * @returns {boolean}
 */
function canScriptFollow(holdsCommentStart, next) {
  return !holdsCommentStart || !RE_SCRIPT_START_TEXT.test(next);
}

/**
 * Scripts joined as one, with a semicolon: after a newline where the last line may end in a
 * comment (`//`, `<!--`, or `-->`, all of which browsers read as running to the end of the
 * line), and before one where the next starts with `-->`, a comment only there. A custom
 * fragment at either end may write any of these.
 *
 * @param {string[]} parts
 * @param {string[]} markers - Custom fragment placeholder markers
 * @returns {string}
 */
function joinScripts(parts, markers) {
  /** @type {string[]} */
  const pieces = [];
  let codePrev = '';
  for (const part of parts) {
    const code = part.trim();
    if (!code) continue;
    if (codePrev) {
      const lastLine = codePrev.slice(codePrev.lastIndexOf('\n') + 1);
      // What JavaScript reads as a comment running to the end of the line
      const endsWithComment = lastLine.includes('//') || lastLine.includes('<!--') || lastLine.includes('-->') ||
        markers.some(marker => codePrev.endsWith(marker));
      const startsWithComment = code.startsWith('-->') || markers.some(marker => code.startsWith(marker));
      pieces.push((endsWithComment ? '\n;' : (codePrev.endsWith(';') ? '' : ';')) + (startsWithComment ? '\n' : ''));
    }
    pieces.push(code);
    codePrev = code;
  }
  return pieces.join('');
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
    if (i > 0) part = part.replace(RE_WS_START, '');
    return i < last ? part.replace(RE_WS_END, '') : part;
  }).join('');
}

/**
 * Whether CSS may follow a style sheet’s: The style sheet has to end cleanly and declare
 * no namespaces, which would apply to what follows, and the CSS can’t hold rules that
 * only work at the start of a style sheet
 *
 * @param {string} css - The last CSS of the style sheets merged so far that isn’t blank
 * @param {string} next
 * @returns {boolean}
 */
function canStyleSheetsJoin(css, next) {
  return isStyleSheetClosed(css) && !RE_NAMESPACE_RULE.test(css) && !RE_LEADING_AT_RULE.test(next);
}

export {
  canScriptFollow,
  canStyleSheetsJoin,
  getMergeKey,
  holdsHashbang,
  joinScripts,
  joinStyleSheets
};