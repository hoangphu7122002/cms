/**
 * The collection tree: root -> leaf -> sub-leaf.
 *
 * A root is usually one project. Its children split the project's posts into
 * named groups (by kind, series or a part range), and a child may have
 * children of its own. A post lands in the deepest node whose `match` it
 * passes; every field in `match` must hold, and a child is only tried when its
 * parent matched. That node is the post's reading collection (prev/next, "part
 * N of M"); the home page shows each root as one card with its groups.
 *
 * Posts that match no root fall back to their own `collection`/`series` name
 * or their project. Rename freely: no post URL depends on these names. A
 * root's `slug` (default: its slugified name) is the URL of its collection
 * page, /collections/<slug>/.
 */
export type CollectionMatch = {
  project?: string;
  kind?: string;
  series?: string;
  /** Inclusive range of `part` numbers. */
  parts?: [number, number];
};

export type CollectionNode = {
  name: string;
  match?: CollectionMatch;
  children?: CollectionNode[];
  /** Roots only: URL segment of the collection page. */
  slug?: string;
  /** Roots only: short name for chips, e.g. "DataMate". */
  short?: string;
  /** Roots only: one line on what the collection is. */
  description?: string;
  /** Roots only: cover image, a path under src/content/posts. */
  cover?: string;
};

export const COLLECTION_TREE: CollectionNode[] = [
  {
    name: "LLM serving on L4 GPUs",
    slug: "llm-serving-bench",
    short: "LLM serving",
    description:
      "How many users one to four 24 GB L4 GPUs can serve, measured engine by engine, with the limits of each number.",
    cover: "llm-serving-bench/figures/20_headline_capacity.png",
    match: { project: "llm-serving-bench" },
    children: [
      { name: "The series", match: { kind: "series" } },
      { name: "How LLM serving works", match: { kind: "concept" } },
      { name: "Notes from the bench", match: { kind: "fieldnote" } },
      { name: "How we measure", match: { kind: "method" } },
    ],
  },
  {
    name: "DataMate: table QA in 15 days",
    slug: "datamate",
    short: "DataMate",
    description:
      "One 9B model answering questions over messy shop spreadsheets, from -0.487 to 0.942 in 15 days, and the system behind it.",
    cover: "datamate/figures/12_arch_overview.png",
    match: { project: "datamate" },
    children: [
      { name: "The journey", match: { parts: [0, 11] } },
      { name: "System design", match: { parts: [12, 99] } },
    ],
  },
  {
    name: "ott-chat: a chat system on AWS",
    slug: "ott-chat",
    short: "ott-chat",
    match: { project: "ott-chat" },
    children: [
      { name: "System design", match: { parts: [0, 6] } },
      { name: "Feature flows", match: { parts: [7, 99] } },
    ],
  },
];
