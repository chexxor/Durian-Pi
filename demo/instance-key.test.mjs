// demo/instance-key.test.mjs — ROADMAP 91 instance identity (docs/BROKER-SUPERVISION.md
// §8): ONE STORE ⇔ ONE DRIVER ⇔ ONE INSTANCE KEY, derived from the CANONICALIZED store
// path. The highest-risk detail is canonicalization: two spellings of one store must
// yield ONE key, or two drivers would race the same store (the wrong-rig class, #491/D18).
//
// FAILING-FIRST: before src/instance.mjs the derivation did not exist (the design doc
// says so verbatim: "the derivation does not exist in code"), so this file fails at
// import against the pre-change tree.
//
// Run: node demo/instance-key.test.mjs   (exit 0 = pass)

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import {
	acquireHostLock,
	canonicalStorePath,
	hostLockPath,
	instanceIdentity,
	instanceKey,
	releaseHostLock,
} from "../src/instance.mjs";
import { brokerStatePath, intentInboxDir, stopRequestPath } from "../src/broker.mjs";

const dir = mkdtempSync(join(tmpdir(), "durig-instance-"));
const isWin = process.platform === "win32";
let failures = 0;
function check(label, ok, detail = "") {
	if (ok) console.log(`  ok   ${label}`);
	else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
	}
}

try {
	// A store that exists on disk, so realpath can resolve junctions / 8.3 / case.
	const store = join(dir, "DB", "RIG.sqlite");
	mkdirSync(join(dir, "DB"), { recursive: true });
	writeFileSync(store, "");
	const other = join(dir, "OTHER.sqlite");
	writeFileSync(other, "");

	/* ── 1. Two spellings of ONE store ⇒ ONE key (the canonicalization trap). ── */
	const base = instanceKey(store);
	check("absolute spelling is the baseline", typeof base === "string" && base.length === 12, base);
	check("a relative spelling shares the key", instanceKey(relative(process.cwd(), store)) === base, `rel=${instanceKey(relative(process.cwd(), store))}`);
	check("`..` segments collapse to the same key", instanceKey(join(dir, "DB", "..", "DB", "RIG.sqlite")) === base);
	check("a trailing separator does not change the key", instanceKey(store + (isWin ? "\\" : "/")) === base);
	if (isWin) {
		check("case-different spellings share the key (Windows is case-insensitive)", instanceKey(join(dir, "db", "rig.SQLITE")) === base, `case=${instanceKey(join(dir, "db", "rig.SQLITE"))}`);
		check("forward vs back slashes share the key", instanceKey(store.replace(/\\/g, "/")) === base);
	}

	/* ── 2. A junction / symlink to the store's dir resolves to the same key. ── */
	const link = join(dir, "link");
	try {
		symlinkSync(join(dir, "DB"), link, isWin ? "junction" : "dir");
		check("a junction/symlink to the store's directory shares the key", instanceKey(join(link, "RIG.sqlite")) === base, `link=${instanceKey(join(link, "RIG.sqlite"))}`);
	} catch (err) {
		check("junction/symlink could be created for the test", false, String(err?.message ?? err));
	}

	/* ── 3. Different stores ⇒ different keys (they coexist). ── */
	check("two different stores get two different keys", instanceKey(other) !== base, `a=${base} b=${instanceKey(other)}`);

	/* ── 4. --instance is a human label only; it never changes the key. ── */
	const labeled = instanceIdentity(store, { label: "alpha" });
	const labeled2 = instanceIdentity(store, { label: "beta" });
	check("the --instance label does not change the derived key", labeled.key === labeled2.key && labeled.key === base);
	check("the label is carried for readability", labeled.label === "alpha" && labeled2.label === "beta");
	check("identity reports the store and the per-instance lock", labeled.store === store && labeled.lock === hostLockPath(store));

	/* ── 5. Markers stay STORE-scoped (per instance, never global). ── */
	check("the broker state marker is store-scoped", brokerStatePath(store) === `${store}.broker.json`, brokerStatePath(store));
	check(
		"two stores have disjoint marker sets",
		brokerStatePath(store) !== brokerStatePath(other) &&
			stopRequestPath(store) !== stopRequestPath(other) &&
			intentInboxDir(store) !== intentInboxDir(other),
	);
	check("canonicalization is a pure function of the store path", canonicalStorePath(store) === canonicalStorePath(store));

	/* ── 6. The per-instance lock: per store, exclusive, releasable. ── */
	check("the lock path is derived from the store", hostLockPath(store) === `${canonicalStorePath(store)}.host.lock`, hostLockPath(store));
	check("two stores get two different lock paths", hostLockPath(store) !== hostLockPath(other));

	const a1 = acquireHostLock(store);
	const a2 = acquireHostLock(store);
	const b1 = acquireHostLock(other);
	check("the first acquire of a store's lock succeeds", a1.acquired === true, JSON.stringify(a1));
	check("a second acquire of the SAME store is refused (one driver per store)", a2.acquired === false && a2.reason === "held", JSON.stringify(a2));
	check("a DIFFERENT store's lock is independent (instances coexist)", b1.acquired === true, JSON.stringify(b1));
	releaseHostLock(store);
	releaseHostLock(other);
	check("after release the lock can be re-acquired", acquireHostLock(store).acquired === true);
	releaseHostLock(store);
	check("releasing an absent lock is a no-op", releaseHostLock(store).released === false);

	console.log(failures === 0 ? "\nPASS — instance identity (one store ⇔ one key; canonicalization trap; per-instance lock + store-scoped markers)" : `\nFAIL — ${failures} check(s) failed`);
} finally {
	rmSync(dir, { recursive: true, force: true });
}

process.exit(failures === 0 ? 0 : 1);
