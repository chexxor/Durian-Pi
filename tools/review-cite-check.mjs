// tools/review-cite-check.mjs — ROADMAP 250 (plus the cheap halves of 244 and 243): citation keys are a
// namespace nobody owns, and a cited path or size is a claim nobody re-measures.
//
// Why this exists (measured, not inferred):
//   * `docs/reviews/harness-tools-skills-public-harnesses-research.md` — the report `docs/ROADMAP.md` cites —
//     uses **184 marker occurrences over 23 distinct base keys** and DEFINES only 14 of them, so 9
//     load-bearing keys (`542f21 b736c3 20106b d32e06 04a0b7 5389e9 3d9c8f 5f6188 dccefb`) resolve to no
//     URL from inside the file (ROADMAP 250).
//   * Round 4's "repair" re-uses `[^1]` for **skills** and `[^2]` for **Cursor rules**, while round 2 defines
//     `[^1]`=hooks and `[^2]`=skills. Pasting it silently re-points citations ROADMAP already relies on.
//     That is a KEY COLLISION, and it is only visible if keys are compared across files.
//   * `docs/reviews/codex-permission-model-and-guard-plane-2026-10-28.md` published "1,457 lines" for
//     `permissions_toml.rs`; the file is **680** lines at the pin. A human re-measured it (244).
//   * `docs/incidents/2026-10-29-windows-vm-suite-self-sweep.md` was cited in prose and has never existed in
//     any branch (`git log --all` empty) — a phantom citation (244, since withdrawn as a chase, but the CLASS
//     is what needs an instrument: rot and fabrication need different verdicts).
//   * Three Goose vendor-site paths in the report are **404** (243): "a dead URL in an evidence table is worse
//     than no URL, because it reads as evidence".
//   * The check that found the first three bullets was hand-written into gitignored `.spike/` and is GONE
//     (ROADMAP 233 happening to the delegate). This file is that check, in git, so the next session runs one
//     command instead of re-deriving ~25 lines and trusting a number in a paragraph.
//
// What it checks (every count prints the PATTERN behind it — D142: a count with no pattern is not evidence):
//   1. FOOTNOTE INTEGRITY (per file): `[^key]` usages vs `[^key]:` definitions. A usage with no definition in
//      the SAME file is DANGLING (hard). A definition never used is unused (soft). Two definitions of one key
//      in one file is a duplicate (hard). `[^key#123]` splits key from anchor, because a `#line` is NOT an
//      address (measured in `docs/reviews/harness-r4-verification-2026-10-29.md` §4: line ranges do not
//      survive a re-fetch).
//   2. KEY NAMESPACE COLLISIONS (across files): the same key DEFINED in two files with different targets.
//      Hard unless the registry (below) declares them the same page (then a registered alias, soft).
//   3. REGISTRY INTEGRITY: an optional machine-readable citation registry (`docs/reviews/*-registry*.md` with
//      a `| key |` table) gives the canonical namespace: `key`, `type`, `target`, `defined_in`, `alias_of`,
//      `evidence`. An alias whose mapping evidence is `inferred` is reported as NEEDS-URL — an inferred
//      mapping must not be pasted until a URL line proves it (250 *Do not*).
//   4. CITED PATHS resolve: `path.ext`, `path.ext:LINE[-LINE]`, `vendor/eval/<clone>/path`, and bare
//      `file.ext:LINE` resolved against the pins the file declares. Three verdicts, deliberately different:
//        OWN-REPO tracked at HEAD            → PASS
//        OWN-REPO absent but added in history → MOVED/DELETED (soft, it may be legitimate)
//        OWN-REPO absent from every branch    → NEVER EXISTED (hard — 244's phantom class)
//        VENDOR  resolved in the clone at HEAD → PASS, and the DECLARED PIN is compared with the clone's
//                                                 real HEAD: PIN DRIFT is hard, because reading a moved clone
//                                                 silently invalidates every line number under it
//        VENDOR  clone not on this host        → NOTE (matches `tools/vendor-pins.mjs --check`'s NOTE class)
//      Line ranges are bounds-checked against `wc -l` at the resolved file (hard if out of range).
//   5. ASSERTED SIZES: "N lines" within the same line as a resolvable path is compared with `wc -l` there.
//      Mismatch is hard (the 1,457-vs-680 class).
//   6. DEAD URL LINKS (243): URLs recorded non-200 in `inputs/fetched/MANIFEST.md` §1 still linked from a
//      report are hard. Offline by construction; `--fetch N` optionally re-checks at most N links and prints
//      the final URL, because `MANIFEST.md` §4 measured that the *locator* rots even when the bytes do not.
//
// Read-only by construction: it reads files, runs `git ls-files` / `git log --diff-filter=A`, and reads clone
// HEADs. It never writes to the repo, the store, or a clone; `--json <path>` and `--self-test` write only
// where you point them (`--self-test` uses the OS temp dir, never this tree — 232's gate).
//
// Exit code: 1 on any HARD finding; 0 clean; 2 on usage/IO error. `--strict` upgrades every soft finding to
// hard (that is the CI posture; the default is a review queue, because historical rows legitimately cite a
// path that was deleted afterwards — the same reason `instrument-provenance.mjs` gates cites behind
// `--strict-cites`).
//
//   node tools/review-cite-check.mjs [<file|dir> …] [--json <out>] [--strict] [--self-test]
//                                   [--registry <file>] [--no-registry] [--vendor-dir <dir>]
//                                   [--pins <file>] [--manifest <file>] [--fetch N] [--top N] [--quiet]
//   With no paths it scans `docs/reviews/*.md` (non-recursive) plus `docs/incidents/*.md`.

import { readFileSync, readdirSync, existsSync, statSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CODE_EXT = "mjs|cjs|js|mts|ts|tsx|jsx|rs|go|py|md|mdx|json|jsonc|toml|ya?ml|txt|sh|ps1|sql|html|css|csv|yaml";
const OWN_DIRS = new Set(["src", "docs", "demo", "scripts", "tools", "inputs", "tests", "vendor", "config"]);

const USAGE = `usage: node tools/review-cite-check.mjs [<file|dir> …] [flags]
  --json <out>        also write the findings as JSON (out path, "-" for stdout)
  --strict            upgrade every SOFT finding to HARD (CI posture)
  --self-test         prove the checker on a clean and a broken fixture in the OS temp dir, then exit
  --no-registry       skip the citation registry
  --registry <file>   registry table (default: auto-discover docs/reviews/*registry*.md)
  --pins <file>       pin table (default: docs/VENDOR-PINS.md)
  --manifest <file>   fetched-page manifest (default: inputs/fetched/MANIFEST.md)
  --vendor-dir <dir>  clone root (default: vendor/eval)
  --fetch N           optionally re-fetch at most N cited links and print final URL + status (default 0 = offline)
  --gate              fail only on the GATE SET (below) — the posture for a repeatable check run
  --top N             print at most N rows per class (default 12)
  --quiet             summary only
`;

function parseArgs(argv) {
	const o = {
		paths: [], json: null, strict: false, selfTest: false, registry: null, noRegistry: false,
		pins: "docs/VENDOR-PINS.md", manifest: "inputs/fetched/MANIFEST.md", vendorDir: "vendor/eval",
		piMain: "vendor/pi-main", piPin: "pi-main.pin.json",
		fetch: 0, top: 12, quiet: false, help: false, gate: false,
	};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		switch (a) {
			case "--json": {
				const v = argv[i + 1];
				if (!v || v.startsWith("--")) { console.error("--json needs a file path\n" + USAGE); process.exit(2); }
				o.json = v; i++; break;
			}
			case "--strict": o.strict = true; break;
			case "--self-test": o.selfTest = true; break;
			case "--no-registry": o.noRegistry = true; break;
			case "--registry": o.registry = argv[++i]; break;
			case "--pins": o.pins = argv[++i]; break;
			case "--manifest": o.manifest = argv[++i]; break;
			case "--vendor-dir": o.vendorDir = argv[++i]; break;
		case "--pi-main": o.piMain = argv[++i]; break;
		case "--pi-pin": o.piPin = argv[++i]; break;
			case "--fetch": o.fetch = Number(argv[++i]) || 0; break;
			case "--timeout": o.timeoutMs = Number(argv[++i]) || 12000; break;
			case "--probe-cache": o.probeCache = argv[++i]; break;
			case "--probe-age": o.probeMaxAgeDays = Number(argv[++i]) || 7; break;
			case "--top": { const v = Number(argv[++i]); o.top = Number.isFinite(v) ? v : 12; break; }
			case "--quiet": o.quiet = true; break;
		case "--gate": o.gate = true; break;
			case "--help": case "-h": o.help = true; break;
			default:
				if (a.startsWith("--")) { console.error(`unknown flag: ${a}\n${USAGE}`); process.exit(2); }
				o.paths.push(a);
		}
	}
	return o;
}

