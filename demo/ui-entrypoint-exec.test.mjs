// demo/ui-entrypoint-exec.test.mjs — ui.mjs is SPAWNED, not pattern-matched (#6376).
//
// WHY THIS DEMO EXISTS. `ui.mjs` is the interactive entrypoint. Six demos read its source
// as a string and grep it; ZERO demos run it. The rig even states the reason out loud
// (demo/tui-enter-wiring.test.mjs:146: "ui.mjs is an ENTRYPOINT - importing it runs a
// program - so the wiring is asserted by reading"). That is a declared policy, not coverage:
// a grep for "ui.mjs" in demo/ returns hits and reads like coverage, while the composed
// program - the alt-screen handoff, the poll cadence, the SIGINT/q wiring, the top-level
// catch - is never executed. Six `process.exit` sites sit in the file; before this demo,
// none was reached by a test.
//
// WHAT COUNTS HERE: a process spawn with an observed exit code and observed bytes. A regex
// over ui.mjs is what created the false impression of coverage in the first place, so this
// demo never reads ui.mjs as text.
//
// HOW A PROGRAM THAT REQUIRES A TERMINAL IS RUN WITHOUT ONE. ui.mjs refuses to start when
// stdout is not a TTY, so the entrypoint is run under a SYNTHETIC terminal: a wrapper that
// sets stdout.isTTY/stdin.isTTY, replaces stdout.write with a recorder, and dumps every
// byte the entrypoint wrote. The program itself - its config load, its store read, its
// screen ownership, its driver, its signal handlers - is the real ui.mjs, unmodified.
//
// WHAT IS STILL UNEXERCISED, said out loud: a REAL PTY. There is no `script`, `expect` or
// PTY binding in this harness, so raw-mode arrow-key decoding and a terminal's DECSET 2026
// reply are asserted nowhere. The demo prints that as a SKIP so the landing report records
// it rather than counting it as a pass (#4996).
//
// Run: node demo/ui-entrypoint-exec.test.mjs   (exit 0 = pass)

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const REPO = process.cwd();
const UI = join(REPO, "ui.mjs");

let pass = 0, fail = 0;
function check(name, cond, detail = "") {
	if (cond) { pass++; console.log(`  ok   ${name}`); }
	else { fail++; console.log(`  FAIL ${name}${detail ? ` -- ${detail}` : ""}`); }
}
const esc = (s) => String(s).replace(/\x1b/g, "ESC");

const ENTER_ALT = "\x1b[?1049h";
const LEAVE_ALT = "\x1b[?1049l";
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";
const PASTE_OFF = "\x1b[?2004l";

/* ── run the entrypoint as it is, in a plain (non-TTY) process ── */
function runPlain(args, env = {}) {
	const r = spawnSync(process.execPath, [UI, ...args], { cwd: REPO, encoding: "utf8", env: { ...process.env, ...env }, timeout: 30000 });
	return { code: r.status ?? 1, out: r.stdout ?? "", err: r.stderr ?? "" };
}

/* ── run the entrypoint under a synthetic terminal; return the bytes it wrote ── */
const WRAPPER = `
import { writeFileSync } from "node:fs";
const frames = [];
process.stdout.write = (s) => { frames.push(String(s)); return true; };
process.stdout.isTTY = true;
process.stdin.isTTY = true;
process.stdin.setRawMode = () => process.stdin;
process.on("exit", () => writeFileSync(process.argv[3], JSON.stringify(frames)));
const sigintMs = Number(process.argv[4]);
if (Number.isFinite(sigintMs) && sigintMs > 0) setTimeout(() => process.kill(process.pid, "SIGINT"), sigintMs);
await import(process.argv[2]);
`;

