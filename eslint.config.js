import js from '@eslint/js'
import tsPlugin from '@typescript-eslint/eslint-plugin'
import tsParser from '@typescript-eslint/parser'
import prettierConfig from 'eslint-config-prettier'
import globals from 'globals'

export default [
  {
    ignores: [
      'dist/**',
      'pkg/**',
      'node_modules/**',
      'test-results/**',
      'examples/**'
    ]
  },
  js.configs.recommended,
  {
    files: ['**/*.js', '**/*.jsx', '**/*.ts', '**/*.tsx', '**/*.mjs'],
    languageOptions: {
      parser: tsParser,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.browser
      }
    },
    plugins: {
      '@typescript-eslint': tsPlugin
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'no-redeclare': 'off',
      // TypeScript handles undefined references better than ESLint can with raw globals.
      'no-undef': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_'
        }
      ],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-this-alias': 'off'
    }
  },
  {
    // Lock implementation and the debug base class legitimately use
    // console.log behind a debug flag.
    files: ['src/lock/locks.ts', 'src/BaseLog.ts'],
    rules: {
      'no-console': 'off'
    }
  },
  {
    // Node CLI helpers; console.log is the intended output channel.
    files: ['tests/pack/**'],
    rules: {
      'no-console': 'off'
    }
  },
  prettierConfig
]