const t0 = Date.now();
const el = () => `${((Date.now() - t0) / 1000).toFixed(2)}s`;
const say = (...a) => { if (!opts.quiet) console.log(...a); };
let opts = parseArgs(process.argv.slice(2));
if (opts.help) { console.log(USAGE); process.exit(0); }

const git = (...a) => {
	try {
		return execFileSync("git", ["-c", "safe.directory=*", ...a], { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 26 });
	} catch { return null; }
};
const read = (p) => { try { return readFileSync(p, "utf8"); } catch { return null; } };

// ---------------------------------------------------------------- collect markdown under review
function collect(paths) {
	if (!paths.length) paths = ["docs/reviews", "docs/incidents"];
	const out = [];
	for (const p of paths) {
		const abs = resolve(ROOT, p);
		if (!existsSync(abs)) { console.error(`no such path: ${p}`); continue; }
		if (statSync(abs).isDirectory()) {
			for (const e of readdirSync(abs, { withFileTypes: true })) {
				if (e.isFile() && e.name.endsWith(".md")) out.push(relative(ROOT, join(abs, e.name)));
			}
		} else out.push(relative(ROOT, abs));
	}
	return out.sort();
}

// ---------------------------------------------------------------- the pin table (tracked authority)
function loadPins(file) {
	const txt = read(resolve(ROOT, file));
	const pins = new Map();
	if (!txt) return { pins, pattern: `no pin table at ${file}` };
	for (const line of txt.split("\n")) {
		const m = line.match(/^\|\s*`([A-Za-z0-9._-]+)`\s*\|\s*`([0-9a-f]{7,40})`/);
		if (m) pins.set(m[1], { sha: m[2], table: file });
	}
	return { pins, pattern: `^| \`<name>\` | \`<7-40 hex>\`` };
}

// ---------------------------------------------------------------- the citation registry (canonical keys)
function loadRegistry(o) {
	let files = [];
	if (o.noRegistry) return { rows: [], files: [], pattern: "registry disabled" };
	if (o.registry) files = [o.registry];
	else files = collect(["docs/reviews"]).filter((f) => /registry/i.test(f));
	const rows = [];
	for (const f of files) {
		const txt = read(resolve(ROOT, f));
		if (!txt) continue;
		let cols = null;
		for (const line of txt.split("\n")) {
			if (!line.trim().startsWith("|")) { if (cols) cols = null; continue; }
			const cells = line.split("|").slice(1, -1).map((c) => c.trim().replace(/^`|`$/g, ""));
			if (cells[0] === "key") { cols = {}; cells.forEach((c, i) => (cols[c] = i)); continue; }
			if (!cols || cells.length < Object.keys(cols).length) continue;
			const get = (k) => (cols[k] >= 0 ? cells[cols[k]] : "");
			if (!get("key") || /^:?-{2,}:?$/.test(get("key"))) continue; // a |---| separator is not a citation
			rows.push({ file: f, key: get("key"), type: get("type"), target: get("target"), defined_in: get("defined_in"), alias_of: get("alias_of"), evidence: get("evidence") });
		}
	}
	return { rows, files, pattern: "a table whose header row starts `| key | type | target | defined_in | alias_of | evidence |`" };
}

