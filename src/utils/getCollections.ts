import type { CollectionEntry } from "astro:content";
import {
  COLLECTION_TREE,
  type CollectionMatch,
  type CollectionNode,
} from "@/collections";
import { postFilter } from "./postFilter";
import { slugifyStr } from "./slugify";
import { tplStr } from "@/i18n";
import type { UIStrings } from "@/i18n/types";

type Post = CollectionEntry<"posts">;

export type PostCollection = {
  /** Stable key, never shown. */
  key: string;
  /** Displayed title (the leaf's name). */
  name: string;
  /** Names from the root down to this leaf, e.g. ["LLM serving", "How we measure"]. */
  path: string[];
  /** Key and name of the root this leaf belongs to. */
  rootKey: string;
  rootName: string;
  /** Sort key of the leaf inside its root, in tree order. */
  order: string;
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

function matches(post: Post, m: CollectionMatch | undefined): boolean {
  if (!m) return true;
  const d = post.data;
  if (m.project !== undefined && d.project !== m.project) return false;
  if (m.kind !== undefined && d.kind !== m.kind) return false;
  if (m.series !== undefined && d.series !== m.series) return false;
  if (m.parts) {
    if (d.part === undefined) return false;
    if (d.part < m.parts[0] || d.part > m.parts[1]) return false;
  }
  return true;
}

/** Deepest matching path of tree nodes (with their sibling index), or []. */
function treePath(
  post: Post,
  nodes: CollectionNode[],
  root = true
): { node: CollectionNode; index: number }[] {
  for (const [index, node] of nodes.entries()) {
    // a root needs a match; a child without one matches everything
    if (root && !node.match) continue;
    if (!matches(post, node.match)) continue;
    return [{ node, index }, ...treePath(post, node.children ?? [], false)];
  }
  return [];
}

type Place = {
  key: string;
  name: string;
  path: string[];
  rootKey: string;
  rootName: string;
  /** Tree order of the leaf inside its root ("" when not from the tree). */
  order: string;
};

/**
 * Which collection a post is in:
 * 1. the deepest node of `COLLECTION_TREE` it matches;
 * 2. else its `collection` or a real `series` name;
 * 3. else, when `series` or `part` is set, its project (kinds kept apart).
 * A post with none of these is in no collection.
 */
export function collectionOf(post: Post): Place | undefined {
  const hits = treePath(post, COLLECTION_TREE);
  if (hits.length > 0) {
    const path = hits.map(h => h.node.name);
    const rootName = path[0];
    return {
      key: `tree:${path.map(slugifyStr).join("/")}`,
      name: path[path.length - 1],
      path,
      rootKey: `tree:${slugifyStr(rootName)}`,
      rootName,
      order: hits
        .slice(1)
        .map(h => String(h.index).padStart(3, "0"))
        .join("."),
    };
  }
  const { collection, series, part, kind, project } = post.data;
  const single = (key: string, name: string): Place => ({
    key,
    name,
    path: [name],
    rootKey: key,
    rootName: name,
    order: "",
  });
  const own = collection?.trim() || series?.trim();
  if (own && !GENERIC_SERIES.has(slugifyStr(own))) {
    return single(`name:${slugifyStr(own)}`, own);
  }
  if (series === undefined && part === undefined) return undefined;
  return project ? single(`map:${project}:${kind}`, project) : undefined;
}

function byPart(a: Post, b: Post): number {
  const pa = a.data.part ?? Number.POSITIVE_INFINITY;
  const pb = b.data.part ?? Number.POSITIVE_INFINITY;
  if (pa !== pb) return pa - pb;
  return a.data.pubDatetime.getTime() - b.data.pubDatetime.getTime();
}

/** All leaf collections of published posts, most recently updated first. */
export function getCollections(posts: Post[]): PostCollection[] {
  const groups = new Map<string, Place & { posts: Post[] }>();
  for (const post of posts.filter(postFilter)) {
    const c = collectionOf(post);
    if (!c) continue;
    const group = groups.get(c.key) ?? { ...c, posts: [] };
    group.posts.push(post);
    groups.set(c.key, group);
  }
  return [...groups.values()]
    .map(g => ({
      key: g.key,
      name: g.name,
      path: g.path,
      rootKey: g.rootKey,
      rootName: g.rootName,
      order: g.order,
      posts: [...g.posts].sort(byPart),
    }))
    .sort((a, b) => latest(b.posts) - latest(a.posts));
}

function latest(list: Post[]): number {
  return Math.max(
    ...list.map(p => (p.data.modDatetime ?? p.data.pubDatetime).getTime())
  );
}

export type CollectionRoot = {
  key: string;
  name: string;
  /** Leaves in tree order; one leaf when the root has no children. */
  leaves: PostCollection[];
  /** A part-0 post ("Start here"), shown first on the card. */
  start?: Post;
  count: number;
};

/** Leaves grouped under their roots, most recently updated root first. */
export function getCollectionRoots(posts: Post[]): CollectionRoot[] {
  const leaves = getCollections(posts);
  const roots = new Map<string, CollectionRoot>();
  for (const leaf of leaves) {
    const root = roots.get(leaf.rootKey) ?? {
      key: leaf.rootKey,
      name: leaf.rootName,
      leaves: [],
      count: 0,
    };
    root.leaves.push(leaf);
    root.count += leaf.posts.length;
    root.start ??= leaf.posts.find(p => p.data.part === 0);
    roots.set(leaf.rootKey, root);
  }
  for (const root of roots.values()) {
    root.leaves.sort((a, b) => a.order.localeCompare(b.order));
  }
  return [...roots.values()].sort(
    (a, b) =>
      latest(b.leaves.flatMap(l => l.posts)) -
      latest(a.leaves.flatMap(l => l.posts))
  );
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
