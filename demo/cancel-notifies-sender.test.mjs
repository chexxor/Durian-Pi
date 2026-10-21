// demo/cancel-notifies-sender.test.mjs — #3470: a cancellation REACHES the other party.
//
// THE DEFECT: `complete_work` sends the sender a DONE notice — the notification channel exists
// and works in one direction. `cancel_work` recorded the reason ON THE ITEM ("for the other
// party and the queue view") but did not NOTIFY, so from the sender's side a cancelled item
// simply VANISHED. `revise_work` then answered "status=cancelled", which says WHAT happened and
// not WHY, so the sender guessed — and guessing cost a full re-registration cycle for eight
// branches plus a lead turn explaining that the original item was cancelled because it was
// already ruled.
//
// WHY THE REASON IS THE WHOLE POINT: "superseded", "duplicate", "already ruled" and "stale pin"
// imply four different next actions. Without the reason the sender must guess, and a guess
// produces a duplicate under a false premise.
//
// FAILING-FIRST: on main `cancelItem` does not exist (the logic is inline in the tool closure),
// so this demo cannot even import what it asserts.
//
// Run: node demo/cancel-notifies-sender.test.mjs  (exit 0 = pass)

import assert from "node:assert/strict";

import { RigQueue, cancelItem, isCancellationNotice, isNoticeItem } from "../src/rig.mjs";

let failures = 0;
function check(label, ok, detail = "") {
	if (ok) console.log(`  ok   ${label}`);
	else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
	}
}

// `cancelItem` needs only `tx.doc(RigQueue)` (that is what `enqueueItem` uses), so a plain
// mutable document is a faithful fake: no harness, no store, no scheduling.
function fakeTx() {
	const queue = { nextId: 1, items: [] };
	return { queue, tx: { doc: async (kind) => (kind === RigQueue ? queue : null) } };
}
const mkItem = (over = {}) => ({
	id: 3384,
	from: "pm",
	to: "lead",
	subject: "eight-branch disposition request",
	body: "body",
	status: "queued",
	transitions: [],
	...over,
});

try {
	console.log("\n=== the RECIPIENT cancels: the SENDER is notified, with the reason ===");
	const { queue, tx } = fakeTx();
	const item = mkItem();
	const out = await cancelItem(tx, { item, me: "lead", reason: "already ruled — duplicate of #3383" });
	check("the item is cancelled", item.status === "cancelled", item.status);
	check("the reason is recorded on the item", item.cancelReason === "already ruled — duplicate of #3383", item.cancelReason);
	check("a transition is recorded", item.transitions.some((t) => t.event === "cancelled" && t.by === "lead"), JSON.stringify(item.transitions));
	check("the other party is the SENDER", out.other === "pm", out.other);
	check("a notice was enqueued", typeof out.noticeId === "number", JSON.stringify(out));
	const notice = queue.items.find((it) => it.id === out.noticeId);
	check("the notice is addressed to the sender", notice?.to === "pm", JSON.stringify(notice));
	check("the notice is from the canceller", notice?.from === "lead", notice?.from);
	check("the notice is a NOTICE, not work", notice?.notice === true, String(notice?.notice));
	check("the subject names the cancelled item", notice?.subject === "CANCELLED #3384: eight-branch disposition request", notice?.subject);
	check("THE REASON TRAVELS in the body", String(notice?.body).includes("already ruled — duplicate of #3383"), notice?.body);
	check("the body names who cancelled", String(notice?.body).includes("cancelled by lead"), notice?.body);
	check("the tool's message names the notified party and the notice id", out.message.includes("notified pm") && out.message.includes(`#${out.noticeId}`), out.message);

	console.log("\n=== the SENDER cancels: the RECIPIENT is notified ===");
	const second = fakeTx();
	const own = mkItem({ id: 3394, from: "pm", to: "lead", status: "queued" });
	const out2 = await cancelItem(second.tx, { item: own, me: "pm", reason: "superseded by #3470" });
	check("the other party is the RECIPIENT", out2.other === "lead", out2.other);
	const notice2 = second.queue.items.find((it) => it.id === out2.noticeId);
	check("the recipient is told, with the reason", notice2?.to === "lead" && String(notice2?.body).includes("superseded by #3470"), JSON.stringify(notice2));

	console.log("\n=== a notice never spawns a notice (no chain) ===");
	const third = fakeTx();
	const doneNotice = mkItem({ id: 500, subject: "DONE #3384: eight-branch disposition request", notice: true, status: "queued" });
	const out3 = await cancelItem(third.tx, { item: doneNotice, me: "lead", reason: "housekeeping" });
	check("cancelling a DONE notice sends NO notice", out3.noticeId === null, JSON.stringify(out3));
	check("the queue gained nothing", third.queue.items.length === 0, `items=${third.queue.items.length}`);
	check("and the message SAYS no notice was sent", out3.message.includes("no notice sent"), out3.message);

	const fourth = fakeTx();
	const cancelNotice = mkItem({ id: 501, subject: "CANCELLED #9: something", notice: true, status: "queued" });
	const out4 = await cancelItem(fourth.tx, { item: cancelNotice, me: "pm", reason: "housekeeping" });
	check("cancelling a CANCELLED notice sends NO notice either", out4.noticeId === null && fourth.queue.items.length === 0);

	console.log("\n=== the predicates the guard relies on ===");
	check("isNoticeItem: DONE", isNoticeItem({ subject: "DONE #1: x" }) === true);
	check("isNoticeItem: CANCELLED", isNoticeItem({ subject: "CANCELLED #1: x" }) === true);
	check("isNoticeItem: a flag-only notice", isNoticeItem({ subject: "anything", notice: true }) === true);
	check("isNoticeItem: real work is NOT a notice", isNoticeItem({ subject: "build the landing screen" }) === false);
	check("isCancellationNotice: shape and flag", isCancellationNotice({ subject: "CANCELLED #1: x" }) && isCancellationNotice({ notice: true }));

	console.log("\n=== the tier is latched onto the notice (chain continuity) ===");
	const fifth = fakeTx();
	const tiered = mkItem({ id: 600, tier: "feature" });
	const out5 = await cancelItem(fifth.tx, { item: tiered, me: "lead", reason: "superseded" });
	const notice5 = fifth.queue.items.find((it) => it.id === out5.noticeId);
	check("the notice inherits the cancelled item's tier", notice5?.tier === "feature", JSON.stringify(notice5?.tier));

	assert.ok(true);
	console.log(
		failures === 0
			? "\nCANCEL NOTIFICATION PASS (the reason reaches the other party; notices never chain)"
			: `\nCANCEL NOTIFICATION FAIL — ${failures} check(s)`,
	);
} catch (err) {
	console.error("ERROR:", err?.message ?? err);
	failures += 1;
}

process.exit(failures === 0 ? 0 : 1);
