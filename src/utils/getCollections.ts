import type { CollectionEntry } from "astro:content";
import { COLLECTION_NAMES } from "@/collections";
import { postFilter } from "./postFilter";
import { slugifyStr } from "./slugify";
import { tplStr } from "@/i18n";
import type { UIStrings } from "@/i18n/types";

type Post = CollectionEntry<"posts">;

export type PostCollection = {
  /** Stable key, never shown. */
  key: string;
  /** Displayed title. */
  name: string;
  /** Published posts in reading order (`part`, then date). */
  posts: Post[];
};

/**
 * `series` values that only repeat the post kind. They do not name a
 * collection, so the name comes from `COLLECTION_NAMES` instead.
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
 * Which collection a post is in, from front matter only:
 * 1. `collection: <name>`;
 * 2. else a real `series: <name>`;
 * 3. else, when `series` or `part` is set, the name mapped in
 *    `src/collections.ts` for "<project>:<kind>", falling back to the
 *    project name.
 * A post with none of these is in no collection.
 */
export function collectionOf(
  post: Post
): { key: string; name: string } | undefined {
  const { collection, series, part, kind, project } = post.data;
  const own = collection?.trim() || series?.trim();
  if (own && !GENERIC_SERIES.has(slugifyStr(own))) {
    return { key: `name:${slugifyStr(own)}`, name: own };
  }
  if (series === undefined && part === undefined) return undefined;
  const mapKey = `${project ?? ""}:${kind}`;
  const mapped = COLLECTION_NAMES[mapKey];
  if (mapped) return { key: `name:${slugifyStr(mapped)}`, name: mapped };
  // unmapped: keep kinds apart (their part numbers overlap), titled by project
  return project ? { key: `map:${mapKey}`, name: project } : undefined;
}

function byPart(a: Post, b: Post): number {
  const pa = a.data.part ?? Number.POSITIVE_INFINITY;
  const pb = b.data.part ?? Number.POSITIVE_INFINITY;
  if (pa !== pb) return pa - pb;
  return a.data.pubDatetime.getTime() - b.data.pubDatetime.getTime();
}

/** All collections of published posts, most recently updated first. */
export function getCollections(posts: Post[]): PostCollection[] {
  const groups = new Map<string, { name: string; posts: Post[] }>();
  for (const post of posts.filter(postFilter)) {
    const c = collectionOf(post);
    if (!c) continue;
    const group = groups.get(c.key) ?? { name: c.name, posts: [] };
    group.posts.push(post);
    groups.set(c.key, group);
  }

  const latest = (list: Post[]) =>
    Math.max(
      ...list.map(p => (p.data.modDatetime ?? p.data.pubDatetime).getTime())
    );

  return [...groups.entries()]
    .map(([key, g]) => ({
      key,
      name: g.name,
      posts: [...g.posts].sort(byPart),
    }))
    .sort((a, b) => latest(b.posts) - latest(a.posts));
}

/** The collection holding this post, or undefined. */
export function findCollection(
  post: Post,
  collections: PostCollection[]
): PostCollection | undefined {
  return collections.find(c => c.posts.some(p => p.id === post.id));
}

/**
 * 1-based position of a post in its collection. Positions count published
 * posts, so they stay "1..M" even when `part` numbers have gaps.
 */
export function positionIn(post: Post, collection: PostCollection): number {
  return collection.posts.findIndex(p => p.id === post.id) + 1;
}

/** "Part 2 of 5". */
export function partOfLabel(
  post: Post,
  collection: PostCollection,
  t: UIStrings
): string {
  return tplStr(t.collection.partOf, {
    n: positionIn(post, collection),
    total: collection.posts.length,
  });
}
