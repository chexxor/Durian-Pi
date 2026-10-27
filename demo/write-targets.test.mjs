// demo/write-targets.test.mjs — #4366: the WRITE-TARGET RESOLVER, table-driven.
//
// The guard `refusalForWrite({ root, path })` already exists (src/seatguard.mjs) and is NEVER
// reached from a shell command string, because nothing turns `> X`, `Set-Content -Path X` or
// `cp A B` into a `path`. THIS is that missing step: resolve the string into paths, and REPORT what
// it cannot resolve. A TABLE, not prose, so the next form is a row rather than a regression.
//
// Run: node demo/write-targets.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";

import { writeTargets } from "../src/writetargets.mjs";

let failures = 0;
const rows = [];
function row(name, command, { cwd = null, want = null, wantNone = false, wantUnresolved = false } = {}) {
	rows.push({ name, command, cwd, want, wantNone, wantUnresolved });
}
const norm = (p) => String(p ?? "").replace(/\\/g, "/");
const runRow = (r) => {
	const { targets, unresolved } = writeTargets(r.command, { cwd: r.cwd });
	if (r.wantNone) return { ok: targets.length === 0, got: targets.map((t) => norm(t.path)).join(",") || "(none)" };
	if (r.wantUnresolved) return { ok: unresolved.length > 0, got: unresolved.length ? unresolved.map((u) => u.raw).join(",") : "(none)" };
	return { ok: targets.some((t) => norm(t.path) === r.want), got: targets.map((t) => norm(t.path)).join(",") || "(none)" };
};

// THE SEAT ROOT IS A PLATFORM FACT, NOT A LITERAL (D131). Every row below used `C:/seat` as the
// seat root, which is an ABSOLUTE path only on Windows: on POSIX `path.resolve("C:/seat", "out.txt")`
// is `<cwd>/C:/seat/out.txt` — correct POSIX behaviour, and 23 rows failed for it on the Linux box.
// The resolver was right and the FIXTURE was Windows-shaped. `SEAT` is an absolute root on whichever
// OS the suite runs on, so a row says "a file under the seat root" instead of "a Windows path".
const SEAT = process.platform === "win32" ? "C:/seat" : "/seat";
const TMP = process.platform === "win32" ? "C:/tmp" : "/tmp";

/* ─── redirection ────────────────────────────────────────────────────────── */
row("> X", "echo hi > out.txt", { cwd: SEAT, want: `${SEAT}/out.txt` });
row(">> X", "echo hi >> out.txt", { cwd: SEAT, want: `${SEAT}/out.txt` });
row("2> X", "cmd 2> err.txt", { cwd: SEAT, want: `${SEAT}/err.txt` });
row("*> X", "cmd *> all.txt", { cwd: SEAT, want: `${SEAT}/all.txt` });
row("quoted path", 'echo hi > "my file.txt"', { cwd: SEAT, want: `${SEAT}/my file.txt` });
row("spaced path", "echo hi > my file.txt", { cwd: SEAT, want: `${SEAT}/my` });
row("absolute path", `echo hi > ${TMP}/out.txt`, { cwd: SEAT, want: `${TMP}/out.txt` });
row("2>&1 is NOT a target", "cmd 2>&1", { cwd: SEAT, wantNone: true });

/* ─── named path parameters ──────────────────────────────────────────────── */
row("Set-Content -Path", "Set-Content -Path a.txt -Value 'hi'", { cwd: SEAT, want: `${SEAT}/a.txt` });
row("Set-Content -LiteralPath", "Set-Content -LiteralPath a.txt -Value 'hi'", { cwd: SEAT, want: `${SEAT}/a.txt` });
row("Add-Content -Path", "Add-Content -Path log.txt -Value 'x'", { cwd: SEAT, want: `${SEAT}/log.txt` });
row("Out-File", "Out-File -FilePath out.txt", { cwd: SEAT, want: `${SEAT}/out.txt` });
row("New-Item -Path", "New-Item -Path dir -ItemType Directory", { cwd: SEAT, want: `${SEAT}/dir` });
row("Remove-Item -Path", "Remove-Item -Path gone.txt", { cwd: SEAT, want: `${SEAT}/gone.txt` });
row("-Value is NOT a target", "Set-Content -Path real.txt -Value 'C:/looks/like/a/path.txt'", { cwd: SEAT, want: `${SEAT}/real.txt` });
row("-Value alone is NO target", "Set-Content -Value 'C:/looks/like/a/path.txt' -Path", { cwd: SEAT, wantNone: true });

/* ─── copy / move: the DESTINATION is the target ─────────────────────────── */
row("cp A B", "cp a.txt b.txt", { cwd: SEAT, want: `${SEAT}/b.txt` });
row("mv A B", "mv a.txt b.txt", { cwd: SEAT, want: `${SEAT}/b.txt` });
row("Copy-Item -Destination", "Copy-Item a.txt -Destination b.txt", { cwd: SEAT, want: `${SEAT}/b.txt` });
row("Move-Item -Destination", "Move-Item a.txt -Destination b.txt", { cwd: SEAT, want: `${SEAT}/b.txt` });
row("xcopy A B", "xcopy srcdir dstdir", { cwd: SEAT, want: `${SEAT}/dstdir` });

/* ─── the BASE case: -C / Set-Location moves the base for RELATIVE targets ── */
row("Set-Location base", "Set-Location sub; Set-Content -Path rel.txt -Value x", { cwd: SEAT, want: `${SEAT}/sub/rel.txt` });
row("cd base", "cd sub && echo hi > rel.txt", { cwd: SEAT, want: `${SEAT}/sub/rel.txt` });
row("git -C base", "git -C ../shared commit -m x", { cwd: SEAT, wantNone: true });
// `-Command '...'` keeps the body as ONE token; the resolver RECURSES into it with the current base,
// so a relative write after a `-C` is caught rather than left opaque (a seat runs a shell this way).
// `../shared` is resolved from the seat root, so the expectation follows the platform too.
row("-C base then nested redirect", "pwsh -C ../shared -Command 'echo hi > rel.txt'", { cwd: SEAT, want: resolve(dirname(SEAT), "shared/rel.txt") });

/* ─── the NEGATIVE case: a target INSIDE the seat root RESOLVES ──────────── */
// A resolver that reports every write as a target is fine; one that CANNOT TELL is not. This row
// asserts the resolver RESOLVES a path under the root - the ALLOW is the guard's job downstream.
row("target inside the seat root resolves", "Set-Content -Path note.txt -Value x", { cwd: SEAT, want: `${SEAT}/note.txt` });

/* ─── the UNRESOLVED row: report, never pass silently ───────────────────── */
row("computed path is unresolved", "Set-Content -Path $p -Value x", { cwd: SEAT, wantUnresolved: true });
row("subexpression is unresolved", 'echo hi > (Join-Path a b)', { cwd: SEAT, wantUnresolved: true });

console.log("\n=== writeTargets — table ===");
for (const r of rows) {
	const { ok, got } = runRow(r);
	if (ok) console.log(`  ok   ${r.name}`);
	else {
		failures += 1;
		console.log(`  FAIL ${r.name}  cmd=${JSON.stringify(r.command)}  want=${r.wantNone ? "(none)" : r.wantUnresolved ? "(unresolved)" : r.want}  got=${got}`);
	}
}

assert.equal(failures, 0, `${failures} table row(s) failed`);
console.log(`\nWRITE-TARGETS TEST PASS (${rows.length} rows: redirection, named params, copy/move destinations, base-changing, negatives, unresolved)`);
process.exit(0);
