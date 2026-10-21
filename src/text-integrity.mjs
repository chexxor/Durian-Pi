// text-integrity.mjs — detect and reverse Windows "mojibake" in text (#3241).
//
// THE FAILURE THIS REPRESENTS. On Windows PowerShell 5.1 `Get-Content` decodes with the
// ANSI code page (CP1252 here), not UTF-8. Read a UTF-8 file that way and one em dash
// (U+2014, bytes E2 80 94) becomes the three characters U+00E2 U+20AC U+201D; write those
// three characters back out as UTF-8 and the file now STORES the corruption. Reproduced
// on this host with:
//
//   Get-Content src.txt | Set-Content -Encoding UTF8 out.txt    # PS 5.1 -> 'â€”' in out.txt
//
// The same mis-decode on a READ alone is a display artefact: `git show` prints the em dash
// correctly while `Get-Content rig.selfdev.json` prints mojibake for a file that is fine on
// disk. Both halves matter, so this module answers one question with one implementation:
// "would re-decoding this text change it?" — the guard and the repair script share it.
//
// The reverse mapping is generated from Node's own windows-1252 decoder rather than typed
// by hand, so every byte 0x80..0xFF is authoritative.

const utf8 = new TextDecoder("utf-8", { fatal: true });
const cp1252 = new TextDecoder("windows-1252");

// char -> byte, for the code page that produced the mojibake.
const BYTE_OF_CHAR = new Map();
for (let b = 0; b < 0x100; b += 1) {
	BYTE_OF_CHAR.set(cp1252.decode(Uint8Array.of(b)), b);
}
// Latin-1 fallback: a text that was decoded as ISO-8859-1 rather than CP1252 keeps the
// C1 controls, and some tools decode with that table instead. Same byte value either way.
for (let b = 0x80; b < 0xa0; b += 1) {
	const c = String.fromCharCode(b);
	if (!BYTE_OF_CHAR.has(c)) BYTE_OF_CHAR.set(c, b);
}

// A mojibake run starts on a character that is a UTF-8 LEAD byte in the code page
// (C2..F4) and continues while characters are continuation bytes (80..BF).
const isLead = (b) => b >= 0xc2 && b <= 0xf4;
const isCont = (b) => b >= 0x80 && b <= 0xbf;

function decodePrefix(bytes) {
	// Longest valid UTF-8 prefix of `bytes`, or null. UTF-8 sequences are at most 4 bytes.
	for (let n = Math.min(4, bytes.length); n >= 2; n -= 1) {
		try {
			const text = utf8.decode(Uint8Array.from(bytes.slice(0, n)));
			return { text, length: n };
		} catch {
			// try a shorter prefix
		}
	}
	return null;
}

/**
 * Every place in `text` where a CP1252/Latin-1 mis-decode can be reversed.
 * @returns {{index:number,length:number,found:string,decoded:string}[]}
 */
export function findMojibake(text) {
	const s = String(text ?? "");
	const hits = [];
	let i = 0;
	while (i < s.length) {
		const lead = BYTE_OF_CHAR.get(s[i]);
		if (lead === undefined || !isLead(lead)) {
			i += 1;
			continue;
		}
		const bytes = [lead];
		let j = i + 1;
		while (j < s.length) {
			const b = BYTE_OF_CHAR.get(s[j]);
			if (b === undefined || !isCont(b)) break;
			bytes.push(b);
			j += 1;
		}
		const decoded = bytes.length > 1 ? decodePrefix(bytes) : null;
		if (decoded) {
			hits.push({
				index: i,
				length: decoded.length,
				found: s.slice(i, i + decoded.length),
				decoded: decoded.text,
			});
			i += decoded.length;
		} else {
			i += 1;
		}
	}
	return hits;
}

/** Reverse the mojibake. A no-op on clean text (idempotent). */
export function decodeMojibake(text) {
	const hits = findMojibake(text);
	if (hits.length === 0) return String(text ?? "");
	let out = "";
	let at = 0;
	for (const h of hits) {
		out += text.slice(at, h.index) + h.decoded;
		at = h.index + h.length;
	}
	return out + text.slice(at);
}

/** True when `bytes` decode as UTF-8 with no replacement or truncation. */
export function isUtf8(bytes) {
	try {
		utf8.decode(bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes));
		return true;
	} catch {
		return false;
	}
}

/** A one-line, greppable description of a hit (for reports and test output). */
export function describeHit(hit) {
	const cps = (t) => [...t].map((c) => `U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}`).join(" ");
	return `at ${hit.index}: ${cps(hit.found)} -> ${cps(hit.decoded)}`;
}
