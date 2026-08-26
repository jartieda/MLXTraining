import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import ml4g from './eslint-rules/index.js'

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'build/**',
      'coverage/**',
      'node_modules/**',
      'playwright-report/**',
      'test-results/**',
      'public/models/**',
      'docs/prototype/**', // vendored third-party prototype, not our source (T009b)
      '*.min.js',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // Application code
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      ml4g,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },

  // Principle V: tokens only, everywhere a learner can see a colour.
  {
    files: ['src/components/**/*.{ts,tsx}', 'src/features/**/*.{ts,tsx}', 'src/routes/**/*.{ts,tsx}'],
    plugins: { ml4g },
    rules: {
      'ml4g/no-raw-hex-or-font-family': 'error',
    },
  },

  // Principle VI: the ML core stays DOM-free, network-free and feature-free.
  {
    files: ['src/ml/**/*.ts'],
    languageOptions: {
      globals: {}, // no browser globals in scope at all
    },
    plugins: { ml4g },
    rules: {
      'ml4g/ml-core-import-boundary': 'error',
    },
  },

  // FR-041: the educator's and administrator's screens may not reach the on-device
  // sample store. Structural rather than reviewed, because the failure only appears on
  // a shared classroom device — the one place it matters most.
  {
    files: ['src/features/classroom/**/*.{ts,tsx}', 'src/features/admin/**/*.{ts,tsx}'],
    plugins: { ml4g },
    rules: {
      'ml4g/no-local-store-in-classroom': 'error',
    },
  },

  // The colormap is the one deliberate exemption: Principle V exempts heat maps so they
  // can use a perceptually uniform ramp instead of brand accents.
  {
    files: ['src/ml/explain/colormap.ts'],
    rules: {
      'ml4g/no-raw-hex-or-font-family': 'off',
    },
  },

  // Tests may reach for both worlds.
  {
    files: ['tests/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  // Build and tooling scripts are Node. Two blocks on purpose: spreading
  // disableTypeChecked into the same object would replace languageOptions wholesale and
  // silently drop the Node globals set alongside it.
  {
    files: ['scripts/**/*.mjs', 'eslint-rules/**/*.js', 'eslint.config.js', '*.config.js'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    files: ['*.config.{ts,js}', 'scripts/**/*.mjs', 'eslint-rules/**/*.js'],
    languageOptions: {
      globals: globals.node,
    },
  },
)
