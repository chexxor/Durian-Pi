// tools/transcript-recovery.mjs — recover a delegate-written file's BODY out of the pi session transcripts.
//
// PROVENANCE (ROADMAP 233 instrument hygiene, operator GRANT 4, 2026-10-29). This is the promoted form of the
// delegate scratch script `.scratch/transcript-write-bodies.mjs`, which the 2026-10-28 incident named for exactly
// this promotion: "Instrument for the next session: `.scratch/transcript-write-bodies.mjs` (promote to
// `tools/transcript-recovery.mjs`)" (docs/incidents/2026-10-28-cross-os-ledger-pruned-and-untracked-loss.md:181).
// Before today it lived only in a gitignored scratch dir — i.e. the recovery instrument for a file-loss incident
// was itself one sweep from loss. Behaviour is unchanged; only the header and the usage line are new.
//
// WHAT IT IS. The harness keeps every assistant `toolCall` in a JSONL transcript under
// `~/.pi/agent/sessions/<cwd-slug>/`, including the full `content` argument of a `write` call. So "untracked and
// deleted" is NOT the same thing as "unrecoverable" — but the transcript layer is per-host, per-cwd, unversioned,
// and does not travel with a clone (docs/reviews/pi-harness-usage-audit-2026-10-28.md §"The transcripts are a
// durable layer nobody used"). Verified there: recovering `tools/channel-preflight.mjs` at 18,985 B,
// `tools/broker-serve.mjs` at 17,877 B and `tools/instrument-provenance.mjs` at 6,643 B from transcript bodies.
//
// READ-ONLY on the transcripts. It WRITES recovered bodies ONLY when `--out <dir>` is passed explicitly
// (docs/ROADMAP.md 239's acceptance: "running it never writes a file without an explicit `--out`"). Without `--out`
// it prints what it found and where it would write. Recovered content is EVIDENCE, not a landed file: it is a
// re-created artifact and must be labelled as one (233/D156) before anything commits it.
//
// Usage: node tools/transcript-recovery.mjs <session-dir> <basename-substring>... [--out <dir>]
//   e.g. node tools/transcript-recovery.mjs ~/.pi/agent/sessions/--home-chexxor-Git-Durian-Pi-- verify-sweep
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, basename } from "node:path";

const argv = process.argv.slice(2);
const outIdx = argv.indexOf("--out");
const out = outIdx >= 0 ? argv[outIdx + 1] : null;
if (outIdx >= 0) argv.splice(outIdx, 2);
const [dir, ...wanted] = argv;
if (!dir || wanted.length === 0) {
	console.error("usage: node tools/transcript-recovery.mjs <session-dir> <basename-substring>... [--out <dir>]");
	process.exit(2);
}
if (out) mkdirSync(out, { recursive: true });
else console.log("(no --out given: printing only — recovered bodies are NOT written)");

const seen = new Map(); // path -> {bytes, tool, session, ts, body, args}
for (const f of readdirSync(dir).filter((n) => n.endsWith(".jsonl")).sort()) {
	let n = 0;
	for (const l of readFileSync(join(dir, f), "utf8").split("\n").filter(Boolean)) {
		let e;
		try { e = JSON.parse(l); } catch { continue; }
		const c = e.message?.content;
		if (e.message?.role !== "assistant" || !Array.isArray(c)) continue;
		for (const x of c) {
			if (x?.type !== "toolCall") continue;
			const a = x.arguments ?? {};
			const p = String(a.path ?? a.file_path ?? "");
			if (!wanted.some((w) => basename(p.replace(/\\/g, "/")).includes(w))) continue;
			const body = a.content ?? "";
			const prev = seen.get(p);
			n++;
			if (!prev || String(body).length > prev.bytes) {
				seen.set(p, { bytes: String(body).length, tool: x.name, session: f.slice(0, 20), ts: e.timestamp, body, args: a });
			}
		}
	}
	if (n) console.log(`${f.slice(0, 34)}  ${n} matching write/edit call(s)`);
}

console.log(`\n=== largest body per path (${seen.size} paths) ===`);
for (const [p, v] of [...seen].sort((a, b) => b[1].bytes - a[1].bytes)) {
	console.log(`  ${String(v.bytes).padStart(6)} B  ${v.tool.padEnd(6)} ${v.session}  ${p}`);
	if (v.bytes > 200) {
		if (!out) { console.log(`      would write ${join("<--out dir>", basename(p.replace(/\\/g, "/")))} — pass --out <dir> to write it`); continue; }
		const dest = join(out, basename(p.replace(/\\/g, "/")));
		writeFileSync(dest, typeof v.body === "string" ? v.body : JSON.stringify(v.body, null, 1));
	}
}
