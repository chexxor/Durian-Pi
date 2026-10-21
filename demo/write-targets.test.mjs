// demo/write-targets.test.mjs — #4366: the WRITE-TARGET RESOLVER, table-driven.
//
// The guard `refusalForWrite({ root, path })` already exists (src/seatguard.mjs) and is NEVER
// reached from a shell command string, because nothing turns `> X`, `Set-Content -Path X` or
// `cp A B` into a `path`. THIS is that missing step: resolve the string into paths, and REPORT what
// it cannot resolve. A TABLE, not prose, so the next form is a row rather than a regression.
//
// Run: node demo/write-targets.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";

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

/* ─── redirection ────────────────────────────────────────────────────────── */
row("> X", "echo hi > out.txt", { cwd: "C:/seat", want: "C:/seat/out.txt" });
row(">> X", "echo hi >> out.txt", { cwd: "C:/seat", want: "C:/seat/out.txt" });
row("2> X", "cmd 2> err.txt", { cwd: "C:/seat", want: "C:/seat/err.txt" });
row("*> X", "cmd *> all.txt", { cwd: "C:/seat", want: "C:/seat/all.txt" });
row("quoted path", 'echo hi > "my file.txt"', { cwd: "C:/seat", want: "C:/seat/my file.txt" });
row("spaced path", "echo hi > my file.txt", { cwd: "C:/seat", want: "C:/seat/my" });
row("absolute path", "echo hi > C:/tmp/out.txt", { cwd: "C:/seat", want: "C:/tmp/out.txt" });
row("2>&1 is NOT a target", "cmd 2>&1", { cwd: "C:/seat", wantNone: true });

/* ─── named path parameters ──────────────────────────────────────────────── */
row("Set-Content -Path", "Set-Content -Path a.txt -Value 'hi'", { cwd: "C:/seat", want: "C:/seat/a.txt" });
row("Set-Content -LiteralPath", "Set-Content -LiteralPath a.txt -Value 'hi'", { cwd: "C:/seat", want: "C:/seat/a.txt" });
row("Add-Content -Path", "Add-Content -Path log.txt -Value 'x'", { cwd: "C:/seat", want: "C:/seat/log.txt" });
row("Out-File", "Out-File -FilePath out.txt", { cwd: "C:/seat", want: "C:/seat/out.txt" });
row("New-Item -Path", "New-Item -Path dir -ItemType Directory", { cwd: "C:/seat", want: "C:/seat/dir" });
row("Remove-Item -Path", "Remove-Item -Path gone.txt", { cwd: "C:/seat", want: "C:/seat/gone.txt" });
row("-Value is NOT a target", "Set-Content -Path real.txt -Value 'C:/looks/like/a/path.txt'", { cwd: "C:/seat", want: "C:/seat/real.txt" });
row("-Value alone is NO target", "Set-Content -Value 'C:/looks/like/a/path.txt' -Path", { cwd: "C:/seat", wantNone: true });

/* ─── copy / move: the DESTINATION is the target ─────────────────────────── */
row("cp A B", "cp a.txt b.txt", { cwd: "C:/seat", want: "C:/seat/b.txt" });
row("mv A B", "mv a.txt b.txt", { cwd: "C:/seat", want: "C:/seat/b.txt" });
row("Copy-Item -Destination", "Copy-Item a.txt -Destination b.txt", { cwd: "C:/seat", want: "C:/seat/b.txt" });
row("Move-Item -Destination", "Move-Item a.txt -Destination b.txt", { cwd: "C:/seat", want: "C:/seat/b.txt" });
row("xcopy A B", "xcopy srcdir dstdir", { cwd: "C:/seat", want: "C:/seat/dstdir" });

/* ─── the BASE case: -C / Set-Location moves the base for RELATIVE targets ── */
row("Set-Location base", "Set-Location sub; Set-Content -Path rel.txt -Value x", { cwd: "C:/seat", want: "C:/seat/sub/rel.txt" });
row("cd base", "cd sub && echo hi > rel.txt", { cwd: "C:/seat", want: "C:/seat/sub/rel.txt" });
row("git -C base", "git -C ../shared commit -m x", { cwd: "C:/seat", wantNone: true });
row("-C base then redirect", "pwsh -C ../shared -Command 'echo hi > rel.txt'", { cwd: "C:/seat", wantNone: true });

/* ─── the NEGATIVE case: a target INSIDE the seat root RESOLVES ──────────── */
// A resolver that reports every write as a target is fine; one that CANNOT TELL is not. This row
// asserts the resolver RESOLVES a path under the root - the ALLOW is the guard's job downstream.
row("target inside the seat root resolves", "Set-Content -Path note.txt -Value x", { cwd: "C:/seat", want: "C:/seat/note.txt" });

/* ─── the UNRESOLVED row: report, never pass silently ───────────────────── */
row("computed path is unresolved", "Set-Content -Path $p -Value x", { cwd: "C:/seat", wantUnresolved: true });
row("subexpression is unresolved", 'echo hi > (Join-Path a b)', { cwd: "C:/seat", wantUnresolved: true });

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
