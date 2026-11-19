// src/tui/durable/cliargs.mjs — `tui.mjs`'s argument parsing, extracted so it is testable (#4164).
//
// WHY THIS EXISTS AS A MODULE: `tui.mjs` is an entrypoint — importing it runs a program — so its
// parsing could only be tested by spawning it, and spawning it with a VALID argv opens a real store and
// starts a TUI. Extracting the parser makes the rules assertable without a store, a TTY or a child.
//
// THE RULE THIS ENFORCES, and it is the general one: AN UNKNOWN FLAG IS REJECTED, NOT IGNORED. A flag
// that is silently discarded is a flag that lies — `enter.mjs` passed `--select <seat>` to this
// entrypoint for a whole item while the entrypoint did not accept it, so the caller's argv said
// something the child never did, and every test that only looked at the caller passed.
//
// `--select` IS NOW ACCEPTED. The store is still resolved by the caller (the seam's `resolveSeatStore`
// turns a seat into its store); this entrypoint's job is to CARRY the seat identity so the session can
// name it, rather than discarding it.

/** Every flag this entrypoint understands. Anything else is an error. */
export const KNOWN_FLAGS = new Set(["--db", "--select", "--attach", "--help", "-h"]);

/** Flags that take a value (the next token, or the text after `=`). `--attach` is NOT one. */
const VALUE_FLAGS = new Set(["--db", "--select"]);

/**
 * Parse `tui.mjs` argv.
 *
 * @param {string[]} argv
 * @returns {{db:string|null, select:string|null, attach:boolean, help:boolean, errors:string[]}}
 */
export function parseTuiArgs(argv = []) {
	const errors = [];
	let db = null;
	let select = null;
	let help = false;
	let attach = false;
	for (let i = 0; i < argv.length; i++) {
		const token = String(argv[i]);
		if (!token.startsWith("-")) {
			errors.push(`unexpected argument "${token}" — this entrypoint takes flags only`);
			continue;
		}
		const eq = token.indexOf("=");
		const name = eq >= 0 ? token.slice(0, eq) : token;
		if (!KNOWN_FLAGS.has(name)) {
			errors.push(`unknown flag "${name}" — known flags are ${[...KNOWN_FLAGS].join(", ")}`);
			continue;
		}
		if (name === "--help" || name === "-h") {
			help = true;
			continue;
		}
		// `--attach` is an ASK, not an override (#4006). It does not force the entrypoint into the
		// store; it says "the broker drives this store, so view that session read-only". src/storeownership.mjs
		// `tuiOpenVerdict` decides attach/open/refuse, and REFUSES an attach nothing owns — a flag that
		// promised access the store would not allow is the same kind of lie as a discarded flag.
		if (name === "--attach") {
			attach = true;
			continue;
		}
		if (!VALUE_FLAGS.has(name)) continue;
		let value;
		if (eq >= 0) value = token.slice(eq + 1);
		else {
			value = argv[i + 1];
			if (value === undefined || String(value).startsWith("-")) {
				errors.push(`flag "${name}" needs a value`);
				continue;
			}
			i++;
		}
		if (name === "--db") db = value;
		if (name === "--select") select = value;
	}
	return { db, select, attach, help, errors };
}
