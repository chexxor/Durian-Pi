// TUI-1 (dep): prove @earendil-works/pi-tui@1.1.0 is a real, importable
// dependency that renders headlessly — no TTY, no shell, native Windows.
//
// Failing-first: before the dependency exists, the import below throws
// ERR_MODULE_NOT_FOUND. After `npm install` locks it, the import resolves and a
// trivial render runs. This test only touches the package surface; it does NOT
// wire pi-tui into any UI (that is the separate build items).
//
// Run: node demo/pitui.test.mjs  (exit 0 = pass)
import { strict as assert } from "node:assert";

let tui;
try {
	tui = await import("@earendil-works/pi-tui");
} catch (err) {
	// Surface the failure clearly: the dep is missing or not resolvable.
	console.error(`IMPORT FAIL: ${err.code ?? err.name}: ${err.message}`);
	process.exit(1);
}

// 1. The dependency is real if it exports a usable surface.
assert.ok(tui && typeof tui === "object", "pi-tui must export a module namespace");

// 2. It resolved to the real built entry, not a stub. TWO spellings are legitimate: a plain npm
// install resolves through node_modules/@earendil-works/pi-tui, while the PINNED tree is linked
// (sync-pi --link) so the same package resolves through vendor/pi-main/packages/tui. Asserting
// only the first spelling is what made this demo red on a correctly-pinned tree (#2412/#3821).
const entry = import.meta.resolve("@earendil-works/pi-tui");
const builtEntry = /(?:node_modules[\/]@earendil-works[\/]pi-tui|vendor[\/]pi-main[\/]packages[\/]tui)[\/]dist[\/]index.js$/.test(entry);
assert.ok(builtEntry, `pi-tui resolved somewhere unexpected: ${entry}`);

// 3. A real headless render call runs with no TTY. `Text` is a leaf renderable
//    and `visibleWidth` measures a rendered cell string — together they exercise
//    the package's render path without opening a terminal.
assert.equal(typeof tui.Text, "function", "pi-tui must export Text");
assert.equal(typeof tui.visibleWidth, "function", "pi-tui must export visibleWidth");

const node = new tui.Text("hello pi-tui");
const lines = node.render ? node.render(40) : [];
const rendered = lines.join("\n");
assert.ok(rendered.includes("hello pi-tui"), `render produced: ${JSON.stringify(rendered)}`);

const width = tui.visibleWidth("hello pi-tui");
assert.equal(width, 12, `visibleWidth("hello pi-tui") = ${width}, expected 12`);

// 4. The screen classes pm's later TUI items name are actually present.
assert.equal(typeof tui.TuiMainScreen, "function", "pi-tui must export TuiMainScreen");
assert.equal(typeof tui.TuiAltScreen, "function", "pi-tui must export TuiAltScreen");

console.log(`PI-TUI ENTRY: ${entry}`);
console.log(`RENDER: ${JSON.stringify(rendered)} (width ${width})`);
console.log("PITUI TEST PASS");
