// src/depplane.mjs — #6374: the three numbers a `check` must print before a green means anything.
//
// WHY THIS EXISTS. `node scripts/sync-pi.mjs --check` compares the PIN to UPSTREAM and says nothing
// about the tree you are standing in, and src/worktree.mjs prints a warning once at creation and then
// goes silent. Measured this session, three times: the same command exits 0 from the seat root and 1 in
// an item worktree, because the seat root's node_modules/@earendil-works/pi-durable is a SYMLINK into
// vendor/pi-main/packages/durable (the build of the pinned tag, 1.5.1) while an item worktree installs
// the LOCKFILE's released 1.3.0. Suite totals of 282/283 were produced in trees resolving different
// versions of the same library. A number without the tree is not a number, so the check prints the
// tree's plane on every run.
//
// THE THREE LEGS, each measured here, never assumed:
//   1. which pi-durable THIS tree resolves, and through what (vendored build vs released package);
//   2. what the pin CLAIMS (ref/sha/pinnedAt) and whether leg 1 matches it;
//   3. the store's `durable_schema.version` against the resolved package's CURRENT_SQLITE_SCHEMA_VERSION
//      — the pair that produces "Durable SQLite schema version 2 is newer than supported version 1".
//
// WHAT IT DOES NOT DO. It measures. It never refuses a run and never decides a severity; src/checkup.mjs
// turns the measurement into a fix-now finding, and a finding is something the operator can close, not a
// gate (the standing rule: a check may report, it may not decide).
//
// The store is opened READ-ONLY (node:sqlite, readOnly), so this module cannot migrate, cannot take the
// broker's write lock and cannot create a store (precedents: src/readonlystore.mjs, src/fleethealth.mjs).

import { DatabaseSync } from "node:sqlite";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";

const PI_PACKAGE = "@earendil-works/pi-durable";

/**
 * The checkout this code RUNS from - the tree whose node_modules the imports actually resolve from.
 * NOT process.cwd(): a scaffold in /tmp can be the cwd while the code still imports the checkout's
 * packages, and reporting "nothing is installed" for that dir would be a measurement of the wrong tree
 * (#6374).
 */
const CHECKOUT_ROOT = (() => {
	const parent = new URL("..", new URL(".", import.meta.url)); // src/ -> the checkout root
	return parent.pathname.replace(/^\/([A-Za-z]:)/, "$1");
})();

/**
 * The version a pin NAMES. Same rule as `pinVersion` in scripts/sync-pi.mjs; the demo asserts the two
 * spellings agree on the shipped pin, because two spellings of one threshold is how a rule un-pairs.
 */
export function pinVersion(pin) {
	const ref = pin?.ref;
	if (typeof ref !== "string" || !ref) return null;
	const m = ref.match(/^v?(\d+\.\d+\.\d+)/);
	return m ? m[1] : null;
}

/** Leg 1: what THIS tree resolves, and through what path. */
function readResolved(root) {
	const pkgPath = join(root, "node_modules", ...PI_PACKAGE.split("/"), "package.json");
	if (!existsSync(pkgPath)) return { version: null, via: null, path: pkgPath };
	let version = null;
	try {
		version = JSON.parse(readFileSync(pkgPath, "utf8")).version ?? null;
	} catch {
		version = null;
	}
	const isLink = (() => {
	 try {
		return lstatSync(join(root, "node_modules", ...PI_PACKAGE.split("/"))).isSymbolicLink();
	 } catch {
		return false;
	 }
	})();
	const real = (() => {
	 try {
		return realpathSync(pkgPath);
	 } catch {
		return pkgPath;
	 }
	})();
	return {
		version,
		via: real.includes("vendor/pi-main") ? "vendored build (sync-pi --link)" : "released package (lockfile)",
		path: real,
		linked: isLink,
	};
}

/** Leg 2: the pin, as written. */
function readPin(root) {
	const pinPath = join(root, "pi-main.pin.json");
	if (!existsSync(pinPath)) return null;
	try {
		return JSON.parse(readFileSync(pinPath, "utf8"));
	} catch {
		return null;
	}
}

/** Leg 3a: what the RESOLVED library says it supports. */
async function readSupported() {
	try {
	 const mod = await import("@earendil-works/pi-durable/storage/sqlite");
	 const version = mod?.CURRENT_SQLITE_SCHEMA_VERSION;
	 return {
		version: typeof version === "number" ? version : null,
		via: "CURRENT_SQLITE_SCHEMA_VERSION from the resolved package",
		migrations: Array.isArray(mod?.SQLITE_MIGRATIONS) ? mod.SQLITE_MIGRATIONS.map((m) => m.version) : null,
	 };
	} catch (err) {
		return { version: null, via: `the resolved pi-durable could not be imported: ${String(err?.message ?? err)}`, migrations: null };
	}
}

/** Leg 3b: what the store actually is, read without touching it. */
function readStoreSchema(dbPath) {
	if (!existsSync(dbPath)) return { version: null, why: `no store at ${dbPath}` };
	try {
		const db = new DatabaseSync(dbPath, { readOnly: true });
		try {
			const rows = db.prepare("SELECT version FROM durable_schema").all();
			if (!rows.length) return { version: null, why: "durable_schema table is empty" };
			return { version: Math.max(...rows.map((r) => Number(r.version))), why: null };
	 } finally {
		db.close();
	 }
	} catch (err) {
		return { version: null, why: `read-only open failed: ${String(err?.message ?? err)}` };
	}
}

/**
 * The plane, as measured. `line` is the one-line form the human sees; every field is a measurement,
 * not a judgement, and nothing here throws on a missing dependency - an unmeasurable leg is reported
 * as such.
 */
export async function readDependencyPlane({ root = CHECKOUT_ROOT, db = null } = {}) {
	const resolved = readResolved(root);
	const pin = readPin(root);
	const expected = pinVersion(pin);
	const supported = await readSupported();
	const dbPath = db ?? process.env.DURIG_DB ?? join(root, "selfdev.sqlite");
	const store = readStoreSchema(dbPath);

	const versionAgrees = resolved.version !== null && expected !== null && resolved.version === expected;
	const schemaAgrees = store.version === null || (supported.version !== null && store.version <= supported.version);

	return {
		package: PI_PACKAGE,
		resolved: resolved.version,
		resolvedVia: resolved.via,
		resolvedPath: resolved.path,
		pinRef: pin?.ref ?? null,
		pinSha: pin?.sha ?? null,
		pinnedAt: pin?.pinnedAt ?? null,
		pinVersion: expected,
		versionAgrees,
		storeSchema: store.version,
		storeSchemaWhy: store.why,
		supportedSchema: supported.version,
		supportedVia: supported.via,
		supportedMigrations: supported.migrations,
		schemaAgrees,
		db: dbPath,
		line:
		`pi-durable ${resolved.version ?? "(not installed)"} ${resolved.via ? `(${resolved.via})` : ""} · ` +
		`pin ${pin?.ref ?? "(no ref)"} sha ${(pin?.sha ?? "").slice(0, 8)} pinned ${pin?.pinnedAt ?? "(unknown)"} · ` +
		`store schema ${store.version ?? "(unreadable)"} vs supported ${supported.version ?? "(unknown)"}${store.version === null && store.why ? ` [${store.why}]` : ""}`,
	};
}