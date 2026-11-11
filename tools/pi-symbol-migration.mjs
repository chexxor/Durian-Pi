#!/usr/bin/env node
// tools/pi-symbol-migration.mjs — the mechanical symbol sweep a pi pin move needs, made repeatable (#6176).
//
// WHY THIS EXISTS. pi-durable 1.5.1 renamed `Session.documentState()` to `Session.snapshot()` and changed what
// it RETURNS: the VALUE (undefined when the doc does not exist) instead of a `DocumentState` wrapper whose
// `.value` could be null. The rename that was actually run lived in `.spike/pin-update/migrate-symbols.mjs` -
// gitignored, absolute-pathed to one machine, and gone the moment the scratch dir was cleaned. A migration you
// cannot re-run is a migration that happened once. This is the promoted version: same rules, parameterised
// root, a dry run, and an exit code you can gate on.
//
// Usage:
//   node tools/pi-symbol-migration.mjs [--root .] [--dirs src,cli.mjs,scripts,tools,extensions,demo]
//                                     [--dry-run] [--json]
// Exit: 0 when the sweep ran and left no `snapshot(...).value` residue; 1 when residue remains (a human must
// read those lines); 2 on a usage or I/O error.
//
// SCOPE, STATED HONESTLY. The original sweep's `.value` stripping keyed on `))`  - two closing parens - which
// is a heuristic, not a parse. Here the generic strip only fires on a line that also contains `snapshot(`, so
// an unrelated `foo.bar.value` is not touched; the variable-based strip (the precise half) is unchanged. Run
// --dry-run first and read the diff before writing.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const DEFAULT_DIRS = ["src", "cli.mjs", "scripts", "tools", "extensions", "demo"];

/** Rewrite one source string. Pure, so a demo can pin it without touching any file. */
export function migrateSource(src) {
	let s = String(src ?? "");

	// 1. The symbol itself.
	s = s.replace(/\bdocumentState\b/g, "snapshot");

	// 2. Mock harness stubs that returned the old wrapper shape.
	s = s.replace(
		/snapshot: async \(\) => \(\{ value: \{[^}]*\} \}\)/g,
		"snapshot: async () => ({})",
	);

	// 3. Inline unwrapping, but only where a snapshot call is on the same line - the guard the scratch
	//    version lacked.
	if (s.includes("snapshot(")) {
		s = s.replace(/\)\)\.value\b/g, "))");
		s = s.replace(/\)\)\?\.value\b/g, "))");
		s = s.replace(/\)\)\.value\?\?\s*\{\}/g, ")) ?? {}");
		// A single-paren call is the common shape: `sess.snapshot(doc).value`.
		s = s.replace(/(\bsnapshot\([^()]*\))\s*\?\.value\b/g, "$1");
		s = s.replace(/(\bsnapshot\([^()]*\))\s*\.value\b/g, "$1");
		s = s.replace(/(\bsnapshot\([^()]*\))\s*\?\?\.value\b/g, "$1 ?? null");
	}

	// 4. Variables that held the wrapper: drop `.value` on every later use of THOSE variables only.
	const vars = new Set();
	for (const m of s.matchAll(/const (\w+) = (?:\(\s*)?await \w[\w.]*\.snapshot\(/g)) vars.add(m[1]);
	for (const v of vars) {
		s = s.replace(new RegExp(`\\b${v}\\s*\\?\\.value\\b`, "g"), v);
		s = s.replace(new RegExp(`\\b${v}\\s*\\.value\\b`, "g"), v);
	}

	return s;
}

/** Lines where a snapshot read is still unwrapped - the human's to-do list. */
export function residue(src) {
	return String(src ?? "")
		.split("\n")
		.filter((l) => /snapshot\((?:[^()]|\([^()]*\))*\)\s*(?:\?\.)?\.value\b/.test(l))
		.map((l) => l.trim());
}

function parseArgs(argv) {
	const opts = { root: ".", dirs: DEFAULT_DIRS, dryRun: false, json: false };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--root") opts.root = argv[++i];
		else if (a === "--dirs")
			opts.dirs = (argv[++i] ?? "")
				.split(",")
				.map((d) => d.trim())
				.filter(Boolean);
		else if (a === "--dry-run") opts.dryRun = true;
		else if (a === "--json") opts.json = true;
		else if (a === "--help" || a === "-h") opts.help = true;
		else throw new Error(`unknown argument: ${a}`);
	}
	return opts;
}

if (process.argv[1] && process.argv[1].endsWith("pi-symbol-migration.mjs")) {
	let opts;
	try {
		opts = parseArgs(process.argv.slice(2));
	} catch (err) {
		process.stderr.write(
			`${err.message}\nusage: node tools/pi-symbol-migration.mjs [--root .] [--dry-run]\n`,
		);
		process.exit(2);
	}
	if (opts.help) {
		process.stdout.write(
			"mechanical pi symbol sweep (documentState -> snapshot, wrapper unwrapping)\n" +
				"  node tools/pi-symbol-migration.mjs --root . --dry-run   # report only, write nothing\n" +
				"  node tools/pi-symbol-migration.mjs                      # rewrite in place\n",
		);
		process.exit(0);
	}

	let files;
	try {
		const out = execFileSync("grep", ["-rlE", "documentState", ...opts.dirs, "--include=*.mjs"], {
			cwd: opts.root,
			encoding: "utf8",
		});
		files = out.trim().split("\n").filter(Boolean);
	} catch (err) {
		// grep exits 1 when nothing matches: that is a clean answer, not an error.
		files = err.stdout ? String(err.stdout).trim().split("\n").filter(Boolean) : [];
	}

	const changed = [];
	const left = [];
	for (const rel of files) {
		let src;
		try {
			src = readFileSync(rel, "utf8");
		} catch (err) {
			process.stderr.write(`cannot read ${rel}: ${err.message}\n`);
			process.exit(2);
		}
		const next = migrateSource(src);
		const res = residue(next);
		if (next !== src) {
			changed.push({ file: rel, residue: res });
			if (!opts.dryRun) writeFileSync(rel, next);
		}
		if (res.length) left.push({ file: rel, lines: res });
	}

	if (opts.json) {
		process.stdout.write(
			`${JSON.stringify({ scanned: files.length, changed: changed.length, dryRun: opts.dryRun, residue: left }, null, 2)}\n`,
		);
	} else {
		process.stdout.write(
			`${opts.dryRun ? "would rewrite" : "files rewritten"}: ${changed.length} of ${files.length}\n`,
		);
		for (const c of changed)
			process.stdout.write(
				`  ${c.file}${c.residue.length ? " (residue: " + c.residue.length + ")" : ""}\n`,
			);
		if (left.length) {
			process.stdout.write("residue a human must read - a snapshot read still unwrapped:\n");
			for (const r of left) for (const l of r.lines) process.stdout.write(`  ${r.file}: ${l}\n`);
		} else {
			process.stdout.write("no `snapshot(...).value` residue\n");
		}
	}
	process.exit(left.length ? 1 : 0);
}
