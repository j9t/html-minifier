// Whether minified markup means the same to browsers as its source: Both are parsed with parse5
// and canonicalized by what the options are meant to change, and the results compared, as trees
// and by what whitespace renders

import { transform, transformStyleAttribute } from 'lightningcss';
import { parse } from 'parse5';
import { minify_sync as terser } from 'terser';
// Too long to restate here, so a wrong entry goes unnoticed; HTML’s defaults are restated below
import { tagDefaultsSVG } from '../../src/lib/constants.js';

const NS_HTML = 'http://www.w3.org/1999/xhtml';
const NS_SVG = 'http://www.w3.org/2000/svg';
const RE_WS_RUN = /[ \t\n\r\f]+/g;
const RE_WS_ONLY = /^[ \t\n\r\f]*$/;
const RE_WS_EDGES = /^[ \t\n\r\f]+|[ \t\n\r\f]+$/g;
const RE_WS_END = /[ \t\n\r\f]+$/;
const RE_VALUELESS_STYLE = /^(?:[a-z-]+:[;\s]*)+$/i;
const RE_JSON_TYPE = /^(?:application\/(?:[\w.-]+\+)?json|importmap|speculationrules)$/;
const RE_JS_COMMENTS = /<!--.*|-->.*|\/\/.*|\/\*[\s\S]*?\*\//g;
const RE_LITERALS_ONLY = /^(?:\s|;|"[^"]*"|'[^']*'|`[^`]*`|\d)*$/;
const RE_EMPTY_ATTRIBUTE = /^(?:class|dir|id|lang|style|title)$/;
const RE_QUOTES_ONLY = /^["']+$/;
const RE_CSS_URL = /(?:url\(\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|((?:[^\s)\\]|\\.)*))\s*\)|@import\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'))/gi;

// Marks a replaced element in rendered text
const REPLACED = '￼';
const SEPARATOR = '\u0001';
const MAX_RESYNC = 64;
const MAX_CSS_PASSES = 10;

const words = (/** @type {string} */ names) => new Set(names.split(' '));

// By the UA style sheet; https://html.spec.whatwg.org/multipage/rendering.html
const ELEMENTS_BLOCK = words('address article aside blockquote body br caption center col colgroup dd details dialog dir div dl dt fieldset figcaption figure footer form frame frameset h1 h2 h3 h4 h5 h6 header hgroup hr html legend li listing main menu nav ol optgroup option p plaintext pre search section summary table tbody td tfoot th thead tr ul xmp');
const ELEMENTS_NOT_RENDERED = words('area base basefont datalist head link meta noembed noframes noscript param rp script style template title');
const ELEMENTS_REPLACED = words('applet audio button canvas embed iframe img input marquee meter object progress select textarea video');
const ELEMENTS_INLINE = words('a abbr acronym b bdi bdo big blink cite code data del dfn em font i ins kbd label map mark nobr output picture q rb rt rtc ruby s samp slot small span strike strong sub sup time tt u var wbr');
const ELEMENTS_PREFORMATTED = words('listing plaintext pre textarea xmp');
const ELEMENTS_FOREIGN_TEXT = words('annotation-xml desc foreignObject mtext text title');
const ELEMENTS_NOT_EMPTIED = words('area base br canvas col embed frameset hr img input link meta param source textarea track wbr');
const ELEMENTS_RECREATED = words('body head html');

// https://html.spec.whatwg.org/multipage/indices.html#attributes-3
const ATTRIBUTES_BOOLEAN = words('allowfullscreen alpha async autofocus autoplay checked compact controls declare default defer disabled formnovalidate headingreset inert ismap itemscope loop multiple muted nohref nomodule noresize noshade novalidate nowrap open playsinline readonly required reversed scoped seamless selected shadowrootclonable shadowrootcustomelementregistry shadowrootdelegatesfocus shadowrootserializable sortable truespeed typemustmatch');
const ATTRIBUTES_WHITESPACE_KEPT = words('pattern placeholder title');
const ELEMENTS_VALUE_KEPT = words('button data input option param');
const ATTRIBUTES_NUMBER = /** @type {Record<string, Set<string>>} */ ({ a: words('tabindex'), area: words('tabindex'), button: words('tabindex'), col: words('span'), colgroup: words('span'), embed: words('height width'), iframe: words('height width'), img: words('height width'), input: words('height maxlength size tabindex width'), object: words('height tabindex width'), ol: words('start'), select: words('size tabindex'), td: words('colspan rowspan'), textarea: words('cols maxlength rows tabindex'), th: words('colspan rowspan'), video: words('height width') });
const ATTRIBUTES_URL = /** @type {Record<string, Set<string>>} */ ({ a: words('href'), area: words('href'), audio: words('src'), base: words('href'), blockquote: words('cite'), button: words('formaction'), del: words('cite'), embed: words('src'), form: words('action'), frame: words('longdesc src'), head: words('profile'), iframe: words('src'), img: words('longdesc src usemap'), input: words('formaction src usemap'), ins: words('cite'), link: words('href'), object: words('classid codebase data usemap'), q: words('cite'), script: words('src'), source: words('src'), track: words('src'), video: words('poster src') });
const META_HTTP_EQUIV_NO_EFFECT = words('cleartype content-script-type content-style-type imagetoolbar msthemecompatible page-enter page-exit pics-label site-enter site-exit window-target x-ua-compatible');
const META_NAME_NO_EFFECT = words('handheldfriendly ie_rm_off mobileoptimized mssmarttagspreventparsing');
const SCRIPT_TYPES_JS = new Set(['', 'application/ecmascript', 'application/javascript', 'application/x-ecmascript', 'application/x-javascript', 'text/ecmascript', 'text/javascript', 'text/jscript', 'text/x-ecmascript', 'text/x-javascript']);

