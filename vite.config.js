import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const FILE_NOTICES = 'THIRD-PARTY-NOTICES.txt';
const PREFIX_STUB = '\0virtual:stub:';

// Licenses Vite’s report misses: Alpine’s package lacks its own, it bundles Vue’s reactivity,
// and LZ-String is a public script rather than a bundled one
/** @type {[string, string][]} */
const LICENSES_EXTRA = [
  ['alpinejs (license text)', 'demo/licenses/alpinejs.txt'],
  ['@vue/reactivity (bundled in alpinejs)', 'node_modules/@vue/reactivity/LICENSE'],
  ['@vue/shared (bundled in alpinejs)', 'node_modules/@vue/shared/LICENSE'],
  ['lz-string', 'demo/licenses/lz-string.txt']
];

// Node-only dependencies, replaced by modules that throw if called, keeping them out of the bundle
/** @type {Record<string, string>} */
const STUBS = {
  // Lightning CSS and SWC require native bindings
  'lightningcss': `export function transform() {
  throw new Error('Lightning CSS is not available in browser environments. CSS minification is disabled in the web version.');
}`,
  '@swc/core': `export function minify() {
  throw new Error('SWC is not available in browser environments. JavaScript minification uses Terser in the web version.');
}`,
  'svgo': `export function optimize() {
  throw new Error('SVGO is not available in browser environments. SVG minification is disabled in the web version.');
}`
};

const config = defineConfig({
  root: 'demo',
  build: {
    license: { fileName: FILE_NOTICES },
    outDir: 'build'
  },
  server: {
    port: 3456
  },
  define: {
    'process.env': {},
    'process.platform': JSON.stringify(process.platform)
  },
  resolve: {
    alias: Object.fromEntries(Object.keys(STUBS).map(name => [name, PREFIX_STUB + name]))
  },
  // Returning `undefined` from a hook hands the id back to Vite’s default handling
  plugins: [{
    // The style sheet is small, so inlining it saves a render-blocking request
    name: 'inline-css',
    apply: 'build',
    generateBundle: {
      order: 'post',
      handler(_, bundle) {
        const page = bundle['index.html'];
        if (page?.type !== 'asset') throw new Error('Vite emitted no index.html');
        for (const [fileName, file] of Object.entries(bundle)) {
          if (file.type !== 'asset' || !fileName.endsWith('.css')) continue;
          const link = new RegExp(`<link rel="stylesheet"[^>]* href="/${fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}">`);
          if (!link.test(String(page.source))) throw new Error(`index.html links no ${fileName}`);
          page.source = String(page.source).replace(link, () => `<style>${String(file.source).trim()}</style>`);
          delete bundle[fileName];
        }
      }
    }
  }, {
    name: 'third-party-notices',
    apply: 'build',
    generateBundle: {
      order: 'post',
      handler(_, bundle) {
        const notices = bundle[FILE_NOTICES];
        if (notices?.type !== 'asset') throw new Error(`Vite emitted no ${FILE_NOTICES}`);
        const extra = LICENSES_EXTRA.map(([name, path]) => `## ${name}\n\n${readFileSync(new URL(path, import.meta.url), 'utf8').trim()}`);
        notices.source = `${String(notices.source).trimEnd()}\n\n${extra.join('\n\n')}\n`;
      }
    }
  }, {
    name: 'node-stub',
    resolveId(id) {
      return id.startsWith(PREFIX_STUB) ? id : undefined;
    },
    load(id) {
      return id.startsWith(PREFIX_STUB) ? STUBS[id.slice(PREFIX_STUB.length)] : undefined;
    }
  }]
});

export default config;