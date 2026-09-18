// US1 scenario 2 and US3 scenario 2 resolve `packages/core/x.ts` and `src/x.ts` here.
// `src/x.ts` resolves here only when the base directory is `<root>/packages/core`,
// which is US1 scenario 8's base-directory-before-project-root rule (R5).
export const x = 'x';
