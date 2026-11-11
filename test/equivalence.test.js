import { describe, test } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { compareMarkup } from './equivalence/compare.js';
import { equivalenceCases } from './equivalence/cases.js';
import { check, reduce, signatureOf, signatureOfThrown } from './equivalence/runner.js';

const fileKnownIssues = new URL('./equivalence/known-issues.json', import.meta.url);
const BASELINE_REDUCTION_STEPS = 400;
const BASELINE_INPUT_MAX = 200;

const keyOf = (/** @type {string} */ html, /** @type {Record<string, unknown>} */ options) =>
  crypto.createHash('sha256').update(html + JSON.stringify(options)).digest('base64url').slice(0, 16);

describe('Equivalence', () => {
  test('Accepts what options are meant to change', () => {
    const cases = /** @type {Array<[string, string, Record<string, unknown>]>} */ ([
      ['<p>a</p> <p>b</p>', '<p>a<p>b', { collapseWhitespace: true, removeOptionalTags: true }],
      ['<input checked="checked">', '<input checked>', { collapseBooleanAttributes: true }],
      ['<input type="text">', '<input>', { removeRedundantAttributes: true }],
      ['<script type="text/javascript">a()</script>', '<script>a()</script>', { removeDefaultTypeAttributes: true }],
      ['<!-- a --><p>b', '<p>b', { removeComments: true }],
      ['<p>a <b>c</b></p>', '<p>a <b>c</b>', { removeOptionalTags: true }],
      ['<a title="a&amp;b">c</a>', '<a title=a&b>c</a>', { decodeEntities: true, removeAttributeQuotes: true }],
      ['<!doctype html PUBLIC "-//W3C//DTD HTML 4.01//EN"><p>a', '<!doctype html><p>a', { useShortDoctype: true }],
      ['<p>a\n<div>b</div>\n<div>c</div>', '<p>a<div>b</div><div>c</div>', { collapseWhitespace: true }],
      ['<p>a\n<div></div>\nb', '<p>a</p>b', { collapseWhitespace: true, removeEmptyElements: true }],
      ['<style>:where(.a.b){gap:2em}:where(.a.c){gap:2em}w{g:}{}:where(.a.b){gap:2em}:where(.a.c){gap:2em}</style>', '<style>:where(.a.b),:where(.a.c){gap:2em}w{g:}:where(.a.b),:where(.a.c){gap:2em}</style>', { minifyCSS: true }],
      ['<link rel="stylesheet" media=" (max-width: 768px) " href="a">', '<link rel="stylesheet" media="(width<=768px)" href="a">', { minifyCSS: true }],
      ['<link rel="stylesheet" media="only screen and 8px)" href="a">', '<link rel="stylesheet" media=" only screen and 8px) " href="a">', { minifyCSS: true }],
      ['<style>a{background:url(https://example.org/b.png)}</style>', '<style>a{background:url(//example.org/b.png)}</style>', { minifyCSS: true, minifyURLs: 'https://example.org/dir/page.html' }],
      ['<p style="background:url(https://example.org/b.png)">a</p>', '<p style="background:url(//example.org/b.png)">a</p>', { minifyCSS: true, minifyURLs: 'https://example.org/dir/page.html' }],
      ['<style>@import "https://example.org/b.css";</style>', '<style>@import "//example.org/b.css";</style>', { minifyCSS: true, minifyURLs: 'https://example.org/dir/page.html' }],
      ['<style>a{background:url("")}</style>', '<style>a{background:url()}</style>', { minifyCSS: true, minifyURLs: 'https://example.org/dir/page.html' }],
      ['<style>a{mask:url("data:image/svg+xml,<svg a=\\"b\\"/>")}</style>', '<style>a{mask:url(\'data:image/svg+xml,<svg a="b"/>\')}</style>', { minifyCSS: true, minifyURLs: 'https://example.org/dir/page.html' }],
      ['<style>a{background:url(/b\\ c.png)}</style>', '<style>a{background:url(/b%20c.png)}</style>', { minifyCSS: true, minifyURLs: 'https://example.org/dir/page.html' }],
      ['<link rel="stylesheet" media=" print " href="a">', '<link rel="stylesheet" media="print" href="a">', {}],
      ['<a href="x"" id="y">b</a>', '<a href="x" id="y">b</a>', {}],
      ['<iframe>a</noscript></body></html>', '<iframe>a</noscript>', {}],
      ['<script>a();</script>\n<script>b()</script>', '<script>a();b()</script>', { mergeScripts: true }],
      ['<script>a() // c</script><script>b()</script>', '<script>a() // c\n;b()</script>', { mergeScripts: true }],
      ['<style>a{top:0}</style>\n<style media=all>b{top:0}</style>', '<style>a{top:0}b{top:0}</style>', { mergeStyles: true }],
      ['<style>a{color:red}</style><style>a{color:blue}</style>', '<style>a{color:#00f}</style>', { mergeStyles: true, minifyCSS: true }],
      ['<svg><!-- a --><rect/></svg>', '<svg><rect/></svg>', { minifySVG: true }],
      ['<svg><!--! a --><rect/></svg>', '<svg><!--! a--><rect/></svg>', { minifySVG: true }],
      ['<svg><!-- a --><rect/></svg>', '<svg><!-- a --><rect/></svg>', { minifySVG: null }],
      ['<svg><foreignObject><svg></svg></foreignObject></svg>x', '<svg><foreignObject></foreignObject></svg>x', { removeEmptyAttributes: true, removeEmptyElements: true }],
      ['<math><annotation-xml encoding="text/html"><svg></svg></annotation-xml></math>x', '<math><annotation-xml encoding="text/html"></annotation-xml></math>x', { removeEmptyAttributes: true, removeEmptyElements: true }],
      ['<p class="" title="">a</p><div id=""></div>', '<p title="">a</p>', { removeEmptyAttributes: (/** @type {string} */ name) => name !== 'title', removeEmptyElements: true }]
    ]);
    for (const [input, output, options] of cases) {
      assert.deepStrictEqual(compareMarkup(input, output, options), [], input);
    }
  });

  test('Rejects what no option is meant to change', () => {
    const cases = /** @type {Array<[string, string, Record<string, unknown>, string]>} */ ([
      ['<p>a <b>c</b></p>', '<p>a<b>c</b></p>', { collapseWhitespace: true }, 'render'],
      ['<pre> a</pre>', '<pre>a</pre>', { collapseWhitespace: true }, 'tree'],
      ['<input type="checkbox">', '<input>', { removeRedundantAttributes: true }, 'tree'],
      ['<a id=x name=y>b</a>', '<a id=x>b</a>', { removeRedundantAttributes: true }, 'tree'],
      ['<div>a</div>b', '<div>ab', {}, 'tree'],
      ['<table><tr><td>a<tr><td>b</table>', '<table><tr><td>a<td>b</table>', {}, 'tree'],
      ['<a onclick="a(&quot;&amp;copy;&quot;)">b</a>', '<a onclick="a(&quot;&copy;&quot;)">b</a>', { minifyJS: { compress: false, mangle: false } }, 'tree'],
      ['<style>a{top:0}</style>', '<style>a{top:1px}</style>', { minifyCSS: true }, 'tree'],
      ['<link rel="stylesheet" media="(max-width:768px)" href="a">', '<link rel="stylesheet" media="(max-width:769px)" href="a">', { minifyCSS: true }, 'tree'],
      ['<link rel="stylesheet" media="(" href="a">', '<link rel="stylesheet" media="" href="a">', { minifyCSS: true }, 'tree'],
      ['<style>a{background:url(https://example.org/b.png)}</style>', '<style>a{background:url(https://example.org/c.png)}</style>', { minifyCSS: true, minifyURLs: 'https://example.org/dir/page.html' }, 'tree'],
      ['<style>a{background:url(http://example.org/b.png)}</style>', '<style>a{background:url(//example.org/b.png)}</style>', { minifyCSS: true, minifyURLs: 'https://example.org/dir/page.html' }, 'tree'],
      ['<a "target="_blank">b</a>', '<a target="_blank">b</a>', {}, 'tree'],
      ['<script>a()</script><script>(b)()</script>', '<script>a()(b)()</script>', { mergeScripts: true }, 'tree'],
      ['<style>a{top:0</style><style>b{top:0}</style>', '<style>a{top:0b{top:0}</style>', { mergeStyles: true, minifyCSS: true }, 'tree'],
      ['<svg><foreignObject><p>a <b>b</b></p></foreignObject></svg>', '<svg><foreignObject><p>a<b>b</b></p></foreignObject></svg>', { minifySVG: true }, 'render'],
      ['<svg><text>a <tspan>b</tspan></text></svg>', '<svg><text>a<tspan>b</tspan></text></svg>', { minifySVG: true }, 'render'],
      ['<svg><text><textPath>a</textPath></text></svg>', '<svg><text><textPath>b</textPath></text></svg>', { minifySVG: true }, 'render'],
      ['<svg><text><a>a</a></text></svg>', '<svg><text><a>b</a></text></svg>', { minifySVG: true }, 'render'],
      ['<svg><!--! a --><rect/></svg>', '<svg><rect/></svg>', { minifySVG: true }, 'tree'],
      ['<p class="">a</p>', '<p>a</p>', { removeEmptyAttributes: () => false }, 'tree'],
      ['<div id=""></div>x', 'x', { removeEmptyAttributes: () => false, removeEmptyElements: true }, 'tree'],
      ['<svg><svg></svg><rect/></svg>x', '<svg><rect/></svg>x', { removeEmptyAttributes: true, removeEmptyElements: true }, 'tree'],
      ['<math><mi>a</mi><math></math></math>x', '<math><mi>a</mi></math>x', { removeEmptyAttributes: true, removeEmptyElements: true }, 'tree'],
      ['<math><annotation-xml encoding=" text/html "><svg></svg></annotation-xml></math>x', '<math><annotation-xml encoding=" text/html "></annotation-xml></math>x', { removeEmptyElements: true }, 'tree'],
      ['<math><annotation-xml encoding=" text/html "></annotation-xml></math>', '<math><annotation-xml encoding="text/html"></annotation-xml></math>', { collapseAttributeWhitespace: true }, 'tree'],
      ['<style>[id]{top:0}</style><div id=""></div>x', '<style>[id]{top:0}</style>x', { removeEmptyAttributes: true, removeEmptyElements: true }, 'tree']
    ]);
    for (const [input, output, options, kind] of cases) {
      assert.strictEqual(compareMarkup(input, output, options)[0]?.kind, kind, input);
    }
  });

  test('Reduces markup that fails to parse, as long as it does', async () => {
    const html = '<p>a</p><a "b="c">d</a><p>e</p>';
    const reduced = await reduce(html, {}, 'thrown:Parse error at line 1, column 9:');
    assert.ok(reduced.html.length < html.length, reduced.html);
    assert.notStrictEqual((await check(reduced.html, {})).thrown, undefined, reduced.html);
  });

  // Each known issue is one case in `known-issues.json`, with a reduced input to audit it by,
  // so that only a change fails: a new or different result, or one that no longer occurs. They
  // are malformed markup past what the parser models (e.g., content after a stray `</body>`, or
  // a `body` start tag within the body), obsolete elements, SVGO’s handling of unclosed SVG, and
  // markup that fails to parse.
  // Run with `UPDATE_EQUIVALENCE_BASELINE=1` to rewrite the list, after reviewing what changed.
  test('Finds output equivalent to its source across options and markup', async () => {
    const known = /** @type {Record<string, {signature: string}>} */ (JSON.parse(fs.readFileSync(fileKnownIssues, 'utf8')));
    /** @type {Record<string, {html: string, options: Record<string, unknown>, signature: string}>} */
    const seen = {};
    const failures = [];
    let compared = 0;
    for (const { html, options } of equivalenceCases()) {
      const { differences, thrown } = await check(html, options);
      if (thrown === undefined) compared++;
      const [first] = differences;
      if (thrown === undefined && !first) continue;
      const signature = thrown === undefined ? signatureOf(/** @type {NonNullable<typeof first>} */ (first)) : signatureOfThrown(thrown);
      const key = keyOf(html, options);
      seen[key] = { html, options, signature };
      if (known[key]?.signature !== signature) failures.push({ html, options, signature, isThrown: thrown !== undefined });
    }
    if (process.env.UPDATE_EQUIVALENCE_BASELINE) {
      const lines = [];
      for (const [key, { html, options, signature }] of Object.entries(seen).sort(([keyA], [keyB]) => keyA < keyB ? -1 : 1)) {
        const reduced = await reduce(html, options, signature, BASELINE_REDUCTION_STEPS);
        const entry = { signature, input: reduced.html.slice(0, BASELINE_INPUT_MAX), ...(Object.keys(reduced.options).length ? { options: reduced.options } : {}) };
        lines.push(`  ${JSON.stringify(key)}: ${JSON.stringify(entry)}`);
      }
      fs.writeFileSync(fileKnownIssues, `{\n${lines.join(',\n')}\n}`);
      return;
    }
    assert.ok(compared > 5000, `Compared only ${compared} cases`);
    const reports = [];
    for (const { html, options, signature, isThrown } of failures.slice(0, 5)) {
      const reduced = isThrown ? { html, options } : await reduce(html, options, signature);
      const { output } = await check(reduced.html, reduced.options);
      reports.push(`${signature}\n  options: ${JSON.stringify(reduced.options)}\n  input:   ${JSON.stringify(reduced.html)}\n  output:  ${JSON.stringify(output)}`);
    }
    assert.strictEqual(failures.length, 0, `${failures.length} new or changed differences, for example:\n${reports.join('\n')}`);
    const stale = Object.keys(known).filter(key => !(key in seen));
    assert.deepStrictEqual(stale, [], `${stale.length} known issues no longer occur; rewrite the list`);
  });
});