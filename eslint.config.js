import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.wrangler/**',
      '**/coverage/**',
      '**/*.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Hooks bugs — a stale dependency array, a hook called conditionally — compile and
    // pass tests yet misbehave at runtime. Only this plugin catches them.
    files: ['apps/web/**/*.{ts,tsx}'],
    ...reactHooks.configs.flat['recommended-latest'],
  },
  {
    // domain.ts is bundled into the browser through the web app's @api/domain alias. Any
    // import here would drag server code into the client, so the file must stay import-free.
    files: ['apps/api/src/domain.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...['ImportDeclaration', 'ExportNamedDeclaration[source]', 'ExportAllDeclaration'].map(
          (selector) => ({
            selector,
            message: 'domain.ts is bundled into the browser and must not import anything.',
          }),
        ),
      ],
    },
  },
  {
    rules: {
      // The project forbids `any` outright — every boundary gets an explicit type.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
);
