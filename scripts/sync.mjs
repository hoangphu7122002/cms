// Copy approved posts from the project repositories listed in manifest.json into src/content/posts/<project>/.
// A post is copied only if its front matter has `status: approved` and every field the hub schema needs.
// Usage: node scripts/sync.mjs [--dry]
import { readFileSync, readdirSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { cpSync } from "node:fs";

const KINDS = ["series", "concept", "fieldnote", "method"];
const REQUIRED = ["title", "description", "pubDatetime", "kind"];
const dry = process.argv.includes("--dry");
const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));

function frontMatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) return null;
  const fm = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([A-Za-z]+):\s*(.*)$/);
    if (kv) fm[kv[1]] = kv[2].replace(/^["']|["']$/g, "");
  }
  return fm;
}

// Checker markers (src, calc) are for the project repo's lessons_check.py; readers never see them.
const strip = text => text.replace(/[ \t]*<!--\s*(?:(?:src|calc):|runs \(stripped on sync\):)[\s\S]*?-->/g, "").replace(/[ \t]+$/gm, "");
// A post refers to figures/NAME.png; Astro wants a relative path starting with ./ to bundle the image.
const localImages = text => text.replace(/(!\[[^\]]*\]\()(?!\.{0,2}\/|https?:|\/)(figures\/)/g, "$1./$2");

let copied = 0;
let skipped = 0;
for (const src of manifest.sources) {
  const dir = resolve(root, src.path);
  if (!existsSync(dir)) {
    console.error(`skip ${src.project}: ${dir} not found`);
    continue;
  }
  for (const name of readdirSync(dir).filter(f => /^\d.*\.md$/.test(f))) {
    const text = readFileSync(join(dir, name), "utf8");
    const fm = frontMatter(text);
    if (!fm || fm.status !== "approved") {
      skipped++;
      continue;
    }
    const missing = REQUIRED.filter(k => !fm[k]);
    if (missing.length || !KINDS.includes(fm.kind)) {
      console.error(`reject ${src.project}/${name}: missing ${missing.join(", ") || "valid kind"}`);
      process.exitCode = 1;
      continue;
    }
    const out = join(root, "src/content/posts", src.project);
    if (!dry) {
      mkdirSync(out, { recursive: true });
      const hasProject = /^project:/m.test(fm.__raw ?? text.split("\n---\n")[0]);
      const body = localImages(strip(text)).replace(/^status:.*\n/m, hasProject ? "" : `project: ${src.project}\n`);
      writeFileSync(join(out, name), body);
      if (existsSync(join(dir, "figures"))) {
        cpSync(join(dir, "figures"), join(out, "figures"), { recursive: true, filter: f => !f.endsWith(".py") });
      }
    }
    copied++;
    console.log(`${dry ? "would copy" : "copied"} ${src.project}/${name}`);
  }
}
console.log(`${copied} copied, ${skipped} not approved`);
