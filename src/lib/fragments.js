/**
 * Custom fragment matching
 *
 * `ignoreCustomFragments` patterns nearly always describe the same shape: a literal
 * opening delimiter, an any-character or negated-class body, and a literal closing
 * delimiter, as in `<%[\s\S]*?%>` or `\{\{[^}]*?\}\}`. Such a fragment can be found
 * with `indexOf` in linear time, where running the pattern as a regex costs O(n²)
 * on input that opens fragments it never closes—and can cost far more than that when
 * the pattern itself backtracks. Patterns of other shapes keep running as regexes,
 * one per pattern, so each keeps its own flags.
 */

import { LRU } from './utils.js';

const RE_WHITESPACE = /\s/;
const RE_NAME_CHAR = /[\w$-]/;

// Run on at most the eight characters ending in the word
const RE_BLOCK_KEYWORD = /(?:^|[^\w$.])(?:do|else|finally|try)$/;

// The last character before a `/` that starts a regular expression, not a division
const RE_BEFORE_REGEX = /[(,=:[!&|?{};+*%<>~^}-]/;

// Run on at most the eleven characters ending in the word
const RE_BEFORE_REGEX_KEYWORD = /(?:^|[^\w$.])(?:await|case|delete|do|else|in|instanceof|new|of|return|throw|typeof|void|yield)$/;

// Run on at most the eleven characters from the `@`
const RE_DROPPABLE_AT_RULE = /^@(?:charset|import|namespace)(?![\w-])/i;

// Any-character and negated-class bodies; without the `s` flag, `.` is itself a
// negated class, excluding line terminators
const RE_DELIMITED = /^(.*?)(?:\[\\s\\S\]|\[\\S\\s\]|\[\^\]|(\.)|\[\^((?:\\[^]|[^\]\\])+)\])(?:([*+])|\{(\d+)(?:,(\d*))?\})\?(.*)$/;

// Flags that leave literal matching alone, so a pattern carrying them can still be
// scanned for; `i` in particular cannot, since case folding moves character indexes
const RE_LITERAL_FLAGS = /^[gds]*$/;

/**
 * @typedef {{open: string, close: string, min: number, max: number, excluded: RegExp | null}} DelimitedFragment
 *  Literal delimiters around a body, found by scanning; `excluded` holds the
 *  characters a negated-class body cannot cross, null when the body spans every
 *  character
 * @typedef {{search: RegExp, anchored: RegExp, close: string | null}} PatternFragment
 *  Everything else, found by running the pattern itself; `close` holds the literal
 *  every match ends with, where one follows an unbounded any-character body
 */

/**
 * Read a regex source as a literal string, so it can be matched with `indexOf`
 * @param {string} source
 * @returns {string | null} Null when the source is more than literal characters
 */
function toLiteral(source) {
  let literal = '';

  for (let i = 0; i < source.length; i++) {
    const char = source[i] ?? '';
    if (char === '\\') {
      const escaped = source[++i];
      // A trailing backslash is half an escape the body token was split out of,
      // as in `<%\.*?%>`, where the `.` is literal and not a body
      if (escaped === undefined) return null;
      // `\n` and friends are literal characters, `\s` and `\1` are not
      if (escaped === 'n') literal += '\n';
      else if (escaped === 't') literal += '\t';
      else if (escaped === 'r') literal += '\r';
      else if (escaped === 'f') literal += '\f';
      else if (escaped === 'v') literal += '\v';
      else if (/[A-Za-z0-9]/.test(escaped)) return null;
      else literal += escaped;
    } else if ('.*+?()[]{}|^$'.includes(char)) {
      return null;
    } else {
      literal += char;
    }
  }

  return literal;
}

/**
 * Describe a fragment pattern as literal delimiters around an any-character body
 * @param {RegExp} pattern
 * @returns {DelimitedFragment | null} Null when the pattern has another shape, which
 *  the caller answers by running it as a regex
 */
function toDelimitedFragment(pattern) {
  if (!RE_LITERAL_FLAGS.test(pattern.flags)) return null;

  const match = RE_DELIMITED.exec(pattern.source);
  if (!match) return null;

  const [, rawOpen, dot, negated, simple, exact, upper, rawClose] = match;
  const open = toLiteral(rawOpen ?? '');
  const close = toLiteral(rawClose ?? '');
  // Both delimiters have to be there: without them a match has no boundary to scan to
  if (!open || !close) return null;

  // The class content doubles as the search for characters the body cannot cross;
  // a `.` body spans every character under the `s` flag, and excludes line
  // terminators without it
  const inner = dot ? (pattern.flags.includes('s') ? null : '\\n\\r\\u2028\\u2029') : negated ?? null;

  const min = simple ? (simple === '+' ? 1 : 0) : Number(exact);
  const max = simple || upper === '' ? Infinity : Number(upper ?? exact);

  return { open, close, min, max, excluded: inner === null ? null : new RegExp('[' + inner + ']', 'g') };
}

