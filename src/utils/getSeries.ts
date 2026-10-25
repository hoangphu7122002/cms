import type { CollectionEntry } from "astro:content";
import { postFilter } from "./postFilter";
import { seriesLabel } from "./seriesLabel";
import { slugifyStr } from "./slugify";
import { tplStr } from "@/i18n";
import type { UIStrings } from "@/i18n/types";

type Post = CollectionEntry<"posts">;
type Kind = Post["data"]["kind"];

export type SeriesGroup = {
  /** Stable key: project + series name, or project + kind when the name is generic. */
  key: string;
  /** Real series name from front matter, or undefined when it only repeats the kind. */
  name: string | undefined;
  kind: Kind;
  project: string | undefined;
  /** Published posts, ordered by `part` (posts without one go last, by date). */
  posts: Post[];
  /** True when the parts are exactly 1..posts.length, so "part N of M" is honest. */
  contiguous: boolean;
};

/**
 * A post joins a series group when it sets `series` or `part`. The group is
 * project + series name; generic names ("series", "concepts", "field notes")
 * fall back to project + kind, so each kind of one project is one reading
 * order. No schema change: works on today's front matter and on real names.
 */
function groupKey(post: Post): string | undefined {
  const { series, part, kind, project } = post.data;
  if (series === undefined && part === undefined) return undefined;
  const name = seriesLabel(series);
  const scope = name ? `series:${slugifyStr(name)}` : `kind:${kind}`;
  return `${project ?? ""}::${scope}`;
}

function byPart(a: Post, b: Post): number {
  const pa = a.data.part ?? Number.POSITIVE_INFINITY;
  const pb = b.data.part ?? Number.POSITIVE_INFINITY;
  if (pa !== pb) return pa - pb;
  return a.data.pubDatetime.getTime() - b.data.pubDatetime.getTime();
}

/** All series groups of published posts, newest-updated group first. */
export function getSeriesGroups(posts: Post[]): SeriesGroup[] {
  const groups = new Map<string, Post[]>();
  for (const post of posts.filter(postFilter)) {
    const key = groupKey(post);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), post]);
  }

  const latest = (g: Post[]) =>
    Math.max(
      ...g.map(p => (p.data.modDatetime ?? p.data.pubDatetime).getTime())
    );

  return [...groups.entries()]
    .map(([key, list]) => {
      const sorted = [...list].sort(byPart);
      const first = sorted[0].data;
      return {
        key,
        name: seriesLabel(first.series),
        kind: first.kind,
        project: first.project,
        posts: sorted,
        contiguous: sorted.every((p, i) => p.data.part === i + 1),
      };
    })
    .sort((a, b) => latest(b.posts) - latest(a.posts));
}

/** Title for a group: its own name, or the plural kind ("Field notes"). */
export function seriesTitle(group: SeriesGroup, t: UIStrings): string {
  return group.name ?? t.kindsPlural[group.kind];
}

/** "Part 2 of 5" when parts run 1..M, else "Part 3, 1 published so far". */
export function partOfLabel(
  post: Post,
  group: SeriesGroup,
  t: UIStrings
): string {
  const index = group.posts.findIndex(p => p.id === post.id);
  const n = post.data.part ?? index + 1;
  return group.contiguous
    ? tplStr(t.series.partOf, { n, total: group.posts.length })
    : tplStr(t.series.partPublished, { n, count: group.posts.length });
}
