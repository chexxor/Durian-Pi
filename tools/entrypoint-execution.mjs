#!/usr/bin/env node
// tools/entrypoint-execution.mjs - EXECUTION vs TEXT (#6377)
//
// WHY THIS EXISTS. "How many demos touch ui.mjs?" is a count of MENTIONS, and a mention can be
// a regex against the file's source or a spawn of the file. Those are different kinds of
// evidence: a source-text demo can pass while the entrypoint is broken, because nothing ever ran.
// The suite reports them in the same bucket, so coverage looks present when none of it is
// execution. This instrument separates the two and REPORTS - it does not decide. Source-text
// assertions are legitimate for things that cannot be spawned, so a gate here would punish them.
//
// THE RULE, stated so a reader can disagree with it. Each demo is classified PER ENTRYPOINT by
// what it does with that file's name:
//   spawned      - the name is an argument to spawn/spawnSync/exec/execSync/execFile, or appears
//                  in a command string run as `node <path>`. A process ran.
//   imported     - the name is `import`ed or `require`d. The entrypoint's top-level code ran, in
//                  this process - execution, but not a spawn.
//   source-text  - the file is read (readFileSync/readFile) and matched with a regex, .includes,
//                  .match or indexOf. Nothing ran.
//   mention      - the name appears only in a comment, a console line or a bare string: no
//                  assertion about that file at all.
// A demo can be both; the counts are reported side by side, not collapsed.
//
// Usage:
//   node tools/entrypoint-execution.mjs                        # entrypoints = shebang .mjs files
//   node tools/entrypoint-execution.mjs --entry cli.mjs --entry ui.mjs
//   node tools/entrypoint-execution.mjs --demo-dir demo --json out.json
// Exit: 0 always - this is a measurement, not a fault. 2 = the scan could not run.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";

