/**
 * Small rehype plugins that shape post bodies for reading:
 * figures with captions, scrollable tables, and Key results / Limits callouts.
 * They run after Shiki and before Astro's image and heading-id passes.
 */

type Props = Record<string, unknown>;
type HNode = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Props;
  children?: HNode[];
};

const el = (tagName: string, properties: Props, children: HNode[]): HNode => ({
  type: "element",
  tagName,
  properties,
  children,
});

const isEl = (node: HNode | undefined, tag?: string): node is HNode =>
  node?.type === "element" && (tag === undefined || node.tagName === tag);

const classes = (node: HNode) =>
  (node.properties?.className as string[] | undefined) ?? [];

const isBlank = (node: HNode) =>
  node.type === "text" && (node.value ?? "").trim() === "";

const meaningful = (nodes: HNode[] = []) =>
  nodes.filter(n => !isBlank(n) && n.type !== "comment" && n.type !== "raw");

const textOf = (node: HNode): string =>
  node.type === "text"
    ? (node.value ?? "")
    : (node.children ?? []).map(textOf).join("");

/** Index of the next sibling that is not blank text, or -1. */
function nextIndex(children: HNode[], from: number) {
  for (let i = from + 1; i < children.length; i++) {
    if (!isBlank(children[i])) return i;
  }
  return -1;
}

/** Calls fn on every node that has children (parents first). */
function walk(node: HNode, fn: (parent: HNode) => void) {
  if (!node.children) return;
  fn(node);
  for (const child of node.children) walk(child, fn);
}

/** `<em>` text when a paragraph holds only one emphasis, else null. */
function captionOf(node: HNode | undefined): HNode[] | null {
  if (!isEl(node, "p")) return null;
  const kids = meaningful(node.children);
  if (kids.length !== 1 || !isEl(kids[0], "em")) return null;
  return kids[0].children ?? [];
}

/**
 * `![alt](src)` alone in a paragraph, followed by a paragraph that is only
 * `*Caption*`, becomes `<figure><img><figcaption>`. A code block (ASCII
 * diagram) followed by `*Figure N. ...*` gets the same treatment.
 */
export function rehypeFigureCaptions() {
  return (tree: HNode) => {
    walk(tree, parent => {
      const kids = parent.children!;
      for (let i = 0; i < kids.length; i++) {
        const node = kids[i];
        let body: HNode | null = null;
        if (isEl(node, "p")) {
          const inner = meaningful(node.children);
          if (inner.length === 1 && isEl(inner[0], "img")) body = inner[0];
        } else if (isEl(node, "pre")) {
          body = node;
        }
        if (!body) continue;

        const j = nextIndex(kids, i);
        const caption = j === -1 ? null : captionOf(kids[j]);
        const isFigureText = caption && /^\s*figure\b/i.test(textOf(kids[j]));
        if (!caption || (body.tagName === "pre" && !isFigureText)) continue;

        const kind = body.tagName === "pre" ? "figure-code" : "figure-image";
        kids.splice(
          i,
          j - i + 1,
          el("figure", { className: ["post-figure", kind] }, [
            body,
            el("figcaption", {}, caption),
          ])
        );
      }
    });
  };
}

const NUMERIC =
  /^[~≈<>≤≥+\-−]?\s*\d[\d\s.,]*(\s*(±|\/|x|×|-|–)\s*\d[\d\s.,]*)*\s*(%|[a-zA-Zµ]{1,4})?$/;

/** Marks columns whose body cells are all numbers so they align right. */
function markNumericColumns(table: HNode) {
  const rows: HNode[] = [];
  walk(table, parent => {
    for (const child of parent.children ?? []) {
      if (isEl(child, "tr")) rows.push(child);
    }
  });
  const cellsOf = (row: HNode) =>
    (row.children ?? []).filter(c => isEl(c, "td") || isEl(c, "th"));
  const bodyRows = rows.filter(r => cellsOf(r).some(c => c.tagName === "td"));
  if (bodyRows.length === 0) return;

  const width = Math.max(...rows.map(r => cellsOf(r).length));
  for (let col = 1; col < width; col++) {
    const values = bodyRows
      .map(r => cellsOf(r)[col])
      .filter(Boolean)
      .map(c => textOf(c).trim())
      .filter(v => v !== "" && v !== "-" && v !== "–");
    if (values.length === 0 || !values.every(v => NUMERIC.test(v))) continue;
    for (const row of rows) {
      const cell = cellsOf(row)[col];
      if (!cell || cell.properties?.align) continue;
      cell.properties = {
        ...cell.properties,
        className: [...classes(cell), "num"],
      };
    }
  }
}

/** Wraps each table in a focusable horizontal scroll container. */
export function rehypeTableScroll() {
  return (tree: HNode) => {
    walk(tree, parent => {
      if (classes(parent).includes("table-scroll")) return;
      const kids = parent.children!;
      for (let i = 0; i < kids.length; i++) {
        const node = kids[i];
        if (!isEl(node, "table")) continue;
        markNumericColumns(node);
        kids[i] = el(
          "div",
          {
            className: ["table-scroll"],
            role: "region",
            ariaLabel: "Table, scroll sideways",
            tabIndex: 0,
          },
          [node]
        );
      }
    });
  };
}

const CALLOUTS: Record<string, string> = {
  "key results": "callout-key",
  "key result": "callout-key",
  limits: "callout-limits",
  limitations: "callout-limits",
};

/** "7. Limits" or "Key results:" -> callout class, else undefined. */
function calloutClass(text: string) {
  const name = text
    .trim()
    .replace(/^\d+(\.\d+)*\.?\s+/, "")
    .replace(/[:.]$/, "")
    .toLowerCase();
  return CALLOUTS[name];
}

/**
 * A `## Key results` or `## Limits` section (numbered or not) is wrapped,
 * with everything up to the next h1/h2, in `<section class="callout">`.
 * A blockquote that opens with **Key results** or **Limits** gets the
 * same classes.
 */
export function rehypeSectionCallouts() {
  return (tree: HNode) => {
    walk(tree, parent => {
      const kids = parent.children!;
      const inCallout = classes(parent).includes("callout-box");
      for (let i = 0; i < kids.length; i++) {
        const node = kids[i];

        if (isEl(node, "blockquote")) {
          const first = meaningful(node.children)[0];
          const lead = isEl(first, "p") ? meaningful(first.children)[0] : null;
          const cls = isEl(lead ?? undefined, "strong")
            ? calloutClass(textOf(lead!))
            : undefined;
          if (cls) {
            node.properties = {
              ...node.properties,
              className: [...classes(node), "callout-box", cls],
            };
          }
          continue;
        }

        if (inCallout || !isEl(node, "h2")) continue;
        const cls = calloutClass(textOf(node));
        if (!cls) continue;
        let end = i + 1;
        while (
          end < kids.length &&
          !isEl(kids[end], "h2") &&
          !isEl(kids[end], "h1")
        )
          end++;
        const section = el(
          "section",
          { className: ["callout-box", cls] },
          kids.slice(i, end)
        );
        kids.splice(i, end - i, section);
      }
    });
  };
}