// ---------------------------------------------------------------- MANIFEST: dead URLs + sha pins
function loadManifest(file) {
	const txt = read(resolve(ROOT, file));
	const dead = new Map();
	const moved = new Map(); // cited URL -> { to, http } — the locator rotted but the page lives (243/250)
	const rows = [];
	if (!txt) return { dead, moved, rows, pattern: `no manifest at ${file}` };
	for (const line of txt.split("\n")) {
		const cells = line.trim().startsWith("|") ? line.split("|").slice(1, -1).map((c) => c.trim()) : null;
		if (!cells) continue;
		const urls = cells.map((c) => c.replace(/[`*]/g, "")).filter((c) => /^https?:\/\//.test(c));
		const url = urls[0] || "";
		const http = cells.map((c) => c.match(/^\*{0,2}(\d{3})\*{0,2}$/)).filter(Boolean).map((m) => Number(m[1]))[0];
		if (!url || !http) continue;
		rows.push({ url, http, final: urls[1] || "" });
		if (http !== 200) dead.set(url.replace(/\/$/, ""), http);
		// a row carrying a SECOND, different URL is a redirect record: cite the final address, not the rotting one
		else if (urls[1] && urls[1].replace(/\/$/, "") !== url.replace(/\/$/, "")) moved.set(url.replace(/\/$/, ""), { to: urls[1], http });
	}
	return { dead, moved, rows, pattern: "MANIFEST table rows: a URL cell plus a 3-digit HTTP cell; a second URL cell = the redirect target" };
}

// ---------------------------------------------------------------- vendor clones
function clones(vendorDir, { piMain, piPin }) {
	const dir = resolve(ROOT, vendorDir);
	const out = new Map();
	if (existsSync(dir)) {
		for (const e of readdirSync(dir, { withFileTypes: true })) {
			if (!e.isDirectory()) continue;
			const name = e.name;
			const rel = join(vendorDir, name);
			const head = git("-C", rel, "rev-parse", "HEAD");
			out.set(name, { rel, head: head ? head.trim() : null, files: null });
		}
	}
	// `vendor/pi-main` is the PINNED BUILD INPUT, not a review clone: its authority is `pi-main.pin.json`, and
	// reviews cite INTO it (`src/harness/harness.ts:161`). Treating it as a named tree is what stops those
	// cites being reported as phantom, and it makes a pi-main HEAD that has drifted off the pin a finding.
	if (piMain && existsSync(resolve(ROOT, piMain))) {
		const head = git("-C", piMain, "rev-parse", "HEAD");
		const txt = read(resolve(ROOT, piPin));
		const sha = txt ? (txt.match(/([0-9a-f]{40})/) || [])[1] : null;
		out.set(basename(piMain), { rel: piMain, head: head ? head.trim() : null, files: null, pinnedSha: sha, pinFile: piPin });
	}
	return out;
}
function cloneFiles(c) {
	if (c.files === null) {
		const listing = git("-C", c.rel, "ls-files");
		c.files = listing ? new Set(listing.split("\n")) : new Set();
	}
	return c.files;
}

// own-repo path authority: tracked at HEAD, and "ever added in history" (244's phantom-citation class)
let trackedSet = null;
const tracked = () => {
	if (trackedSet === null) trackedSet = new Set((git("ls-files") || "").split("\n").filter(Boolean));
	return trackedSet;
};
// Two line counts, because they differ and the difference is a real thing to report, not a bug to hide:
//   wc    = number of NEWLINES — what `wc -l` prints, and what every author in this corpus measured with
//   content = number of non-empty-terminated lines (wc + 1 when the file has no trailing newline)
// Range anchors resolve against `content` (the last line IS addressable); "(N) lines" claims compare to `wc`,
// and a 1-off explained by a missing trailing newline is soft. Getting this wrong invented three SIZE MISMATCH
// findings on the first run (aider is 40 lines, wc agrees) and a fourth on the goose extensions page (no trailing newline).
function lineCount(txt) {
	if (txt === "") return { wc: 0, content: 0, trailingNewline: true };
	const nl = (txt.match(/\n/g) || []).length;
	return { wc: nl, content: txt.endsWith("\n") ? nl : nl + 1, trailingNewline: txt.endsWith("\n") };
}

// line count of a tracked path AT HEAD (not on disk — the live tree may be dirty; 232/233 discipline)
const gitLinesCache = new Map();
function gitCounts(p) {
	if (gitLinesCache.has(p)) return gitLinesCache.get(p);
	const out = git("show", `HEAD:${p}`);
	const v = out === null ? null : lineCount(out);
	gitLinesCache.set(p, v);
	return v;
}
// spread form used by the own-tree resolutions, so `headLen` (wc -l) and `contentLen` travel together
const ownCounts = (p) => { const c = gitCounts(p); return c ? { headLen: c.wc, contentLen: c.content, trailingNewline: c.trailingNewline } : { headLen: null, contentLen: null, trailingNewline: true }; };
const gitLines = (p) => { const c = gitCounts(p); return c ? c.wc : null; };

const everExistedCache = new Map();
function everExisted(p) {
	if (everExistedCache.has(p)) return everExistedCache.get(p);
	const out = git("log", "--all", "--diff-filter=A", "--format=%h", "--max-count=1", "--", p);
	const v = Boolean(out && out.trim());
	everExistedCache.set(p, v);
	return v;
}

const normTarget = (s) => {
	const link = s.match(/\]\((https?:\/\/[^)\s]+)/) || s.match(/^(https?:\/\/\S+)/);
	let u = link ? link[1] : s.trim();
	u = u.replace(/[)\].,]*$/, "").replace(/\/$/, "").toLowerCase();
	return u;
};

// ---------------------------------------------------------------- per-file extraction
function extract(txt) {
	const lines = txt.split(/\r?\n/);
	const defs = new Map();   // key -> [{line,target}]
	const uses = new Map();   // key -> [{line,anchor}]
	const paths = [];         // {raw, path, start, end, line}
	const sizes = [];         // {n, line, path?}
	const urls = [];
	const PATH_RE = new RegExp(`(?:^|[^A-Za-z0-9_./-])((?:[A-Za-z0-9_.+-]+\\/)+[A-Za-z0-9_.+-]+\\.(?:${CODE_EXT})(?![A-Za-z0-9])|(?![/])(?:[A-Za-z0-9_.+-]+\\.(?:${CODE_EXT}))(?![A-Za-z0-9]))(?::(\\d{1,6})(?:\\s*[-\\u2013]\\s*(\\d{1,6}))?)?`, "g");
	let fence = null; // a fenced block is an EXAMPLE, not a definition: charging a doc for showing a defect is how a gate gets ignored
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const fm = line.match(/^\s{0,3}(`{3,}|~{3,})/);
		if (fm) { if (fence === null) fence = fm[1]; else if (fm[1][0] === fence[0] && fm[1].length >= fence.length) fence = null; continue; }
		const inFence = fence !== null; // footnote SYNTAX means nothing in a fence; paths/sizes/URLs still count there
		const def = line.match(/^\s{0,3}\[\^([^\]^]+)\]:\s*(.*)$/);
		if (def && !inFence) {
			if (!defs.has(def[1])) defs.set(def[1], []);
			defs.get(def[1]).push({ line: i + 1, target: def[2] });
			continue;
		}
		if (!inFence) for (const m of line.matchAll(/\[\^([^\]^]+)\]/g)) {
			const key = m[1];
			const [k, anchor] = key.includes("#") ? [key.slice(0, key.indexOf("#")), key.slice(key.indexOf("#") + 1)] : [key, null];
			if (!uses.has(k)) uses.set(k, []);
			uses.get(k).push({ line: i + 1, anchor, raw: m[0] });
		}
		PATH_RE.lastIndex = 0;
		for (let m = PATH_RE.exec(line); m; m = PATH_RE.exec(line)) {
			paths.push({ raw: m[0], path: m[1], start: m[2] ? Number(m[2]) : null, end: m[3] ? Number(m[3]) : (m[2] ? Number(m[2]) : null), line: i + 1, col: m.index });
		}
		for (const m of line.matchAll(/([\d][\d,]*)\s+lines\b/g)) sizes.push({ n: Number(m[1].replace(/,/g, "")), line: i + 1, col: m.index, text: line });
		for (const m of line.matchAll(/https?:\/\/[^\s)>\]"'\x60|]+/g)) urls.push({ url: m[0].replace(/[.,;:!?]+$/, ""), line: i + 1 }); // a shell quote, a backtick or a sentence period is not part of an address
	}
	return { lines, defs, uses, paths, sizes, urls };
}

// own-repo basename lookup: a review cites `broker.mjs:123` by basename all the time. Unique suffix match
// resolves; multiple matches are AMBIGUOUS rather than guessed.
function ownByBasename(p) {
	const hits = [...tracked()].filter((f) => f === p || f.endsWith("/" + p));
	if (hits.length === 1) return { path: hits[0], unique: true };
	return { hits, unique: false };
}

