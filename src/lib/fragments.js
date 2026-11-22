/**
 * Custom fragment matching, and checks that minified CSS and JavaScript keep fragments intact
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
const RE_CSS_NAME_CHAR = /[\w-]/;
const RE_URL_OPEN = /url\(\s*/iy;
// An escape right before a fragment, which what it renders could extend (`\0` before a digit)
const RE_ESCAPE_END = /\\+[^\\\s]{0,9}$/;

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
 * @typedef {{start: number, end: number, context: string}} Span
 *  Stretch of code that a placeholder within reads as text of in: a comment, a string
 *  (as its quote), a template literal, a regular expression, or an unquoted URL
 * @typedef {{text: string, index: number, context: string, padding: string}} Placement
 *  A placeholder, where it stands, what it reads as there (`code` outside spans), and,
 *  within a string or the like, the whitespace around it
 */

/**
 * Index past the CSS comment or string starting at an index
 * @param {string} source
 * @param {number} index
 * @returns {number} The index itself when none starts there
 */
function skipCommentOrString(source, index) {
  const char = source[index];

  if (char === '/' && source[index + 1] === '*') {
    const end = source.indexOf('*/', index + 2);
    return end === -1 ? source.length : end + 2;
  }
  if (char !== '"' && char !== '\'') return index;

  for (let position = index + 1; position < source.length; position++) {
    const current = source[position];
    if (current === '\\') position++;
    else if (current === char) return position + 1;
    else if (current === '\n') return position;
  }
  return source.length;
}

/**
 * Comments, strings, and unquoted URLs in CSS, in order
 * @param {string} source
 * @returns {Span[]}
 */
function findCSSSpans(source) {
  /** @type {Span[]} */
  const spans = [];

  for (let i = 0; i < source.length; i++) {
    // An escaped quote is part of a name, not a string
    if (source[i] === '\\' && source[i + 1] !== '\n') {
      i++;
      continue;
    }
    const end = skipCommentOrString(source, i);
    if (end > i) {
      spans.push({ start: i, end, context: source[i] === '/' ? 'comment' : source[i] ?? '' });
      i = end - 1;
      continue;
    }

    const char = source[i];
    if ((char !== 'u' && char !== 'U') || RE_CSS_NAME_CHAR.test(source[i - 1] ?? '')) continue;
    RE_URL_OPEN.lastIndex = i;
    if (!RE_URL_OPEN.test(source)) continue;
    const start = RE_URL_OPEN.lastIndex;
    // A quoted URL is a string, read as one on the next turn
    if (source[start] !== '"' && source[start] !== '\'') {
      const close = source.indexOf(')', start);
      const urlEnd = close === -1 ? source.length : close;
      spans.push({ start, end: urlEnd, context: 'url' });
      i = urlEnd;
    } else {
      i = start - 1;
    }
  }

  return spans;
}

/**
 * @param {string} source
 * @param {RegExp} placeholder - Global
 * @param {Span[]} spans - In order
 * @returns {Placement[]}
 */
function placePlaceholders(source, placeholder, spans) {
  /** @type {Placement[]} */
  const placements = [];
  let next = 0;

  for (const match of source.matchAll(placeholder)) {
    while (next < spans.length && /** @type {Span} */ (spans[next]).end <= match.index) next++;
    const span = spans[next];
    const context = span && span.start <= match.index ? span.context : 'code';
    let padding = '';
    // Restoring a fragment puts back the whitespace around it, which, in code, replaces
    // whatever the minifier left there, but in a string adds to what it wrote instead
    // (e.g., a line break it escaped as `\n`); an escape before it has to stay, too
    if (context !== 'code' && context !== 'comment') {
      let start = match.index;
      let end = match.index + match[0].length;
      while (start > 0 && RE_WHITESPACE.test(source[start - 1] ?? '')) start--;
      while (end < source.length && RE_WHITESPACE.test(source[end] ?? '')) end++;
      const escape = RE_ESCAPE_END.exec(source.slice(Math.max(0, start - 16), start))?.[0] ?? '';
      padding = escape + source.slice(start, match.index) + '|' + source.slice(match.index + match[0].length, end);
    }
    placements.push({ text: match[0], index: match.index, context, padding });
  }

  return placements;
}

