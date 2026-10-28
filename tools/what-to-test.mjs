#!/usr/bin/env node
// tools/what-to-test.mjs — which tests does THIS diff actually need, and is the cheap answer safe?
//
// Why this exists (operator, 2026-10-28): "node scripts/test.mjs --area docs for doc-only edits (5 tests,
// not 238) — I burned 3 full suites on pointer formatting." The fast path already existed (`--area docs`,
// measured 0.1 s for 5 tests against 41.8 s for 238) and was still not used, because knowing an area name
// is not the same as knowing which guards YOUR change carries. And `--area docs` alone is the wrong set for
// a lot of doc edits: `demo/runbook-frontmatter.test.mjs` lives in area `check`, and
// `demo/feature-row.test.mjs` / `demo/features-drift.test.mjs` live in area `rig`, so a hand-picked area can
// miss the guard on the file you just edited. A remembered incantation is a hint; this is a control.
//
// The selection is DERIVED, not curated. A hand-written path→test map is exactly the thing that rots — that
// is why `demo/test-areas.test.mjs` exists for the area manifest. Instead this reads the demo sources and
// takes every test that NAMES the changed path, its containing directory, or its file name: a test that
// asserts on a file mentions that file, and a test that imports a module spells its path
// (`import … from "../src/testareas.mjs"` contains `src/testareas.mjs`). Coverage comes from
// `src/testareas.mjs` (the product's own area data) so nothing here duplicates the partition.
//
// Every count it prints ships with the needle that produced it (D142: "never quote a count without the
// pattern that produced it"), and it never proposes a downgrade of the LANDING gate: the full suite stays
// the pre-landing/QA gate (`docs/runbooks/run-your-area.md`).
//
// It also runs the docs-integrity scan that the pitfall in `docs/SELFDEV.md` describes but nothing
// instruments: doc writes carry control bytes and zero-width characters typed into a code fence, and no demo
// checks for them.
//
//   node tools/what-to-test.mjs                 classify the working tree (staged + unstaged + untracked)
//   node tools/what-to-test.mjs --base main     classify a whole branch vs its merge-base with main
//   node tools/what-to-test.mjs --run           run the selected guards now (sequential, 120 s each)
//   node tools/what-to-test.mjs --json          machine-readable verdict
//   node tools/what-to-test.mjs --no-scan       skip the byte-integrity scan of changed text files
//
// Exit: 0 selection produced and (with --run) all selected tests passed; 1 a selected test failed or the
// byte scan found something; 2 usage / git / manifest error.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { areaNames, discoverTests, filesForArea, readManifest, validateManifest } from "../src/testareas.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** Same per-test bound the product runner uses (`scripts/test.mjs` DEFAULT_TIMEOUT_MS). */
const TIMEOUT_MS = 120_000;
/** Above this many derived guards the diff is not "cheap to check" and the honest answer is the full gate. */
const CHEAP_CAP = 25;

const USAGE = `usages:
  node tools/what-to-test.mjs                 classify the working tree (staged + unstaged + untracked)
  node tools/what-to-test.mjs --base <ref>    classify everything HEAD changed since the merge-base with <ref>
  node tools/what-to-test.mjs --run           run the derived guard set now, then report (direct tier first)
  node tools/what-to-test.mjs --direct-only   run only the DIRECT guards (the sub-second "did I break the
                                              pointer / a runbook?" check; a doc edit does not stop here)
  node tools/what-to-test.mjs --paths <p,..>  classify these paths instead of the working tree (plan before editing)
  node tools/what-to-test.mjs --json          one JSON document
  node tools/what-to-test.mjs --no-scan       skip the control-byte / zero-width scan of changed text files`;

class UsageError extends Error {}

function parseArgs(argv) {
	const opts = { base: null, run: false, json: false, scan: true, paths: null, directOnly: false };
	for (const a of argv) {
		if (a === "--base") throw new UsageError("--base needs a value (use --base=<ref>)");
		else if (a.startsWith("--base=")) opts.base = a.slice(7);
		else if (a === "--run") opts.run = true;
		else if (a === "--direct-only") { opts.run = true; opts.directOnly = true; }
		else if (a.startsWith("--paths=")) opts.paths = a.slice(8).split(",").map((p) => p.trim()).filter(Boolean);
		else if (a === "--paths") throw new UsageError("--paths needs a comma-separated list (use --paths=<p,...>)");
		else if (a === "--json") opts.json = true;
		else if (a === "--no-scan") opts.scan = false;
		else if (a === "--help" || a === "-h") opts.help = true;
		else throw new UsageError(`unknown argument: ${a}`);
	}
	return opts;
}

function git(args, { allowFail = false } = {}) {
	const r = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
	if (r.status !== 0 && !allowFail) throw new Error(`git ${args.join(" ")} failed: ${r.stderr.trim() || r.status}`);
	return r.stdout ?? "";
}

