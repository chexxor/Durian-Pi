// tools/compaction-guard-install.mjs — put the compaction guard where the harness loads it.
//
// WHY THIS EXISTS. `.pi/` is gitignored on purpose (`.gitignore:15`: "Machine-local pi agent state: a
// local-model endpoint (and its key) can land here, so it is host-specific ... never committed"). The
// guard's source is tracked in `tools/`; each host installs it into `.pi/extensions/`, which is where
// pi-coding-agent's project-extension discovery looks (verified with
// `.spike/probe-extension-discovery.mjs`, which lists `.pi/extensions/compaction-guard.js` first).
//
//   node tools/compaction-guard-install.mjs            # write/refresh the extension
//   node tools/compaction-guard-install.mjs --check    # report only, exit 1 if missing or stale
//
// Cost: a file copy, no model, no network, no broker (D213). Verify after install with
// `node tools/compaction-guard-e2e.mjs` or, in a session, `/compaction-guard`.
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";

const src = "tools/compaction-guard-extension.js";
const dest = ".pi/extensions/compaction-guard.js";
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
	console.log(`INSTALLED  ${dest}  (${source.length} bytes; ${installed ? "refreshed" : "first install"})`);
} else {
	console.log(`UP TO DATE  ${dest}`);
}