/**
 * Whether every placeholder the output holds reads as it did in the source, and only once:
 * A fragment written for one kind of string, or for code, may break another (e.g., a value
 * escaped for single quotes, now in double quotes), and one written twice renders twice
 * @param {Placement[]} before
 * @param {Placement[]} after
 * @returns {boolean}
 */
function keepsPlacements(before, after) {
  const placements = new Map(before.map(placement => [placement.text, placement]));
  const seen = new Set();

  for (const { text, context, padding } of after) {
    const original = placements.get(text);
    if (!original || seen.has(text) || original.padding !== padding) return false;
    // What an unquoted URL can hold, a string can, too
    if (original.context !== context && !(original.context === 'url' && (context === '"' || context === '\''))) return false;
    seen.add(text);
  }

  return true;
}

/**
 * Whether what comes before an index allows a CSS rule to start there
 * @param {string} source
 * @param {number} index
 * @returns {boolean}
 */
function isRuleStart(source, index) {
  let position = index;
  while (position > 0) {
    const char = source[--position] ?? '';
    if (char === '\n' || char === '\r' || char === ';' || char === '{' || char === '}') return true;
    if (!RE_WHITESPACE.test(char)) return char === ')' || (char === '/' && source[position - 1] === '*');
  }
  return true;
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
    const end = skipCommentOrString(source, i);
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
 * Whether code that starts with fragments still holds them where they stood: A fragment
 * starting a statement or rule can render as anything, or as nothing, while engines read
 * it as an identifier or selector and join it with the code around it, or drop it, so only
 * output of nothing but fragments holds up, and only where no label or `case` went with it
 * @param {Placement[]} starts
 * @param {Placement[]} after
 * @param {string} output
 * @param {RegExp} placeholder
 * @returns {boolean}
 */
function keepsStarts(starts, after, output, placeholder) {
  if (!starts.length) return true;
  const kept = new Set(after.map(placement => placement.text));
  return !output.replace(placeholder, '').trim() && starts.every(placement => kept.has(placement.text));
}

/**
 * Whether minified CSS can stand in for its source; a fragment in an at-rule Lightning CSS
 * cannot read would go with that at-rule
 * @param {string} source
 * @param {unknown} output - Anything but a string, from a minifier of one’s own, passes
 * @param {RegExp} placeholder - Global pattern matching one fragment placeholder
 * @returns {boolean}
 */
function isMinifiedCSSSafe(source, output, placeholder) {
  if (typeof output !== 'string' || output === source) return true;

  const before = placePlaceholders(source, placeholder, findCSSSpans(source));
  if (!before.length) return true;
  const after = placePlaceholders(output, placeholder, findCSSSpans(output));

  const starts = before.filter(placement => placement.context === 'code' && isRuleStart(source, placement.index));
  if (!keepsStarts(starts, after, output, placeholder) || !keepsPlacements(before, after)) return false;
  if (!source.includes('@')) return true;
  const kept = new Set(after.map(placement => placement.text));
  return findDroppableAtRulePlaceholders(source, placeholder).every(token => kept.has(token));
}

/** @type {Promise<typeof import('acorn')> | undefined} */
let acornPromise;

/**
 * @param {boolean} inline - Whether the code is an event handler, which may `return`
 * @param {boolean} isModule
 * @param {Span[]} spans - Receives the comments
 * @returns {import('acorn').Options}
 */
function getAcornOptions(inline, isModule, spans) {
  return {
    allowReturnOutsideFunction: inline,
    ecmaVersion: 'latest',
    onComment: (_block, _text, start, end) => spans.push({ start, end, context: 'comment' }),
    sourceType: isModule ? 'module' : 'script'
  };
}

/**
 * Parse JavaScript for its comments, strings, template literals, and regular expressions,
 * and for where its statements start
 * @param {typeof import('acorn')} acorn
 * @param {string} source
 * @param {boolean} inline
 * @param {boolean} isModule
 * @returns {{spans: Span[], statements: Set<number>, labeled: boolean} | null} Null where
 *  the code does not parse
 */
function parseJS(acorn, source, inline, isModule) {
  /** @type {Span[]} */
  const spans = [];
  /** @type {any[]} */
  const stack = [];

  try {
    stack.push(acorn.parse(source, getAcornOptions(inline, isModule, spans)));
  } catch {
    return null;
  }

  const statements = new Set();
  let labeled = false;
  while (stack.length) {
    const node = stack.pop();
    const type = node.type;
    if (type === 'Literal') {
      if (typeof node.value === 'string') spans.push({ start: node.start, end: node.end, context: source[node.start] ?? '' });
      else if (node.regex) spans.push({ start: node.start, end: node.end, context: '/' });
      continue;
    }
    if (type === 'TemplateElement') {
      spans.push({ start: node.start, end: node.end, context: '`' });
      continue;
    }
    if (type === 'LabeledStatement' || type === 'SwitchCase') labeled = true;
    if (type.endsWith('Statement')) statements.add(node.start);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const child of value) if (typeof child?.type === 'string') stack.push(child);
      } else if (typeof value?.type === 'string') {
        stack.push(value);
      }
    }
  }

  spans.sort((spanA, spanB) => spanA.start - spanB.start);
  return { spans, statements, labeled };
}