/**
 * The changed paths, NUL-parsed so a path with a space or a non-ASCII name cannot be mis-read.
 *
 * `--porcelain -z` emits `XY path\0`, and for a rename `XY new\0old\0`; the rename's second token has no
 * status prefix, which is why this walks tokens rather than lines.
 */
function changedPaths(base) {
	const out = [];
	if (base) {
		const mb = git(["merge-base", base, "HEAD"], { allowFail: true }).trim();
		if (!mb) throw new Error(`--base ${base}: no merge-base with HEAD`);
		for (const p of git(["diff", "--name-only", `${mb}...HEAD`]).split("\n")) if (p) out.push({ path: p, status: "M", via: `vs ${base}` });
	}
	const tokens = git(["status", "--porcelain=v1", "-z"]).split("\0");
	for (let i = 0; i < tokens.length; i++) {
		const tok = tokens[i];
		if (!tok) continue;
		const status = tok.slice(0, 2);
		const path = tok.slice(3);
		if (!path) continue;
		if (status[0] === "R" || status[1] === "R" || status[0] === "C" || status[1] === "C") i++; // skip the paired old path
		out.push({ path, status, via: "working tree" });
	}
	const seen = new Set();
	return out.filter((c) => !seen.has(c.path) && seen.add(c.path));
}

const TEXT_RE = /\.(md|markdown|txt|json|jsonc|ya?ml|mjs|js|ps1|sh|ts|tsx|sql)$/i;
const DOC_RE = /(\.md|\.markdown|\.txt)$/i;

/**
 * Every `demo/*.test.mjs` that mentions a path, and HOW.
 *
 * Three needle kinds, printed with the match so a reader can audit the selection:
 *   path — the exact repo-relative path (`docs/NEXT.md`, or an import specifier that contains it)
 *   dir  — the containing directory with a trailing slash (`docs/runbooks/`), which is how the runbook
 *          guards reference the whole family without naming one file
 *   name — the bare file name (`SELFDEV.md`), which catches a test that builds the path from parts
 *          (`join(ROOT, "docs", "SELFDEV.md")`) and would match no `path` needle
 */
function guardsFor(changed, sources) {
	const hits = new Map(); // test -> { needles: [{path, kind, needle}] }
	for (const c of changed) {
		const needles = [{ kind: "path", needle: c.path }];
		const dir = dirname(c.path);
		// A directory needle is only useful two or more levels down: `docs/runbooks/` names the runbook
		// family, while `docs/` matches a third of the suite and says nothing about the edit.
		if (dir && dir !== "." && dir.includes("/")) needles.push({ kind: "dir", needle: `${dir}/` });
		// A name needle catches a test that builds the path from parts (`join(ROOT, "docs", "SELFDEV.md")`).
		// Extension-bearing names only: `.scratch` matching `land-helper.test.mjs` is noise, not a guard.
		const name = basename(c.path);
		if (c.path.includes("/") && /\.[A-Za-z0-9]+$/.test(name) && !name.startsWith(".")) needles.push({ kind: "name", needle: name });
		for (const [test, text] of sources) {
			for (const n of needles) {
				if (text.includes(n.needle)) {
					if (!hits.has(test)) hits.set(test, []);
					hits.get(test).push({ path: c.path, ...n });
				}
			}
		}
	}
	return hits;
}

/**
 * The scan the docs pitfall in `docs/SELFDEV.md` describes and nothing instruments: a U+200B written into a
 * code fence makes a repro command wrong, and a stray 0x07 replaced the leading letter of four words in
 * `docs/DECISIONS.md`. Both survive `git diff` review because both are invisible.
 */
function scanText(path) {
	const text = readFileSync(join(ROOT, path), "utf8");
	const found = [];
	const named = { "\u200b": "ZERO WIDTH SPACE", "\u200e": "LRM", "\u200f": "RLM", "\ufeff": "BOM", "\u00a0": "NBSP", "\u2060": "WORD JOINER" };
	for (const [ch, label] of Object.entries(named)) {
		let i = text.indexOf(ch);
		while (i >= 0) {
			found.push({ path, at: i, what: `U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")} ${label}`, line: text.slice(0, i).split("\n").length });
			i = text.indexOf(ch, i + 1);
		}
	}
	for (const m of text.matchAll(/[\u0000-\u0008\u000b-\u001f]/g)) {
		found.push({ path, at: m.index, what: `control byte 0x${m[0].charCodeAt(0).toString(16).padStart(2, "0")}`, line: text.slice(0, m.index).split("\n").length });
	}
	// Mojibake: a UTF-8 byte pair re-decoded as cp1252 — the exact symptom of Python's default cp1252 open
	// on Windows round-tripping a repo file (SELFDEV, 2026-10-20).
	// Written with escapes, never as literal characters: a literal mojibake sample in this file's own source
	// trips this scan (measured — the tool flagged itself on its first run).
	for (const m of text.matchAll(/\uFFFD|[\u00c2\u00c3][\u0080-\u00bf]|\u00e2\u20ac[\u00a2\u0080-\u00bf]|\u00c3\u00a9/g)) {
		found.push({ path, at: m.index, what: `mojibake sequence ${JSON.stringify(m[0])}`, line: text.slice(0, m.index).split("\n").length });
	}
	return found;
}

