import tsParser from '@typescript-eslint/parser';

export default [
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/lib/scanning/providers/scandit/**'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@scandit/*'],
              message:
                'Domain 6 and shared PWA code may not import Scandit directly. Use provider-neutral scanning contracts.',
            },
          ],
        },
      ],
    },
  },
];
