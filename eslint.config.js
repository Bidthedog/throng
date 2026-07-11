// Flat ESLint config for the throng monorepo.
//
// Scope: static analysis (correctness/style) on TypeScript source across every
// workspace. Type-checking proper is still `tsc -b` (the build); this layer adds
// the lint rules TypeScript itself does not enforce. Kept non-type-checked for
// speed and so it runs without a prior build (matching the source-alias test
// setup in vitest.config.ts).
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  // Never lint build output, deps, reports, or generated scratch.
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/node_modules/**',
      'coverage/**',
      'test-results/**',
      'playwright-report/**',
      'packages/ui/dist/**',
      // Claude Code scratch: leftover git worktrees (`.claude/worktrees/`) and
      // local settings are not part of the tracked source tree (see .gitignore).
      '.claude/**',
      '.remember/**',
      // Spec Kit machinery (constitution, specs, bridge snapshots, templates) —
      // not application source; never lint it.
      '.specify/**',
      // Config/scripts are plain .mjs/.js — linted with a Node profile below,
      // but keep vendored or generated assets out entirely.
      '**/*.d.ts',
    ],
  },

  // Base JS + TypeScript recommended rules for all TS source.
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // TypeScript sources across the workspaces.
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      // TypeScript already reports use of undefined identifiers (and does it
      // with full type/global awareness); core `no-undef` only produces false
      // positives on TS types, ambient globals, and `NodeJS.*`. Off, per the
      // typescript-eslint project's own guidance.
      'no-undef': 'off',
      // Inversify (@injectable/@inject) and decorator metadata legitimately use
      // parameter properties and empty-ish constructors; keep these pragmatic.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
    },
  },

  // Terminal emulator code legitimately matches ANSI/VT control characters
  // (e.g. ESC `\x1b`) in regexes — that is the job, not a mistake.
  {
    files: ['packages/ui/src/renderer/terminal/**/*.{ts,tsx}'],
    rules: { 'no-control-regex': 'off' },
  },

  // React renderer: hooks correctness rules. `exhaustive-deps` is advisory
  // (surfaced as a warning, does not fail CI) — the rules-of-hooks check that
  // catches genuine bugs stays an error.
  {
    files: ['packages/ui/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-hooks/exhaustive-deps': 'warn',
    },
  },

  // Test files: relax rules that fight normal test ergonomics.
  {
    files: ['**/tests/**/*.{ts,tsx}', '**/*.test.ts', '**/*.e2e.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  // Plain JS tooling / fixtures (ESM/CJS) anywhere — build scripts, test
  // fixtures (*.mjs), root config files. These run under Node, so give them the
  // Node global set (TypeScript's checker doesn't cover them).
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
);
