/**
 * Collection names for posts that do not name their collection themselves.
 *
 * A collection is a named, ordered group of posts. A post names it with the
 * optional `collection` front matter field (or a real `series` name). Synced
 * posts that only carry a generic series value ("series", "concepts",
 * "field notes") are named here instead, keyed by "<project>:<kind>", so
 * nothing in the synced files has to change. Rename freely: only the
 * displayed title changes, no URL depends on it.
 */
export const COLLECTION_NAMES: Record<string, string> = {
  "llm-serving-bench:series": "LLM serving on one GPU",
  "llm-serving-bench:concept": "How LLM serving works",
  "llm-serving-bench:fieldnote": "Notes from the bench",
  "llm-serving-bench:method": "How we measure",
};
