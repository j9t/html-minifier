import { describe, test } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { compareMarkup } from './equivalence/compare.js';
import { equivalenceCases } from './equivalence/cases.js';
import { check, reduce, signatureOf, signatureOfThrown } from './equivalence/runner.js';

const fileKnownIssues = new URL('./equivalence/known-issues.json', import.meta.url);

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
      ['<!doctype html PUBLIC "-//W3C//DTD HTML 4.01//EN"><p>a', '<!doctype html><p>a', { useShortDoctype: true }]
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
      ['<a onclick="a(&quot;&amp;copy;&quot;)">b</a>', '<a onclick="a(&quot;&copy;&quot;)">b</a>', { minifyJS: { compress: false, mangle: false } }, 'tree']
    ]);
    for (const [input, output, options, kind] of cases) {
      assert.strictEqual(compareMarkup(input, output, options)[0]?.kind, kind, input);
    }
  });

  // Each known issue is one case in `known-issues.json`, so that only a change fails: a new or
  // different result, or one that no longer occurs. They are malformed markup past what the
  // parser models (e.g., content after a stray `</body>`, or a `body` start tag within the body),
  // obsolete elements, SVGO’s handling of unclosed SVG, and markup that fails to parse.
  // Run with `UPDATE_EQUIVALENCE_BASELINE=1` to rewrite the list, after reviewing what changed.
  test('Finds output equivalent to its source across options and markup', async () => {
    const known = /** @type {Record<string, string>} */ (JSON.parse(fs.readFileSync(fileKnownIssues, 'utf8')));
    /** @type {Record<string, string>} */
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
      seen[key] = signature;
      if (known[key] !== signature) failures.push({ html, options, signature, isThrown: thrown !== undefined });
    }
    if (process.env.UPDATE_EQUIVALENCE_BASELINE) {
      fs.writeFileSync(fileKnownIssues, JSON.stringify(Object.fromEntries(Object.entries(seen).sort()), null, 2));
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