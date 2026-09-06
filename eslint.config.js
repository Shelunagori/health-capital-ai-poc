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
              group: ['../*/*', '!../*/index', '!../*/index.js'],
              message:
                'Import other modules only through their index (e.g. `../audit/index.js`). See docs/architecture.md.',
            },
            {
              group: ['**/modules/*/*', '!**/modules/*/index', '!**/modules/*/index.js'],
              message: 'Import other modules only through their index.',
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