// https://html.spec.whatwg.org/multipage/ (per element, with the values read as the default)
const DEFAULTS_ANY = /** @type {Record<string, string>} */ ({ autocorrect: 'on', fetchpriority: 'auto', loading: 'eager', popovertargetaction: 'toggle' });
const DEFAULTS_HTML = /** @type {Record<string, Record<string, string>>} */ ({
  area: { shape: 'rect' },
  button: { type: 'submit' },
  col: { span: '1' },
  colgroup: { span: '1' },
  form: { autocomplete: 'on', enctype: 'application/x-www-form-urlencoded', method: 'get' },
  html: { dir: 'ltr' },
  iframe: { scrolling: 'auto' },
  img: { decoding: 'auto' },
  input: { colorspace: 'limited-srgb', type: 'text' },
  link: { media: 'all' },
  marquee: { behavior: 'scroll', direction: 'left' },
  meta: { media: 'all' },
  meter: { max: '1', min: '0' },
  ol: { type: '1' },
  progress: { max: '1' },
  source: { media: 'all' },
  style: { media: 'all' },
  td: { colspan: '1', rowspan: '1' },
  textarea: { cols: '20', rows: '2', wrap: 'soft' },
  th: { colspan: '1', rowspan: '1', scope: 'auto' },
  track: { kind: 'subtitles' }
});

const isWsOnly = (/** @type {string} */ text) => RE_WS_ONLY.test(text);
const trim = (/** @type {string} */ text) => text.replace(RE_WS_EDGES, '');
const attrValue = (/** @type {any} */ node, /** @type {string} */ name) => node.attrs?.find((/** @type {any} */ attr) => attr.name === name)?.value;
const childrenOf = (/** @type {any} */ node) => (node.content ?? node).childNodes ?? [];
const isHTML = (/** @type {any} */ node) => node.namespaceURI === NS_HTML;
const isEventAttribute = (/** @type {string} */ name) => /^on[a-z]{3,}$/.test(name);
const isPreformatted = (/** @type {any} */ node) => isHTML(node) && ELEMENTS_PREFORMATTED.has(node.tagName);
const isInertScript = (/** @type {string} */ code) => RE_LITERALS_ONLY.test(code) || RE_LITERALS_ONLY.test(code.replace(RE_JS_COMMENTS, ''));

/**
 * @param {any} node
 * @param {(child: any) => void} visit
 */
function walk(node, visit) {
  for (const child of childrenOf(node)) {
    visit(child);
    walk(child, visit);
  }
}

// What Terser and Lightning CSS themselves change is theirs to test, so both sides go through
// them: What differs after that, HTML Minifier did
const cacheCode = new Map();
function normalizeCode(/** @type {string} */ kind, /** @type {string} */ code, /** @type {() => string} */ normalize) {
  const key = kind + SEPARATOR + code;
  if (!cacheCode.has(key)) {
    let result;
    try {
      result = normalize();
    } catch {
      result = '';
    }
    cacheCode.set(key, result);
  }
  return cacheCode.get(key);
}

const normalizeJS = (/** @type {string} */ code, isHandler = false) => normalizeCode('js' + isHandler, code, () =>
  terser(code, { compress: false, format: { comments: false }, mangle: false, parse: { bare_returns: isHandler } }).code ?? '');

// Lightning CSS can shorten its own output further, so one side is passes ahead of the other
function untilStable(/** @type {string} */ code, /** @type {(text: string) => string} */ normalize) {
  let result = code;
  for (let pass = 0; pass < MAX_CSS_PASSES; pass++) {
    const next = normalize(result);
    if (next === result) break;
    result = next;
  }
  return result;
}

const normalizeCSS = (/** @type {string} */ code) => normalizeCode('css', code, () =>
  untilStable(code, text => transform({ code: Buffer.from(text), errorRecovery: true, filename: 'a.css', minify: true }).code.toString()));
const normalizeStyleAttribute = (/** @type {string} */ code) => normalizeCode('style', code, () =>
  untilStable(code, text => transformStyleAttribute({ code: Buffer.from(text), errorRecovery: true, filename: 'a', minify: true }).code.toString()));

// An invalid query normalizes to nothing, which leaves it to be compared as written
function canonicalizeMedia(/** @type {string} */ value) {
  const query = trim(value);
  return (query && normalizeCSS(`@media ${query}{a{top:0}}`)) || query;
}