/**
 * Whether a regex source has a `|` outside groups and classes, which lets a match skip the rest
 * @param {string} source
 * @returns {boolean}
 */
function hasTopLevelAlternation(source) {
  let depth = 0;
  let inClass = false;

  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === '\\') i++;
    else if (inClass) inClass = char !== ']';
    else if (char === '[') inClass = true;
    else if (char === '(') depth++;
    else if (char === ')') depth--;
    else if (char === '|' && depth === 0) return true;
  }

  return false;
}

/**
 * The literal all matches of a pattern end with, where an unbounded any-character body leads
 * up to it: Without that literal ahead, each opener runs the body to the end of the input
 * only to fail, which costs O(n²) on input that opens fragments it never closes
 * @param {RegExp} pattern
 * @returns {string | null}
 */
function toClosingLiteral(pattern) {
  const match = RE_DELIMITED.exec(pattern.source);
  if (!match) return null;

  const [, rawOpen, dot, negated, simple, , , rawClose] = match;
  if (!simple || negated !== undefined || (dot && !pattern.flags.includes('s'))) return null;
  if (hasTopLevelAlternation(rawOpen ?? '')) return null;

  const close = toLiteral(rawClose ?? '');
  // `indexOf` can stand in for the pattern only where case folding leaves the literal alone
  if (!close || (pattern.flags.includes('i') && close.toLowerCase() !== close.toUpperCase())) return null;

  return close;
}

// Prepared fragments outlive the call, as options mostly repeat their patterns; a scan
// only ever runs synchronously, so the `lastIndex` of their regexes is never shared
const fragmentCache = new LRU(100);

/**
 * Prepare a fragment pattern for matching, by scanning where the shape allows it
 * @param {RegExp} pattern
 * @returns {DelimitedFragment | PatternFragment}
 */
function toFragment(pattern) {
  const key = pattern.flags + '/' + pattern.source;
  const cached = /** @type {DelimitedFragment | PatternFragment | undefined} */ (fragmentCache.get(key));
  if (cached) return cached;

  // `g` and `y` are ours to set, the rest belong to the pattern
  const flags = pattern.flags.replace(/[gy]/g, '');
  const fragment = toDelimitedFragment(pattern) ?? {
    search: new RegExp(pattern.source, flags + 'g'),
    anchored: new RegExp(pattern.source, flags + 'y'),
    close: toClosingLiteral(pattern)
  };
  fragmentCache.set(key, fragment);
  return fragment;
}

/**
 * Replace runs of custom fragments, and the whitespace padding them
 * @param {string} value - Document to scan
 * @param {(DelimitedFragment | PatternFragment)[]} fragments - In the order the patterns
 *  were given, since the earliest match wins and ties go to the pattern listed first
 * @param {(match: string) => string} replacer - Called with each match, as `replace` would
 * @returns {string}
 */
