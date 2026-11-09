// demo/tui-landing-name-gap.test.mjs — item #4354 (designer spec #4352 §4: the NAME rung goes 9 -> 10)
//
// The derivation in one line: a landing row books sel 2 + state 13 + NAME 9 + queue 9 = 33 fixed cells,
// and there is NO separate separator cell between the name and the queue column — the padding edge of the
// name field IS the separator. So a seat whose name is exactly 9 cells long (the census tops at
// `architect`) renders glued against the parked pole: `architect4q · 175p`. The ruling is that the cell is
// bought in the NAME field, AFTER the name, where the row has slack — not by compressing the parked pole
// (`4q · 175p` -> `4q·175p`), which would spend the legibility of the triage fact to buy a gap. The rung's
// general form is: rung >= longest seat name + 1.
//
// FAILING-FIRST: on the pre-fix tree sections 1-3 fail (glued pole, no gutter, prefix 33). Section 4's
// floor assertions already pass and must KEEP passing — they are why the caps exist.
//
// Run: node demo/tui-landing-name-gap.test.mjs  (exit 0 = pass)

import { frameToLines, renderTui } from "../src/tui/client.mjs";
import { textWidth } from "../src/textwidth.mjs";

let failures = 0;
const check = (label, ok, detail = "") => {
	if (ok) console.log(`  ok   ${label}`);
	else {
		failures++;
		console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
	}
};

// The longest name the census actually has, a short one, and one in between.
const SEATS = [
	{ name: "architect", role: "design" },
	{ name: "impl", role: "implementation engineer" },
	{ name: "scribe", role: "documentation" },
];
const items = [];
// `architect` carries the worst row the census offers: the full nine-cell parked pole `4q · 175p`.
for (let i = 0; i < 4; i++) items.push({ id: 9000 + i, from: "pm", to: "architect", subject: "queued work", status: "queued" });
for (let i = 0; i < 175; i++) items.push({ id: 9100 + i, from: "pm", to: "architect", subject: "parked work", status: "deferred" });
items.push({ id: 9200, from: "pm", to: "impl", subject: "a short row", status: "queued" });
items.push({ id: 9201, from: "pm", to: "impl", subject: "parked on a question", status: "deferred" });

const health = { seats: SEATS, queueItems: items, attention: [] };
const rowsAt = (width) =>
	frameToLines(renderTui({ seats: SEATS, health, queueItems: items, width, height: 24 })).filter((line) =>
		SEATS.some((seat) => line.includes(seat.name)),
	);

/* ─── 1. the nine-cell pole renders whole, and it is not glued to the name ── */
console.log("\n=== 1. the parked pole is intact and separated from the name ===");
const row = rowsAt(80).find((line) => line.includes("architect"));
console.log(`  row: ${JSON.stringify(row)}`);
check("the pole `4q · 175p` is rendered whole", row?.includes("4q · 175p"), row);
check("a cell sits between the name and the pole", /architect\s+4q/.test(row ?? ""),
	"the glued `architect4q` shape is exactly what this rung kills");

/* ─── 2. the gutter is uniform, not a property of one row ─────────────────── */
console.log("\n=== 2. every landing row gets the same one-cell name gutter ===");
for (const seat of SEATS) {
	const r = rowsAt(80).find((line) => line.includes(seat.name));
	const at = r?.indexOf(seat.name);
	const next = r?.slice(at + seat.name.length, at + seat.name.length + 1);
	check(`${seat.name} (${textWidth(seat.name)} name cells) is followed by a space, not by the queue column`,
		next === " ", `next cell = ${JSON.stringify(next)}`);
}

/* ─── 3. the booked prefix: sel 2 + state 13 + name 10 + queue 9 = 34 ─────── */
console.log("\n=== 3. the fixed prefix is 34 cells (2 + 13 + 10 + 9) ===");
const beforePole = textWidth(row.slice(0, row.indexOf("4q")));
console.log(`  measured prefix before the pole: ${beforePole} cells`);
check("sel(2) + state(13) + name(10) = 25 cells before the queue column", beforePole === 25, `measured ${beforePole}`);

/* ─── 4. the floor: nothing the floor discipline protects is lost ─────────── */
console.log("\n=== 4. at the 44-column floor the pole is still whole and the row still fills ===");
const narrow = rowsAt(44).find((line) => line.includes("architect"));
check("the pole is not truncated at 44 columns", narrow?.includes("4q · 175p"), JSON.stringify(narrow));
check("the row still reaches the frame edge", textWidth(narrow ?? "") === 44, `width ${textWidth(narrow ?? "")}`);
const wide = rowsAt(120).find((line) => line.includes("architect"));
check("the row is byte-identical in shape at 120 columns (it fills, not caps)", textWidth(wide ?? "") === 120,
	`width ${textWidth(wide ?? "")}`);

console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — landing name gutter, ${failures} failing check(s)`);
process.exit(failures === 0 ? 0 : 1);
