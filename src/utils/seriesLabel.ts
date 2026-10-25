import { slugifyStr } from "./slugify";

/**
 * Series values that only repeat the post kind ("series", "concepts",
 * "field notes", ...). Showing them next to the kind badge adds nothing.
 */
const GENERIC_SERIES = new Set([
  "series",
  "concept",
  "concepts",
  "fieldnote",
  "fieldnotes",
  "field-note",
  "field-notes",
  "method",
  "methods",
]);

/**
 * Label to show for a post's series on cards, or undefined when the post has
 * no series or the series name is a generic kind name.
 */
export function seriesLabel(series: string | undefined): string | undefined {
  const name = series?.trim();
  if (!name || GENERIC_SERIES.has(slugifyStr(name))) return undefined;
  return name;
}
