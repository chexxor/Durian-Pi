// tools/extract-pi-src.mjs — recover pi's ORIGINAL TypeScript from an installed package's `.js.map` sourcesContent.
//
// PROVENANCE (ROADMAP 233 instrument hygiene, operator GRANT 4, 2026-10-29). Promoted from the delegate scratch
// script `.spike/extract-pi-src.mjs`, which docs/reviews/harness-tools-skills-research.md:273 cited with the note
// "was `.spike/extract-pi-src.mjs`, gitignored on purpose; if this becomes an instrument it needs a queue item, per
// 233". It is now a tracked, cited delegate instrument instead of a file that vanishes on a sweep; behaviour is
// unchanged apart from this header. If the team ever takes it over (ROADMAP 233/262), move it and amend the cites.
//
// WHY. durian-pi pins pi at a commit and vendors the build (`vendor/pi-main/`, gitignored; `pi-main.pin.json` is the
// truth). Research notes that quote pi line numbers must quote the ORIGINAL `.ts` lines, not compiled `.js` lines —
// `node_modules/@earendil-works/*` ships `.js` plus a source map carrying `sourcesContent`, which is the only place
// the pinned commit's TypeScript exists on a box that did not run `scripts/sync-pi.mjs --sync`.
//
// It WRITES: it extracts `<pkg-dir>`'s embedded sources into `<out-dir>` (choose a scratch path — never the repo root).
//
// Usage: node tools/extract-pi-src.mjs <pkg-dir> <out-dir>
//   e.g. node tools/extract-pi-src.mjs node_modules/@earendil-works/pi-durable .spike/pi-src
import fs from "node:fs";
import path from "node:path";

const [pkgDir, outDir] = process.argv.slice(2);
if (!pkgDir || !outDir) {
  console.error("usage: node tools/extract-pi-src.mjs <pkg-dir> <out-dir>");
  process.exit(2);
}
let files = 0;
let skipped = 0;
const seen = new Set();

function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "bundle" || e.name === "node_modules") continue;
      walk(p);
    } else if (e.name.endsWith(".js.map")) {
      let map;
      try {
        map = JSON.parse(fs.readFileSync(p, "utf8"));
      } catch {
        skipped++;
        continue;
      }
      if (!map.sourcesContent) {
        skipped++;
        continue;
      }
      for (let i = 0; i < map.sources.length; i++) {
        const src = map.sources[i];
        const body = map.sourcesContent[i];
        if (!src || !body) continue;
        const rel = src.replace(/^(\.\.\/)+/, "");
        const dst = path.join(outDir, rel);
        if (seen.has(rel)) continue;
        seen.add(rel);
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.writeFileSync(dst, body);
        files++;
      }
    }
  }
}

fs.mkdirSync(outDir, { recursive: true });
walk(pkgDir);
console.log(`extracted ${files} source file(s) to ${outDir} (${skipped} map(s) without embedded sources)`);
