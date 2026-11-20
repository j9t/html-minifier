import js from '@eslint/js';
import globals from 'globals';

// The page script and its modules; everything else, web version tests included, runs in Node
const FILES_BROWSER = ['site/*.js', 'site/lib/**/*.js'];

export default [
  {
    ignores: [
      'dist/**',
      'site/build/**',
      'site/public/**'
    ]
  },
  js.configs.recommended,
  {
    rules: {
      curly: ['error', 'multi-line'],
      eqeqeq: ['error', 'smart'],
      // Comments only; code length is left to review
      'max-len': ['error', {
        code: Infinity,
        comments: 100,
        ignoreUrls: true,
        // JSDoc tags and typedef members can’t be wrapped
        ignorePattern: '^\\s*(?:/\\*)?\\*+\\s*(?:@|[\\w$]+\\??:)'
      }],
      'no-shadow': 'error',
      'no-var': 'error',
      'prefer-const': 'error'
    }
  },
  {
    ignores: FILES_BROWSER,
    languageOptions: {
      globals: globals.node
    }
  },
  {
    files: FILES_BROWSER,
    languageOptions: {
      globals: {
        ...globals.browser,
        LZString: 'readonly'
      }
    }
  }
];