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
 * or their project. Rename freely: no URL depends on these names.
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
};

export const COLLECTION_TREE: CollectionNode[] = [
  {
    name: "LLM serving on L4 GPUs",
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
    match: { project: "datamate" },
    children: [
      { name: "The journey", match: { parts: [0, 11] } },
      { name: "System design", match: { parts: [12, 99] } },
    ],
  },
  {
    name: "ott-chat: a chat system on AWS",
    match: { project: "ott-chat" },
    children: [
      { name: "System design", match: { parts: [0, 6] } },
      { name: "Feature flows", match: { parts: [7, 99] } },
    ],
  },
];
