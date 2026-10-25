const WORDS_PER_MINUTE = 220;

/** Minutes to read a markdown body: words / 220, at least 1. */
export function readingMinutes(body: string | undefined): number {
  if (!body) return 1;
  const text = body
    .replace(/<!--[\s\S]*?-->/g, " ") // source comments
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1") // images: keep alt
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links: keep label
    .replace(/<[^>]+>/g, " ") // inline html
    .replace(/[#>*_`|~-]+/g, " "); // markdown punctuation
  const words = text.match(/[\p{L}\p{N}][\p{L}\p{N}'.,%/]*/gu)?.length ?? 0;
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}
