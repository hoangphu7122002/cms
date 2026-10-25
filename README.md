# cms

A static blog hub for series, concepts, field notes and methods, built from the AstroPaper theme (Astro, Tailwind, Pagefind search). Live at https://blog.phufamily.com/ (not indexed by search engines until `PUBLIC_INDEXABLE` is set to `"true"` in `.github/workflows/deploy.yml`).

## Four kinds of posts

`kind` in the front matter is one of `series` (ordered story of one project, with `series` and `part`), `concept` (project-independent explainer), `fieldnote` (one wrong turn, about 1,000 words), `method` (how we work). `project` names the source repository.

## Where posts live

Posts are written next to the code and results they describe, in each project repository under `docs/lessons/`. This repository only holds posts that were reviewed and approved. `manifest.json` lists the sources; `node scripts/sync.mjs` copies the files whose front matter has `status: approved` into `src/content/posts/<project>/`.

Adding another project is one entry in `manifest.json`.

## Local use

```bash
pnpm install
pnpm dev          # http://localhost:4321/
pnpm build        # type check, build, search index
node scripts/sync.mjs --dry
```

Pushing to `main` deploys through GitHub Pages (`.github/workflows/deploy.yml`).

The theme is AstroPaper by Sat Naing (MIT). Its update path stays open: `git remote add upstream https://github.com/satnaing/astro-paper`.