/**
 * Tokenize JavaScript for its comments, strings, template literals, and regular expressions,
 * which is all minified code needs and takes less than parsing it. Tokens read without
 * parsing may come out wrong around regular expressions, which can only make a fragment
 * seem to have moved.
 * @param {typeof import('acorn')} acorn
 * @param {string} source
 * @param {boolean} inline
 * @param {boolean} isModule
 * @returns {Span[] | null} Null where the code does not tokenize
 */
function tokenizeJS(acorn, source, inline, isModule) {
  /** @type {Span[]} */
  const spans = [];

  try {
    for (const token of acorn.tokenizer(source, getAcornOptions(inline, isModule, spans))) {
      const label = token.type.label;
      if (label === 'string') spans.push({ start: token.start, end: token.end, context: source[token.start] ?? '' });
      else if (label === 'template' || label === 'invalidTemplate') spans.push({ start: token.start, end: token.end, context: '`' });
      else if (label === 'regexp') spans.push({ start: token.start, end: token.end, context: '/' });
    }
  } catch {
    return null;
  }

  spans.sort((spanA, spanB) => spanA.start - spanB.start);
  return spans;
}

/**
 * Whether minified JavaScript can stand in for its source; code that doesn’t parse with
 * its fragments in it stays as written, as does code whose output Acorn cannot read where
 * it has to
 * @param {string} source
 * @param {unknown} output - Anything but a string, from a minifier of one’s own, passes
 * @param {RegExp} placeholder - Global pattern matching one fragment placeholder
 * @param {boolean} [inline] - Whether the code is an event handler
 * @param {boolean} [isModule]
 * @returns {Promise<boolean>}
 */
async function isMinifiedJSSafe(source, output, placeholder, inline = false, isModule = false) {
  if (typeof output !== 'string' || output === source || source.search(placeholder) === -1) return true;

  const acorn = await (acornPromise ??= import('acorn'));
  const read = parseJS(acorn, source, inline, isModule);
  if (!read) return false;
  const before = placePlaceholders(source, placeholder, read.spans);

  const starts = before.filter(placement => read.statements.has(placement.index));
  if (starts.length && read.labeled) return false;

  // Code may end up in a string (a key, under Terser’s `quote_keys`), so the output is read, too
  const spansOutput = tokenizeJS(acorn, output, inline, isModule);
  if (!spansOutput) return false;
  const after = placePlaceholders(output, placeholder, spansOutput);
  return keepsStarts(starts, after, output, placeholder) && keepsPlacements(before, after);
}

export {
  toDelimitedFragment,
  toFragment,
  replaceCustomFragments,
  isMinifiedCSSSafe,
  isMinifiedJSSafe
};