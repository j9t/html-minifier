import { describe, test } from 'node:test';
import assert from 'node:assert';
import { toDelimitedFragment, toFragment, replaceCustomFragments, isMinifiedCSSSafe, isMinifiedJSSafe } from '../src/lib/fragments.js';
import { assertLinearGrowth } from './timing.js';

describe('Fragments', () => {
  describe('`toDelimitedFragment`', () => {
    test('Reads the shape the shipped defaults use', () => {
      assert.deepStrictEqual(toDelimitedFragment(/<%[\s\S]*?%>/), { open: '<%', close: '%>', min: 0, max: Infinity, excluded: null });
      assert.deepStrictEqual(toDelimitedFragment(/<\?[\s\S]*?\?>/), { open: '<?', close: '?>', min: 0, max: Infinity, excluded: null });
    });

    test('Reads bounded and reversed bodies', () => {
      assert.deepStrictEqual(toDelimitedFragment(/\{\{[\s\S]{0,500}?\}\}/), { open: '{{', close: '}}', min: 0, max: 500, excluded: null });
      assert.deepStrictEqual(toDelimitedFragment(/<%[\S\s]{2,}?%>/), { open: '<%', close: '%>', min: 2, max: Infinity, excluded: null });
      assert.deepStrictEqual(toDelimitedFragment(/<%[^]+?%>/), { open: '<%', close: '%>', min: 1, max: Infinity, excluded: null });
      assert.deepStrictEqual(toDelimitedFragment(/<%[\s\S]{4}?%>/), { open: '<%', close: '%>', min: 4, max: 4, excluded: null });
    });

    test('Reads negated-class bodies, keeping the class as the boundary', () => {
      assert.deepStrictEqual(toDelimitedFragment(/<%[^%]*?%>/), { open: '<%', close: '%>', min: 0, max: Infinity, excluded: /[%]/g });
      assert.deepStrictEqual(toDelimitedFragment(/\{\{[^{}]{0,500}?\}\}/), { open: '{{', close: '}}', min: 0, max: 500, excluded: /[{}]/g });
      assert.deepStrictEqual(toDelimitedFragment(/\{%[^\]]+?%\}/), { open: '{%', close: '%}', min: 1, max: Infinity, excluded: /[\]]/g });
    });

    test('Keeps escaped characters as themselves', () => {
      assert.deepStrictEqual(toDelimitedFragment(/\{%[\s\S]*?%\}/), { open: '{%', close: '%}', min: 0, max: Infinity, excluded: null });
      assert.deepStrictEqual(toDelimitedFragment(/<\?php[\s\S]*?\?>/), { open: '<?php', close: '?>', min: 0, max: Infinity, excluded: null });
    });

    test('Refuses shapes a literal scan cannot stand in for', () => {
      assert.strictEqual(toDelimitedFragment(/<%[\s\S]*%>/), null, 'Greedy body takes the last terminator, not the first');
      assert.strictEqual(toDelimitedFragment(/<%[^]]*?%>/), null, 'An any-character body followed by a literal `]`, not a negated class');
      assert.strictEqual(toDelimitedFragment(/<(WC@[\s\S]*?)>/), null, 'Delimiters are not literal');
      assert.strictEqual(toDelimitedFragment(/^<%[\s\S]*?%>/), null, 'Anchors are not literal');
      assert.strictEqual(toDelimitedFragment(/\s*[\s\S]*?%>/), null, 'Opening delimiter is not literal');
      assert.strictEqual(toDelimitedFragment(/<%[\s\S]*?/), null, 'No closing delimiter to scan to');
      assert.strictEqual(toDelimitedFragment(/<%\.*?%>/s), null, 'The body token is an escaped literal `.`');
      assert.strictEqual(toDelimitedFragment(/<%\[\s\S]*?%>/), null, 'The body token starts inside an escape');
    });

    test('Takes flags into account', () => {
      // `.` spans every character only under `s`; without it, line terminators bound the body
      assert.deepStrictEqual(toDelimitedFragment(/<%.*?%>/), { open: '<%', close: '%>', min: 0, max: Infinity, excluded: /[\n\r\u2028\u2029]/g });
      assert.deepStrictEqual(toDelimitedFragment(/<%.*?%>/s), { open: '<%', close: '%>', min: 0, max: Infinity, excluded: null });
      assert.strictEqual(toDelimitedFragment(/<%[\s\S]*?%>/i), null, 'Case folding moves character indexes');
      // `g` is the caller's business, so it does not stand in the way
      assert.deepStrictEqual(toDelimitedFragment(/<%[\s\S]*?%>/g), { open: '<%', close: '%>', min: 0, max: Infinity, excluded: null });
    });
  });

  describe('`replaceCustomFragments`', () => {
    const marker = (/** @type {string} */ match) => '[' + JSON.stringify(match) + ']';
    const prepare = (/** @type {RegExp[]} */ patterns) => patterns.map(toFragment);

    const patternSets = [
      [/<%[\s\S]*?%>/, /<\?[\s\S]*?\?>/],
      [/<%[\s\S]*?%>/],
      [/\{\{[\s\S]{0,3}?\}\}/, /<%[\s\S]*?%>/],
      [/<%[\s\S]{1,4}?%>/],
      [/\{%[\s\S]*?%\}/, /\{\{[\s\S]*?\}\}/, /<[^]*?>/],
      // Overlapping delimiters, in both orders, since ties go to the pattern listed first
      [/<%%[\s\S]*?%%>/, /<%[\s\S]*?%>/],
      [/<%[\s\S]*?%>/, /<%%[\s\S]*?%%>/],
      [/<%[\s\S]+?%>/, /<%[\s\S]{2,5}?%>/],
      [/a[\s\S]*?a/],
      // Negated-class bodies, scanned with their class as the boundary
      [/<%[^%]*?%>/],
      [/<%[^%]*?%>/, /\{\{[\s\S]*?\}\}/],
      [/\{\{[^{}]{1,4}?\}\}/, /<%[\s\S]*?%>/],
      [/\{\{.*?\}\}/],
      [/a[^x]*?a/],
      // Shapes that fall back to running the pattern, on their own and mixed in
      [/<%[\s\S]*%>/],
      [/<(WC@[\s\S]*?)>/, /<%[\s\S]*?%>/],
      // …among them ones that end in a closing literal, which is looked for first (without
      // flags, which the joined oracle would drop)
      [/<\?(?:php[\t\n\r ]|=|\$|xml(?:-stylesheet)?(?![\w-])|\s)[\s\S]*?\?>/, /<%[\s\S]*?%>/],
      [/a|<%[\s\S]*?%>/],
      [/(?:<%|\{\{)[\s\S]*?%>/]
    ];

    test('Matches what the equivalent regex would match, across random inputs', () => {
      // The scan stands in for `\s*(?:A|B)+\s*`, so that regex is the oracle
      const viaRegExp = (/** @type {string} */ input, /** @type {RegExp[]} */ patterns) => {
        const sources = patterns.map(pattern => pattern.source);
        return input.replace(new RegExp('\\s*(?:' + sources.join('|') + ')+\\s*', 'g'), marker);
      };

      const alphabet = ['<', '>', '%', '?', '{', '}', 'a', ' ', '  ', '\n', '\t', '<%', '%>', '<%%', '%%>', '{{', '}}', '<% x %>', 'aa', '<%a%>', '<WC@x>', '<?', '?>', '<?php', '<?PHP', '<?=', '<?x'];
      // Seeded, so a failure is reproducible
      let seed = 42;
      const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
      const pick = (/** @type {any[]} */ options) => options[Math.floor(random() * options.length)];

      for (let round = 0; round < 20000; round++) {
        const patterns = pick(patternSets);
        let input = '';
        for (let i = 0, n = Math.floor(random() * 26); i < n; i++) input += pick(alphabet);

        assert.strictEqual(
          replaceCustomFragments(input, prepare(patterns), marker),
          viaRegExp(input, patterns),
          `Round ${round} with ${patterns.join(' ')} on ${JSON.stringify(input)}`
        );
      }
    });

    test('Joins whitespace and adjacent fragments to the match', () => {
      const fragments = prepare([/<%[\s\S]*?%>/]);
      assert.strictEqual(replaceCustomFragments('a   <%x%><%y%>   b', fragments, marker), 'a["   <%x%><%y%>   "]b');
      // However long the run, since nothing caps it
      const spaces = ' '.repeat(500);
      assert.strictEqual(replaceCustomFragments(`a${spaces}<%x%>`, fragments, marker), `a["${spaces}<%x%>"]`);
      // Only fragments running straight into each other share a match; whitespace
      // between them belongs to the first
      assert.strictEqual(replaceCustomFragments('<%x%> <%y%>', fragments, marker), '["<%x%> "]["<%y%>"]');
    });

    test('Keeps a negated-class body from crossing the characters it excludes', () => {
      const fragments = prepare([/\{\{[^}]*?\}\}/]);
      assert.strictEqual(replaceCustomFragments('{{a}b}} {{c}}', fragments, marker), '{{a}b}}[" {{c}}"]');
      assert.strictEqual(replaceCustomFragments('{{}a}}', fragments, marker), '{{}a}}');
    });

    test('Returns input without a fragment untouched', () => {
      const input = '<p>' + '<% '.repeat(50) + '</p>';
      assert.strictEqual(replaceCustomFragments(input, prepare([/<%[\s\S]*?%>/]), marker), input);
    });

    test('Keeps a pattern’s own flags', () => {
      // The whitespace before the match joins it, as it would for any other fragment
      assert.strictEqual(replaceCustomFragments('<%x%> <A%x%a>', prepare([/<a%[\s\S]*?%a>/i]), marker), '<%x%>[" <A%x%a>"]');
      assert.strictEqual(replaceCustomFragments('<%x%> <A%x%a>', prepare([/<a%[\s\S]*?%a>/]), marker), '<%x%> <A%x%a>');
    });

    test('Reuses prepared fragments across scans, which leave no state behind', () => {
      const pattern = /\{\{[\s\S]*?\}\}|<%[\s\S]*?%>/;
      assert.strictEqual(toFragment(pattern), toFragment(new RegExp(pattern.source)));
      assert.notStrictEqual(toFragment(pattern), toFragment(new RegExp(pattern.source, 'i')));

      // A scan that stops early, as at a fragment that runs to the end, must not offset the next
      for (const input of ['a {{b}} c <%d', '{{e}}', 'f <%g%>']) {
        const expected = input.replace(/\s*(?:\{\{[\s\S]*?\}\}|<%[\s\S]*?%>)\s*/g, match => JSON.stringify([match]));
        assert.strictEqual(replaceCustomFragments(input, [toFragment(pattern)], marker), expected, input);
      }
    });

    test('Gives up on a pattern run as a regex where its closing literal is nowhere ahead', async () => {
      assert.strictEqual(toFragment(/<\?(?:php[\t\n\r ]|=|\$|xml(?:-stylesheet)?(?![\w-])|\s)[\s\S]*?\?>/i).close, '?>');
      assert.strictEqual(toFragment(/a|<%[\s\S]*?%>/).close, null, 'A match of `a` ends anywhere');
      assert.strictEqual(toFragment(/(<%|\{\{)[\s\S]*?%>/).close, '%>');
      assert.strictEqual(toFragment(/<a%[\s\S]*?%a>/i).close, null, 'Case folding moves the literal');
      assert.strictEqual(toFragment(/(<%).*?%>/).close, null, 'The body stops at line terminators');

      // Each opener would otherwise run to the end of the input, which costs O(n²)
      const fragments = prepare([/<\?(?:php[\t\n\r ]|=|\$|xml(?:-stylesheet)?(?![\w-])|\s)[\s\S]*?\?>/i]);
      await assertLinearGrowth(count => {
        const input = '<?php '.repeat(count);
        assert.strictEqual(replaceCustomFragments(input, fragments, marker), input);
      }, 20000, 'Failing on unclosed openers');
    });

    test('Does not let a pattern that matches nothing stall the scan', () => {
      // `String.replace` spreads an empty match over every position; skipping it is saner
      assert.strictEqual(replaceCustomFragments('abc', prepare([/x*/]), marker), 'abc');
      assert.strictEqual(replaceCustomFragments('abxc', prepare([/x*/]), marker), 'ab["x"]c');
    });
  });

  describe('`isMinifiedCSSSafe`', () => {
    const placeholder = /U\d+U/g;

    test('Passes through non-string results', () => {
      assert.strictEqual(isMinifiedCSSSafe('a\nU0U', /** @type {any} */ ({}), placeholder), true);
    });

    test('Reads colons as values, not labels', () => {
      assert.strictEqual(isMinifiedCSSSafe('a { top: 0; b: U0U }', 'a{top:0;b:U0U}', placeholder), true);
    });

    test('Fails on fragments that change quotes or lose them', () => {
      assert.strictEqual(isMinifiedCSSSafe('a { content: \'U0U\' }', 'a{content:"U0U"}', placeholder), false);
      assert.strictEqual(isMinifiedCSSSafe('a { b: url("U0U") }', 'a{b:url(U0U)}', placeholder), false);
      assert.strictEqual(isMinifiedCSSSafe('a { b: url(U0U) }', 'a{b:url("U0U")}', placeholder), true);
      assert.strictEqual(isMinifiedCSSSafe('a { content: " U0U" }', 'a{content:"U0U"}', placeholder), false);
    });

    test('Fails on fragments written twice', () => {
      assert.strictEqual(isMinifiedCSSSafe('a { top: U0U }', 'a{top:U0U}b{top:U0U}', placeholder), false);
    });

    test('Fails on fragments that change order', () => {
      assert.strictEqual(isMinifiedCSSSafe('a { top: U0U } b { top: U1U }', 'b{top:U1U}a{top:U0U}', placeholder), false);
      assert.strictEqual(isMinifiedCSSSafe('a { top: U0U } b { top: U1U }', 'b{top:U1U}', placeholder), true);
    });

    test('Reads escaped quotes as part of names, not as strings', () => {
      assert.strictEqual(isMinifiedCSSSafe('a { b: x\\"; c: U0U }', 'a{b:x\\";c:U0U}', placeholder), true);
    });

    test('Scans long inputs in linear time', async () => {
      const sources = [
        (/** @type {number} */ count) => '@import U0U;'.repeat(count),
        (/** @type {number} */ count) => '@import '.repeat(count) + 'U0U',
        (/** @type {number} */ count) => '/*'.repeat(count) + '@import U0U',
        (/** @type {number} */ count) => 'url('.repeat(count) + 'U0U',
        (/** @type {number} */ count) => 'url("'.repeat(count) + 'U0U',
        (/** @type {number} */ count) => '"' + ' '.repeat(count * 4) + 'U0U"',
        (/** @type {number} */ count) => ' '.repeat(count * 4) + ': U0U'
      ];
      for (const source of sources) {
        await assertLinearGrowth(count => isMinifiedCSSSafe(source(count), 'x', placeholder), 20000, source(1).slice(0, 20));
      }
    });
  });

  describe('`isMinifiedJSSafe`', () => {
    const placeholder = /U\d+U/g;

    test('Passes through non-string results', async () => {
      assert.strictEqual(await isMinifiedJSSafe('l: U0U', /** @type {any} */ (undefined), placeholder), true);
    });

    test('Fails on fragments starting statements next to labels or other code', async () => {
      assert.strictEqual(await isMinifiedJSSafe('a; b: U0U', 'a;b:U0U', placeholder), false);
      assert.strictEqual(await isMinifiedJSSafe('a();\nU0U', 'a(),U0U', placeholder), false);
      assert.strictEqual(await isMinifiedJSSafe('\nU0U\n', 'U0U', placeholder), true);
    });

    test('Fails on code that doesn’t parse', async () => {
      assert.strictEqual(await isMinifiedJSSafe('U0U if (a) {} U1U', 'x', placeholder), false);
      assert.strictEqual(await isMinifiedJSSafe('a = "U0U"', 'a="U0U', placeholder), false);
    });

    test('Allows `return` in event handlers and `import` in modules only', async () => {
      assert.strictEqual(await isMinifiedJSSafe('return U0U', 'return U0U;', placeholder, true), true);
      assert.strictEqual(await isMinifiedJSSafe('return U0U', 'return U0U;', placeholder), false);
      assert.strictEqual(await isMinifiedJSSafe('import "a"; f(U0U)', 'import"a";f(U0U)', placeholder, false, true), true);
      assert.strictEqual(await isMinifiedJSSafe('import "a"; f(U0U)', 'import"a";f(U0U)', placeholder), false);
    });

    test('Fails on fragments that move into another kind of string', async () => {
      assert.strictEqual(await isMinifiedJSSafe('a = \'U0U\'', 'a="U0U"', placeholder), false);
      assert.strictEqual(await isMinifiedJSSafe('a = `U0U`', 'a="U0U"', placeholder), false);
      assert.strictEqual(await isMinifiedJSSafe('a = `${U0U}`', 'a=`${U0U}`', placeholder), true);
      assert.strictEqual(await isMinifiedJSSafe('a = "U0U"; b()', 'a="U0U",b()', placeholder), true);
      assert.strictEqual(await isMinifiedJSSafe('a = `\nU0U`', 'a=`\\nU0U`', placeholder), false);
    });

    test('Fails on fragments that change order', async () => {
      assert.strictEqual(await isMinifiedJSSafe('var a = U0U; f(U1U, a)', 'f(U1U,U0U)', placeholder), false);
      assert.strictEqual(await isMinifiedJSSafe('f(U0U); g(U1U)', 'f(U0U),g(U1U)', placeholder), true);
    });

    test('Fails on fragments that move from code into a string', async () => {
      assert.strictEqual(await isMinifiedJSSafe('use({ U0U: 1 })', 'use({"U0U":1})', placeholder), false);
    });

    test('Fails on escapes before fragments that change', async () => {
      assert.strictEqual(await isMinifiedJSSafe('a = "\\x00U0U"', 'a="\\0U0U"', placeholder), false);
      assert.strictEqual(await isMinifiedJSSafe('a = "\\nU0U"', 'a="\\nU0U"', placeholder), true);
      assert.strictEqual(await isMinifiedJSSafe('a = \'\\\\U0U\'; b()', 'a=\'\\\\U0U\',b()', placeholder), true);
    });

    test('Fails on fragments written twice', async () => {
      assert.strictEqual(await isMinifiedJSSafe('x = { U0U }', 'x={U0U:U0U}', placeholder), false);
    });

    test('Parses long inputs in linear time', async () => {
      const sources = [
        (/** @type {number} */ count) => 'l: U0U; '.repeat(count),
        (/** @type {number} */ count) => 'a("U0U"); '.repeat(count),
        (/** @type {number} */ count) => '`' + 'U0U${a}'.repeat(count) + '`',
        (/** @type {number} */ count) => '"' + ' '.repeat(count * 4) + 'U0U"',
        (/** @type {number} */ count) => '/*'.repeat(count) + 'U0U'
      ];
      for (const source of sources) {
        await assertLinearGrowth(count => isMinifiedJSSafe(source(count), 'x', placeholder), 20000, source(1).slice(0, 20));
      }
    });
  });
});