// Compress and mangle change code past comparing it, so what can then be said is that it parses
const isJSComparable = (/** @type {any} */ options) => typeof options.minifyJS === 'object' && options.minifyJS.compress === false && options.minifyJS.mangle === false;

function canonicalizeUrl(/** @type {string} */ value, /** @type {any} */ options) {
  if (!options.minifyURLs) return trim(value);
  const site = typeof options.minifyURLs === 'string' ? options.minifyURLs : options.minifyURLs.site;
  try {
    return new URL(trim(value), site || 'https://example.org/dir/page.html').href
      .replace(/[?#]+(?=#|$)/, '')
      .replace(/\/index\.html?(?=[?#]|$)/, '/');
  } catch {
    return trim(value);
  }
}

// Ahead of Lightning CSS, which may then merge rules with what are the same URLs
const canonicalizeCSSUrls = (/** @type {string} */ css, /** @type {any} */ options) => options.minifyURLs
  ? css.replace(RE_CSS_URL, (match, double, single, unquoted, importDouble, importSingle) => {
    const url = double ?? single ?? unquoted ?? importDouble ?? importSingle ?? '';
    if (/^data:/i.test(url)) return match;
    const canonical = JSON.stringify(canonicalizeUrl(url.replace(/\\(.)/g, '$1'), options));
    return match[0] === '@' ? `@import ${canonical}` : `url(${canonical})`;
  })
  : css;

// Splits by the algorithm in the spec, closely enough to compare URLs and descriptors
// https://html.spec.whatwg.org/multipage/images.html#parsing-a-srcset-attribute
function canonicalizeSrcset(/** @type {string} */ value, /** @type {any} */ options) {
  const candidates = [];
  let rest = trim(value);
  while (rest) {
    rest = rest.replace(/^[ \t\n\r\f,]+/, '');
    if (!rest) break;
    const url = /^[^ \t\n\r\f]+/.exec(rest)?.[0] ?? '';
    rest = rest.slice(url.length);
    if (url.endsWith(',')) {
      candidates.push(canonicalizeUrl(url.replace(/,+$/, ''), options));
      continue;
    }
    let index = 0;
    let inParens = false;
    for (; index < rest.length; index++) {
      const character = rest[index];
      if (!inParens && character === ',') break;
      if (character === '(') inParens = true;
      else if (character === ')') inParens = false;
    }
    let descriptor = trim(rest.slice(0, index));
    rest = rest.slice(index);
    const number = /^([0-9.]+)([wx])$/.exec(descriptor);
    if (number) descriptor = +(number[1] ?? 0) + (number[2] ?? '');
    if (descriptor === '1x') descriptor = '';
    candidates.push(canonicalizeUrl(url, options) + (descriptor ? ' ' + descriptor : ''));
  }
  return candidates.join(', ');
}

function isRedundant(/** @type {any} */ node, /** @type {string} */ name, /** @type {string} */ value, /** @type {any} */ options, /** @type {any} */ context) {
  const tag = node.tagName;
  const valueLower = trim(value.toLowerCase());
  if (name === 'xmlns' || name === 'xmlns:xlink') return true;
  const isTarget = name === 'target' && valueLower === '_self' && !context.hasBase && (tag === 'a' || (isHTML(node) && (tag === 'area' || tag === 'form')));
  if (isTarget) return true;
  if (node.namespaceURI === NS_SVG) {
    const expected = /** @type {Record<string, Record<string, string | string[]>>} */ (tagDefaultsSVG)[tag.toLowerCase()]?.[name.toLowerCase()];
    return Array.isArray(expected) ? expected.includes(valueLower) : expected === valueLower;
  }
  if (!isHTML(node)) return false;
  if (name === 'xml:lang') return true;
  if (DEFAULTS_ANY[name] === valueLower || DEFAULTS_HTML[tag]?.[name] === valueLower) return true;
  if (tag === 'ol' && name === 'start') return valueLower === '1' && attrValue(node, 'reversed') === undefined;
  if (tag === 'script' && name === 'language') return valueLower === 'javascript';
  if (tag === 'script' && name === 'charset') return attrValue(node, 'src') === undefined;
  if (tag === 'a' && name === 'name') {
    const asWritten = (/** @type {string} */ text) => options.collapseAttributeWhitespace ? trim(text).replace(RE_WS_RUN, ' ') : text;
    return asWritten(attrValue(node, 'id') ?? '\0') === asWritten(value);
  }
  return false;
}

// Whether `removeEmptyAttributes` removes the attribute where it is empty
const removesEmpty = (/** @type {string} */ tag, /** @type {string} */ name, /** @type {any} */ options) => typeof options.removeEmptyAttributes === 'function'
  ? Boolean(options.removeEmptyAttributes(name, tag))
  : Boolean(options.removeEmptyAttributes) && (RE_EMPTY_ATTRIBUTE.test(name) || isEventAttribute(name) || (tag === 'input' && name === 'value'));

function isRemovedAttribute(/** @type {any} */ node, /** @type {string} */ name, /** @type {string} */ value, /** @type {any} */ options, /** @type {any} */ context) {
  const tag = node.tagName;
  // What a stray closing quote leaves, which the parser drops and which does nothing
  if (!value && RE_QUOTES_ONLY.test(name)) return true;
  if (context.selected.has(name)) return false;
  if ((isWsOnly(value) || (name === 'style' && RE_VALUELESS_STYLE.test(trim(value)))) && removesEmpty(tag, name, options)) return true;
  if (options.removeRedundantAttributes && isRedundant(node, name, value, options, context)) return true;
  if (options.removeDefaultTypeAttributes && (isHTML(node) || tag === 'style') && name === 'type') {
    const type = trim(value.split(';', 1)[0] ?? '').toLowerCase();
    return tag === 'script' ? SCRIPT_TYPES_JS.has(type) : (tag === 'style' || tag === 'link') && (type === '' || type === 'text/css');
  }
  return false;
}

function canonicalizeRel(/** @type {string} */ tag, /** @type {string} */ value) {
  const keywords = [...new Set(trim(value).toLowerCase().split(RE_WS_RUN).filter(Boolean))];
  let implied = '';
  if (tag === 'link' && keywords.includes('icon')) implied = 'shortcut';
  else if (['a', 'area', 'form'].includes(tag) && keywords.includes('noreferrer')) implied = 'noopener';
  return keywords.filter(keyword => keyword !== implied).join(' ');
}

function canonicalizeValue(/** @type {any} */ node, /** @type {string} */ name, /** @type {string} */ raw, /** @type {any} */ options) {
  const tag = node.tagName;
  const html = isHTML(node);
  let value = raw;
  if (options.collapseAttributeWhitespace && !ATTRIBUTES_WHITESPACE_KEPT.has(name) && !(name === 'value' && ELEMENTS_VALUE_KEPT.has(tag)) && !isEventAttribute(name)) {
    value = trim(value).replace(RE_WS_RUN, ' ');
  }
  if (options.collapseBooleanAttributes && html && !tag.includes('-')) {
    const isBoolean = ATTRIBUTES_BOOLEAN.has(name) && !(name === 'loop' && tag === 'marquee');
    const isCollapsible = (name === 'crossorigin' && ['', 'anonymous'].includes(value.toLowerCase())) ||
      (name === 'hidden' && value.toLowerCase() !== 'until-found' && !value.includes('&')) ||
      (name === 'draggable' && !['true', 'false'].includes(value.toLowerCase()) && !value.includes('&'));
    if (isBoolean || isCollapsible) value = '';
  }
  if (name === 'class') return [...new Set(trim(value).split(RE_WS_RUN).filter(Boolean))].sort().join(' ');
  if (name === 'style') {
    const style = trim(value);
    if (!style || RE_VALUELESS_STYLE.test(style)) return '';
    return options.minifyCSS ? normalizeStyleAttribute(canonicalizeCSSUrls(style, options)) : style.replace(/\s*;$/, ';');
  }
  if (isEventAttribute(name)) {
    const code = trim(value).replace(/^javascript:\s*/i, '');
    if (!options.minifyJS) return code;
    return isJSComparable(options) ? normalizeJS(code, true) : '«JavaScript»';
  }
  if (!html) return value;
  if (ATTRIBUTES_URL[tag]?.has(name) && !(tag === 'link' && /canonical/i.test(attrValue(node, 'rel') ?? ''))) return canonicalizeUrl(value, options);
  if (ATTRIBUTES_NUMBER[tag]?.has(name) || name === 'tabindex') return trim(value);
  if ((name === 'srcset' && (tag === 'img' || tag === 'source')) || (name === 'imagesrcset' && tag === 'link')) return canonicalizeSrcset(value, options);
  if (tag === 'meta' && name === 'content' && /viewport/i.test(attrValue(node, 'name') ?? '')) return value.replace(/\s+/g, '').replace(/[0-9]+\.[0-9]+/g, number => String(+number));
  if (tag === 'meta' && name === 'content' && /content-security-policy/i.test(attrValue(node, 'http-equiv') ?? '')) return value.replace(RE_WS_RUN, ' ');
  if (tag === 'script' && name === 'type') return trim(value.replace(/\s*;\s*/g, ';'));
  if (name === 'rel' && options.removeRedundantAttributes) return canonicalizeRel(tag, value);
  if (name === 'media' && ['link', 'meta', 'source', 'style'].includes(tag)) return options.minifyCSS ? canonicalizeMedia(value) : trim(value);
  if (tag === 'iframe' && name === 'srcdoc') return canonicalize(value, options, true).lines.join(SEPARATOR);
  return value;
}

function canonicalizeAttributes(/** @type {any} */ node, /** @type {any} */ options, /** @type {any} */ context) {
  const attributes = [];
  for (const attribute of node.attrs) {
    const name = (attribute.prefix ? attribute.prefix + ':' : '') + attribute.name;
    if (!isRemovedAttribute(node, name, attribute.value, options, context)) {
      attributes.push([name, canonicalizeValue(node, name, attribute.value, options)]);
    }
  }
  return attributes.sort(([nameA = ''], [nameB = '']) => nameA < nameB ? -1 : nameA > nameB ? 1 : 0);
}

function canonicalizeRaw(/** @type {any} */ node, /** @type {string} */ text, /** @type {any} */ options) {
  if (isWsOnly(text)) return '';
  const type = trim(attrValue(node, 'type') ?? '').toLowerCase();
  if (node.tagName === 'style') {
    if (!options.minifyCSS) return trim(text);
    return options.removeUnusedCSS ? '«CSS»' : normalizeCSS(canonicalizeCSSUrls(text, options));
  }
  if (RE_JSON_TYPE.test(type) && options.minifyJSON) {
    try {
      return JSON.stringify(JSON.parse(text));
    } catch {
      return trim(text);
    }
  }
  if (options.processScripts?.includes(type)) return '«Processed»';
  if (options.minifyJS && (SCRIPT_TYPES_JS.has(type) || type === 'module')) {
    if (isJSComparable(options) && type !== 'module') return normalizeJS(text);
    return isInertScript(text) ? '' : '«JavaScript»';
  }
  if (!options.mergeScripts) return trim(text);
  // Separators matter where code parses; what doesn’t is compared loosely
  return (SCRIPT_TYPES_JS.has(type) && normalizeJS(text)) || text.replace(/[;\s]+/g, '');
}

// Only classic scripts merge, and only with the same loading behavior
function isSameScriptKind(/** @type {any} */ scriptA, /** @type {any} */ scriptB) {
  const typeOf = (/** @type {any} */ script) => {
    const type = trim(attrValue(script, 'type') ?? '').toLowerCase();
    return SCRIPT_TYPES_JS.has(type) ? '' : type;
  };
  return typeOf(scriptA) === '' && typeOf(scriptB) === '' && ['async', 'defer', 'nomodule', 'nonce'].every(name => attrValue(scriptA, name) === attrValue(scriptB, name));
}

function mergeAdjacentScripts(/** @type {any[]} */ children) {
  /** @type {any[]} */
  const merged = [];
  for (const child of children) {
    const last = merged[merged.length - 1];
    if (child.nodeName === '#text' && isWsOnly(child.value) && last?.tagName === 'script') continue;
    if (child.tagName === 'script' && last?.tagName === 'script' && attrValue(child, 'src') === undefined && attrValue(last, 'src') === undefined && isSameScriptKind(child, last)) {
      const text = child.childNodes[0]?.value ?? '';
      if (last.childNodes[0]) last.childNodes[0].value += ';\n' + text;
      else if (text) last.childNodes = child.childNodes;
      continue;
    }
    merged.push(child);
  }
  return merged;
}

function stripComments(/** @type {any} */ node) {
  if (node.childNodes) {
    node.childNodes = node.childNodes.filter((/** @type {any} */ child) => child.nodeName !== '#comment');
    node.childNodes.forEach(stripComments);
  }
  if (node.content) stripComments(node.content);
}

function mergeText(/** @type {any} */ node) {
  if (node.childNodes) {
    /** @type {any[]} */
    const merged = [];
    for (const child of node.childNodes) {
      const last = merged[merged.length - 1];
      if (child.nodeName === '#text' && last?.nodeName === '#text') last.value += child.value;
      else merged.push(child);
    }
    node.childNodes = merged;
    merged.forEach(mergeText);
  }
  if (node.content) mergeText(node.content);
}

function isEmptyRemovable(/** @type {any} */ node, /** @type {any} */ options, /** @type {any} */ context) {
  if (!isHTML(node) && node.tagName !== 'svg' && node.tagName !== 'math') return false;
  const tag = node.tagName;
  const id = attrValue(node, 'id');
  if (ELEMENTS_NOT_EMPTIED.has(tag) || tag.includes('-') || (id !== undefined && (id.trim() || !removesEmpty(tag, 'id', options) || context.selected.has('id')))) return false;
  if (ELEMENTS_RECREATED.has(tag) && node.attrs.length) return false;
  if ((options.removeEmptyElementsExcept ?? []).some((/** @type {string} */ spec) => spec.replace(/[<>]/g, '').split(/\s/)[0] === tag)) return false;
  for (const { name, value } of node.attrs) {
    if ((name === 'role' || name === 'tabindex' || name.startsWith('aria-') || (name === 'for' && ['label', 'output', 'template'].includes(tag))) && value.trim()) return false;
  }
  if (['audio', 'script', 'video'].includes(tag) && attrValue(node, 'src') !== undefined) return false;
  if (tag === 'iframe' && (attrValue(node, 'src') !== undefined || attrValue(node, 'srcdoc') !== undefined)) return false;
  if (tag === 'object' && attrValue(node, 'data') !== undefined) return false;
  return !(tag === 'applet' && attrValue(node, 'code') !== undefined);
}

function pruneEmptyElements(/** @type {any} */ node, /** @type {any} */ options, /** @type {any} */ context) {
  if (node.childNodes) {
    for (const child of node.childNodes) pruneEmptyElements(child, options, context);
    node.childNodes = node.childNodes.filter((/** @type {any} */ child) => {
      if (!child.tagName || !isEmptyRemovable(child, options, context)) return true;
      // Styles can minify to nothing and then go
      if (child.tagName === 'style' && options.minifyCSS) return false;
      if (child.tagName === 'script' && options.minifyJS && isInertScript(child.childNodes[0]?.value ?? '')) return false;
      const content = childrenOf(child).filter((/** @type {any} */ grandchild) => grandchild.nodeName !== '#comment');
      return content.some((/** @type {any} */ grandchild) => grandchild.nodeName !== '#text' || !isWsOnly(grandchild.value));
    });
  }
  if (node.content) pruneEmptyElements(node.content, options, context);
}

// Removing `meta` elements without effect and replacing the content-type pragma
function canonicalizeMeta(/** @type {any} */ node) {
  if (node.childNodes) {
    node.childNodes = node.childNodes.filter((/** @type {any} */ child) => {
      if (child.tagName !== 'meta' || !isHTML(child)) return true;
      const names = child.attrs.map((/** @type {any} */ attr) => attr.name);
      const httpEquiv = attrValue(child, 'http-equiv');
      const name = attrValue(child, 'name');
      if ((httpEquiv !== undefined || name !== undefined) && names.every((/** @type {string} */ attr) => ['content', 'http-equiv', 'name'].includes(attr)) &&
          (httpEquiv === undefined || META_HTTP_EQUIV_NO_EFFECT.has(httpEquiv.toLowerCase())) && (name === undefined || META_NAME_NO_EFFECT.has(name.toLowerCase()))) {
        return false;
      }
      if (names.length === 2 && httpEquiv?.toLowerCase() === 'content-type') {
        const match = /charset[\t\n\f\r ]*=[\t\n\f\r ]*["']?([^"'\t\n\f\r ;]+)/i.exec(attrValue(child, 'content') ?? '');
        if (match) child.attrs = [{ name: 'charset', value: match[1] }];
      }
      return true;
    });
    node.childNodes.forEach(canonicalizeMeta);
  }
  if (node.content) canonicalizeMeta(node.content);
}

// Whitespace at the end of the input does nothing, outside of preformatted content
function trimDocumentEnd(/** @type {any} */ body) {
  let node = body;
  while (node?.childNodes?.length) {
    const last = node.childNodes.findLast((/** @type {any} */ child) => child.nodeName !== '#comment');
    if (!last) return;
    if (last.nodeName === '#text') {
      if (node.tagName && ELEMENTS_PREFORMATTED.has(node.tagName) && node.tagName !== 'plaintext') return;
      last.value = last.value.replace(RE_WS_END, '');
      if (last.value) return;
      node.childNodes.splice(node.childNodes.indexOf(last), 1);
      continue;
    }
    if (!last.tagName || (ELEMENTS_PREFORMATTED.has(last.tagName) && last.tagName !== 'plaintext') || last.tagName === 'template') return;
    node = last;
  }
}

function withShortDoctype(/** @type {string} */ html) {
  const doctype = parse(html, { sourceCodeLocationInfo: true }).childNodes.find(child => child.nodeName === '#documentType');
  const location = doctype?.sourceCodeLocation;
  return location ? html.slice(0, location.startOffset) + '<!doctype html>' + html.slice(location.endOffset) : html;
}

// The attribute names the document’s style sheets select on, which removal has to spare
function findSelected(/** @type {any} */ document) {
  /** @type {Set<string>} */
  const selected = new Set();
  walk(document, node => {
    if (node.tagName === 'style') {
      for (const match of childrenOf(node).map((/** @type {any} */ child) => child.value ?? '').join('').toLowerCase().matchAll(/\[\s*(?:[\w-]*\|)?([\w:-]+)\s*[\]=~|^$*]/g)) {
        selected.add(match[1] ?? '');
      }
    }
  });
  return selected;
}

/**
 * @param {string} source
 * @param {any} options
 * @param {boolean} scripting
 * @returns {{lines: string[], document: any}}
 */
function canonicalize(source, options, scripting) {
  const document = parse(options.useShortDoctype ? withShortDoctype(source) : source, { scriptingEnabled: scripting });
  const collapse = Boolean(options.collapseWhitespace);
  const comments = /** @type {string[]} */ ([]);
  const lines = ['mode:' + document.mode];
  let hasBase = false;
  walk(document, node => { hasBase ||= node.tagName === 'base'; });
  const context = { hasBase, selected: findSelected(document) };
  if (options.removeComments) stripComments(document);
  // Where a comment ends up around the document’s elements does nothing, and it goes with an
  // empty element it sits in; SVGO, which may remove them, reads an SVG whole and by default
  // keeps those starting with `!`, trimmed
  const keepsAllSVGComments = !options.minifySVG;
  const keepsMarkedSVGComments = options.minifySVG === true || (typeof options.minifySVG === 'object' && options.minifySVG !== null && !options.minifySVG.plugins);
  const collectComments = (/** @type {any} */ node, /** @type {boolean} */ insideSVG) => {
    for (const child of childrenOf(node)) {
      if (child.nodeName === '#comment') {
        if (!insideSVG || keepsAllSVGComments) comments.push(child.data);
        else if (keepsMarkedSVGComments && trim(child.data).startsWith('!')) comments.push(trim(child.data));
      } else {
        collectComments(child, insideSVG || child.tagName === 'svg');
      }
    }
  };
  if (!options.removeEmptyElements) collectComments(document, false);
  if (options.removeEmptyElements) pruneEmptyElements(document, options, context);
  mergeText(document);
  if (options.removeRedundantAttributes) canonicalizeMeta(document);
  const body = document.childNodes.find(child => child.nodeName === 'html')?.childNodes.find((/** @type {any} */ child) => child.tagName === 'body');
  if (body) trimDocumentEnd(body);

  function visit(/** @type {any} */ node, /** @type {string} */ path, /** @type {boolean} */ preformatted) {
    const parent = node.tagName;
    const children = options.mergeScripts ? mergeAdjacentScripts(childrenOf(node)) : childrenOf(node);
    for (const child of children) {
      if (child.nodeName === '#documentType') {
        lines.push(options.useShortDoctype ? 'doctype:' + child.name.toLowerCase() : `doctype:${child.name}|${child.publicId ?? ''}|${child.systemId ?? ''}`);
      } else if (child.nodeName === '#text') {
        visitText(child, node, parent, path, preformatted);
      } else if (child.tagName) {
        const isOpaque = child.tagName === 'svg' && Boolean(options.minifySVG);
        const pathChild = `${path}/${child.tagName}`;
        const namespace = isHTML(child) ? '' : (child.namespaceURI.split('/').pop() ?? '');
        lines.push(`${pathChild}@${namespace}${isOpaque ? '«SVG»' : JSON.stringify(canonicalizeAttributes(child, options, context))}`);
        if (!isOpaque) {
          visit(child, pathChild, preformatted || isPreformatted(child));
          lines.push(`${pathChild}/end`);
        }
      }
    }
  }

  function visitText(/** @type {any} */ text, /** @type {any} */ node, /** @type {string} */ parent, /** @type {string} */ path, /** @type {boolean} */ preformatted) {
    const { value } = text;
    // With scripting, this is text that nothing reads
    if (parent === 'noscript' && scripting) return;
    // Markup to the user agents that read it, and minified as such
    if (parent === 'noembed' || parent === 'noframes') return;
    // Browsers render no fallback content here
    if (parent === 'iframe') return;
    if (parent === 'select' && isWsOnly(value)) return;
    if (parent === 'option') {
      // Browsers strip and collapse this for the label
      const label = trim(value).replace(RE_WS_RUN, ' ');
      if (label) lines.push(`${path}#text:${label}`);
    } else if (parent === 'script' || parent === 'style') {
      const raw = canonicalizeRaw(node, value, options);
      if (raw) lines.push(`${path}#raw:${raw}`);
    } else if (parent === 'html' || parent === 'head') {
      if (!isWsOnly(value)) lines.push(`${path}#text:${value.replace(RE_WS_RUN, '')}`);
    } else if (preformatted) {
      // A last line break in `pre` renders nothing
      lines.push(`${path}#text:${parent === 'pre' ? value.replace(/[\r\n][ \t]*$/, '') : value}`);
    } else if (collapse || options.removeEmptyElements || options.removeOptionalTags) {
      const content = value.replace(RE_WS_RUN, '');
      if (content) lines.push(`${path}#text:${content}`);
    } else {
      // Lines that a removed tag or comment leaves with nothing but whitespace go
      lines.push(`${path}#text:${value.replace(/[ \t\f\r]*\n[ \t\n\f\r]*/g, '\n')}`);
    }
  }

  visit(document, '', false);
  lines.push('comments:' + JSON.stringify(comments.sort()));
  return { document, lines };
}

function serializePreformatted(/** @type {any} */ node) {
  let result = '';
  for (const child of childrenOf(node)) {
    if (child.nodeName === '#text') result += child.value;
    else if (child.tagName) result += `<${child.tagName}>${serializePreformatted(child)}</${child.tagName}>`;
  }
  return result;
}

const isCustomBlock = (/** @type {string} */ tag, /** @type {any} */ options) =>
  !ELEMENTS_INLINE.has(tag) && !ELEMENTS_REPLACED.has(tag) && !ELEMENTS_BLOCK.has(tag) && !ELEMENTS_NOT_RENDERED.has(tag) && !(options.inlineCustomElements ?? []).includes(tag);

/**
 * What each block holds, with whitespace as CSS collapses it
 * @param {any} root
 * @param {any} options
 * @returns {string[]}
 */
function renderedText(root, options) {
  const blocks = /** @type {string[]} */ ([]);

  function foreign(/** @type {any} */ node, /** @type {string} */ path) {
    for (const child of node.childNodes ?? []) {
      if (child.tagName) {
        (ELEMENTS_FOREIGN_TEXT.has(child.tagName) ? block : foreign)(child, `${path}/${child.tagName}`);
      }
    }
  }

  function block(/** @type {any} */ element, /** @type {string} */ path) {
    let parts = /** @type {string[]} */ ([]);

    const flush = () => {
      let text = parts.join('');
      parts = [];
      if (options.collapseInlineTagWhitespace) text = text.replace(new RegExp(`[ \\t\\n\\r\\f]*${REPLACED}[ \\t\\n\\r\\f]*`, 'g'), REPLACED);
      text = trim(text.replace(RE_WS_RUN, ' '));
      if (options.collapseNoBreakSpaces) text = text.replace(/ ?([\xA0\u202F\u2007]) ?/g, '$1');
      if (text) blocks.push(path + SEPARATOR + text);
    };

    const inline = (/** @type {any} */ node) => {
      for (const child of childrenOf(node)) {
        if (child.nodeName === '#text') {
          if (node.tagName !== 'select') parts.push(child.value);
        } else if (child.tagName) {
          inlineElement(child);
        }
      }
    };

    const inlineElement = (/** @type {any} */ child) => {
      const tag = child.tagName;
      const pathChild = `${path}/${tag}`;
      if (!isHTML(child)) {
        if (tag === 'svg' || tag === 'math') parts.push(REPLACED);
        // Text within SVG text runs on in these
        if (tag === 'a' || tag === 'tspan' || tag === 'textPath') inline(child);
        else foreign(child, pathChild);
      } else if (tag === 'template') {
        block(child.content, pathChild);
      } else if (ELEMENTS_NOT_RENDERED.has(tag) || (tag === 'input' && trim(attrValue(child, 'type') ?? '').toLowerCase() === 'hidden')) {
        // Takes no part in the line
      } else if (isPreformatted(child)) {
        if (tag === 'textarea') parts.push(REPLACED);
        else flush();
        const content = serializePreformatted(child);
        blocks.push(`${pathChild}${SEPARATOR}preformatted:${tag === 'pre' ? content.replace(/[\r\n][ \t]*$/, '') : content}`);
      } else if (tag === 'br') {
        flush();
        blocks.push(path + SEPARATOR + '<br>');
      } else if (ELEMENTS_BLOCK.has(tag) || isCustomBlock(tag, options)) {
        flush();
        block(child, pathChild);
      } else if (ELEMENTS_REPLACED.has(tag)) {
        parts.push(REPLACED);
        block(child, pathChild);
      } else {
        inline(child);
      }
    };

    inline(element);
    flush();
  }

  block(root, '');
  return blocks;
}

// Whether the output’s scripts still parse wherever the input’s did
function checkScriptSyntax(/** @type {any} */ documentIn, /** @type {any} */ documentOut) {
  const collect = (/** @type {any} */ document) => {
    const codes = /** @type {string[]} */ ([]);
    walk(document, node => {
      if (node.tagName === 'script' && isHTML(node) && SCRIPT_TYPES_JS.has(trim(attrValue(node, 'type') ?? '').toLowerCase()) && node.childNodes[0]?.value) {
        codes.push(node.childNodes[0].value);
      }
    });
    return codes;
  };
  const parses = (/** @type {string} */ code) => normalizeJS(code) !== '' || isInertScript(code);
  if (!collect(documentIn).every(parses)) return [];
  return collect(documentOut).filter(code => !parses(code)).map(code => ({ input: 'parses', kind: 'syntax', output: code.slice(0, 200) }));
}

/**
 * The differing lines, each difference ending where both sides agree again
 * @param {string} kind
 * @param {string[]} linesIn
 * @param {string[]} linesOut
 */
function diffLines(kind, linesIn, linesOut) {
  const differences = [];
  let indexIn = 0;
  let indexOut = 0;
  while (indexIn < linesIn.length || indexOut < linesOut.length) {
    if (linesIn[indexIn] === linesOut[indexOut]) {
      indexIn++;
      indexOut++;
      continue;
    }
    differences.push({ input: linesIn[indexIn] ?? '', kind, output: linesOut[indexOut] ?? '' });
    let resynced = false;
    for (let distance = 1; distance <= MAX_RESYNC && !resynced; distance++) {
      for (let skipIn = 0; skipIn <= distance; skipIn++) {
        const lineIn = linesIn[indexIn + skipIn];
        if (lineIn !== undefined && lineIn === linesOut[indexOut + distance - skipIn]) {
          indexIn += skipIn;
          indexOut += distance - skipIn;
          resynced = true;
          break;
        }
      }
    }
    if (!resynced) break;
  }
  return differences;
}

/**
 * @param {string} input
 * @param {string} output
 * @param {any} options
 * @returns {Array<{kind: string, input: string, output: string}>} What differs, if anything
 */
export function compareMarkup(input, output, options) {
  for (const scripting of [true, false]) {
    const canonicalIn = canonicalize(input, options, scripting);
    const canonicalOut = canonicalize(output, options, scripting);
    const differences = diffLines('tree', canonicalIn.lines, canonicalOut.lines);
    // An SVG SVGO reads is opaque to the tree, so its HTML is compared as rendered
    if (options.collapseWhitespace || options.removeOptionalTags || options.removeEmptyElements || options.minifySVG) {
      differences.push(...diffLines('render', renderedText(canonicalIn.document, options), renderedText(canonicalOut.document, options)));
    }
    if (options.minifyJS) {
      differences.push(...checkScriptSyntax(canonicalIn.document, canonicalOut.document));
    }
    if (differences.length) {
      return differences;
    }
  }
  return [];
}