function replaceCustomFragments(value, fragments, replacer) {
  // Where each fragment's next match may start, its next closing delimiter may be
  // found, and its next excluded character sits; all only ever move forward, which
  // is what keeps the whole scan linear
  const found = fragments.map(() => /** @type {{start: number, end: number} | null} */ (null));
  const closesAt = fragments.map(() => -1);
  const excludedAt = fragments.map(() => -1);
  const exhausted = fragments.map(() => false);

  /**
   * Whether a body region holds a character its class excludes
   * @param {DelimitedFragment} fragment
   * @param {number} index - Which fragment, for the forward-only bookkeeping
   * @param {number} bodyStart
   * @param {number} close
   * @returns {boolean}
   */
  const bodyBlocked = (fragment, index, bodyStart, close) => {
    if (!fragment.excluded) return false;
    if (/** @type {number} */ (excludedAt[index]) < bodyStart) {
      fragment.excluded.lastIndex = bodyStart;
      const blocked = fragment.excluded.exec(value);
      excludedAt[index] = blocked ? blocked.index : Infinity;
    }
    return /** @type {number} */ (excludedAt[index]) < close;
  };

  /**
   * Earliest match of one delimited fragment at or after `from`
   * @param {DelimitedFragment} fragment
   * @param {number} index - Which fragment, for the forward-only bookkeeping
   * @param {number} from
   * @param {boolean} anchored - Whether the match has to start exactly at `from`
   * @returns {{start: number, end: number} | null}
   */
  const scan = (fragment, index, from, anchored) => {
    // The closing delimiter first: An opener starting with `<` is slow to find in markup
    if (/** @type {number} */ (closesAt[index]) < from) {
      closesAt[index] = value.indexOf(fragment.close, from);
      if (closesAt[index] === -1) {
        exhausted[index] = true;
        return null;
      }
    }

    let openFrom = from;

    for (;;) {
      const open = anchored
        ? (value.startsWith(fragment.open, from) ? from : -1)
        : value.indexOf(fragment.open, openFrom);
      if (open === -1) {
        if (!anchored) exhausted[index] = true;
        return null;
      }

      const bodyStart = open + fragment.open.length;
      if (/** @type {number} */ (closesAt[index]) < bodyStart + fragment.min) {
        closesAt[index] = value.indexOf(fragment.close, bodyStart + fragment.min);
      }
      const close = /** @type {number} */ (closesAt[index]);
      if (close === -1) {
        exhausted[index] = true;
        return null;
      }

      if (close - bodyStart <= fragment.max && !bodyBlocked(fragment, index, bodyStart, close)) {
        return { start: open, end: close + fragment.close.length };
      }
      // The body is longer than the pattern allows, or holds a character its class
      // excludes, so the match has to start later
      if (anchored) return null;
      openFrom = open + 1;
    }
  };

  /**
   * Earliest match of one regex fragment at or after `from`
   * @param {PatternFragment} fragment
   * @param {number} index - Which fragment, for the forward-only bookkeeping
   * @param {number} from
   * @param {boolean} anchored
   * @returns {{start: number, end: number} | null}
   */
  const run = (fragment, index, from, anchored) => {
    if (fragment.close !== null) {
      // `Infinity` marks a closing literal that is nowhere ahead, so the search is not repeated
      if (/** @type {number} */ (closesAt[index]) < from) {
        const close = value.indexOf(fragment.close, from);
        closesAt[index] = close === -1 ? Infinity : close;
      }
      if (closesAt[index] === Infinity) return null;
    }

    const pattern = anchored ? fragment.anchored : fragment.search;
    pattern.lastIndex = from;

    for (;;) {
      const match = pattern.exec(value);
      if (!match) return null;
      // A pattern that matches nothing would leave the run in place forever
      if (match[0].length > 0) return { start: match.index, end: match.index + match[0].length };
      if (anchored) return null;
      pattern.lastIndex = match.index + 1;
    }
  };

  /**
   * @param {number} from
   * @param {boolean} anchored
   * @returns {{start: number, end: number} | null}
   */
  const find = (from, anchored) => {
    /** @type {{start: number, end: number} | null} */
    let earliest = null;

    for (let i = 0; i < fragments.length; i++) {
      if (exhausted[i]) continue;
      const fragment = /** @type {DelimitedFragment | PatternFragment} */ (fragments[i]);

      /** @type {{start: number, end: number} | null} */
      let match;
      if (anchored) {
        match = 'open' in fragment ? scan(fragment, i, from, true) : run(fragment, i, from, true);
      } else {
        // Matches only ever move forward, so the last one found still stands
        const previous = found[i];
        match = previous && previous.start >= from
          ? previous
          : ('open' in fragment ? scan(fragment, i, from, false) : run(fragment, i, from, false));
        found[i] = match;
        // Nothing ahead now means nothing ahead later, either
        if (!match) exhausted[i] = true;
      }

      // Ties go to the fragment listed first, the way alternation would resolve them
      if (match && (!earliest || match.start < earliest.start)) earliest = match;
    }

    return earliest;
  };

  let out = '';
  let copied = 0;
  let search = 0;

  while (search <= value.length) {
    const first = find(search, false);
    if (!first) break;

    // Fragments running straight into each other are one match
    let end = first.end;
    for (;;) {
      const next = find(end, true);
      if (!next) break;
      end = next.end;
    }

    // …as is the whitespace on either side, back to where the last match left off
    let start = first.start;
    while (start > copied && RE_WHITESPACE.test(value[start - 1] ?? '')) start--;
    while (end < value.length && RE_WHITESPACE.test(value[end] ?? '')) end++;

    out += value.slice(copied, start) + replacer(value.slice(start, end));
    copied = end;
    search = end;
  }

  return copied === 0 ? value : out + value.slice(copied);
}