// Resolve one cited path. Returns {kind, verdict, detail, abs?, headLen?}
// Bare / vendor-relative names resolve ONLY against clones this file actually names, and an exact match in
// more than one clone is AMBIGUOUS rather than "first clone that happens to have the file": on the first run
// `AGENTS.md:114` inside `crewai-review.md` silently resolved to CLONE `cline/AGENTS.md` (35 lines) and
// produced five bogus LINE OUT OF RANGE findings. A wrong resolution is worse than an unresolved one.
function resolvePath(ref, filePins, mentionedClones, cloneMap, vendorDir) {
	let p = ref.path.replace(/^\.\//, "");
	if (p.startsWith("vendor/") && !p.startsWith("vendor/eval/")) {
		const name = p.split("/")[1];
		if (cloneMap.has(name)) {
			const sub = p.split("/").slice(2).join("/");
			const c = cloneMap.get(name);
			if (!sub) return { kind: "vendor", verdict: "PASS", detail: `clone ${name} present at ${c.head ? c.head.slice(0, 8) : "?"}` };
			if (/\.\.\.|…/.test(sub)) return { kind: "vendor", verdict: "MALFORMED PATH", detail: `an elided path is not an address: ${sub}` };
			return fileInClone(c, sub, ref, vendorDir, name);
		}
	}
	if (p.startsWith("vendor/eval/")) {
		const rest = p.slice("vendor/eval/".length);
		const name = rest.split("/")[0];
		const sub = rest.split("/").slice(1).join("/");
		const c = cloneMap.get(name);
		if (!c) return { kind: "vendor", verdict: "CLONE ABSENT", detail: `${vendorDir}/${name} is not on this host` };
		if (!sub) return { kind: "vendor", verdict: "PASS", detail: `clone ${name} present at ${c.head ? c.head.slice(0, 8) : "?"}` };
		return fileInClone(c, sub, ref, vendorDir, name);
	}
	if (OWN_DIRS.has(p.split("/")[0])) {
		if (tracked().has(p)) return { kind: "own", verdict: "PASS", detail: "tracked at HEAD", abs: resolve(ROOT, p), ...ownCounts(p), where: "at HEAD" };
		if (existsSync(resolve(ROOT, p))) return { kind: "own", verdict: "UNTRACKED", detail: "on disk, not in git (ROADMAP 233)" };
		const own = ownByBasename(p);
		if (own.unique) return { kind: "own", verdict: "PASS", detail: `${own.path} (basename cite, tracked at HEAD)`, abs: resolve(ROOT, own.path), ...ownCounts(own.path), where: "at HEAD" };
		if (own.hits.length > 1) return { kind: "own", verdict: "AMBIGUOUS", detail: `${own.hits.length} tracked paths end ${p}: ${own.hits.slice(0, 4).join(", ")} — name the directory` };
		// a review of another project often cites THAT tree with its own `src/…` — try the clones it names
		const fb = tryInClones(p, [...mentionedClones].filter((n) => cloneMap.has(n)), ref, cloneMap, vendorDir);
		if (fb) return fb;
		if (mentionedClones.size) return { kind: "vendor", verdict: "UNRESOLVED", detail: `not tracked at HEAD, and not in the ${mentionedClones.size} clone(s) this file names — it may be another project's tree` };
		return { kind: "own", verdict: everExisted(p) ? "MOVED/DELETED" : "NEVER EXISTED", detail: everExisted(p) ? "added in some branch, absent at HEAD" : "no branch ever had this path (ROADMAP 244 phantom cite)" };
	}
	const primary = tryInClones(p, [...filePins].filter((n) => cloneMap.has(n)), ref, cloneMap, vendorDir)
		|| tryInClones(p, [...mentionedClones].filter((n) => cloneMap.has(n)), ref, cloneMap, vendorDir);
	if (primary) return primary;
	const own2 = ownByBasename(p);
	if (own2.unique) return { kind: "own", verdict: "PASS", detail: `${own2.path} (basename cite, tracked at HEAD)`, abs: resolve(ROOT, own2.path), ...ownCounts(own2.path), where: "at HEAD" };
	if (own2.hits.length > 1) return { kind: "own", verdict: "AMBIGUOUS", detail: `${own2.hits.length} tracked paths end ${p}: ${own2.hits.slice(0, 4).join(", ")} — name the directory` };
	if (filePins.size || mentionedClones.size) {
		const wide = tryInClones(p, [...cloneMap.keys()], ref, cloneMap, vendorDir);
		if (wide && wide.verdict === "PASS") return { ...wide, foreignClone: true };
		if (wide && wide.verdict === "AMBIGUOUS") return wide;
		return { kind: "vendor", verdict: "UNRESOLVED", detail: `not in this repo and not in any clone this file names (${filePins.size} pinned, ${mentionedClones.size} named of ${cloneMap.size} on disk)` };
	}
	const wide = tryInClones(p, [...cloneMap.keys()], ref, cloneMap, vendorDir);
	if (wide) return wide;
	return { kind: "own", verdict: tracked().has(p) ? "PASS" : "UNRESOLVED", detail: `not tracked at HEAD, no clone holds it (probed ${cloneMap.size} clones on disk — this file names none)` };
}

function tryInClones(p, names, ref, cloneMap, vendorDir) {
	const exact = [], suffix = [];
	for (const name of names) {
		const c = cloneMap.get(name);
		if (!c) continue;
		const set = cloneFiles(c);
		if (set.has(p)) exact.push([name, p]);
		else for (const f of set) if (f.endsWith("/" + p)) suffix.push([name, f]);
	}
	const hits = exact.length ? exact : suffix;
	if (!hits.length) return null;
	if (hits.length > 1) return { kind: "vendor", verdict: "AMBIGUOUS", detail: `${hits.length} candidate clones hold a path ending ${p}: ${hits.slice(0, 4).map(([n, f]) => n + "/" + f).join(", ")}${hits.length > 4 ? ", …" : ""} — name the clone or pin it` };
	return fileInClone(cloneMap.get(hits[0][0]), hits[0][1], ref, vendorDir, hits[0][0]);
}

function fileInClone(c, sub, ref, vendorDir, name) {
	if (!c.head) return { kind: "vendor", verdict: "CLONE ABSENT", detail: `${name} has no HEAD` };
	const set = cloneFiles(c);
	if (!set.has(sub)) return { kind: "vendor", verdict: "UNRESOLVED", detail: `not in ${name} at ${c.head.slice(0, 8)}: ${sub}` };
	const abs = join(ROOT, c.rel, sub);
	const txt = read(abs);
	const n = txt === null ? null : lineCount(txt);
	return { kind: "vendor", verdict: "PASS", detail: `${name}/${sub}`, abs, headLen: n?.wc ?? null, contentLen: n?.content ?? null, trailingNewline: n?.trailingNewline ?? true, clone: name, sha: c.head, where: "at the pin" };
}

// Declared pins inside a file: `vendor/eval/<name>` … `<7-40 hex>` on the same line/paragraph.
function declaredPins(txt) {
	const out = new Map();
	for (const m of txt.matchAll(/vendor\/eval\/([a-z0-9][a-z0-9-]*)[^\n]{0,120}?\b([0-9a-f]{7,40})\b/g)) {
		if (!out.has(m[1])) out.set(m[1], []);
		out.get(m[1]).push(m[2]);
	}
	return out;
}

// A family is a set of files whose citation keys are ONE namespace — the only condition under which the same
// key meaning two pages is a DEFECT rather than ordinary Markdown. Two rules, deliberately narrow: (a) one
// filename stem is a prefix of another (`harness-tools-skills-public-harnesses-research.md` + `-r3` + `-4`,
// the round family that produced ROADMAP 250), and (b) an explicit `<!-- cite-family: NAME -->` marker.
// There is NO cross-reference rule: an early version unioned files that name each other, and because reviews
// cite each other constantly, union-find merged 22 reports into ONE namespace and invented 81 collisions.
// Transitive cross-citation is not namespace identity.
function families(files) {
	const parent = new Map(files.map((f) => [f, f]));
	const find = (f) => { while (parent.get(f) !== f) f = parent.get(f); return f; };
	const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
	const stems = files.map((f) => basename(f).replace(/\.md$/, ""));
	for (let i = 0; i < files.length; i++) for (let j = 0; j < files.length; j++) if (i !== j && stems[j].startsWith(stems[i])) union(files[i], files[j]);
	const groups = new Map();
	for (const f of files) { const r = find(f); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(f); }
	return groups;
}

// ---------------------------------------------------------------- main run

// ---------------------------------------------------------------- self-test (the checker proves itself)
function selfTest(o) {
	const dir = mkdtempSync(join(tmpdir(), "citecheck-"));
	let pass = 0, fail = 0;
	const eq = (name, got, want) => { if (got === want) { pass++; console.log(`  PASS ${name} = ${want}`); } else { fail++; console.log(`  FAIL ${name}: got ${got}, want ${want}`); } };
	try {
		writeFileSync(join(dir, "probe-report.md"), `Text uses [^1] and [^2] and src/config.mjs:1-5.\n\n[^1]: [Hooks](https://code.claude.com/docs/en/hooks)\n[^2]: [Skills](https://code.claude.com/docs/en/skills)\n`);
		writeFileSync(join(dir, "probe-report-2.md"), `Text uses [^1] and [^9z] and [^ghost#40].\nsrc/definitely-not-a-real-path-xyz.mjs:10-9999 is cited, and docs/also-not-real.md:1 too.\ndocs/probe-note.mdx:3 and src/probe-widget.tsx:4 are cited, and the checker must keep the FULL extension.\nsrc/config.mjs:1-999999 is out of range, and \`src/config.mjs\` is 99,999 lines.\n\`src/config.mjs\` is 42,424 lines. <!-- cite-check: ignore-line -->\n\n[^1]: [Skills](https://code.claude.com/docs/en/skills)\n`);
		// a DIFFERENT family that re-uses `[^1]` for yet another page must NOT be a collision — ordinary
		// Markdown gives every file its own footnote namespace, and 76 false positives would bury the 2 real ones
		writeFileSync(join(dir, "unrelated-notes.md"), `Uses [^1] elsewhere.\n\n[^1]: [Something else](https://example.com/other)\n`);
		// showing a defect is not having one: the checker charged its OWN evidence note for the duplicate definition it
		// illustrates inside a ``` block. Footnote syntax has no meaning inside a fence, so it must not be parsed there.
		writeFileSync(join(dir, "fenced-example.md"), "Body [^1].\n\n```\n[^1]: https://e.com/one\n[^1]: https://e.com/two\nBody [^ghostkey].\n```\n\n[^1]: [One](https://one.example/x)\n");
		writeFileSync(join(dir, "CITATION-REGISTRY.md"), `| key | type | target | defined_in | alias_of | evidence |\n|---|---|---|---|---|---|\n| 1 | page | https://code.claude.com/docs/en/hooks | probe-report.md | | confirmed |\n| 2 | page | https://code.claude.com/docs/en/skills | probe-report.md | 1 | inferred |\n`);
		const inner = { ...o, paths: [dir], registry: join(dir, "CITATION-REGISTRY.md"), quiet: true, json: null };
		const r = run(inner);
		const n = (klass) => r.F.filter((f) => f.class === klass).length;
		eq("clean fixture DANGLING KEY", r.F.filter((f) => f.file.endsWith("probe-report.md") && f.class === "DANGLING KEY").length, 0);
		eq("broken fixture DANGLING KEY", r.F.filter((f) => f.file.endsWith("probe-report-2.md") && f.class === "DANGLING KEY").length, 2);
		eq("broken fixture PATH NEVER EXISTED", n("PATH NEVER EXISTED") >= 1 ? 1 : 0, 1);
		eq("broken fixture LINE OUT OF RANGE", n("LINE OUT OF RANGE") >= 1 ? 1 : 0, 1);
		eq("broken fixture SIZE MISMATCH", n("SIZE MISMATCH"), 1);
		eq("a cite-check: ignore-line marker suppresses exactly the finding on that line", r.suppressed, 1);
		// `.md`/`.ts`/`.json` sit BEFORE `.mdx`/`.tsx`/`.jsonc` in CODE_EXT; without the (?![A-Za-z0-9]) guard they
		// truncate the longer extension and the checker reports a real path as a phantom (it did that to cline-rules.mdx)
		eq("a .mdx cite keeps its full extension", r.F.filter((f) => f.detail.includes("probe-note.mdx:3")).length, 1);
		eq("a .tsx cite keeps its full extension", r.F.filter((f) => f.detail.includes("probe-widget.tsx:4")).length, 1);
		eq("KEY COLLISION found for [^1] inside the family", r.collisions.filter((c) => c.key === "1" && c.defs.length === 2).length, 1);
		eq("NO collision across families for [^1]", r.collisions.filter((c) => c.defs.some((d) => d.file.endsWith("unrelated-notes.md"))).length, 0);
		eq("registry ALIAS INFERRED", n("ALIAS INFERRED — NEEDS URL"), 1);
		eq("a footnote def or marker inside a ``` fence is an example, not a finding",
			r.F.filter((f) => f.file.endsWith("fenced-example.md")).length, 0);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
	console.log(`SELF-TEST ${fail === 0 ? "PASS" : "FAIL"} — ${pass} passed, ${fail} failed (fixtures in ${tmpdir()}, never in this tree)`);
	return fail === 0 ? 0 : 1;
}

// ---------------------------------------------------------------- main run
function run(o) {
	const ctx = {
		clones: clones(o.vendorDir, { piMain: o.piMain, piPin: o.piPin }),
		pins: loadPins(o.pins),
		registry: loadRegistry(o),
		manifest: loadManifest(o.manifest),
		dead: null,
	};
	ctx.dead = ctx.manifest.dead;
	const files = collect(o.paths);
	const F = [];
	const perFile = [];
	const urlRefs = []; // every cited http(s) URL, for --fetch
	const suppClass = new Map();
	const fileLines = new Map(); // file -> lines[], for the marker checks below
	const defIndex = new Map();
	for (const f of files) {
		const txt = read(resolve(ROOT, f));
		if (txt === null) { F.push({ file: f, line: 0, class: "READ", sev: "hard", pattern: "readFileSync", detail: "unreadable" }); continue; }
		const x = extract(txt);
		const pins = declaredPins(txt);
		const filePins = new Set(pins.keys());
		// clones this file NAMES anywhere (not just with a sha) — the candidate set for a bare cited path
		const mentioned = new Set([...ctx.clones.keys()].filter((n) => txt.includes(n)));
		fileLines.set(f, x.lines);
		// `<!-- cite-ns: quoted -->` marks a file whose `[^key]` tokens QUOTE another file's namespace (a
		// verification note about a report). Its dangling keys are expected, so they report as soft, not hard.
		const nsQuoted = /<!--[^>]*cite-ns:\s*quoted/.test(txt);
		const st = { file: f, nsQuoted, defs: x.defs.size, keys: x.uses.size, occurrences: [...x.uses.values()].reduce((a, b) => a + b.length, 0) + x.defs.size, anchored: 0, dangling: 0, pathCites: 0, pathPass: 0, pathFail: 0, sizeChecks: 0, sizeFail: 0, suppressed: 0 };
		perFile.push(st);

		for (const [key, uses] of x.uses) {
			if (!x.defs.has(key)) {
				st.dangling++;
				F.push({ file: f, line: uses[0].line, class: "DANGLING KEY", sev: nsQuoted ? "soft" : "hard", pattern: `[^${key}] used; no [^${key}]: line in this file`, detail: `${uses.length} use(s); first ${uses[0].raw}${uses[0].anchor ? ` — anchor #${uses[0].anchor} is not an address` : ""}${nsQuoted ? " — this file declares cite-ns: quoted, so it quotes another file's keys" : ""}` });
			}
			for (const u of uses) if (u.anchor) st.anchored++;
		}
		for (const [key, d] of x.defs) {
			if (d.length > 1) F.push({ file: f, line: d[1].line, class: "DUP DEFINITION", sev: "hard", pattern: `[^${key}]: twice in one file`, detail: `lines ${d.map((z) => z.line).join(",")}` });
			if (!x.uses.has(key)) F.push({ file: f, line: d[0].line, class: "UNUSED DEFINITION", sev: "soft", pattern: `[^${key}]: defined, never used`, detail: "" });
			if (!defIndex.has(key)) defIndex.set(key, []);
			for (const z of d) defIndex.get(key).push({ file: f, line: z.line, target: z.target });
		}

		for (const ref of x.paths) {
			if (!(ref.start !== null || ref.path.startsWith("vendor/eval/") || ref.path.startsWith("vendor/"))) continue;
			st.pathCites++;
			const r = resolvePath(ref, filePins, mentioned, ctx.clones, o.vendorDir);
			if (r.verdict === "PASS") {
				st.pathPass++;
				if (r.foreignClone) F.push({ file: f, line: ref.line, class: "PATH RESOLVED IN AN UNNAMED CLONE", sev: "soft", pattern: `resolved to ${r.clone}, which this file never names`, detail: `${ref.raw} — the citation is real but a reader cannot tell which tree it was read in` });
				if (r.clone && pins.has(r.clone)) for (const sha of pins.get(r.clone)) {
					if (!r.sha.startsWith(sha)) F.push({ file: f, line: ref.line, class: "PIN DRIFT", sev: "hard", pattern: `file declares ${r.clone} at ${sha}; live HEAD ${r.sha.slice(0, 8)}`, detail: `${ref.raw} — every line number under a moved clone reads a different file` });
				}
				if (r.headLen && ref.end && ref.end > (r.contentLen || r.headLen)) F.push({ file: f, line: ref.line, class: "LINE OUT OF RANGE", sev: "hard", pattern: `:${ref.start}${ref.end !== ref.start ? `-${ref.end}` : ""} vs ${r.headLen} lines ${r.where}${r.trailingNewline ? "" : ` (${r.contentLen} content lines — no trailing newline)`}`, detail: `${r.detail}` });
				if (ref.start && ref.end && ref.start > ref.end) F.push({ file: f, line: ref.line, class: "RANGE REVERSED", sev: "hard", pattern: ":start>end", detail: ref.raw });
			} else {
				st.pathFail++;
				const softv = r.verdict === "CLONE ABSENT" || r.verdict === "AMBIGUOUS" || r.verdict === "UNTRACKED" || r.verdict === "MOVED/DELETED" || r.verdict === "UNRESOLVED";				F.push({ file: f, line: ref.line, class: `PATH ${r.verdict}`, sev: softv ? "soft" : "hard", pattern: r.kind === "vendor" ? "vendor/eval/<clone>/path, or a relative path under a pin/clone this file names" : "a repo path cited with a line anchor", detail: `${ref.raw} — ${r.detail}` });
			}
		}

		for (const s of x.sizes) {
			const near = x.paths.filter((p) => p.line === s.line).find((p) => Math.abs(p.col - s.col) < 200);
			if (!near) continue;
			const r = resolvePath(near, filePins, mentioned, ctx.clones, o.vendorDir);
			if (r.verdict !== "PASS" || !r.headLen) continue;
			st.sizeChecks++;
			// HARD only at a vendor PIN, which is immutable; our own tree moves, so a size claim that was true when
			// written drifts as the product grows (measured: `src/broker.mjs` "491 lines" is 2,271 lines at HEAD today).
			if (r.headLen !== s.n) {
				const offByOne = Math.abs(r.headLen - s.n) === 1 && !r.trailingNewline;
				// If the SAME line also states the figure that matches the pin, it is a CORRECTION ("was 1,457 from
				// memory; measurement at the pin says 680"), not a bad claim. Measured 2026-10-29: four such lines in
				// this corpus, all quoting the same 1,457/680 pair. Failing a correction teaches the reader to ignore
				// the gate, so detect the pin figure with or without the word "lines" following it.
				const lineTxt = x.lines[s.line - 1] || "";
				const corrected = new RegExp(`(^|[^.\d:/-])${r.headLen}([^\d]|$)`).test(lineTxt); // a `:680` anchor is not the line restating the pin length
				st.sizeFail++;
				const immutableTarget = r.kind === "vendor";
				F.push({ file: f, line: s.line, class: corrected ? "SIZE CLAIM CORRECTED IN LINE" : offByOne ? "SIZE OFF-BY-ONE (NO TRAILING NEWLINE)" : "SIZE MISMATCH", sev: corrected || offByOne ? "soft" : immutableTarget ? "hard" : "soft", pattern: `"${s.n} lines" on the same line as ${near.raw}`, detail: `measured ${r.headLen} lines (${r.contentLen} content lines) ${r.where} (${r.detail})${corrected ? " — this line also carries the figure that matches the pin, so it is quoting the bad number in order to correct it" : offByOne ? " — the file has no trailing newline, so wc -l and the content count differ by 1; the claim is wc-style, not wrong" : immutableTarget ? " — a pin never moves, so this claim was never true" : " — SOFT: our own tree moves, so a size claim was only ever true at authoring time"}` });
			}
		}

		for (const u of x.urls) {
			urlRefs.push({ file: f, line: u.line, url: u.url });
			if (/\b404\b|\bdead\b/i.test(x.lines[u.line - 1] || "")) continue; // a row that RECORDS its own 404 is honest, not a phantom
			const key = u.url.replace(/\/$/, "");
			const http = ctx.dead.get(key);
			if (http) F.push({ file: f, line: u.line, class: "DEAD URL LINKED", sev: "hard", pattern: `MANIFEST records HTTP ${http} for this URL`, detail: `${u.url} — a dead URL in an evidence table reads as evidence (ROADMAP 243)` });
			else if (ctx.manifest.moved.has(key)) F.push({ file: f, line: u.line, class: "URL MOVED (RECORDED)", sev: "soft", pattern: `MANIFEST records ${key} -> ${ctx.manifest.moved.get(key).to}`, detail: `${u.url} — the cited locator rots; cite the final address or the pinned copy (measured 2026-10-29T03:55Z: docs.cline.bot/features/cline-rules -> /customization/cline-rules, cursor.com/docs/context/rules -> /docs/rules)` });
		}
	}

	// the pinned build input: `pi-main.pin.json` is the authority for `vendor/pi-main`, and reviews cite into
	// that tree by bare path. A HEAD off the pin silently invalidates every such anchor.
	for (const [name, c] of ctx.clones) {
		if (c.pinnedSha && c.head && !c.head.startsWith(c.pinnedSha.slice(0, 7))) {
			F.push({ file: o.piPin, line: 0, class: "PIN DRIFT", sev: "hard", pattern: `${o.piPin} pins ${c.pinnedSha.slice(0, 8)}; ${c.rel} HEAD is ${c.head.slice(0, 8)}`, detail: "every review anchor into this tree was read at a commit the repo does not record (D158: a pin the live tree does not run is a fiction)" });
		}
	}

	// cross-file collisions — inside a family only (see families()): a shared key namespace is what makes a
	// collision a defect, and 250 is exactly that defect between two rounds of one report.
	const fam = families(files);
	const famOf = new Map(), baseOf = new Map();
	for (const [root, members] of fam) {
		const stemOf = (x) => basename(x).replace(/\.md$/, "");
		const base = members.slice().sort((a, b) => stemOf(a).length - stemOf(b).length)[0];
		for (const m of members) { famOf.set(m, stemOf(base)); baseOf.set(m, m === base); }
	}
	const collisions = [];
	for (const [key, defs] of defIndex) {
		if (defs.length < 2) continue;
		const byFamily = new Map();
		for (const d of defs) { const k = famOf.get(d.file) || d.file; if (!byFamily.has(k)) byFamily.set(k, []); byFamily.get(k).push(d); }
		for (const [famName, members] of byFamily) {
			if (members.length < 2) continue;
			const targets = new Set(members.map((d) => normTarget(d.target)).filter(Boolean));
			if (targets.size < 2) continue;
			const declaredAlias = ctx.registry.rows.filter((r) => r.key === key).some((r) => r.alias_of);
			// HARD when the family's BASE document defines the key and a later round re-defines it: that is the
			// 250 condition — the base is what ROADMAP cites, so pasting the round silently re-points ROADMAP.
			const hitsBase = members.some((d) => baseOf.get(d.file));
			const sev = declaredAlias ? "soft" : hitsBase ? "hard" : "soft";
			collisions.push({ key, family: famName, defs: members.slice(), declaredAlias, hitsBase, sev, targets: [...targets] });
			F.push({ file: members[0].file, line: members[0].line, class: declaredAlias ? "KEY COLLISION (REGISTERED ALIAS)" : "KEY COLLISION", sev, pattern: `[^${key}] DEFINED with different targets inside family ${famName}`, detail: members.map((d) => `${d.file}:${d.line} -> ${normTarget(d.target).slice(0, 60)}`).join("   ||   ") });
		}
	}

	// registry integrity — a registry that is not checked against the files is just more prose to rot
	for (const r of ctx.registry.rows) {
		if (r.alias_of) {
			const canonical = ctx.registry.rows.find((q) => q.key === r.alias_of);
			if (!canonical) F.push({ file: r.file, line: 0, class: "REGISTRY DANGLING ALIAS", sev: "hard", pattern: `alias_of=${r.alias_of}`, detail: `${r.key} names a key the registry does not define` });
			else if (normTarget(canonical.target) !== normTarget(r.target)) F.push({ file: r.file, line: 0, class: "REGISTRY TARGET MISMATCH", sev: "hard", pattern: `alias ${r.key} vs canonical ${r.alias_of}`, detail: `${r.target} vs ${canonical.target}` });
			if (/inferred/i.test(r.evidence)) F.push({ file: r.file, line: 0, class: "ALIAS INFERRED — NEEDS URL", sev: "soft", pattern: `evidence: ${r.evidence}`, detail: `${r.key} -> ${r.alias_of} was inferred, not printed by the round that used it: check before use (250 *Do not*)` });
		}
		if (r.defined_in && !files.includes(r.defined_in)) F.push({ file: r.file, line: 0, class: "REGISTRY defined_in STALE", sev: "soft", pattern: `defined_in: ${r.defined_in}`, detail: "not in the scanned file set" });
		// a canonical row must agree with what its file ACTUALLY defines — otherwise the registry is a wish
		if (r.defined_in && r.key && !r.alias_of && defIndex.has(r.key)) {
			const def = defIndex.get(r.key).find((d) => d.file === r.defined_in);
			if (def && normTarget(def.target) !== normTarget(r.target) && !/unknown/i.test(r.target)) {
				F.push({ file: r.file, line: 0, class: "REGISTRY DISAGREES WITH REPORT", sev: "hard", pattern: `registry [^${r.key}] -> ${r.target}`, detail: `${r.defined_in}:${def.line} defines it as ${normTarget(def.target)} — one of the two is wrong` });
			}
		}
	}

	// Suppression markers, so a deliberate exception is auditable instead of a gate the reader ignores:
	//   <!-- cite-check: ignore-line --> on the cited line | <!-- cite-check: ignore-file --> anywhere in the file
	// Suppressed findings are COUNTED in the output, never dropped silently.
	const supp = new Map();
	const kept = [];
	for (const x of F) {
		const lines = fileLines.get(x.file) || [];
		const txt = lines.join("\n");
		const lineTxt = x.line > 0 ? lines[x.line - 1] || "" : "";
		if (/cite-check:\s*ignore-file/.test(txt) || /cite-check:\s*ignore-line/.test(lineTxt)) { supp.set(x.file, (supp.get(x.file) || 0) + 1); suppClass.set(x.class, (suppClass.get(x.class) || 0) + 1); continue; }
		kept.push(x);
	}
	F.length = 0; F.push(...kept);
	for (const s of perFile) s.suppressed = supp.get(s.file) || 0;

	return { F, perFile, collisions, ctx, files, suppressed: [...supp.values()].reduce((a, b) => a + b, 0), urlRefs };
}

function report(r, o) {
	// A full audit and a gate answer different questions, so they fail on different classes.
	// GATE SET = an anchor that is WRONG TODAY: a key that points two ways, a key defined twice in one file,
	// a cited path no branch ever had, an anchor outside the file, a pin that moved, a dead URL. Historical
	// research notes legitimately carry DANGLING keys and unfinished path cites — those are a review queue in
	// full-audit mode, not a red gate (measured 2026-10-29: the gate set is 108 collisions + 71 duplicate definitions
	// + 9 phantom paths + 2 malformed + 2 out-of-range + 6 size-at-pin + 5 dead URLs = 203 failing; the 89 hard
	// DANGLING keys are the extra 89 that full audit adds. A gate that fires on all 292 is a gate nobody runs.)
	const GATE = new Set(["KEY COLLISION", "DUP DEFINITION", "PATH NEVER EXISTED", "PATH MALFORMED PATH", "LINE OUT OF RANGE", "RANGE REVERSED", "PIN DRIFT", "DEAD URL LINKED", "SIZE MISMATCH", "REGISTRY DANGLING ALIAS", "REGISTRY TARGET MISMATCH", "REGISTRY DISAGREES WITH REPORT"]);
	const isFail = (f) => (o.gate ? GATE.has(f.class) && f.sev === "hard" : f.sev === "hard");
	const hard = r.F.filter(isFail);
	const soft = r.F.filter((f) => !isFail(f));
	console.log(`REVIEW CITATION CHECK  (${new Date().toISOString()})  ${r.files.length} file(s) scanned, host-OS paths as given`);
	console.log(`  patterns: footnote defs ^\\s{0,3}[^key]: ; usages [^key] (key#anchor split) ; citations path.ext[:LINE[-LINE]] under ${o.vendorDir}/<clone> or this repo ; sizes "(N) lines" within 200 chars of a resolvable path on the SAME line ; dead URLs from ${o.manifest} §1 (non-200) ; pins from ${o.pins}`);
	console.log(`  registry: ${r.ctx.registry.files.length ? r.ctx.registry.files.join(", ") + ` (${r.ctx.registry.rows.length} rows)` : "none"}  |  manifest rows: ${r.ctx.manifest.rows.length}, dead: ${r.ctx.manifest.dead.size} [${[...r.ctx.manifest.dead.entries()].map(([u, h]) => h).join(",")}]`);
	console.log(`  clones: ${r.ctx.clones.size} under ${o.vendorDir}  |  tracked repo paths: ${tracked().size}  |  ever-existed probes: ${everExistedCache.size}  |  manifest-recorded moves: ${r.ctx.manifest.moved.size}`);
	console.log(`  posture: ${o.gate ? "GATE — fails on " + [...GATE].join(", ") : "FULL AUDIT — every hard finding fails; use --gate for the anchor-wrong-today set"}`);
	const byClass = new Map();
	for (const f of r.F) byClass.set(f.class, (byClass.get(f.class) || 0) + 1);
	console.log("\nCLASS CENSUS (hard count first; a class can hold both severities — e.g. a quoted namespace)");
	for (const [k, n] of [...byClass].sort((a, b) => b[1] - a[1])) {
		const rows = r.F.filter((f) => f.class === k);
		const h = rows.filter((f) => f.sev === "hard").length;
		console.log(`  ${h ? "HARD" : "SOFT"} ${k.padEnd(38)} ${n}${n - h ? ` (hard ${h} + not-failing ${n - h})` : ""}${o.gate && GATE.has(k) ? "  [gate]" : ""}`);
	}
	const groups = [...r.perFile].sort((a, b) => (b.dangling - a.dangling) || (b.occurrences - a.occurrences));
	console.log("\nPER FILE  (file  defs  distinctKeys  markerOccurrences  anchored  DANGLING  pathCites pass/fail  sizeChecks/fail)");
	for (const s of groups) if (s.defs || s.dangling || s.pathCites) console.log(`  ${s.file}  ${s.defs}  ${s.keys}  ${s.occurrences}  ${s.anchored}${s.nsQuoted ? "  [cite-ns:quoted]" : ""}  ${s.dangling}  ${s.pathCites} ${s.pathPass}/${s.pathFail}  ${s.sizeChecks}/${s.sizeFail}${s.suppressed ? `  supp ${s.suppressed}` : ""}`);
	for (const klass of ["DANGLING KEY", "KEY COLLISION", "KEY COLLISION (REGISTERED ALIAS)", "DUP DEFINITION", "SIZE MISMATCH", "SIZE OFF-BY-ONE (NO TRAILING NEWLINE)", "LINE OUT OF RANGE", "RANGE REVERSED", "PIN DRIFT", "PATH NEVER EXISTED", "PATH MALFORMED PATH", "PATH UNRESOLVED", "PATH MOVED/DELETED", "PATH AMBIGUOUS", "PATH CLONE ABSENT", "PATH UNTRACKED", "PATH RESOLVED IN AN UNNAMED CLONE", "DEAD URL LINKED", "URL MOVED (RECORDED)", "DEAD URL (LIVE PROBE)", "URL MOVED (LIVE PROBE)", "URL UNPROBED", "UNUSED DEFINITION", "REGISTRY DISAGREES WITH REPORT", "REGISTRY DANGLING ALIAS", "REGISTRY TARGET MISMATCH", "ALIAS INFERRED — NEEDS URL"]) {
		const rows = r.F.filter((f) => f.class === klass);
		if (!rows.length) continue;
		console.log(`\n${klass} (${rows.length})`);
		for (const row of rows.slice(0, o.top)) console.log(`  ${row.file}:${row.line}  ${row.pattern}\n      ${row.detail}`);
		if (rows.length > o.top) console.log(`  … ${rows.length - o.top} more (raise with --top)`);
	}
	if (o.strict && soft.length) console.log(`\n--strict: ${soft.length} SOFT finding(s) count as failing`);
	const failing = hard.length || (o.strict && soft.length);
	console.log(`\nVERDICT: ${hard.length} failing, ${soft.length} not failing (of ${r.F.length} findings)${r.suppressed ? `  |  ${r.suppressed} SUPPRESSED by cite-check markers` : ""}  →  exit ${failing ? 1 : 0}   (${el()})`);
	if (o.json) { const body = JSON.stringify({ at: new Date().toISOString(), gate: o.gate, files: r.files.map((f) => r.perFile.find((p) => p.file === f)), findings: r.F }, null, 1); if (o.json === "-") console.log(body); else { writeFileSync(resolve(ROOT, o.json), body); console.log(`JSON written: ${o.json}`); } }
	return failing ? 1 : 0;
}

// Opt-in liveness probe (--fetch N). The default posture is OFFLINE and deterministic: a gate that changes
// when a vendor changes its site is not a gate. With --fetch, up to N cited URLs not already recorded in the
// MANIFEST are probed with redirects followed, which is how locator ROT is told apart from a dead page —
// measured 2026-10-29T03:55Z on this host: cursor.com/docs/context/rules -> /docs/rules, docs.cline.bot/
// features/cline-rules -> /customization/cline-rules, and the three goose site paths are 404 with no redirect.
const PROBE_CACHE_DEFAULT = ".spike/probe-cache.json"; // gitignored scratch; the cache is a speed, not evidence
function loadProbeCache(o) {
	const p = resolve(ROOT, o.probeCache ?? PROBE_CACHE_DEFAULT);
	const j = read(p);
	if (!j) return { path: p, map: new Map(), freshMs: (o.probeMaxAgeDays ?? 7) * 864e5 };
	try { return { path: p, map: new Map(Object.entries(JSON.parse(j))), freshMs: (o.probeMaxAgeDays ?? 7) * 864e5 }; }
	catch { return { path: p, map: new Map(), freshMs: (o.probeMaxAgeDays ?? 7) * 864e5 }; }
}
async function probeUrls(r, o) {
	const cache = loadProbeCache(o);
	const seen = new Set();
	const todo = [];
	for (const ref of r.urlRefs) {
		const key = ref.url.replace(/\/$/, "");
		if (r.ctx.manifest.dead.has(key) || r.ctx.manifest.moved.has(key) || seen.has(key)) continue;
		seen.add(key); todo.push({ key, url: ref.url });
	}
	const list = todo.sort((a, b) => a.key.localeCompare(b.key)).slice(0, o.fetch);
	const byKey = new Map();
	for (const ref of r.urlRefs) { const k = ref.url.replace(/\/$/, ""); if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(ref); }
	let probed = 0, unreachable = 0, cached = 0;
	for (const { key, url } of list) {
		let status = null, final = "";
		const hit = cache.map.get(key);
		if (hit && Date.now() - Date.parse(hit.at) < cache.freshMs) { status = hit.status; final = hit.final; cached++; }
		else try {
			const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(o.timeoutMs || 12000), headers: { "user-agent": "durian-pi-review-cite-check/1.0 (evidence integrity probe)" } });
			status = res.status; final = res.url || "";
			res.body?.cancel?.();
			cache.map.set(key, { status, final, at: new Date().toISOString() });
		} catch { unreachable++; }
		probed++;
		const verdict = classifyProbe(key, status, final);
		for (const ref of byKey.get(key) || []) {
			if (!verdict) continue;
			F_push(r, { file: ref.file, line: ref.line, class: verdict.class, sev: verdict.sev, pattern: verdict.pattern, detail: verdict.detail(url, o.manifest) });
		}
	}
	try { writeFileSync(cache.path, JSON.stringify(Object.fromEntries(cache.map), null, 1)); } catch { /* cache is a convenience */ }
	return { probed, unreachable, cached, candidates: todo.length, cachePath: cache.path };
}
const F_push = (r, x) => { r.F.push(x); };

// What a probe CAN and CANNOT prove — measured 2026-10-29T03:59Z over 192 cited URLs on this host:
//   176 returned 200 · 9 returned 403 · 4 returned 429 · 1 returned 401 · 2 unreachable
// Not one 403/429 was a dead page: Medium, openai.com, mckinsey.com, researchgate.net and componentsource.com
// block non-browser clients. Calling a bot-block "dead" would have invented 14 findings, so only 404/410 are dead.
// Moves also need judgement: `?hl=vi` locale suffixes and openreview/springer/nature `/challenge`-`/transit`
// interstitials are anti-bot, not relocation, and a repo rename (Pi-OpenDurig -> Durian-Pi, 8 citations) is a
// MOVED the reader should see. Compare PATHS, ignore query-only differences.
function classifyProbe(key, status, final) {
	if (status === null) return { class: "URL UNPROBED", sev: "soft", pattern: `--fetch: no answer from ${key}`, detail: (u) => "a network failure is NOT evidence the page is dead — do not report it as one" };
	if (status === 404 || status === 410 || status === 510) return { class: "DEAD URL (LIVE PROBE)", sev: "hard", pattern: `HTTP ${status} probed ${new Date().toISOString()}`, detail: (u) => `${u} — gone today, and a dead URL in an evidence table reads as evidence (ROADMAP 243)` };
	if (status === 403 || status === 401 || status === 429 || status === 503) return { class: "URL UNVERIFIABLE (BOT-BLOCKED)", sev: "soft", pattern: `HTTP ${status} — the host refuses this client, so liveness is unknown`, detail: (u) => `${u} — a bot-block is NOT a death sentence (measured: 9 of 192 cited URLs 403 and 4 429, none of them dead). Read it in a browser or at a pin, then record the verdict in the MANIFEST.` };
	if (final && status >= 200 && status < 400) {
		try {
			const a = new URL(key), b = new URL(final);
			const interstitial = /challenge|transit|login|signin|captcha/i.test(b.pathname);
			if (interstitial) return { class: "URL BEHIND ANTI-BOT", sev: "soft", pattern: `lands on an interstitial: ${b.pathname}`, detail: (u) => `${u} — the page is gated, so this probe proves nothing about its content` };
			if (a.host === b.host && a.pathname === b.pathname) return null; // query-only difference is not a move
			return { class: "URL MOVED (LIVE PROBE)", sev: "soft", pattern: `lands at ${final} (HTTP ${status})`, detail: (u, manifest) => `${u} — the cited locator rots even when the page lives; cite the final address or the pinned copy, and record it in ${manifest} so the offline gate sees it` };
		} catch { return null; }
	}
	return null;
}

if (opts.selfTest) process.exit(selfTest(opts));
const res = run(opts);
if (opts.fetch > 0) { const p = await probeUrls(res, opts); console.log(`  live probe: ${p.probed} of ${p.candidates} cited URLs (${p.cached} from ${p.cachePath}, ${p.unreachable} unreachable — soft, never dead)`); }
process.exit(report(res, opts));
