// Seeded generator of markup and option sets, aimed at where minifiers go wrong: whitespace around
// inline elements, omitted tags, tables, foreign content, raw text, and odd attribute values

const WHITESPACE = ['', '', ' ', '  ', '\n', '\n  ', '\t', ' \n '];
const TEXT = ['a', 'b c', ' x ', 'word', '&amp;', '&lt;b&gt;', '&nbsp;', ' &nbsp; ', '&#32;', '&#10;', '&ampx', '&notin', '中文', 'é', '1 &lt; 2', '\xA0', ']]>', '--', '&', 'x=1'];
const COMMENTS = ['<!-- c -->', '<!---->', '<!--[if IE]>x<![endif]-->', '<!--! keep -->', '<!-- # k -->', '<!-- a -- b -->', '<!-- a --!>'];
const ELEMENTS_INLINE = 'a abbr b bdi bdo button cite code data dfn em i input img kbd label mark q s samp select small span strong sub sup textarea time u var wbr br'.split(' ');
const ELEMENTS_BLOCK = 'address article aside blockquote center details dialog div dl fieldset figure footer form h1 h2 header hr main menu nav ol p pre section table ul'.split(' ');
const ELEMENTS_ODD = 'x-foo my-el foo template noscript slot ruby rt rp rb object video audio canvas iframe map area picture source xmp listing plaintext noembed noframes marquee nobr font'.split(' ');
const ATTRIBUTES = /** @type {Array<[string, string[]]>} */ ([
  ['class', [' a  b a ', '', ' ', 'z a']],
  ['id', ['x', '', ' a ']],
  ['title', ['', ' t  u ', 'a"b', "a'b", 'a&amp;b', '&quot;']],
  ['lang', ['', 'en']],
  ['dir', ['', 'ltr', 'auto']],
  ['style', ['', ' color:red; ', 'color:', 'color:red;;', 'background:url("a b.png")']],
  ['hidden', ['', 'hidden', 'until-found', 'false']],
  ['draggable', ['true', 'false', '', 'x']],
  ['contenteditable', ['', 'true', 'false']],
  ['spellcheck', ['false', '']],
  ['checked', ['', 'checked', 'false']],
  ['disabled', ['', 'disabled']],
  ['selected', ['', 'x']],
  ['type', ['text', 'submit', 'button', 'checkbox', 'text/javascript', 'module', 'text/css', 'TEXT', '']],
  ['value', ['', ' ', ' v ', 'a  b']],
  ['name', ['x', 'y', ' ']],
  ['href', [' a b ', '#', 'javascript:void(0)', 'x?a=1&amp;b=2', '', 'x?a=1&b=2', 'x?copy=1']],
  ['src', ['a.png', ' a.png ', '']],
  ['srcset', ['a.png 1x, b.png 2x', 'a,b.png 1.0x', ' a.png ,b.png']],
  ['target', ['_self', '_blank', '_SELF']],
  ['rel', ['noopener noreferrer', 'noopener', 'a a', 'shortcut icon']],
  ['onclick', ['', ' a() ', 'javascript:a()', 'a("&quot;")', 'a("&amp;copy;")']],
  ['colspan', ['1', '2', ' 1 ']],
  ['rowspan', ['1']],
  ['start', ['1', '2']],
  ['reversed', ['']],
  ['media', ['all', 'print', ' all ']],
  ['tabindex', [' 0 ', '0']],
  ['data-x', ['', ' 1 ', 'a=b', '`', '<>', "a'b\"c"]],
  ['aria-hidden', ['true', '']],
  ['role', ['', 'x']],
  ['alt', ['', ' ']],
  ['for', ['x', '']],
  ['method', ['get', 'GET', 'post']],
  ['loading', ['eager', 'lazy']],
  ['download', ['', 'x']],
  ['autocomplete', ['on', 'off']],
  ['open', ['', 'open']],
  ['xmlns', ['http://www.w3.org/1999/xhtml', 'x']],
  ['xml:lang', ['en']],
  ['Foo', ['x']],
  ['foo', ['y']]
]);
const SCRIPTS = ['<script>a()</script>', '<script></script>', '<script type="text/javascript">b</script>', '<script type=module>c</script>', '<script type="application/ld+json">{ "a" : 1 }</script>', '<script type="text/template"> <b> x </b> </script>', '<script language=javascript charset=utf-8>d</script>', '<script src=a.js></script>', '<script>"<!--"</script>', '<script><!--\na()\n//--></script>', '<script><!--\na("<script></script>");\n//--></script>'];
const STYLES = ['<style>a{color:red}</style>', '<style> </style>', '<style media=all type=text/css>[hidden]{x:y}</style>', '<style>input[type=text]{color:red}</style>'];
const DOCTYPES = ['<!doctype html>', '<!DOCTYPE html>', '<!doctype html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">', '<!doctype html PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN">', '<!doctype html PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN" "http://www.w3.org/TR/html4/loose.dtd">', '', '<!doctype foo>'];
const HEAD_CONTENT = ['<title> a  b </title>', '<meta charset=utf-8>', '<meta http-equiv=content-type content="text/html; charset=utf-8">', '<meta name=viewport content="width=device-width, initial-scale=1.0">', '<link rel=stylesheet href=a.css type=text/css>', '<base href=/x/>', '<base target=_blank>', '<noscript><link rel=x href=y></noscript>', '<template><td>x</td></template>'];

