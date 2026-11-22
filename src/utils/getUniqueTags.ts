import type { CollectionEntry } from "astro:content";
import { TAG_GROUPS, TAG_REGISTRY, type TagGroup, type TagId } from "@/tags";
import { postFilter } from "./postFilter";

export type TagInfo = {
  /** Registry id, also the URL segment. */
  tag: TagId;
  tagName: string;
  group: TagGroup;
  description: string;
  count: number;
};

/**
 * Tags used by published posts, read from the registry (src/tags.ts).
 * Unused registry tags are left out. Sorted by group, then post count.
 */
export function getUniqueTags(posts: CollectionEntry<"posts">[]): TagInfo[] {
  const counts = new Map<TagId, number>();
  for (const post of posts.filter(postFilter)) {
    for (const id of post.data.tags) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([tag, count]) => {
      const meta = TAG_REGISTRY[tag];
      return {
        tag,
        tagName: meta.name,
        group: meta.group,
        description: meta.description,
        count,
      };
    })
    .sort(
      (a, b) =>
        TAG_GROUPS.indexOf(a.group) - TAG_GROUPS.indexOf(b.group) ||
        b.count - a.count ||
        a.tagName.localeCompare(b.tagName)
    );
}

/** Display name of a tag id. */
export const tagName = (id: TagId) => TAG_REGISTRY[id].name;
