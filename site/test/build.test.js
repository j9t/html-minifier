import { exec } from 'node:child_process';
import { before, describe, test } from 'node:test';
import assert from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import { promisify } from 'node:util';

// Run apart from the main suite, as building loads the machine enough to throw off its timing tests
describe('Build', () => {
  const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  let html;
  let notices;

  before(async () => {
    await promisify(exec)('npm run build:site', { cwd: new URL('../..', import.meta.url) });
    html = read('build/index.html');
    notices = read('build/THIRD-PARTY-NOTICES.txt');
  }, { timeout: 120_000 });

  test('Minifies the page', () => {
    assert.doesNotMatch(html, /\n/);
  });

  test('Keeps Alpine directives', () => {
    assert.match(html, /data-x-data="?minifier/);
    assert.match(html, /data-x-for="option in options"/);
    assert.match(html, /data-x-cloak/);
  });

  // LinkedIn needs `head` (and `body`), messengers like WhatsApp and Signal need quotes
  test('Keeps social markup readable for picky parsers', () => {
    assert.match(html, /<head>/);
    assert.match(html, /<body>/);
    for (const [, attributes] of html.matchAll(/<meta ([^>]*(?:og|twitter):[^>]*)>/g)) {
      assert.doesNotMatch(attributes, /=[^"]/, `Unquoted attribute in <meta ${attributes}>`);
    }
  });

  test('Inlines the style sheet', () => {
    assert.match(html, /<style>:root\{/);
    assert.doesNotMatch(html, /<link[^>]+stylesheet/);
    assert.ok(!readdirSync(new URL('../build/assets/', import.meta.url)).some(file => file.endsWith('.css')), 'Style sheet left in assets');
  });

  test('Keeps button types', () => {
    assert.match(html, /<button type="?button/);
  });

  test('Points assets to the root', () => {
    assert.match(html, /src="?\/assets\//);
  });

  test('Leaves out SVGO, which the web version can’t use', () => {
    assert.ok(!readdirSync(new URL('../build/assets/', import.meta.url)).some(file => file.startsWith('svgo')), 'SVGO chunk in assets');
    // Its dependencies, as far as nothing else uses them
    for (const name of ['svgo', 'csso', 'css-select', 'sax']) {
      assert.doesNotMatch(notices, new RegExp(`^## ${name} `, 'm'), `Notices list ${name}`);
    }
  });

  test('Publishes the license of all bundled third-party software', () => {
    for (const path of [
      'node_modules/@vue/reactivity/LICENSE',
      'node_modules/@vue/shared/LICENSE',
      'node_modules/terser/LICENSE',
      'site/licenses/alpinejs.txt',
      'site/licenses/lz-string.txt'
    ]) {
      const license = readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
      assert.ok(notices.includes(license.trim()), `Missing the license of ${path}`);
    }
  });
});