import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

// Lint for the eval + red-team harness. Kept separate from the root config
// (root ignores evals/) because this package has its own toolchain and Node
// globals. Loose on purpose — this is test infrastructure, not shipped code.
export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  { ignores: ['node_modules/', 'src/contract/__toolsnaps__/'] },
);