/**
 * @param {number} seed
 * @returns {() => number} A generator of numbers from 0 up to 1 (Mulberry32)
 */
export function createRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @param {number} seed
 * @returns {string}
 */
export function generateMarkup(seed) {
  const random = createRandom(seed);
  const pick = (/** @type {string[]} */ items) => items[Math.floor(random() * items.length)] ?? '';
  const whitespace = () => pick(WHITESPACE);
  const comment = () => pick(COMMENTS);

  function attribute() {
    const [name, values] = ATTRIBUTES[Math.floor(random() * ATTRIBUTES.length)] ?? ['', []];
    if (random() < 0.1) return ' ' + name;
    const value = pick(values);
    const quote = pick(['"', '"', "'", '']);
    if (!quote && (/[\s"'`=<>]/.test(value) || value === '')) return ` ${name}="${value.replace(/"/g, '&quot;')}"`;
    if (quote && value.includes(quote)) return ` ${name}=${quote === '"' ? "'" : '"'}${value}${quote === '"' ? "'" : '"'}`;
    return ` ${name}=${quote}${value}${quote}`;
  }

  function attributes() {
    let result = '';
    let count = random() < 0.55 ? 0 : 1 + Math.floor(random() * 3);
    while (count--) result += attribute();
    return result;
  }

  function children(/** @type {number} */ depth) {
    let result = whitespace();
    let count = Math.floor(random() * 4);
    while (count--) result += node(depth) + whitespace();
    return result;
  }

  function table(/** @type {number} */ depth) {
    const open = (/** @type {string} */ tag) => random() < 0.5 ? `<${tag}${attributes()}>` : '';
    const close = (/** @type {string} */ tag) => random() < 0.5 ? `</${tag}>` : '';
    let result = `<table${attributes()}>` + whitespace();
    if (random() < 0.3) result += `<caption>${children(depth - 1)}</caption>` + whitespace();
    if (random() < 0.3) result += `<colgroup>${whitespace()}<col span=1>${whitespace()}</colgroup>` + whitespace();
    if (random() < 0.25) result += comment();
    result += open('thead') || open('tbody');
    let rows = 1 + Math.floor(random() * 2);
    while (rows--) {
      result += open('tr') + whitespace();
      let cells = 1 + Math.floor(random() * 2);
      while (cells--) result += `<${pick(['td', 'th'])}${attributes()}>${random() < 0.8 ? children(depth - 1) : ''}${close('td')}` + whitespace();
      result += close('tr') + whitespace();
    }
    return result + (random() < 0.1 ? pick(TEXT) : '') + '</table>';
  }

  function list(/** @type {number} */ depth) {
    const tag = pick(['ul', 'ol', 'dl']);
    let result = `<${tag}${attributes()}>` + whitespace();
    let items = 1 + Math.floor(random() * 3);
    while (items--) {
      result += `<${tag === 'dl' ? pick(['dt', 'dd']) : 'li'}${attributes()}>${children(depth - 1)}${random() < 0.5 && tag !== 'dl' ? '</li>' : ''}` + whitespace();
    }
    return result + `</${tag}>`;
  }

  function select() {
    let result = `<select${attributes()}>` + whitespace();
    let options = 1 + Math.floor(random() * 3);
    while (options--) {
      const option = `<option${attributes()}>${pick(['', ' a ', 'b  c', '&amp;'])}${random() < 0.5 ? '</option>' : ''}` + whitespace();
      result += random() < 0.2 ? `<optgroup label=x>${whitespace()}${option}</optgroup>` : option;
    }
    return result + '</select>';
  }

  function foreign(/** @type {number} */ depth) {
    if (random() < 0.5) {
      return `<math>${whitespace()}${pick(['<mi> x </mi>', '<mtext><b>y</b></mtext>', '<annotation-xml encoding="text/html"><p>z</p></annotation-xml>', '<annotation-xml><p>z</p></annotation-xml>', '<ms>a</ms>'])}</math>`;
    }
    return `<svg${attributes()} viewBox="0 0 1 1">${whitespace()}${pick(['<path d="M0 0"/>', '<circle cx=0 cy="0" r=1></circle>', '<title> t </title>', '<text x="0"> a  b </text>', `<foreignObject>${children(depth - 1)}</foreignObject>`, '<desc><b> x </b></desc>', '<a target=_self xlink:href=x>y</a>', '<style>a{}</style>', '<script>a</script>', '<![CDATA[ x ]]>'])}${whitespace()}</svg>`;
  }

  function node(/** @type {number} */ depth) {
    const choice = random();
    if (depth <= 0 || choice < 0.28) return pick(TEXT);
    if (choice < 0.33) return comment();
    if (choice < 0.36) return pick(SCRIPTS);
    if (choice < 0.39) return pick(STYLES);
    if (choice < 0.44) return table(depth);
    if (choice < 0.47) return list(depth);
    if (choice < 0.50) return select();
    if (choice < 0.53) return foreign(depth);
    const tag = pick(choice < 0.75 ? ELEMENTS_INLINE : choice < 0.93 ? ELEMENTS_BLOCK : ELEMENTS_ODD);
    if (/^(?:area|br|hr|img|input|source|wbr)$/.test(tag)) return `<${tag}${attributes()}>`;
    if (/^(?:listing|noembed|noframes|plaintext|pre|textarea|xmp)$/.test(tag)) {
      return `<${tag}${attributes()}>${pick(['', '\n', '\nx', '\n\nx', ' a  b\n', '<b>x</b>', 'a&amp;b', '\r\nz'])}</${tag}>`;
    }
    return `<${tag}${attributes()}>${children(depth - 1)}${random() < 0.92 ? `</${tag}>` : ''}`;
  }

  if (random() < 0.35) {
    return children(3) + (random() < 0.3 ? node(3) : '');
  }

  function headContent() {
    let result = '';
    let count = Math.floor(random() * 3);
    while (count--) result += whitespace() + pick([...HEAD_CONTENT, pick(SCRIPTS), comment()]);
    return result;
  }

  const hasHtml = random() < 0.7;
  return pick(DOCTYPES) + whitespace() +
    (hasHtml ? `<html${random() < 0.2 ? attributes() : ''}>` : '') + whitespace() +
    (random() < 0.7 ? `<head>${headContent()}${whitespace()}</head>` : headContent()) + whitespace() +
    (random() < 0.25 ? comment() + whitespace() : '') +
    (random() < 0.8 ? `<body${random() < 0.2 ? attributes() : ''}>` : '') + children(4) +
    (random() < 0.7 ? '</body>' : '') + whitespace() + (random() < 0.2 ? comment() : '') +
    (hasHtml && random() < 0.7 ? '</html>' : '') + whitespace();
}