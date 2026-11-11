#!/usr/bin/env node
// tools/suite-signature.mjs — group a red suite by CAUSE, not by the first line that happens to match (#6176).
//
// WHY THIS EXISTS. During the pi v1.5.1 pin move the suite went 93 PASS / 187 FAIL, and the scratch triage
// that lived in `.spike/pin-update/signature-classify.mjs` (gitignored, so it dies with the scratch dir)
// collapsed eight distinct failures into a single bucket called "(no stderr line)". That is not a cosmetic
// bug: a classifier whose buckets are keyed on whatever line its regex happened to hit first turns eight
// different causes into one excuse, which is exactly the failure mode the failure ledger (#3795) exists to
// prevent - "5 pre-existing reds" flattening three causes into one.
//
// WHAT THE FIX IS. A signature is built from the parts that identify a CAUSE: the exit code, whether the
// runner killed the test for timeout, the error CLASS, the site (file:line:col of the throw), and the
// message. When nothing recognisable is present, the row is NOT thrown into a shared catch-all: it gets a
// signature naming its own file and a digest of its own output. Two different failures can never land in one
// bucket by accident, and any bucket with more than one member prints its members so a human can see what
// was merged.
//
// Usage:
//   node scripts/test.mjs --all --jobs 8 > suite.out 2> suite.err
//   node tools/suite-signature.mjs suite.err            # or the combined capture; either works
//   node tools/suite-signature.mjs suite.err --json     # machine-readable
//   node tools/suite-signature.mjs --text '<capture>'  # a capture handed in, for tests
// Exit: 0 when at least one red block was classified; 1 when the capture contains no `--- <file> (exit N) ---`
// block (there is nothing to classify - a capture with no reds is not a triage result); 2 for a usage error.

import { readFileSync } from "node:fs";

const BLOCK_HEAD = /^--- (\S+) \(exit (\d+|null)\) ---$/;
const ERROR_LINE = /^(\w*(?:Error|Failed|Failure|Exception))(?: \[([A-Za-z0-9_]+)\])?: ?(.*)$/;

/** Split a runner capture into per-test blocks, keeping the exit code the runner reported.
 * `exit null` is REAL: scripts/test.mjs reports a killed test (SIGKILL on POSIX) with no code, so a
 * classifier that only accepts digits silently drops every timeout - the reddest kind of red there is. */
export function parseBlocks(text) {
	const blocks = [];
	let cur = null;
	for (const line of String(text ?? "").split("\n")) {
		const m = line.match(BLOCK_HEAD);
		if (m) {
			if (cur) blocks.push(cur);
			cur = { file: m[1], exit: m[2] === "null" ? null : Number(m[2]), body: [] };
		} else if (cur && !line.startsWith("full output:")) {
			cur.body.push(line);
		}
	}
	if (cur) blocks.push(cur);
	return blocks;
}

/**
 * One signature per CAUSE. Order of the parts matters for reading: a human scanning the output should see
 * kind, then where, then what. `key` is what groups; `label` is what a human reads.
 */
export function signatureOf(block) {
	const body = block.body ?? [];
	const timedOut = body.some((l) => /TIMED OUT after \d+ms/.test(l));

	let kind = null;
	let message = null;
	for (const line of body) {
		const m = line.trim().match(ERROR_LINE);
		if (m) {
			kind = m[1];
			if (m[2]) kind = `${m[1]}[${m[2]}]`;
			message = (m[3] || "").trim();
			break;
		}
		if (/^\s*\^\s*$/.test(line)) continue; // the caret under the offending token
		const at = line.trim().match(/^Error: (.*)$/);
		if (at) {
			kind = "Error";
			message = at[1].trim();
			break;
		}
	}

	let site = null;
	const frames = [];
	for (const line of body) {
		if (!/^\s*at\s/.test(line)) continue;
		// Two shapes: `at file://path:1:2` and `at fnName (file://path:1:2)`. Taking only the first shape
		// means the site of a real throw is lost, and the signature is weaker than it needs to be.
		const after = line
			.trim()
			.slice(3)
			.trim()
			.replace(/[)]+$/, "")
			.replace(/\{\s*$/, "");
		const target = after.includes("(")
			? after.slice(after.indexOf("(") + 1).replace(/\)+$/, "")
			: after;
		const m = target.match(/^(?:file:\/\/)?(\S+?)(?::(\d+):(\d+))?$/);
		if (m) frames.push({ file: (m[1] || "").split("/").pop(), pos: m[2] ? `${m[2]}:${m[3]}` : "" });
	}
	// Prefer the frame that IS this demo: the top frame of a truncated capture is often node's own loader,
	// which names a site but not the one a human needs.
	const stem = (block.file || "").split("/").pop();
	const own = frames.find((f) => f.file === stem);
	if (own) site = own.pos ? `${own.file}:${own.pos}` : own.file;
	else if (frames.length)
		site = frames[0].pos ? `${frames[0].file}:${frames[0].pos}` : frames[0].file;

	if (!kind) {
		// The runner shows head+tail of a long capture, so the error header is often cut and only the stack
		// survives. Node's `code: 'ERR_…'` line is still there, and that is enough to name the cause.
		for (const line of body) {
			const c = line.trim().match(/^code: '([A-Z0-9_]+)'\s*,?$/);
			if (c) {
				kind = c[1] === "ERR_ASSERTION" ? "AssertionError[ERR_ASSERTION]" : `Error[${c[1]}]`;
				message = "cause line cut by the runner's head+tail; named from the error code";
				break;
			}
		}
	}
	if (!kind) kind = timedOut ? "TIMEOUT" : "UNCLASSIFIED";
	if (!message) {
		// Nothing recognisable. Do NOT throw it into a shared catch-all: name the row, and if it produced
		// output, use the last line of THAT row's capture as its identity. Two silent failures in different
		// files are different failures; the predecessor's "(no stderr line)" bucket made them look like one.
		const last = body.filter((l) => l.trim()).slice(-1)[0] ?? "";
		message = last
			? `no error line; last output: ${last.trim().slice(0, 160)}`
			: `no output at all (${block.exit === null ? "killed" : `exit ${block.exit}`})`;
	}

	const where = site ?? block.file; // a signature always has a site: the throw, or the row it belongs to
	const key = `${block.exit === null ? "killed" : block.exit} | ${kind} | ${where} | ${message.slice(0, 200)}`;
	const label = `${kind} at ${where}: ${message.slice(0, 160)}`;
	return { key, label, kind, site: where, message, exit: block.exit, timedOut, file: block.file };
}

