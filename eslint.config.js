import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  {
    ignores: [
      '**/node_modules/**',
      'client/dist/**',
      'server/data/**',
      '.vercel/**',
      'uploads/**',
    ],
  },
  js.configs.recommended,
  {
    rules: {
      // Matches this codebase's existing convention of underscore-prefixing
      // intentionally-unused args/vars (e.g. _next, _id, _createdAt).
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    files: ['server/**/*.js', 'api/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },
  {
    // Abstract base class: named params document the adapter contract but are
    // intentionally unused in every method (each throws 'Not implemented').
    files: ['server/services/ai/providerInterface.js'],
    rules: {
      'no-unused-vars': ['error', { args: 'none' }],
    },
  },
  {
    files: ['client/public/sw.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.serviceworker },
    },
  },
  {
    files: ['client/**/*.{js,jsx}'],
    ignores: ['client/public/sw.js'],
    plugins: { react, 'react-hooks': reactHooks },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser },
    },
    settings: { react: { version: 'detect' } },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
    },
  },
  {
    files: ['shared/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['*/client/*', '*/server/*', '../client/*', '../server/*'],
              message:
                'shared/ is a one-way dependency: it must never import from client/ or server/.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.config.js', '**/vite.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },
];
