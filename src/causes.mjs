// src/causes.mjs — the rig's CAUSE VOCABULARY (#5047).
//
// WHY A MODULE FOR TWO STRINGS. A cause is named by the code that RAISES it and acted on by code far away: the
// provider seam stops the call, `src/attention.mjs` makes it visible, `src/supervisor.mjs` parks the item, the
// runbook points the operator at the ledger. If each of them spells the literal, the join breaks the day one of
// them reword, and the breakage is silent — the notice simply stops matching, and the seat retries something that
// costs money.
//
// The other reason is layering: the modules that ACT on a cause must not import the module that RAISES it just to
// read a name. `src/providers/spend.mjs` pulls pi-ai, `node:fs` and the ledger instrument; a pure notice
// computation over stored entries should not inherit any of that. So the name lives here, and BOTH sides import
// it.
//
// A cause is NOT a status. The submission still settles as `model_error` in the store (the run genuinely ended
// unanswered); what the cause adds is WHICH stop it was, so the retry policy, the notice and the escalation can
// branch on it instead of guessing from prose.

/** The rig's own cap stopped this call. Raised at the provider seam; parked, never retried. */
export const SPEND_CAUSE = "spend_cap_exceeded";

/** The cap keys, so a notice can name the one that fired instead of "a cap". */
export const SPEND_CAP_KEYS = ["DURIG_SPEND_CAP_CALL_USD", "DURIG_SPEND_CAP_RUN_USD", "DURIG_SPEND_CAP_STORE_USD"];

/**
 * Is this error message a MONEY stop from the rig's own cap (rather than a provider limit or a transport
 * failure)? Both tests are kept: the cause name, and the phrase the message carries so pi-ai's retry classifier
 * treats it as non-retryable (`pi-ai/utils/retry.js` NON_RETRYABLE_PROVIDER_LIMIT_ERROR_PATTERN). A message can
 * reach a seat entry after pi-ai has wrapped it, so matching is substring-based, never anchored.
 */
export function isSpendStopMessage(text) {
	if (typeof text !== "string") return false;
	return text.includes(SPEND_CAUSE) || text.includes("out of budget under it");
}

/** Which cap the message names (null when it names none) — for operator-facing detail, never for a decision. */
export function spendCapNamed(text) {
	return SPEND_CAP_KEYS.find((key) => String(text ?? "").includes(key)) ?? null;
}
