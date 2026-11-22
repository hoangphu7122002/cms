import type { ImageMetadata } from "astro";

// lazy: only the covers a page asks for are imported and optimised
const figures = import.meta.glob<{ default: ImageMetadata }>(
  "/src/content/posts/*/figures/*.{png,jpg,jpeg,webp}"
);

/**
 * The image behind a collection `cover` path (relative to src/content/posts),
 * or undefined when the path is unset or the file is missing.
 */
export async function getCover(
  path: string | undefined
): Promise<ImageMetadata | undefined> {
  if (!path) return undefined;
  const load = figures[`/src/content/posts/${path}`];
  return load ? (await load()).default : undefined;
}
