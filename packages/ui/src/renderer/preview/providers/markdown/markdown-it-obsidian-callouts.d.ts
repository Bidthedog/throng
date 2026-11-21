// The package ships no type declarations. throng uses its default export as a markdown-it plugin and nothing
// else (075 FR-013); `callouts.ts` reads only the token attributes its core rule writes.
declare module 'markdown-it-obsidian-callouts' {
  import type { MarkdownIt } from 'markdown-it';

  export default function mdItObsidianCallouts(md: MarkdownIt, options?: Record<string, unknown>): void;
}
