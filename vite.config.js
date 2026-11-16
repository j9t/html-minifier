import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const FILE_NOTICES = 'THIRD-PARTY-NOTICES.txt';

// Licenses Vite’s report misses: Alpine’s package lacks its own, it bundles Vue’s reactivity,
// and LZ-String is a public script rather than a bundled one
/** @type {[string, string][]} */
const LICENSES_EXTRA = [
  ['alpinejs (license text)', 'demo/licenses/alpinejs.txt'],
  ['@vue/reactivity (bundled in alpinejs)', 'node_modules/@vue/reactivity/LICENSE'],
  ['@vue/shared (bundled in alpinejs)', 'node_modules/@vue/shared/LICENSE'],
  ['lz-string', 'demo/licenses/lz-string.txt']
];

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
    alias: {
      // Replace Lightning CSS with inline stub for browser builds
      // Lightning CSS requires Node.js native bindings and cannot run in-browser
      'lightningcss': '\0virtual:lightningcss-stub',
      // Replace SWC with inline stub for browser builds
      // SWC requires Node.js native bindings and cannot run in-browser
      '@swc/core': '\0virtual:swc-stub'
    }
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
    name: 'native-stub',
    resolveId(id) {
      if (id === '\0virtual:lightningcss-stub' || id === '\0virtual:swc-stub') {
        return id;
      }
      return undefined;
    },
    load(id) {
      if (id === '\0virtual:lightningcss-stub') {
        return `export function transform() {
  throw new Error('Lightning CSS is not available in browser environments. CSS minification is disabled in the web version.');
}`;
      }
      if (id === '\0virtual:swc-stub') {
        return `export function minify() {
  throw new Error('SWC is not available in browser environments. JavaScript minification uses Terser in the web version.');
}`;
      }
      return undefined;
    }
  }]
});

export default config;