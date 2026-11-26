"""README flow figure (AWS-diagram style).  python docs/assets/make_figures.py   (needs Google Chrome)
Facts: README How it works, manifest.json, scripts/sync.mjs, .github/workflows/deploy.yml, terraform/dns."""
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from awsfig import GREY, INK, PURPLE, Fig  # noqa: E402

c = Fig(1640, 680, HERE / "icons")
c.title("cms: approved lessons to the blog", "projects keep their lessons; this repo syncs, builds and publishes them")

c.group(20, 110, 360, 390, "Source project repo", stroke=GREY, dash="6,4", icon="onprem/vcs/git")
c.group(390, 110, 940, 540, "This repo (local or CI)", stroke=INK, icon="programming/language/nodejs")
c.group(970, 110, 1620, 390, "GitHub Actions: deploy.yml, push to main", stroke="#78909c", dash="6,4", icon="onprem/ci/github-actions")

c.node(190, 250, "generic/storage/storage", "docs/lessons/*.md", ["only status: approved"], size=48)
c.node(470, 250, "programming/language/nodejs", "scripts/sync.mjs", ["copies approved posts"], size=48)
c.node(760, 250, "generic/storage/storage", "src/content/posts/", ["one folder per project"], size=48)
c.node(1080, 250, "programming/framework/vue", "astro check + build", ["Astro 7, MDX, Tailwind 4", "+ pagefind index"], size=48)
c.node(1330, 250, "generic/storage/storage", "dist/", ["static site"], size=48)
c.node(1540, 250, "onprem/network/internet", "GitHub Pages", ["blog.phufamily.com"], size=48)

c.arrow([(225, 250), (435, 250)])
c.plate(330, 240, "sync", 14)
c.step(330, 205, 1)
c.arrow([(505, 250), (725, 250)])
c.step(615, 205, 2)
c.arrow([(795, 250), (1045, 250)])
c.step(920, 205, 3)
c.arrow([(1115, 250), (1295, 250)])
c.step(1205, 205, 4)
c.arrow([(1365, 250), (1505, 250)])
c.step(1435, 205, 5)

# manifest note
c.node(470, 450, "generic/storage/storage", "manifest.json", ["list of source repos", "path + note per source"], size=48)
c.arrow([(470, 410), (470, 324)], color=PURPLE, dash="8,5")
c.plate(555, 340, "reads sources", 14)

c.legend_steps(40, 590, [
    "Lessons marked status: approved in the project repo",
    "sync.mjs copies them into src/content/posts/PROJECT/",
    "Astro reads the collection tree (src/collections.ts)",
    "astro check, astro build, then the pagefind search index",
    "The built dist/ is published to GitHub Pages",
], cols=2, colw=620, lh=22)
c.legend_arrows(1330, 575, [("flow", INK, ""), ("config read", PURPLE, "8,5")], lh=22)
c.save(HERE / "flow")
