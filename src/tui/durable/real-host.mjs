// Real host bundle: pi-coding-agent services built from the user's own config.
//
// `createAgentSessionServices` is what pi itself uses at startup. It loads the
// installed pi packages listed in settings.json, runs their extension factories,
// and registers the providers they declare — this is how a provider package such
// as pi-deepinfra reaches the ModelRuntime. The same ModelRuntime is then handed
// to the durable harness, so generation uses the configured provider and the
// operator's stored credentials.
import { loadCodingAgent } from "./imports.mjs";

export async function createRealHost({ cwd, agentDir }) {
	const ca = await loadCodingAgent();
	const resolvedAgentDir = agentDir ?? ca.getAgentDir();
	const services = await ca.createAgentSessionServices({ cwd, agentDir: resolvedAgentDir });
	const hostSessionManager = ca.SessionManager.inMemory(cwd);
	const { session: hostSession } = await ca.createAgentSessionFromServices({ services, sessionManager: hostSessionManager });
	const model = await resolveConfiguredModel(services);
	return { ca, hostSession, hostSessionManager, services, model };
}

/** The settings' default provider/model, falling back to the first authenticated model. */
async function resolveConfiguredModel(services) {
	const { settingsManager, modelRuntime } = services;
	const provider = settingsManager.getDefaultProvider();
	const modelId = settingsManager.getDefaultModel();
	if (provider !== undefined && modelId !== undefined) {
		const configured = modelRuntime.getModel(provider, modelId);
		if (configured !== undefined) return configured;
	}
	const available = await modelRuntime.getAvailable();
	if (available.length === 0) {
		throw new Error(
			"No configured model is available. Run Pi once and `/login <provider>`, or set defaultProvider/defaultModel in ~/.pi/agent/settings.json.",
		);
	}
	return available[0];
}