function runTty({ args = [], db, sigintMs = 2600, stdin = null, dir }) {
	const wrapper = join(dir, "synthetic-terminal.mjs");
	const framesFile = join(dir, `frames-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
	writeFileSync(wrapper, WRAPPER);
	const r = spawnSync(process.execPath, [wrapper, UI, framesFile, String(sigintMs)], {
		cwd: REPO,
		encoding: "utf8",
		env: { ...process.env, DURIG_DB: db },
		input: stdin ?? "",
		timeout: 40000,
	});
	let frames = [];
	try { frames = JSON.parse(readFileSync(framesFile, "utf8")); } catch { frames = []; }
	return { code: r.status ?? 1, out: r.stdout ?? "", err: r.stderr ?? "", frames: frames.join("") };
}

const root = mkdtempSync(join(tmpdir(), "ui-entrypoint-exec-"));
try {
	const store = join(root, "ui-fixture.sqlite");
	const up = spawnSync(process.execPath, [join(REPO, "cli.mjs"), "up", join(REPO, "rig.starter.json"), "--no-serve"], {
		cwd: REPO, encoding: "utf8", env: { ...process.env, DURIG_DB: store }, timeout: 60000,
	});
	check("the fixture store the entrypoint will read actually exists", up.status === 0 && existsSync(store), `cli up exit ${up.status}: ${(up.stderr ?? "").slice(0, 200)}`);

	/* ── 1. --help: exit 0, usage on STDERR, nothing on stdout ── */
	const h = runPlain(["--help"]);
	check("--help exits 0", h.code === 0, `exit ${h.code}: ${h.err.slice(0, 200)}`);
	check("--help prints the usage header", /durig ui — the read-only TUI/.test(h.err), h.err.slice(0, 200));
	check("--help names the keys it will handle", /q \/ Ctrl\+C\s+quit/.test(h.err), h.err.slice(0, 300));
	check("--help writes NOTHING to stdout (usage is a human message, not a payload)", h.out === "", `stdout was: ${h.out.slice(0, 200)}`);

	/* ── 2. no terminal: the guard fires, and fires BEFORE the store is even looked at ── */
	const n = runPlain([], { DURIG_DB: join(root, "does-not-exist.sqlite") });
	check("running without a TTY exits 2", n.code === 2, `exit ${n.code}: ${n.err.slice(0, 200)}`);
	check("the guard says what is missing and what to use instead", /needs a terminal \(stdout is not a TTY; use watch\/log/.test(n.err), n.err.slice(0, 200));
	check("the guard is checked BEFORE the store (no 'no store at' message appears)", !/no store at/.test(n.err), n.err.slice(0, 200));
	check("the refusal goes to stderr, stdout stays empty", n.out === "", `stdout: ${n.out.slice(0, 200)}`);

	/* ── 3. a terminal, but no store: exit 2 with the path in the message, and the screen is never taken over ── */
	const t1 = runTty({ db: join(root, "no-such-store.sqlite"), sigintMs: 1200, dir: root });
	check("no store exits 2 under a terminal", t1.code === 2, `exit ${t1.code}: ${t1.err.slice(0, 200)}`);
	check("the message names the path it looked for", /no store at /.test(t1.err) && t1.err.includes(join(root, "no-such-store.sqlite")), t1.err.slice(0, 300));
	check("the alt screen is NEVER entered when the store is missing", !t1.frames.includes(ENTER_ALT), esc(t1.frames).slice(0, 300));

	/* ── 4. the composed program runs: handoff, at least one painted frame, SIGINT restores ── */
	const t2 = runTty({ db: store, sigintMs: 2600, dir: root });
	check("a terminal run exits 0 on SIGINT", t2.code === 0, `exit ${t2.code}: ${t2.err.slice(0, 300)}`);
	check("the alt-screen handoff happens (ENTER_ALT + hide cursor + clear)", t2.frames.includes(ENTER_ALT) && t2.frames.includes(HIDE_CURSOR), esc(t2.frames).slice(0, 200));
	check("the terminal is left usable: cursor shown, paste framing off, alt screen exited",
		t2.frames.includes(SHOW_CURSOR) && t2.frames.includes(PASTE_OFF) && t2.frames.includes(LEAVE_ALT), esc(t2.frames).slice(0, 300));
	check("restore is IDEMPOTENT: exactly one LEAVE_ALT in the whole run", t2.frames.split(LEAVE_ALT).length - 1 === 1, `count=${t2.frames.split(LEAVE_ALT).length - 1}`);
	const painted = t2.frames.split("\x1b[?2026h").filter((s) => /durig/.test(s));
	check("the poll loop PAINTS at least one frame (the composition, not a component, is exercised)", painted.length >= 1, `painted writes: ${painted.length}`);
	check("the frame names the rig and its seats", /durig · \d+ seats/.test(t2.frames), esc(t2.frames).slice(0, 300));
	check("the sync-output probe is emitted for a TTY (DECSET 2026 query)", t2.frames.includes("\x1b[?2026$p"), esc(t2.frames).slice(0, 200));

	/* ── 5. the cadence is real: a longer run paints more than a shorter one ── */
	const shortRun = runTty({ db: store, sigintMs: 900, dir: root });
	const longRun = runTty({ db: store, sigintMs: 3000, dir: root });
	const countFrames = (f) => (f.match(/\x1b\[H\x1b\[2J/g) ?? []).length;
	check("the poll keeps painting (declared pollMs 700: a 3s run paints more than a 0.9s run)", countFrames(longRun.frames) > countFrames(shortRun.frames), `short=${countFrames(shortRun.frames)} long=${countFrames(longRun.frames)}`);

	/* ── 6. `q` typed at the keyboard quits without any signal ── */
	const qRun = runTty({ db: store, sigintMs: 0, stdin: "q", dir: root });
	check("the q key reaches the quit wiring (exit 0, no SIGINT sent)", qRun.code === 0, `exit ${qRun.code}: ${qRun.err.slice(0, 300)}`);
	check("the q path restores the terminal", qRun.frames.includes(LEAVE_ALT) && qRun.frames.includes(SHOW_CURSOR), esc(qRun.frames).slice(0, 300));

	/* ── 7. a store that cannot be opened: the poll reports it INSIDE the frame and keeps running ──
	 * The driver's rule is that a failed poll must not kill the session (same discipline as `watch`).
	 * This is asserted by running the entrypoint, not by reading it. */
	const badDir = join(root, "looks-like-a-store");
	mkdirSync(badDir);
	const t3 = runTty({ db: badDir, sigintMs: 1500, dir: root });
	check("an unreadable store does not crash the UI: it exits 0 on SIGINT and reports the poll failure on stderr", t3.code === 0 && t3.err.includes("(poll failed: "), `exit ${t3.code}: stderr=${t3.err.slice(0, 200)}`);
	check("the poll error names the path it could not open", t3.err.includes(badDir), t3.err.slice(0, 200));
	check("the terminal is still restored when the poll never succeeds", t3.frames.includes(LEAVE_ALT) && t3.frames.includes(SHOW_CURSOR), esc(t3.frames).slice(0, 300));

	console.log("\nUNEXERCISED, stated rather than dropped:");
	console.log("SKIP: a real PTY is unavailable in this harness (no script/expect/pty binding), so raw-mode arrow-key decoding and a terminal's DECSET 2026 reply are asserted by nothing. Everything above runs the real entrypoint under a synthetic terminal.");
	console.log("SKIP: ui.mjs's fatal path - the uncaughtException/unhandledRejection handlers and the outer catch - is reached by nothing a test can legitimately trigger: every store failure the entrypoint can produce is swallowed by the driver's poll loop and self-heals. Those exit sites stay unexercised, and are named here rather than quietly omitted.");
} finally {
	rmSync(root, { recursive: true, force: true });
}

console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
