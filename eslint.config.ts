import { defineConfig } from 'eslint/config';
import js from '@eslint/js';
import exadev from '@exadev/eslint-config';

export default defineConfig(
  { ignores: ['dist', 'coverage', 'node_modules', 'reports', 'test-results', 'playwright-report'] },
  {
    languageOptions: {
      parserOptions: { project: ['./tsconfig.json', './site/tsconfig.json', './site/tsconfig.worker.json', './e2e/tsconfig.json'], tsconfigRootDir: import.meta.dirname },
    },
  },
  { ...js.configs.recommended, files: ['**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}'] },
  ...exadev,
);
