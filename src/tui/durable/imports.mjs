// Resolve the PINNED coding-agent package (the `@earendil-works/pi-coding-agent` dependency in
// package.json), NOT the mutable, machine-local managed install the spike used
// (~/.pi/agent/install/current-version). Build-spec §1: shipped code must not resolve the managed
// install; §3: the `DURABLE_TUI_AGENT_PACKAGE` override is REMOVED (it existed only to point the
// spike at a second copy). The pin itself is #2095 (devtools); this module is the product-side read.

export async function loadCodingAgent() {
	return import("@earendil-works/pi-coding-agent");
}

export async function loadDurable() {
	return import("@earendil-works/pi-durable");
}
export async function loadPiAi() {
	return import("@earendil-works/pi-ai");
}
export async function loadTui() {
	return import("@earendil-works/pi-tui");
}