const NODE_CMD_RE = /\bnode\s+(?:\S*\.)?[\w./-]*\.mjs/;
const READ_RE = /\b(readFileSync|readFile|fs\.read)\s*\([^)]{0,200}/;
const IMPORT_RE = /import\s+[^;]{0,200}|require\s*\(\s*[^)]{0,200}|from\s+["'][^"']{0,200}/;
const MATCH_RE = /\.(test|match|includes|indexOf|search)\s*\(/;

// A mention is the basename at a word boundary: `demo/foo.test.mjs` is NOT a mention of
// `test.mjs`, or every demo that runs a demo would count as running the test runner.
function mentions(text, name) {
	return new RegExp(`(?<![A-Za-z0-9_.-])${name.replace(/\./g, "\\.")}`).test(text);
}

/** Call-site text for each spawn-like call in a source file. Pure. */
function callSites(source, opener) {
	const out = [];
	const re = new RegExp(`\\b(${opener})\\s*\\(`, "g");
	let m;
	while ((m = re.exec(source)) !== null) {
		out.push(source.slice(m.index, m.index + 400));
	}
	return out;
}

/**
 * Classify one demo against one entrypoint basename. Returns a set of kinds the demo actually
 * performs. Pure: no filesystem, no spawn, so the demo can feed synthetic sources.
 */
function classifyDemo(source, name) {
	const kinds = new Set();
	if (!mentions(source, name)) return kinds;
	for (const site of callSites(source, "spawnSync|spawn|execSync|execFile|exec|fork")) {
		if (mentions(site, name)) kinds.add("spawned");
	}
	if (!kinds.has("spawned")) {
		// a `node x.mjs` command line is a spawn even when wrapped in a helper the classifier
		// does not know; it is only counted when the same line is not a file read
		const cmd = source.match(/.{0,80}node\s+\S*\.mjs.{0,80}/g) || [];
		if (cmd.some((c) => mentions(c, name) && !/\b(readFileSync|readFile)\b/.test(c))) kinds.add("spawned");
	}
	// an import or require pulls the entrypoint into THIS process: its top-level code ran
	for (const stmt of source.match(/import[^;\n]{0,200}|require\s*\(\s*[^)]{0,200}/g) || []) {
		if (mentions(stmt, name) && !/\b(readFileSync|readFile)\b/.test(stmt)) kinds.add("imported");
	}
	for (const site of callSites(source, "readFileSync|readFile|fs\\.read")) {
		if (mentions(site, name)) kinds.add("source-text");
	}
	if (!kinds.size && mentions(source, name)) kinds.add("mention"); // the name appears, nothing is asserted about it
	return kinds;
}

function listEntrypoints(root) {
	const atRoot = readdirSync(root).filter((f) => f.endsWith(".mjs")).map((f) => join(root, f));
	const scripts = readdirSync(join(root, "scripts")).filter((f) => f.endsWith(".mjs")).map((f) => join(root, "scripts", f));
	return [...atRoot, ...scripts].filter((p) => readFileSync(p, "utf8").startsWith("#!/usr/bin/env node"));
}

/**
 * Scan every demo against every entrypoint. `scan` is pure once the sources are in hand, so the
 * demo can pass fixtures instead of the live suite.
 */
function scan(demoDir, entries) {
	const demos = readdirSync(demoDir).filter((f) => f.endsWith(".test.mjs")).sort();
	const sources = demos.map((d) => ({ demo: d, source: readFileSync(join(demoDir, d), "utf8") }));
	const perEntry = entries.map((entry) => {
		const name = basename(entry);
		const rows = [];
		let mentionOnly = 0;
		for (const { demo, source } of sources) {
			const kinds = classifyDemo(source, name);
			if (!kinds.size) continue;
			if (kinds.size === 1 && kinds.has("mention")) { mentionOnly++; continue; }
			rows.push({ demo, kinds: [...kinds] });
		}
		const count = (kind) => rows.filter((r) => r.kinds.includes(kind)).length;
		return {
			entry: entry,
			name,
			demosTouching: rows.length,
			spawned: count("spawned"),
			imported: count("imported"),
			sourceText: count("source-text"),
			mentionOnly,
			rows,
		};
	});
	return { demosScanned: demos.length, entries: perEntry };
}

function print(report) {
	console.log(`EXECUTION vs TEXT - ${report.demosScanned} demos scanned (#6377)`);
	console.log("COVERED means RUN: a source-text demo reads the file and matches it, and cannot fail for a behavioural reason.");
	for (const e of report.entries.sort((a, b) => a.name.localeCompare(b.name))) {
		console.log(`  ${e.name.padEnd(22)} spawned=${String(e.spawned).padEnd(3)} imported=${String(e.imported).padEnd(3)} source-text=${String(e.sourceText).padEnd(3)} mention-only=${String(e.mentionOnly).padEnd(3)}`);
		const textOnly = e.rows.filter((r) => !r.kinds.includes("spawned") && !r.kinds.includes("imported") && r.kinds.includes("source-text"));
		if (e.spawned === 0 && textOnly.length) {
			console.log(`    ^ never run: ${textOnly.map((r) => r.demo).join(", ")} assert against its SOURCE only`);
		}
	}
}

function main(argv) {
	const root = process.cwd();
	const entries = [];
	let demoDir = join(root, "demo");
	let jsonOut = null;
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "--entry") entries.push(argv[++i]);
		else if (argv[i] === "--demo-dir") demoDir = argv[++i];
		else if (argv[i] === "--json") jsonOut = argv[++i];
	}
	const target = entries.length ? entries.map((e) => (e.startsWith("/") ? e : join(root, e))) : listEntrypoints(root);
	if (!target.length) { console.error("entrypoint-execution: no entrypoints found"); return 2; }
	const report = scan(demoDir, target);
	print(report);
	if (jsonOut) writeFileSync(jsonOut, JSON.stringify(report, null, 2));
	return 0;
}

if (process.argv[1] === new URL(import.meta.url).pathname) process.exit(main(process.argv.slice(2)));

export { classifyDemo, mentions, callSites, scan, listEntrypoints };
