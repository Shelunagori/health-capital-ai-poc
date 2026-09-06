// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      '**/*.d.ts',
      'apps/api/src/generated/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: ['**/*.ts', '**/*.tsx'],
  })),
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      sourceType: 'module',
      globals: { process: 'readonly', console: 'readonly', Buffer: 'readonly' },
    },
  },
  {
    // Module boundary rule: a module is imported only through its index.
    // From apps/api/src/modules/<a>/*.ts, another module is `../<b>/...`; platform is `../../platform/...`.
    files: ['apps/api/src/modules/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              // A sibling module is reachable only through its index: `../<module>/index.js`.
              // Module names are listed explicitly because a wildcard segment also matches `..`,
              // which would wrongly catch `../../platform/...`. Every module may import platform
              // directly: it is infrastructure, not a domain module. Add new modules here.
              group: [
                '../ai/*',
                '!../ai/index.js',
                '../audit/*',
                '!../audit/index.js',
                '../auth/*',
                '!../auth/index.js',
                '../authorization/*',
                '!../authorization/index.js',
                '../benefits/*',
                '!../benefits/index.js',
                '../classification/*',
                '!../classification/index.js',
                '../eligibility/*',
                '!../eligibility/index.js',
                '../guidance/*',
                '!../guidance/index.js',
                '../integrations/*',
                '!../integrations/index.js',
                '../members/*',
                '!../members/index.js',
              ],
              message:
                'Import a sibling module only through its index (e.g. `../audit/index.js`). See docs/architecture.md.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': 'error',
    },
  },
  {
    files: ['**/*.test.ts'],
    rules: {
      // Test bodies read parsed JSON responses; the shape is asserted right after.
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
    },
  },
  prettier,
);
