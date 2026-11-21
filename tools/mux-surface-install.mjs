// tools/mux-surface-install.mjs — put /mux where a pi session loads it.
//
// WHY THIS EXISTS. `.pi/` is gitignored on purpose (`.gitignore`: machine-local pi agent state — a local-model
// endpoint and its key can land there — never committed). The command's source is TRACKED in `tools/`; each host
// installs it into `.pi/extensions/`, where pi-coding-agent's project-extension discovery looks.
//
//   node tools/mux-surface-install.mjs            # write/refresh the extension
//   node tools/mux-surface-install.mjs --check    # report only, exit 1 if missing or stale
//
// WHY EXACTLY ONE FILE IS INSTALLED (the same rule that governs tools/queue-surface-install.mjs, and why it is
// NOT like tools/compaction-guard-install.mjs, which copies its core too): the mux core statically imports the
// rig's own modules at `../src/broker.mjs`, `../src/storeownership.mjs` and their siblings, and the drivers sit
// beside it in `tools/`. Those relative paths are only correct while the core sits in the repo's `tools/`. Copy
// the core into `.pi/extensions/` would land those imports on `.pi/src/...`, which does not exist. So one file
// is installed, and its fallback import `../../tools/mux-surface-core.mjs` — measured to resolve under pi's jiti
// loader — lands back on the tracked core. One edited grammar therefore stays ONE file, and a session's `/mux`
// and `cli.mjs mux` cannot drift by construction.
//
// WHAT IS DELIBERATELY NOT INSTALLED: `tools/mux-surface-owner.mjs`, the plugin's only `child_process` module.
// A presentation command must not be able to reach the door that starts processes; only `cli.mjs mux` passes
// `--run`, and a session that wants the argv printed gets it printed.
//
// Cost: a file copy, no model, no network, no broker (D213). Verify after install with
// `node demo/mux-surface.test.mjs` or, in a session, `/mux --list`.
//
// Measured Linux / Fedora Linux 45 (Forty Five) / kernel 7.2.15-300.fc45.x86_64 / node v24.22.1: 0.02 s.
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";

const src = "tools/mux-surface-extension.js";
const dest = ".pi/extensions/mux-surface.js";
const checkOnly = process.argv.includes("--check");

if (!existsSync(src)) {
  console.error(`FAIL  source missing: ${src}`);
  process.exit(1);
}

const source = readFileSync(src, "utf8");
const installed = existsSync(dest) ? readFileSync(dest, "utf8") : null;
const same = installed === source;

if (checkOnly) {
  if (!installed) {
    console.log(`NOT INSTALLED  ${dest} does not exist — run: node tools/mux-surface-install.mjs`);
    process.exit(1);
  }
  console.log(same ? `UP TO DATE  ${dest}` : `STALE  ${dest} differs from ${src} (${installed.length} vs ${source.length} bytes)`);
  process.exit(same ? 0 : 1);
}

if (!same) {
  mkdirSync(".pi/extensions", { recursive: true });
  copyFileSync(src, dest);
  console.log(`INSTALLED  ${dest} (${source.length} bytes)  ${installed ? "refreshed" : "first install"}`);
} else {
  console.log(`UP TO DATE  ${dest} — the core and the drivers stay in tools/ on purpose (their ../src imports resolve from there)`);
}
