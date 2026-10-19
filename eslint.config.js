import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'test-results'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message:
            'Math.random is never used for outcomes. Use src/game/random.ts, or a visual-only RNG passed in explicitly.',
        },
      ],
    },
  },
  {
    // The dice planner and 2D fallback may use Math.random for purely visual variation
    // (launch spin, flicker), never for which face lands up.
    files: ['src/dice3d/visualRandom.ts', 'scripts/**'],
    rules: { 'no-restricted-properties': 'off' },
  },
  {
    files: ['scripts/**', '*.config.{js,ts}'],
    languageOptions: { globals: globals.node },
  },
);
