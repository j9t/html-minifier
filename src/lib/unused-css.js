/**
 * Unused-CSS removal
 */

import { findTagEnd, hashContent } from './utils.js';

// Attributes whose values name elements by ID or hold space-separated ID lists
const idReferenceAttributes = new Set([
  'aria-activedescendant',
  'aria-controls',
  'aria-describedby',
  'aria-details',
  'aria-errormessage',
  'aria-flowto',
  'aria-labelledby',
  'aria-owns',
  'commandfor',
  'contextmenu',
  'for',
  'form',
  'headers',
  'itemref',
  'list',
  'popovertarget'
]);

// Attributes whose value may be a same-document fragment URL (`#main`). `:target`
// rules and SVG sprite references (`<use href="#icon">`) rest on these, so the ID
// they name counts as used.
const fragmentReferenceAttributes = new Set([
  'action',
  'cite',
  'data',
  'formaction',
  'href',
  'poster',
  'src',
  'usemap',
  'xlink:href'
]);

const attributePattern = /(?:^|[\s/])([-\w:.]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
const identifierPattern = /--[\w-]*|-?[A-Za-z_][\w-]*/g;
const whitespacePattern = /\s/;
const whitespaceRunPattern = /\s+/;
// SVG paints and filters reach elements by ID through `url(#gradient)`, in
// presentation attributes as well as in `style`
const fragmentURLPattern = /url\(\s*['"]?#([^)'"\s]+)/gi;
// Class names routinely carry characters that end a CSS identifier (`md:flex`,
// `w-1/2`, `p-[3px]`), so scripts and `data-*` values contribute whole tokens
// besides identifiers; quoted strings are where scripts keep such names
const stringLiteralPattern = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;

// CSS identifiers may contain escapes (`.md\:flex`, `.w-1\/2`), which have to be
// resolved before comparing them against the plain tokens found in the markup. A
// symbol may follow another name (`p.note`, `.a.b`); matches outside selectors
// (`#fff`, `a.png`) are harmless, as only selectors are checked against the list.
const cssIdentifierPattern = /(?<!\\)[.#]((?:[-_a-zA-Z]|\\[0-9a-fA-F]{1,6}[ \t\n]?|\\[^\n0-9a-fA-F])(?:[-\w]|\\[0-9a-fA-F]{1,6}[ \t\n]?|\\[^\n0-9a-fA-F])*)/g;
// `unusedSymbols` also drops `@keyframes` and `@counter-style` rules by name, so any
// name used there is off limits even when no element carries it as a class or ID
const reservedAtRulePattern = /@(?:-\w+-)?(?:keyframes|counter-style)\s+(-?[_a-zA-Z][\w-]*)/gi;
const escapePattern = /\\(?:([0-9a-fA-F]{1,6})[ \t\n]?|(.))/g;
// Matches inside comments and scripts only add names
const startTagPattern = /<([a-z][^\s/>]*)/gi;

/**
 * Resolve CSS escape sequences in an identifier.
 * @param {string} identifier
 * @returns {string}
 */
function unescapeIdentifier(identifier) {
  if (identifier.indexOf('\\') === -1) {
    return identifier;
  }
  return identifier.replace(escapePattern, (_match, hex, literal) => {
    if (!hex) {
      return literal;
    }
    // Per CSS Syntax spec, a null, surrogate, or out-of-range escape becomes `U+FFFD`
    const code = parseInt(hex, 16);
    return (code === 0 || code > 0x10FFFF || (code >= 0xD800 && code <= 0xDFFF))
      ? '\uFFFD'
      : String.fromCodePoint(code);
  });
}

/**
 * Add what `identifierPattern` matches in `text`
 * @param {string} text
 * @param {Set<string>} used
 * @param {Set<string>} [names] - Also receives each identifier lowercased
 * @param {Set<string>} [seen] - Identifiers added before, which are skipped
 */
function addIdentifiers(text, used, names, seen) {
  for (const identifier of text.match(identifierPattern) ?? []) {
    if (seen) {
      if (seen.has(identifier)) {
        continue;
      }
      seen.add(identifier);
    }
    used.add(identifier);
    names?.add(identifier.toLowerCase());
  }
}

/**
 * Add what splitting `text` at `/\s+/` yields, but empty strings
 * @param {string} text
 * @param {Set<string>} used
 */
function addTokens(text, used) {
  // Most values are a single token, which needs no array
  if (!whitespacePattern.test(text)) {
    if (text) {
      used.add(text);
    }
    return;
  }
  for (const token of text.split(whitespaceRunPattern)) {
    if (token) {
      used.add(token);
    }
  }
}

/**
 * Locate the bodies of a raw-text element (`style`, `script`).
 *
 * Scanning beats one regular expression here: A pattern permissive enough for the
 * end tags browsers accept (`</script\t\n bar>`, `</script/>`) backtracks
 * quadratically over a document full of near-matches, and bounding it would make
 * long start tags go unrecognized.
 *
 * Tag names are matched in ASCII case only, as browsers do, and on the markup itself,
 * so offsets need no mapping back.
 *
 * @param {string} html
 * @param {string} tagName - Lowercase element name
 * @returns {Array<{start: number, bodyStart: number, bodyEnd: number, end: number, closed: boolean}>}
 */
function findRawTextElements(html, tagName) {
  /** @type {Array<{start: number, bodyStart: number, bodyEnd: number, end: number, closed: boolean}>} */
  const found = [];
  // Without the `u` flag, `i` folds no non-ASCII character into ASCII
  const openTag = new RegExp('<' + tagName, 'gi');
  const closeTag = new RegExp('</' + tagName, 'gi');
  const lengthOpen = tagName.length + 1;
  const lengthClose = tagName.length + 2;
  // A tag name ends at whitespace, a slash, or the closing bracket—so `<styles>`
  // and `</scriptfoo>` name different elements and must not match
  const endsName = (/** @type {string} */ character) =>
    character === '' || character === '/' || character === '>' || /\s/.test(character);

  let cursor = 0;
  for (;;) {
    openTag.lastIndex = cursor;
    const start = openTag.exec(html)?.index ?? -1;
    if (start === -1) {
      break;
    }
    if (!endsName(html.charAt(start + lengthOpen))) {
      cursor = start + lengthOpen;
      continue;
    }
    // A quoted attribute value may hold a `>`, so the tag ends where the parser
    // says it does, not at the next bracket
    const startTagEnd = findTagEnd(html, start + lengthOpen);
    if (startTagEnd === -1) {
      break;
    }

    const bodyStart = startTagEnd + 1;
    let search = bodyStart;
    let bodyEnd = -1;
    let end = -1;
    for (;;) {
      closeTag.lastIndex = search;
      const candidate = closeTag.exec(html)?.index ?? -1;
      if (candidate === -1) {
        break;
      }
      if (endsName(html.charAt(candidate + lengthClose))) {
        const closeEnd = findTagEnd(html, candidate + lengthClose);
        if (closeEnd !== -1) {
          bodyEnd = candidate;
          end = closeEnd + 1;
        }
        break;
      }
      search = candidate + lengthClose;
    }

    const closed = bodyEnd !== -1;
    found.push({
      start,
      bodyStart,
      bodyEnd: closed ? bodyEnd : html.length,
      end: closed ? end : html.length,
      closed
    });
    cursor = closed ? end : html.length;
  }

  return found;
}

/**
 * Collect the class names and IDs a document references.
 *
 * Style sheet contents are excluded, so that a style sheet never counts as
 * evidence for its own selectors. An `iframe srcdoc` value is not scanned,
 * either: It holds a document of its own, minified against its own symbol set.
 * Over-collecting is safe here (a symbol wrongly considered used is merely
 * kept), under-collecting is not.
 *
 * @param {string} html - Raw document markup
 * @param {boolean} includeScripts - Also treat identifiers inside inline `script` elements as used
 * @param {((text: string) => string)} [decode] - Resolves character references in attribute values and foreign script contents
 * @param {Set<string>} [elements] - Receives the element names the markup uses, lowercased, and the identifiers found in scripts, as possible element names
 * @returns {Set<string>} Symbols to keep
 */
function collectUsedSymbols(html, includeScripts, decode, elements) {
  const used = new Set();

  // Style sheets are skipped rather than cut out, so offsets keep pointing into
  // `html`. Only the body is skipped—the start tag carries ordinary attributes,
  // and `<style id="theme">` could be what `#theme` refers to. An unclosed
  // element is not skipped: Reading its contents as markup can only add symbols,
  // whereas ignoring the rest of the document would lose them.
  const skipped = findRawTextElements(html, 'style')
    .filter(element => element.closed)
    .map(element => ({ start: element.bodyStart, end: element.bodyEnd }));

  if (elements) {
    collectUsedElements(html, skipped, elements);
  }

  // Both loops below walk forward, so one cursor over the skipped ranges suffices
  let skipCursor = 0;
  const isSkipped = (/** @type {number} */ index) => {
    while (skipCursor < skipped.length && (skipped[skipCursor]?.end ?? 0) <= index) {
      skipCursor++;
    }
    const element = skipped[skipCursor];
    return element !== undefined && index >= element.start;
  };

  attributePattern.lastIndex = 0;
  let match;
  while ((match = attributePattern.exec(html))) {
    const raw = match[2] ?? match[3] ?? match[4] ?? '';
    if (!raw || isSkipped(match.index)) {
      continue;
    }
    const name = (match[1] ?? '').toLowerCase();
    // `class="us&#101;d"` names the class `used`, so compare against the decoded value
    const value = (decode && raw.indexOf('&') !== -1) ? decode(raw) : raw;
    if (name === 'class' || name === 'id' || idReferenceAttributes.has(name)) {
      addTokens(value, used);
    } else if (name.startsWith('data-')) {
      // Class names are commonly parked in `data-*` attributes for scripts to apply later
      addIdentifiers(value, used);
      addTokens(value, used);
    } else if (fragmentReferenceAttributes.has(name) && value.charAt(0) === '#') {
      // Only a leading `#`: `href="/page#sec"` names a section of another document
      addTokens(value.slice(1), used);
    }
    if (value.indexOf('(') !== -1) {
      fragmentURLPattern.lastIndex = 0;
      let reference;
      while ((reference = fragmentURLPattern.exec(value))) {
        addTokens(reference[1] ?? '', used);
      }
    }
  }

  if (includeScripts) {
    // Script contents are raw text, so character references stay literal
    // except in SVG and MathML, where they are resolved; as the namespace
    // isn’t tracked here, both readings count where they differ. An unclosed
    // `script` runs to the end of the document, as it does in a browser.
    skipCursor = 0;
    // Scripts repeat their identifiers, which need adding only once
    /** @type {Set<string>} */
    const identifiersScript = new Set();
    for (const element of findRawTextElements(html, 'script')) {
      if (isSkipped(element.start)) {
        continue;
      }
      const body = html.slice(element.bodyStart, element.bodyEnd);
      const decoded = (decode && body.indexOf('&') !== -1) ? decode(body) : body;
      for (const text of decoded === body ? [body] : [body, decoded]) {
        addIdentifiers(text, used, elements, identifiersScript);
        stringLiteralPattern.lastIndex = 0;
        let literal;
        while ((literal = stringLiteralPattern.exec(text))) {
          addTokens(literal[1] ?? literal[2] ?? literal[3] ?? '', used);
        }
      }
    }
  }

  return used;
}

/**
 * Determine which class/ID symbols a style sheet defines but the document doesn’t reference.
 * @param {string} css - Style sheet contents
 * @param {Set<string>} used - Symbols the document references
 * @param {Array<string | RegExp>} safelist - Symbols to keep regardless
 * @returns {string[]} Symbols safe to remove
 */
function findUnusedSymbols(css, used, safelist) {
  const reserved = new Set();
  reservedAtRulePattern.lastIndex = 0;
  let match;
  while ((match = reservedAtRulePattern.exec(css))) {
    if (match[1]) {
      reserved.add(match[1]);
    }
  }

  const unused = [];
  const seen = new Set();
  cssIdentifierPattern.lastIndex = 0;
  while ((match = cssIdentifierPattern.exec(css))) {
    const symbol = unescapeIdentifier(match[1] ?? '');
    if (seen.has(symbol)) {
      continue;
    }
    seen.add(symbol);
    if (used.has(symbol) || reserved.has(symbol) || isSafelisted(symbol, safelist)) {
      continue;
    }
    unused.push(symbol);
  }

  return unused;
}

/**
 * @param {string} symbol
 * @param {Array<string | RegExp>} safelist
 * @returns {boolean}
 */
function isSafelisted(symbol, safelist) {
  return safelist.some(entry => {
    if (!(entry instanceof RegExp)) {
      return entry === symbol;
    }
    // `test()` advances `lastIndex` on global and sticky patterns, which would
    // make a safelist entry match only every other symbol
    entry.lastIndex = 0;
    return entry.test(symbol);
  });
}

/**
 * Collect the element names a document contains, including those the parser
 * supplies when the markup leaves them out.
 * @param {string} html
 * @param {Array<{start: number, end: number}>} skipped - Style sheet bodies, in document order
 * @param {Set<string>} elements - Lowercase element names, added to
 */
function collectUsedElements(html, skipped, elements) {
  elements.add('html');
  elements.add('head');
  elements.add('body');

  let skipIndex = 0;
  startTagPattern.lastIndex = 0;
  let match;
  while ((match = startTagPattern.exec(html))) {
    while (skipIndex < skipped.length && (skipped[skipIndex]?.end ?? 0) <= match.index) {
      skipIndex++;
    }
    const element = skipped[skipIndex];
    if (element && match.index >= element.start) {
      continue;
    }
    elements.add((match[1] ?? '').toLowerCase());
  }
}

/**
 * Build the unused-CSS context for a document.
 * @param {string} html - Raw document markup
 * @param {boolean} includeScripts - Also treat identifiers inside inline `script` elements as used
 * @param {((text: string) => string)} [decode] - Resolves character references in attribute values and foreign script contents
 * @returns {{usedSymbols: Set<string>, usedElements: Set<string>, usedElementsKey: string}}
 */
function collectUsage(html, includeScripts, decode) {
  // A script may create the elements a rule is for, so its identifiers count as names, too
  const usedElements = new Set();
  const usedSymbols = collectUsedSymbols(html, includeScripts, decode, usedElements);
  // Elements the parser supplies inside a `table`, added after script identifiers, as a script
  // may create a `table`, too
  if (usedElements.has('table')) {
    usedElements.add('tbody');
    usedElements.add('tr');
  }
  if (usedElements.has('col')) {
    usedElements.add('colgroup');
  }
  return {
    usedSymbols,
    usedElements,
    // The CSS cache outlives a document, so its keys tell element sets apart. The set
    // is in document order, so the same elements in another order only miss the cache.
    usedElementsKey: String(hashContent([...usedElements].join(' ')))
  };
}

/**
 * Create a Lightning CSS `Selector` visitor that drops selectors naming an unused
 * class, ID, or element from their list, so the rule stays for the selectors that
 * remain (`unusedSymbols` alone only removes rules whose selectors are all unused).
 *
 * Only a selector’s own compounds are judged: Names inside pseudo-class and
 * pseudo-element arguments (`:not(.x)`, `:host(.x)`) are left alone.
 *
 * @param {string[]} unusedSymbols - Class/ID symbols safe to remove, from `findUnusedSymbols`
 * @param {Set<string>} usedElements - Lowercase element names the document contains or its scripts name
 * @param {Array<string | RegExp>} safelist - Symbols to keep regardless
 * @returns {(selector: Array<{type: string, name?: string}>) => [] | undefined}
 */
function createSelectorPruner(unusedSymbols, usedElements, safelist) {
  const unused = new Set(unusedSymbols);
  /** @type {Map<string, boolean>} */
  const unusedElements = new Map();
  const isUnusedElement = (/** @type {string} */ name) => {
    let result = unusedElements.get(name);
    if (result === undefined) {
      result = !usedElements.has(name.toLowerCase()) && !isSafelisted(name, safelist);
      unusedElements.set(name, result);
    }
    return result;
  };

  return selector => {
    for (const component of selector) {
      const name = component.name;
      if (name === undefined) {
        continue;
      }
      if (((component.type === 'class' || component.type === 'id') && unused.has(name)) ||
          (component.type === 'type' && isUnusedElement(name))) {
        return [];
      }
    }
    return undefined;
  };
}

const unusedCSSKeys = new Set(['safelist', 'scripts']);

/**
 * Normalize the `removeUnusedCSS` option into a settled configuration.
 *
 * A misspelled key or a safelist that is not an array would otherwise protect
 * nothing, and that only surfaces as a missing rule much later—so every value
 * that gets dropped is reported.
 *
 * @param {boolean | {safelist?: Array<string | RegExp>, scripts?: boolean} | undefined} option
 * @param {(message: string) => unknown} [warn] - Receives one message per ignored value
 * @returns {{safelist: Array<string | RegExp>, scripts: boolean} | null} Null when disabled
 */
function normalizeUnusedCSSOptions(option, warn) {
  if (!option) {
    return null;
  }
  const report = warn ?? (() => {});
  const config = /** @type {Record<string, any>} */ (typeof option === 'object' ? option : {});

  for (const key of Object.keys(config)) {
    if (!unusedCSSKeys.has(key)) {
      report(`Ignoring unknown \`removeUnusedCSS\` key \`${key}\`—expected \`safelist\` or \`scripts\``);
    }
  }

  /** @type {Array<string | RegExp>} */
  let safelist = [];
  if (config.safelist !== undefined) {
    if (!Array.isArray(config.safelist)) {
      report('Ignoring `removeUnusedCSS.safelist`—it takes an array of strings and regular expressions');
    } else {
      safelist = config.safelist.filter((/** @type {unknown} */ entry) => {
        if (typeof entry === 'string' || entry instanceof RegExp) {
          return true;
        }
        report(`Ignoring \`removeUnusedCSS.safelist\` entry of type ${typeof entry}—entries must be strings or regular expressions`);
        return false;
      });
    }
  }

  if (config.scripts !== undefined && typeof config.scripts !== 'boolean') {
    report('Ignoring `removeUnusedCSS.scripts`—it takes a boolean');
  }

  return {
    safelist,
    // Keeping identifiers seen in inline scripts costs a little of the reduction
    // but avoids the most common breakage, so it is the default
    scripts: typeof config.scripts === 'boolean' ? config.scripts : true
  };
}

export {
  collectUsage,
  collectUsedSymbols,
  createSelectorPruner,
  findUnusedSymbols,
  normalizeUnusedCSSOptions
};