/**
 * Index past the regular expression starting at the `/` at an index
 * @param {string} source
 * @param {number} index
 * @returns {number} The index itself when the line ends before the expression does
 */
function skipRegex(source, index) {
  let inClass = false;
  for (let position = index + 1; position < source.length; position++) {
    const current = source[position];
    if (current === '\n' || current === '\r') return index;
    if (current === '\\') position++;
    else if (current === '[') inClass = true;
    else if (current === ']') inClass = false;
    else if (current === '/' && !inClass) return position + 1;
  }
  return index;
}

/**
 * Index past the comment, string, or regular expression starting at an index
 * @param {string} source
 * @param {number} index
 * @param {boolean} isJS
 * @returns {number} The index itself when none starts there
 */
function skipCommentOrString(source, index, isJS) {
  const char = source[index];
  const next = source[index + 1];

  if (char === '/' && next === '*') {
    const end = source.indexOf('*/', index + 2);
    return end === -1 ? source.length : end + 2;
  }
  if (isJS && char === '/' && next === '/') {
    const end = source.indexOf('\n', index + 2);
    return end === -1 ? source.length : end;
  }
  if (isJS && char === '/') return isRegexStart(source, index) ? skipRegex(source, index) : index;
  if (char !== '"' && char !== '\'' && !(isJS && char === '`')) return index;

  for (let position = index + 1; position < source.length; position++) {
    const current = source[position];
    if (current === '\\') position++;
    else if (current === char) return position + 1;
    else if (current === '\n' && char !== '`') return position;
  }
  return source.length;
}

/**
 * Index of the last non-whitespace character before an index
 * @param {string} source
 * @param {number} index
 * @returns {number} -1 when there is none
 */
function findPreviousToken(source, index) {
  let position = index - 1;
  while (position >= 0 && RE_WHITESPACE.test(source[position] ?? '')) position--;
  return position;
}

/**
 * Whether a `/` starts a regular expression rather than a division, going by what precedes
 * it; after a `)`, which `if (a) /b/.test(c)` leaves open, it’s read as a division
 * @param {string} source
 * @param {number} slash
 * @returns {boolean}
 */
function isRegexStart(source, slash) {
  const before = findPreviousToken(source, slash);
  if (before === -1) return true;

  const char = source[before] ?? '';
  // `++` and `--` can only end an operand here, as a literal cannot be incremented
  if ((char === '+' || char === '-') && source[before - 1] === char) return false;
  return RE_BEFORE_REGEX.test(char) || RE_BEFORE_REGEX_KEYWORD.test(source.slice(Math.max(before - 10, 0), before + 1));
}

/**
 * Whether a block keyword ends at an index
 * @param {string} source
 * @param {number} index
 * @returns {boolean}
 */
function isBlockKeywordEnd(source, index) {
  return RE_BLOCK_KEYWORD.test(source.slice(Math.max(index - 7, 0), index + 1));
}

/**
 * Whether a `{` opens a block rather than an object literal
 * @param {string} source
 * @param {number} brace
 * @returns {boolean}
 */
function isBlockBrace(source, brace) {
  const before = findPreviousToken(source, brace);
  if (before === -1) return true;

  const char = source[before] ?? '';
  if (char === ';' || char === '{' || char === '}' || char === ')') return true;
  if (char === '>') return source[before - 1] === '=';
  return isBlockKeywordEnd(source, before);
}

/**
 * Whether a colon ends a statement label or `default`, going by what precedes the name.
 * Two expressions cannot follow each other, so a name after one of these tokens cannot
 * be the middle of a ternary
 * @param {string} source
 * @param {number} colon
 * @returns {boolean}
 */
function isLabelColon(source, colon) {
  const end = findPreviousToken(source, colon);
  let start = end;
  while (start >= 0 && RE_NAME_CHAR.test(source[start] ?? '')) start--;
  if (start === end) return false;

  const before = findPreviousToken(source, start + 1);
  const char = source[before];
  // After `:`, any other name may be a nested ternary’s branch
  if (char === ':') return source.slice(start + 1, end + 1) === 'default';
  return before === -1 || char === ';' || char === '}' || char === ')' || (char === '{' && isBlockBrace(source, before));
}

/**
 * Whether the `case` keyword starts at an index, rather than a name or property holding it
 * @param {string} source
 * @param {number} index
 * @returns {boolean}
 */
