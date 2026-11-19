// tools/queue-surface-install.mjs — put /queue where a pi session loads it.
//
// WHY THIS EXISTS. `.pi/` is gitignored on purpose (`.gitignore:15`: "Machine-local pi agent state: a
// local-model endpoint (and its key) can land here, so it is host-specific ... never committed"). The
// command's source is tracked in `tools/`; each host installs it into `.pi/extensions/`, which is where
// pi-coding-agent's project-extension discovery looks.
//
//   node tools/queue-surface-install.mjs            # write/refresh the extension
//   node tools/queue-surface-install.mjs --check    # report only, exit 1 if missing or stale
//
// WHY ONLY ONE FILE IS INSTALLED (unlike tools/compaction-guard-install.mjs, which copies its core too).
// The guard's core imports nothing outside itself, so copying it next to the extension makes the pair
// relocatable. Our core is different: it statically imports the rig's grammar at `../src/queue-command.mjs`
// and its siblings, and those paths are only correct when the core sits in the repo's `tools/`. Copying the
// core into `.pi/extensions/` would make those `../src/...` imports land on `.pi/src/...`, which does not
// exist. So exactly ONE file is installed, and its fallback import `../../tools/queue-surface-core.mjs` —
// measured to resolve under pi's jiti loader — lands on the tracked core, in the repo, in both planes. One
// edited grammar therefore stays ONE file, and a session and `cli.mjs queue` cannot drift by construction.
//
// Cost: a file copy, no model, no network, no broker (D213). Verify after install with
// `node demo/queue-pi-command.test.mjs` or, in a session, `/queue --list`.
//
// Measured Linux / Fedora Linux 45 (Forty Five) / kernel 7.2.15-300.fc45.x86_64 / node v24.22.1: 0.02 s.
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";

const src = "tools/queue-surface-extension.js";
const dest = ".pi/extensions/queue-surface.js";
const checkOnly = process.argv.includes("--check");

if (!existsSync(src)) {
  console.error(`FAIL  source missing: ${src}`);
  process.exit(1);
}

const source = readFileSync(src, "utf8");
const installed = existsSync(dest) ? readFileSync(dest, "utf8") : null;
const same = installed === source;

if (checkOnly) {
  if (!installed) { console.log(`NOT INSTALLED  ${dest} does not exist`); process.exit(1); }
  console.log(same ? `UP TO DATE  ${dest}` : `STALE  ${dest} differs from ${src} (${installed.length} vs ${source.length} bytes)`);
  process.exit(same ? 0 : 1);
}

if (!same) {
  mkdirSync(".pi/extensions", { recursive: true });
  copyFileSync(src, dest);
  console.log(`INSTALLED  ${dest} (${source.length} bytes)  ${installed ? "refreshed" : "first install"}`);
} else {
  console.log(`UP TO DATE  ${dest} — the core stays in tools/ on purpose (its ../src imports resolve from there)`);
}
