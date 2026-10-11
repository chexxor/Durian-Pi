// Loading configured extensions.
//
// The two things worth proving: a configured extension actually reaches a seat's
// model (so "support extensions" is real, not a config key that does nothing),
// and every way an extension can be wrong FAILS LOUDLY. The second half is the
// interesting one — a declared extension silently not loading is the same failure
// shape as the dropped constitution: the rig looks configured and runs as
// something else.
//
// Run: node demo/extensions.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxText } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { extensionNames, loadExtensions, parseExtensionList } from "../src/extensions.mjs";

const ctx = BACKGROUND_CONTEXT;
const durigDir = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const FIXTURE = "demo/fixtures/echo-extension.mjs";
// Fixtures go in the OS temp dir. The invalid ones below import nothing, and the
// one that does (demo/fixtures/echo-extension.mjs) is a tracked file, so a temp
// dir inside the repo would buy nothing and leave litter on any crash.
const dir = mkdtempSync(join(tmpdir(), "durig-ext-"));

/** Write a module and return its absolute path, which loadExtensions accepts. */
function fixture(name, source) {
	const path = join(dir, name);
	writeFileSync(path, source);
	return path;
}

try {
	/* ----------------------------------------------------- the config list */

	assert.deepEqual(parseExtensionList(undefined), [], "unset means none");
	assert.deepEqual(parseExtensionList(""), [], "an empty string means none");
	assert.deepEqual(parseExtensionList("./a.ts,./b.ts"), ["./a.ts", "./b.ts"]);
	assert.deepEqual(
		parseExtensionList(" ./a.ts , ./b.ts ,"),
		["./a.ts", "./b.ts"],
		"whitespace and a trailing comma are not errors - they are invisible in a config file",
	);
	assert.deepEqual(parseExtensionList(["./a.ts", "  ", "./b.ts"]), ["./a.ts", "./b.ts"], "array form works too");

	/* ------------------------------------------------------- loading works */

	const ok = await loadExtensions([FIXTURE], { cwd: durigDir });
	assert.equal(ok.length, 1);
	assert.equal(ok[0].name, "echo", "the extension's own name is used");
	assert.deepEqual(extensionNames(ok), ["echo"]);
	assert.ok(ok[0].path.endsWith("echo-extension.mjs"), "the resolved path is kept for reporting");

	// A relative path resolves against cwd, like every other setting.
	const viaRelative = await loadExtensions(["demo/fixtures/echo-extension.mjs"], { cwd: durigDir });
	assert.equal(viaRelative[0].name, "echo");

	/* ------------------------------------------- every wrong way fails loudly */

	const mustThrow = async (paths, pattern, why) => {
		await assert.rejects(
			() => loadExtensions(paths, { cwd: durigDir }),
			(err) => {
				assert.match(err.message, pattern, `${why} (got: ${err.message})`);
				return true;
			},
			why,
		);
	};

	await mustThrow(["./nope/absent.mjs"], /extension not found/, "a path that does not exist");
	await mustThrow(
		[fixture("no-export.mjs", "export const notAnExtension = 1;\n")],
		/exports nothing usable/,
		"a module with no usable export",
	);
	await mustThrow(
		[fixture("not-object.mjs", "export default 42;\n")],
		/not an extension object/,
		"a default export that is not an extension",
	);
	await mustThrow(
		[fixture("no-name.mjs", "export default { sections: [1] };\n")],
		/has no "name"/,
		"an extension without a name",
	);
	await mustThrow(
		[fixture("empty.mjs", "export default { name: 'empty' };\n")],
		/would do nothing/,
		"an extension that declares nothing - a no-op that looks configured",
	);
	await mustThrow(
		[fixture("throws.mjs", "throw new Error('boom on import');\n")],
		/cannot load extension/,
		"a module that throws while loading",
	);
	// Two entries with one name: pi-durable replaces by name, which is the
	// live-reload behaviour, and in a single config list it is a silent swap.
	const dupA = fixture("dup-a.mjs", "export default { name: 'dup', sections: [1] };\n");
	const dupB = fixture("dup-b.mjs", "export default { name: 'dup', sections: [1] };\n");
	await mustThrow([dupA, dupB], /two extensions are named "dup"/, "two extensions sharing a name");

	// Nothing declared is fine; one bad entry in a longer list still fails the
	// whole load rather than installing the good ones.
	await mustThrow([FIXTURE, "./nope/absent.mjs"], /extension not found/, "one bad path among good ones");

	/* ------------------------------- an installed extension reaches the model */

	// The strong proof. Observed through the `pi.system` entry's `sections` map,
	// which is what the model actually received.
	async function sectionsSeen(install) {
		const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
		const models = createModels();
		models.setProvider(faux.provider);
		const registry = createRegistry();
		for (const entry of install) registry.install(entry);
		const storage = await openNodeSqliteStorage(join(dir, `seen-${install.length}.sqlite`));
		const harness = await Harness.open(storage, { models, registry }, ctx);
		try {
			const convId = await harness.commit(async (tx) => {
				const conv = await tx.createConversation({ ownership: { kind: "ownerless" } });
				await configure(tx, conv.id, { model: { provider: "faux", modelId: "faux-seat" } });
				return conv.id;
			}, ctx);
			faux.setResponses([fauxAssistantMessage(fauxText("ok"))]);
			const conv = await harness.conversation(convId, ctx);
			const settled = await (await conv.submit({ type: "input", content: "hello" }, ctx)).wait(ctx);
			assert.equal(settled.status, "done", "the run settled");
			const page = await conv.entries({}, 20, undefined, ctx);
			const system = page.items.find((entry) => entry.kind === "pi.system");
			return system?.model?.[0]?.sections ?? null;
		} finally {
			await harness.close(ctx);
		}
	}

	const withExtension = await sectionsSeen([ok[0].extension]);
	assert.ok(withExtension, "a system entry was recorded");
	assert.match(
		String(withExtension["echo-note"]),
		/ECHO-EXTENSION-REACHED-THE-MODEL/,
		"the configured extension's section reaches the model's system prompt",
	);

	// The control: without installing it, the same key must be absent. Otherwise
	// the assertion above could pass for a reason that has nothing to do with this
	// loader.
	const without = await sectionsSeen([]);
	assert.equal(
		without?.["echo-note"],
		undefined,
		"the section is absent when the extension is not installed (this is the control)",
	);

	/* --------------------------------------- the CLI actually wires it in */

	// The loader working is not the same as durig using it. This drives the real
	// cli.mjs, which is where a config key that nothing reads would hide.
	const cli = (args, env) =>
		spawnSync(process.execPath, ["cli.mjs", ...args], {
			cwd: durigDir,
			env: {
				...process.env,
				DURIG_PROVIDER: "faux",
				DURIG_DB: join(dir, "cli.sqlite"),
				...env,
			},
			encoding: "utf8",
		});

	// config reports the list, so the setting is discoverable rather than folklore.
	const cfg = cli(["config"], { DURIG_EXTENSIONS: FIXTURE });
	assert.equal(cfg.status, 0, `config failed: ${cfg.stderr.slice(0, 200)}`);
	assert.match(
		cfg.stdout,
		/"DURIG_EXTENSIONS": "demo\/fixtures\/echo-extension.mjs"/,
		"the effective extension list is reported by config",
	);

	// Opening a harness installs them, and `up` says so.
	const good = cli(["up", "rig.v2.json"], { DURIG_EXTENSIONS: FIXTURE });
	assert.equal(good.status, 0, `up with an extension failed: ${good.stderr.slice(0, 300)}`);
	assert.match(
		good.stdout,
		/"extensions": \[\s*"echo"\s*\]/,
		"up names the extensions this process installed",
	);

	// And a declared extension that cannot load fails the command instead of
	// being skipped quietly.
	const bad = cli(["up", "rig.v2.json"], { DURIG_EXTENSIONS: "./nope/absent.mjs" });
	assert.notEqual(bad.status, 0, "a declared extension that cannot load must fail the command");
	assert.match(
		`${bad.stdout}${bad.stderr}`,
		/extension not found/,
		"and it must name the path, not just fail",
	);
} finally {
	try {
		rmSync(dir, { recursive: true, force: true });
	} catch (err) {
		console.error(`CLEANUP WARNING (temp dir kept): ${err?.message ?? err}`);
	}
}

// After the finally, so cleanup runs. A process.exit() INSIDE the try skips the
// finally entirely, which is how this test first left three temp dirs behind.
console.log(
	"EXTENSIONS TEST PASS (config list, load, all six failure modes, duplicate names, section reaches the model, CLI wiring)",
);
process.exit(0);
