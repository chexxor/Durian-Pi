// Loading extensions from configuration.
//
// A pi-durable extension is a plain module: it exports
// `defineExtension({ name, sections, tools, hooks, tasks, wraps })`, and the
// application installs it into a registry. durig's own Router is one, which is
// why this file is a *loader* and not a new mechanism — the mechanism already
// exists and durig was already using it.
//
// TRUST BOUNDARY. An extension is code that runs inside durig's process with the
// harness API: it can commit entries and documents, start tasks and
// conversations, see prompts, and its tools inherit the same OS permissions the
// process has. There is deliberately **no auto-discovery** — no scanning a
// directory, no installing whatever a rig file mentions — because "which code
// runs in here" must stay an explicit operator decision. List only paths you
// trust, exactly as you would a dependency.
//
// This loads pi-DURABLE extensions. A pi *coding-agent* extension is a different
// thing (slash commands, a TUI, project-trust prompts) and cannot load here:
// durig depends on `pi-coding-agent` for the durable-TUI merge but has no
// interactive surface of its own (D21). See ROADMAP item 23.

import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** The shapes an extension may declare. An extension with none of them would be
 * installed and do nothing, which is worse than failing: it looks configured. */
const DECLARABLE = ["tools", "sections", "hooks", "tasks", "wraps"];

/**
 * `DURIG_EXTENSIONS` is a comma-separated list, in the same vocabulary as every
 * other setting (env, then the config file, then nothing). Blank entries are
 * dropped so a trailing comma is not an error, and whitespace around a path is
 * ignored because it is invisible in a config file.
 */
export function parseExtensionList(value) {
	if (value === undefined || value === null) return [];
	if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
	return String(value)
		.split(",")
		.map((entry) => entry.trim())
		.filter(Boolean);
}

/**
 * Import each path and return the extension it exports, or throw with the reason.
 *
 * Fails loudly and immediately, naming the path and what was wrong with it. A
 * declared extension that cannot load must never be skipped quietly: the operator
 * asked for it, and a rig running without it would look configured while doing
 * something else — the same failure shape as the dropped constitution.
 *
 * @param {string[]} paths      module paths, resolved against `cwd` when relative
 * @param {{cwd?: string}} [opts]
 * @returns {Promise<Array<{name: string, path: string, extension: object}>>}
 */
export async function loadExtensions(paths, { cwd = process.cwd() } = {}) {
	const loaded = [];
	const byName = new Map();
	for (const raw of parseExtensionList(paths)) {
		const path = isAbsolute(raw) ? raw : resolve(cwd, raw);
		if (!existsSync(path)) {
			throw new Error(`extension not found: ${raw} (resolved to ${path})`);
		}
		let mod;
		try {
			mod = await import(pathToFileURL(path).href);
		} catch (err) {
			throw new Error(`cannot load extension ${raw}: ${err?.message ?? err}`);
		}
		// `default` is the conventional export; `extension` is accepted so a
		// module can also export helpers alongside it.
		const extension = mod?.default ?? mod?.extension;
		if (extension === undefined || extension === null) {
			throw new Error(
				`extension ${raw} exports nothing usable - a module must default-export defineExtension({...}) or export it as \`extension\``,
			);
		}
		if (typeof extension !== "object") {
			throw new Error(
				`extension ${raw} is not an extension object (got ${typeof extension}) - use defineExtension({...})`,
			);
		}
		const name = extension.name;
		if (typeof name !== "string" || name.trim() === "") {
			throw new Error(`extension ${raw} has no "name" - every extension needs a unique name`);
		}
		if (!DECLARABLE.some((key) => Array.isArray(extension[key]) && extension[key].length > 0)) {
			throw new Error(
				`extension ${raw} ("${name}") declares no tools, sections, hooks, tasks or wraps, so installing it would do nothing - that is a mistake, not a no-op`,
			);
		}
		// pi-durable replaces an installed extension with the same name in place,
		// which is the live-reload behaviour. In ONE config list that is almost
		// certainly a copy-paste error, and it would be invisible.
		if (byName.has(name)) {
			throw new Error(
				`two extensions are named "${name}" (${byName.get(name)} and ${raw}) - the second would replace the first, silently`,
			);
		}
		byName.set(name, raw);
		loaded.push({ name, path, extension });
	}
	return loaded;
}

/** Names only, for reporting what a process is running. */
export function extensionNames(loaded) {
	return loaded.map((entry) => entry.name);
}