/** Classify a capture into cause groups, sorted by how many reds share the cause. */
export function classify(text) {
	const blocks = parseBlocks(text);
	const groups = new Map();
	for (const b of blocks) {
		const sig = signatureOf(b);
		if (!groups.has(sig.key))
			groups.set(sig.key, {
				key: sig.key,
				label: sig.label,
				kind: sig.kind,
				site: sig.site,
				members: [],
				notes: [],
				timedOut: sig.timedOut,
			});
		groups.get(sig.key).members.push(sig.file);
	}
	for (const g of groups.values()) {
		// Grouping is a judgement. Say out loud when it merged, so the next person can disagree with it
		// instead of inheriting a flattened "N reds of type X" line.
		if (g.members.length > 1)
			g.notes.push(
				`MERGED: ${g.members.length} reds share this cause - confirm they really do before writing one line about them`,
			);
	}
	return {
		blocks: blocks.length,
		distinct: groups.size,
		groups: [...groups.values()].sort(
			(a, b) => b.members.length - a.members.length || a.key.localeCompare(b.key),
		),
	};
}

function parseArgs(argv) {
	const opts = { file: null, text: null, json: false };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--json") opts.json = true;
		else if (a === "--text") opts.text = argv[++i];
		else if (a === "--help" || a === "-h") opts.help = true;
		else if (a.startsWith("-")) throw new Error(`unknown argument: ${a}`);
		else opts.file = a;
	}
	return opts;
}

if (process.argv[1] && process.argv[1].endsWith("suite-signature.mjs")) {
	let opts;
	try {
		opts = parseArgs(process.argv.slice(2));
	} catch (err) {
		process.stderr.write(
			`${err.message}\nusage: node tools/suite-signature.mjs <capture> [--json] [--text '<capture>']\n`,
		);
		process.exit(2);
	}
	if (opts.help) {
		process.stdout.write(
			"group a suite capture's reds by cause.\n" +
				"  node scripts/test.mjs --all --jobs 8 > suite.out 2> suite.err\n" +
				"  node tools/suite-signature.mjs suite.err        # exit 0 when at least one red was classified\n" +
				"  node tools/suite-signature.mjs suite.err --json\n",
		);
		process.exit(0);
	}
	let text;
	try {
		text = opts.text ?? (opts.file ? readFileSync(opts.file, "utf8") : readFileSync(0, "utf8"));
	} catch (err) {
		process.stderr.write(`cannot read the capture: ${err.message}\n`);
		process.exit(2);
	}
	const result = classify(text);
	if (opts.json) {
		process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
	} else {
		for (const g of result.groups) {
			process.stdout.write(`[${g.members.length}] ${g.label}\n`);
			process.stdout.write(`    ${g.members.join(", ")}\n`);
			if (g.members.length > 1)
				process.stdout.write(
					`    MERGED: ${g.members.length} reds share this cause - confirm they really do before writing one line about them\n`,
				);
		}
		process.stdout.write(`reds: ${result.blocks}  distinct causes: ${result.distinct}\n`);
	}
	process.exit(result.blocks > 0 ? 0 : 1);
}
