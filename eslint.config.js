import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist', 'node_modules'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    // Architecture rule: the engine is pure TypeScript. No React, no DOM, no wall clock.
    files: ['src/engine/**/*.ts'],
    languageOptions: { globals: {} },
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: ['react', 'react-dom', 'react/*', 'zustand', 'zustand/*', '../render/*', '../input/*', '../store'] },
      ],
      'no-restricted-globals': ['error', 'window', 'document', 'performance', 'requestAnimationFrame'],
      'no-restricted-properties': ['error', { object: 'Date', property: 'now' }],
    },
  },
)