function runTests(files) {
	process.stdout.write(`\nrunning ${files.length} derived test(s) sequentially (timeout ${TIMEOUT_MS}ms each)\n`);
	const results = [];
	for (const f of files) {
		const t0 = Date.now();
		const r = spawnSync(process.execPath, [join(ROOT, f)], { cwd: ROOT, encoding: "utf8", timeout: TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 });
		const timedOut = r.error?.code === "ETIMEDOUT";
		results.push({ file: f, ok: r.status === 0, timedOut, ms: Date.now() - t0, tail: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim().split("\n").slice(-6).join("\n") });
		process.stdout.write(`${r.status === 0 ? "PASS" : timedOut ? "TIMEOUT" : "FAIL"} ${f} (${((Date.now() - t0) / 1000).toFixed(1)}s)\n`);
		if (r.status !== 0 && results.at(-1).tail) process.stderr.write(`--- ${f} ---\n${results.at(-1).tail}\n`);
	}
	return results;
}

function main(argv) {
	const opts = parseArgs(argv);
	if (opts.help) {
		process.stdout.write(`${USAGE}\n`);
		return 0;
	}
	const coverage = validateManifest(ROOT);
	const manifest = readManifest(ROOT);
	const tests = discoverTests(ROOT);
	const sources = new Map(tests.map((t) => [t, readFileSync(join(ROOT, t), "utf8")]));
	const changed = opts.paths ? opts.paths.map((p) => ({ path: p, status: "P", via: "--paths" })) : changedPaths(opts.base);
	if (changed.length === 0) {
		process.stdout.write("nothing changed (working tree clean and no diff vs the base) — run the full gate when in doubt: node scripts/test.mjs --all\n");
		return 0;
	}

	const codeChanged = changed.filter((c) => !DOC_RE.test(c.path));
	const docOnly = codeChanged.length === 0;
	const hits = guardsFor(changed, sources);

	// A changed test file is selected whether or not anything names it.
	for (const c of changed) if (tests.includes(c.path)) {
		if (!hits.has(c.path)) hits.set(c.path, []);
		hits.get(c.path).push({ path: c.path, kind: "itself", needle: c.path });
	}

	const selected = [...hits.keys()].sort();
	// Tier, so a reader can see what is a direct guard and what is only a family mention. Under-selection is
	// the failure this exists to fix (a missed guard on the file you just edited), so --run takes BOTH tiers;
	// the tiers exist to explain a large set, not to shave it.
	const kinds = (t) => new Set(hits.get(t).map((h) => h.kind));
	const isDirect = (t) => {
		const k = kinds(t);
		return k.has("path") || k.has("itself");
	};
	const direct = selected.filter(isDirect);
	const mention = selected.filter((t) => !isDirect(t));
	const byArea = new Map(areaNames(manifest).map((a) => [a, filesForArea(manifest, a)]));
	const areaOf = (t) => {
		for (const [a, files] of byArea) if (files.includes(t)) return a;
		return "UNMAPPED";
	};

	// Where the changed code lives decides how much of the suite is plausibly implicated. Derived from the
	// diff, not from a guess about the change's intent.
	const implicatedAreas = new Set();
	for (const c of codeChanged) {
		if (/^(demo|src|scripts|tools)\//.test(c.path) || /^(cli|tui|ui|intent)\.mjs$/.test(c.path)) implicatedAreas.add("FULL GATE");
	}
	for (const t of selected) implicatedAreas.add(areaOf(t));

	const scannable = changed.filter((c) => TEXT_RE.test(c.path) && existsSync(join(ROOT, c.path)));
	const scan = opts.scan ? scannable.flatMap((c) => scanText(c.path)) : [];
	const cheap = docOnly && selected.length > 0 && selected.length <= CHEAP_CAP;

	const verdict = {
		ok: true,
		base: opts.base ?? "working-tree",
		changedPaths: changed.map((c) => `${c.status} ${c.path}`),
		docOnly,
		rule: "a demo test is selected when its own source contains the changed path, its containing directory, or its file name",
		selected: selected.map((t) => ({ test: t, area: areaOf(t), tier: isDirect(t) ? "direct" : "mention", why: hits.get(t).map((h) => `${h.kind}:${h.needle}`).sort().slice(0, 4).join(" ") })),
		areasImplicated: [...implicatedAreas].sort(),
		scanFindings: scan,
		fullGate: { command: "node scripts/test.mjs --all", tests, coverage: coverage.errors },
	};

	const runSet = opts.directOnly ? direct : selected;
	let runResults = null;
	if (opts.run && runSet.length && runSet.length <= CHEAP_CAP) runResults = runTests([...direct.filter((t) => runSet.includes(t)), ...runSet.filter((t) => !direct.includes(t))]);
	if (opts.json) {
		verdict.ran = runResults;
		verdict.directTier = direct;
		verdict.mentionTier = mention;
		verdict.ok = (runResults ? runResults.every((r) => r.ok) : true) && scan.length === 0;
		process.stdout.write(`${JSON.stringify(verdict, null, 2)}\n`);
		return verdict.ok ? 0 : 1;
	}

	process.stdout.write(`changed: ${changed.length} path(s)${opts.base ? ` (working tree + vs ${opts.base})` : ""} · doc-only: ${docOnly ? "YES" : "no"}\n`);
	for (const c of changed) process.stdout.write(`  ${c.status} ${c.path}\n`);

	if (scan.length) {
		process.stdout.write(`\nBYTE SCAN FAIL — ${scan.length} invisible character(s) in changed text files (a broken repro command is invisible in review):\n`);
		for (const f of scan) process.stdout.write(`  ${f.path}:${f.line} ${f.what}\n`);
	}

	if (selected.length) {
		process.stdout.write(`\nderived guards: ${selected.length} test(s) — ${direct.length} direct + ${mention.length} family mention (${verdict.rule})\n`);
		for (const t of selected) {
			const why = [...new Set(hits.get(t).map((h) => `${h.kind}:${h.needle}`))].sort().join(" ");
			process.stdout.write(`  ${isDirect(t) ? "direct " : "mention"} ${areaOf(t).padEnd(10)} ${t}\n      matched: ${why}\n`);
		}
	} else {
		process.stdout.write(`\nderived guards: none — no demo test names any changed path, so no area is a fast path here.\n`);
	}

	if (docOnly) {
		const docArea = filesForArea(manifest, "docs");
		process.stdout.write(
			`\nDOC-ONLY FAST PATH — the whole suite is ${tests.length} tests / ~42 s; the derived set above is ` +
				`${selected.length} test(s) (${direct.length} direct + ${mention.length} mention).\n` +
				`  run them:   node tools/what-to-test.mjs --run${opts.base ? ` --base=${opts.base}` : ""}\n` +
				`  or the area: node scripts/test.mjs --area docs   (${docArea.length} tests, measured 0.1 s) — but it is NOT this set: ` +
				`${selected.filter((t) => !docArea.includes(t)).map((t) => `${t} (${areaOf(t)})`).join(", ") || "nothing outside it"} ` +
				`sits outside area "docs" and would be missed by the area alone.\n`,
		);
	} else {
		process.stdout.write(`\nnot doc-only: ${codeChanged.length} non-doc path(s) changed, so the pre-landing gate is the FULL suite:\n  node scripts/test.mjs --all   (${tests.length} tests)\n`);
	}
	process.stdout.write(
		`\nNEVER LAND ON THE SUBSET: an area or a derived guard set is a working loop, not the gate ` +
			`(docs/runbooks/run-your-area.md). Full gate: node scripts/test.mjs --all · areas: node scripts/test.mjs --list\n`,
	);
	if (!coverage.ok) process.stdout.write(`\ntest-area manifest ROTATED: ${coverage.errors.join("; ")}\n`);

	if (!opts.run) return scan.length ? 1 : 0;
	if (runSet.length === 0) {		process.stdout.write(`\nnothing to run — the derived set is empty. The gate is the full suite: node scripts/test.mjs --all\n`);
		return 2;
	}
	if (runSet.length > CHEAP_CAP) {
		process.stdout.write(`\nrefusing to run ${runSet.length} derived guards here (> ${CHEAP_CAP}) — that is the full gate's job: node scripts/test.mjs --all\n`);
		return 2;
	}
	const runOk = runResults.every((r) => r.ok);
	process.stdout.write(`${runOk ? "all derived tests passed" : "DERIVED SET FAILED"}\n`);
	return runOk && scan.length === 0 ? 0 : 1;
}

try {
	process.exitCode = main(process.argv.slice(2));
} catch (e) {
	if (e instanceof UsageError) process.stderr.write(`${e.message}\n${USAGE}\n`);
	else process.stderr.write(`${e?.stack ?? e}\n`);
	process.exitCode = 2;
}