function isCaseKeyword(source, index) {
  if (!source.startsWith('case', index) || RE_NAME_CHAR.test(source[index + 4] ?? '')) return false;

  const before = source[index - 1] ?? '';
  if (before === '.' || RE_NAME_CHAR.test(before)) return false;

  let after = index + 4;
  while (RE_WHITESPACE.test(source[after] ?? '')) after++;
  return source[after] !== ':';
}

/**
 * Indexes of the colons after which a JavaScript statement starts
 * @param {string} source
 * @returns {Set<number>}
 */
function findStatementColons(source) {
  const colons = new Set();
  // Unpaired `?` in the current `case` expression, -1 outside of one
  let ternaries = -1;

  for (let i = 0; i < source.length; i++) {
    const end = skipCommentOrString(source, i, true);
    if (end > i) {
      i = end - 1;
      continue;
    }

    const char = source[i];
    if (ternaries === -1) {
      if (char === ':') {
        if (isLabelColon(source, i)) colons.add(i);
      } else if (char === 'c' && isCaseKeyword(source, i)) {
        ternaries = 0;
        i += 3;
      }
    } else if (char === '?') {
      // `?.` and `??` have no `:` to pair with
      if (source[i + 1] === '.' || source[i + 1] === '?') i++;
      else ternaries++;
    } else if (char === ':') {
      if (ternaries === 0) colons.add(i);
      ternaries--;
    } else if (char === ';' || char === '{' || char === '}') {
      ternaries = -1;
    }
  }

  return colons;
}

/**
 * Placeholders within `@charset`, `@import`, and `@namespace` statements, which
 * Lightning CSS drops whole where it cannot read them, and `@charset` always
 * @param {string} source
 * @param {RegExp} placeholder
 * @returns {string[]}
 */
function findDroppableAtRulePlaceholders(source, placeholder) {
  const tokens = [];
  let start = -1;

  for (let i = 0; i <= source.length; i++) {
    const end = skipCommentOrString(source, i, false);
    if (end > i) {
      i = end - 1;
      continue;
    }

    const char = source[i];
    if (start === -1) {
      if (char === '@' && RE_DROPPABLE_AT_RULE.test(source.slice(i, i + 11))) start = i;
    } else if (char === ';' || char === '{' || char === '}' || char === undefined) {
      for (const match of source.slice(start, i).matchAll(placeholder)) tokens.push(match[0]);
      start = -1;
    }
  }

  return tokens;
}

/**
 * Whether what comes before an index allows a statement or rule to start there
 * @param {string} source
 * @param {number} index
 * @param {Set<number>} colons - Colons after which a statement starts
 * @param {boolean} isJS
 * @returns {boolean}
 */
function isCodeStart(source, index, colons, isJS) {
  let position = index;
  while (position > 0) {
    const char = source[--position] ?? '';
    if (char === '\n' || char === '\r' || char === ';' || char === '{' || char === '}') return true;
    if (!RE_WHITESPACE.test(char)) {
      return char === ')' || (char === '/' && source[position - 1] === '*') || colons.has(position) || (isJS && isBlockKeywordEnd(source, position));
    }
  }
  return true;
}

/**
 * Whether minified CSS or JavaScript can stand in for its source. A fragment starting a
 * statement or rule can render as anything, or as nothing, while engines read it as an
 * identifier or selector and join it with the code around it, or drop it; a fragment in
 * an at-rule Lightning CSS cannot read would go with that at-rule
 * @param {string} source
 * @param {unknown} output - Anything but a string, from a minifier of one’s own, passes
 * @param {RegExp} placeholder - Global pattern matching one fragment placeholder
 * @param {boolean} [isJS] - Whether the code is JavaScript rather than CSS
 * @returns {boolean}
 */
function isMinifiedCodeSafe(source, output, placeholder, isJS = false) {
  if (typeof output !== 'string' || output === source) return true;

  const matches = [...source.matchAll(placeholder)];
  if (!matches.length) return true;

  const colons = isJS ? findStatementColons(source) : new Set();
  const starts = matches.filter(match => isCodeStart(source, match.index, colons, isJS));
  const kept = new Set(Array.from(output.matchAll(placeholder), match => match[0]));

  // Output of nothing but fragments only holds up where no label or `case` went with the code
  if (starts.length && (colons.size || output.replace(placeholder, '').trim() || !starts.every(match => kept.has(match[0])))) return false;
  return isJS || !source.includes('@') || findDroppableAtRulePlaceholders(source, placeholder).every(token => kept.has(token));
}

export {
  toDelimitedFragment,
  toFragment,
  replaceCustomFragments,
  isMinifiedCodeSafe
};