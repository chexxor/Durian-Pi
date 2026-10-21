// Adapter: run pi-coding-agent's InteractiveMode on top of a pi-durable
// conversation.
//
// Route B of the spike. The TUI is written against `AgentSessionRuntime` and
// `AgentSession`; pi-durable is a different (durable) substrate. This adapter
// presents the runtime shape the TUI expects and owns the conversation on the
// durable side:
//
//   - the transcript, live partial, model, thinking level, queue, and usage come
//     from the durable conversation (`viewState` + `watchEvents`);
//   - rendering-only host services (settings, model catalog, resource loader,
//     extensions, the pi-agent-core Agent) come from a real AgentSession used as
//     a shell, reached through a Proxy fallback. The shell's own generation loop
//     is never started; the durable harness runs generation.
//
// Scope of this spike (see README): boot, render a durable transcript, stream a
// durable generation, and submit operator input. Coding-agent-only features
// that have no durable analogue (bash, export, /tree, labels) are served by the
// delegated host shell, not reimplemented.
import { loadCodingAgent, loadDurable } from "./imports.mjs";
import { DurableEventBridge } from "./bridge.mjs";
import { isCompactionSummaryMessage, messageOfEntry, sessionEntryFromDurable } from "./translate.mjs";

/** Thrown when an operation needs a durable mapping the adapter does not define. */
export class DurableAdapterError extends Error {
	constructor(message) {
		super(message);
		this.name = "DurableAdapterError";
	}
}

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

/**
 * Read surface the TUI expects from `session.sessionManager`, built from durable
 * entries.
 *
 * A Proxy over the real (in-memory) coding-agent SessionManager: transcript
 * reads are overridden to reflect the durable conversation, while the write
 * methods the host shell uses for non-durable features (appendMessage,
 * appendCompaction, ...) delegate to that manager unchanged. Those writes are
 * coding-agent-local; the durable transcript remains the source of truth for
 * everything this spike renders.
 */
function createDurableSessionManager(ca, host, cwd) {
	const state = { entries: [], byId: new Map(), name: undefined, labels: new Map() };
	const own = {
		replace(entries) {
			state.entries = entries;
			state.byId = new Map(entries.map((entry) => [entry.id, entry]));
		},
		setName(name) {
			state.name = name;
		},
		getCwd() {
			return cwd;
		},
		getSessionDir() {
			return cwd;
		},
		getSessionFile() {
			return undefined;
		},
		getSessionId() {
			return "durable";
		},
		isPersisted() {
			return true;
		},
		usesDefaultSessionDir() {
			return false;
		},
		getSessionName() {
			return state.name;
		},
		getEntries() {
			return [...state.entries];
		},
		getEntry(id) {
			return state.byId.get(id);
		},
		getEntryCount() {
			return state.entries.length;
		},
		getLeafId() {
			return state.entries.at(-1)?.id ?? null;
		},
		getBranch() {
			return [...state.entries];
		},
		getHeader() {
			return null;
		},
		buildContextEntries() {
			return ca.buildContextEntries(state.entries, own.getLeafId(), state.byId);
		},
		buildSessionContext() {
			return ca.buildSessionContext(state.entries, own.getLeafId(), state.byId);
		},
		buildSessionProjection() {
			return ca.buildSessionProjection(state.entries, own.getLeafId(), state.byId);
		},
		/** Flat tree: durable entries carry no parent links, so every entry is a root. */
		getTree() {
			return state.entries.map((entry) => ({
				entry,
				children: [],
				...(state.labels.has(entry.id) ? { label: state.labels.get(entry.id) } : {}),
			}));
		},
		appendLabelChange(targetId, label) {
			if (label === undefined) state.labels.delete(targetId);
			else state.labels.set(targetId, label);
		},
	};
	return new Proxy(host, {
		get(target, property, receiver) {
			if (property in own) {
				const value = Reflect.get(own, property, own);
				return typeof value === "function" ? value.bind(own) : value;
			}
			const value = Reflect.get(target, property, target);
			return typeof value === "function" ? value.bind(target) : value;
		},
		set(target, property, value) {
			if (property in own) return Reflect.set(own, property, value, own);
			return Reflect.set(target, property, value, target);
		},
		has(target, property) {
			return property in own || Reflect.has(target, property);
		},
	});
}

/** Session facade: durable-owned members override; everything else delegates to the host shell. */
class DurableSessionCore {
	#parts;
	#bridge;
	#listeners = new Set();
	#entries = [];
	#messages = [];
	#model;
	#thinkingLevel = "medium";
	#scopedModels = [];
	#streaming = false;
	#inbox = [];
	#compacting = false;
	#retryAttempt = 0;
	#tokensBefore;
	#name;
	#sessionManager;
	#started = false;
	#context;
	#timestamps = new Map();
	#sequence = 0;
	#baseTime = Date.now();
	#disposers = [];

	constructor(parts) {
		this.#parts = parts;
		this.#context = parts.context;
		this.#sessionManager = createDurableSessionManager(parts.ca, parts.hostSessionManager, parts.cwd);
		this.#model = modelFromAgentDoc(parts.modelRuntime, parts.initialView.docs["pi.agent"]);
		this.#bridge = new DurableEventBridge({
			mapEntry: (entry) => sessionEntryFromDurable(entry, this.#timestampFor(entry.id), this.#tokensBefore ?? 0),
			isCompactionMessage: isCompactionSummaryMessage,
		});
		this.ready = this.#start();
	}

	get state() {
		const hostState = this.#parts.hostSession.state;
		return { ...hostState, messages: this.#messages, model: this.#model, thinkingLevel: this.#thinkingLevel };
	}

	get messages() {
		return this.#messages;
	}

	get model() {
		return this.#model;
	}

	get thinkingLevel() {
		return this.#thinkingLevel;
	}

	get scopedModels() {
		return this.#scopedModels;
	}

	get isStreaming() {
		return this.#streaming;
	}

	get isIdle() {
		return !this.#streaming && !this.#compacting;
	}

	get isCompacting() {
		return this.#compacting;
	}

	get pendingMessageCount() {
		return this.#inbox.length;
	}

	get retryAttempt() {
		return this.#retryAttempt;
	}

	get autoCompactionEnabled() {
		return this.#parts.hostSession.autoCompactionEnabled;
	}

	set autoCompactionEnabled(value) {
		this.#parts.hostSession.autoCompactionEnabled = value;
	}

	get sessionManager() {
		return this.#sessionManager;
	}

	get sessionFile() {
		return undefined;
	}

	get steeringMode() {
		return this.#parts.hostSession.steeringMode;
	}

	get followUpMode() {
		return this.#parts.hostSession.followUpMode;
	}

	async prompt(text, options = {}) {
		const content = toUserContent(text, options.images);
		await this.#parts.conversation.submit({ type: "input", content }, this.#context);
		if (options.streamingBehavior === undefined) await this.#parts.conversation.waitForIdle(this.#context);
	}

	subscribe(listener) {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	async abort() {
		await this.#parts.conversation.abort(this.#context);
	}

	abortRetry() {
		this.#parts.hostSession.abortRetry();
	}

	abortCompaction() {
		// A cooperative abort of the conversation's live tasks is how durable stops a
		// running compaction; the host shell has no compaction of its own to abort.
		void this.#parts.conversation.abort(this.#context);
	}

	abortBranchSummary() {
		this.#parts.hostSession.abortBranchSummary();
	}

	setModel(model) {
		this.#model = model;
		this.#notify({ type: "model_select", model });
	}

	setThinkingLevel(level) {
		this.#thinkingLevel = level;
		this.#notify({ type: "thinking_level_changed", level });
	}

	cycleThinkingLevel() {
		const levels = this.getAvailableThinkingLevels();
		const index = levels.indexOf(this.#thinkingLevel);
		const next = levels[(index + 1) % levels.length];
		this.setThinkingLevel(next);
		return next;
	}

	cycleModel() {
		if (this.#scopedModels.length === 0) return undefined;
		const index = this.#scopedModels.findIndex((entry) => entry.model === this.#model);
		const next = this.#scopedModels[(index + 1) % this.#scopedModels.length];
		this.setModel(next.model);
		return next.model;
	}

	getAvailableThinkingLevels() {
		return [...THINKING_LEVELS];
	}

	setScopedModels(models) {
		this.#scopedModels = models;
	}

	getSteeringMessages() {
		return this.#inbox.filter((item) => item.mode === "steer").map((item) => item.text);
	}

	getFollowUpMessages() {
		return this.#inbox.filter((item) => item.mode === "followUp").map((item) => item.text);
	}

	clearQueue() {
		const cleared = { steering: this.getSteeringMessages(), followUp: this.getFollowUpMessages() };
		this.#inbox = [];
		return cleared;
	}

	async steer(text) {
		await this.#parts.conversation.submit({ type: "input", content: text, whenBusy: "steer" }, this.#context);
	}

	async followUp(text) {
		await this.#parts.conversation.submit({ type: "input", content: text, whenBusy: "followUp" }, this.#context);
	}

	setSteeringMode(mode) {
		this.#parts.hostSession.steeringMode = mode;
	}

	setFollowUpMode(mode) {
		this.#parts.hostSession.followUpMode = mode;
	}

	getLastAssistantText() {
		for (let i = this.#messages.length - 1; i >= 0; i -= 1) {
			const message = this.#messages[i];
			if (message.role !== "assistant") continue;
			const text = message.content.find((block) => block.type === "text");
			if (text !== undefined) return text.text;
		}
		return undefined;
	}

	getUserMessagesForForking() {
		const out = [];
		for (const entry of this.#entries) {
			const message = messageOfEntry(entry);
			if (message?.role !== "user") continue;
			out.push({ entryId: String(entry.id), text: userText(message) });
		}
		return out;
	}

	getContextUsage() {
		const contextWindow = this.#model?.contextWindow ?? 0;
		for (let i = this.#messages.length - 1; i >= 0; i -= 1) {
			const message = this.#messages[i];
			if (message.role !== "assistant" || message.usage === undefined) continue;
			const tokens = this.#parts.ca.calculateContextTokens(message.usage);
			return { tokens, contextWindow, percent: contextWindow > 0 ? (tokens / contextWindow) * 100 : null };
		}
		return { tokens: null, contextWindow, percent: null };
	}

	async compact(instructions) {
		// The TUI's /compact passes the custom-instructions string directly.
		const text = typeof instructions === "string" ? instructions : instructions?.customInstructions;
		this.#compacting = true;
		try {
			await this.#parts.conversation.compact(text, this.#context);
			await this.#parts.conversation.waitForIdle(this.#context);
		} finally {
			this.#compacting = false;
		}
	}

	async waitForIdle() {
		await this.#parts.conversation.waitForIdle(this.#context);
	}

	setSessionName(name) {
		this.#name = name;
		this.#sessionManager.setName(name);
	}

	refreshContext() {
		this.#parts.hostSession.refreshContext();
	}

	async #start() {
		if (this.#started) return;
		this.#started = true;
		const view = await this.#parts.conversation.viewState(this.#context);
		this.#disposers.push(() => view.dispose());
		this.#applyView(view.value);
		this.#disposers.push(view.subscribe((value) => this.#applyView(value)));
		const stream = await this.#parts.watchEvents(this.#parts.harness, this.#parts.conversation.id, this.#context);
		this.#disposers.push(() => void stream.stop());
		stream.start(async (events) => {
			this.#trackRunState(events);
			for (const event of this.#bridge.translate(events)) this.#notify(event);
		});
	}

	#applyView(view) {
		const entries = [];
		for (const entry of view.entries) {
			if (entry.conversationId !== this.#parts.conversation.id) continue;
			const mapped = sessionEntryFromDurable(entry, this.#timestampFor(entry.id), this.#tokensBefore ?? 0);
			if (mapped !== undefined) entries.push(mapped);
		}
		// Durable's active transcript is already flat and ordered; coding-agent's
		// path walk needs parent links, so chain them into one branch.
		for (let i = 0; i < entries.length; i += 1) entries[i].parentId = i === 0 ? null : entries[i - 1].id;
		this.#entries = entries;
		this.#messages = entries.filter((entry) => entry.type === "message").map((entry) => entry.message);
		this.#sessionManager.replace(entries);
		this.#inbox = (view.docs["pi.inbox"]?.items ?? [])
			.filter((item) => item.mode === "steer" || item.mode === "followUp")
			.map((item) => ({ mode: item.mode, text: inboxText(item) }));
		const agent = view.docs["pi.agent"];
		if (agent?.thinkingLevel !== undefined) this.#thinkingLevel = agent.thinkingLevel;
	}

	#timestampFor(id) {
		// pi-durable entries carry no timestamp, so the adapter synthesizes a
		// monotonically increasing one from first observation. Ordering is faithful;
		// wall-clock accuracy is not, and the coding-agent entry shape requires one.
		let timestamp = this.#timestamps.get(id);
		if (timestamp === undefined) {
			timestamp = new Date(this.#baseTime + this.#sequence++).toISOString();
			this.#timestamps.set(id, timestamp);
		}
		return timestamp;
	}

	#trackRunState(events) {
		for (const event of events) {
			if (event.type === "run_start") this.#streaming = true;
			else if (event.type === "run_end") this.#streaming = false;
			else if (event.type === "auto_retry_start") this.#retryAttempt = event.attempt;
			else if (event.type === "auto_retry_end") this.#retryAttempt = 0;
			else if (event.type === "compaction_start") {
				this.#compacting = true;
				// durable stores no token count on the summary entry, so capture the
				// pre-compaction context size here for the TUI's "tokens before" line.
				this.#tokensBefore = this.#estimateContextTokens();
			} else if (event.type === "compaction_end") this.#compacting = false;
		}
	}

	#estimateContextTokens() {
		let tokens = 0;
		for (const message of this.#messages) tokens += this.#parts.ca.estimateTokens(message);
		return tokens;
	}

	#notify(event) {
		for (const listener of this.#listeners) void listener(event);
	}

	dispose() {
		for (const dispose of this.#disposers) dispose();
		this.#disposers = [];
		this.#listeners.clear();
	}
}

function userText(message) {
	if (typeof message.content === "string") return message.content;
	return message.content.find((block) => block.type === "text")?.text ?? "";
}

/** Best-effort text of a queued durable inbox item, for the TUI's pending-items display. */
function inboxText(item) {
	const content = item.content;
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content.find((block) => block?.type === "text")?.text ?? "";
	}
	return "";
}

/**
 * Build a coding-agent `Model` view from the durable `pi.agent` document.
 * The durable model ("faux" in this spike) is not in the coding-agent catalog,
 * so one is synthesized; the TUI only reads id/provider/name/contextWindow.
 */
function modelFromAgentDoc(modelRuntime, agentDoc) {
	const reference = agentDoc?.model;
	if (reference === undefined) return undefined;
	const known = modelRuntime.getModel(reference.provider, reference.modelId);
	if (known !== undefined) return known;
	return {
		id: reference.modelId,
		provider: reference.provider,
		name: `${reference.provider}/${reference.modelId}`,
		api: "faux",
		contextWindow: 128000,
		maxTokens: 8192,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		input: ["text"],
	};
}

function toUserContent(text, images) {
	if (images === undefined || images.length === 0) return text;
	return [{ type: "text", text }, ...images.map((image) => ({ type: "image", ...image }))];
}

/**
 * Build a durable-backed runtime for InteractiveMode.
 *
 * `options.host` lets a caller supply a real coding-agent host (services plus a
 * session). Without it an offline host is built: a ModelRuntime with no
 * credentials plus a placeholder model. `options.models` is the pi-ai `Models`
 * (or a coding-agent ModelRuntime, which implements `Models`) the durable
 * harness uses to generate; it defaults to the host's runtime, so a real host
 * makes generation use the configured provider.
 */
export async function createDurableTuiRuntime(options) {
	const [ca, durable] = await Promise.all([loadCodingAgent(), loadDurable()]);
	const context = options.context ?? (await import("@earendil-works/chord/context")).BACKGROUND_CONTEXT;
	const storage = options.storage ?? new durable.MemoryStorage();
	const registry = options.registry ?? durable.createRegistry();
	// The durable registry owns the toolset. Installing nothing (as before) leaves a
	// chat app; the default install matches Pi's coding toolset plus code mode.
	if (options.tools !== false) await installDefaultTools(durable, registry);
	const { NodeExecutionEnv } = await import("@earendil-works/pi-durable/env/node");
	const host = options.host ?? (await createOfflineHost(ca, options));
	const { hostSession, hostSessionManager, services } = host;
	const modelRuntime = services.modelRuntime;
	const models = options.models ?? modelRuntime;
	// Tools reach files and processes only through this environment, and the Harness
	// builds it per call from the conversation agent's cwd.
	const env = options.env ?? ((target) => new NodeExecutionEnv({ cwd: target.cwd ?? options.cwd }));
	const harness = await durable.Harness.open(
		storage,
		{ models, registry, env, ...(options.settings === undefined ? {} : { settings: options.settings }) },
		context,
	);
	const agentModel = options.agentModel ?? { provider: "faux", modelId: "faux-1" };
	const conversation =
		options.conversation ?? (await harness.root(context, { agent: { model: agentModel, cwd: options.cwd } }));

	const view = await conversation.viewState(context);
	const core = new DurableSessionCore({
		ca,
		cwd: options.cwd,
		hostSession,
		hostSessionManager,
		harness,
		conversation,
		context,
		watchEvents: durable.watchEvents,
		modelRuntime,
		initialView: view.value,
	});
	view.dispose();
	const session = new Proxy(core, {
		get(target, property) {
			if (property in target) {
				const value = Reflect.get(target, property, target);
				return typeof value === "function" ? value.bind(target) : value;
			}
			const value = Reflect.get(hostSession, property, hostSession);
			return typeof value === "function" ? value.bind(hostSession) : value;
		},
		set(target, property, value) {
			if (property in target) return Reflect.set(target, property, value, target);
			return Reflect.set(hostSession, property, value, hostSession);
		},
		has(target, property) {
			return property in target || Reflect.has(hostSession, property);
		},
	});

	const runtime = {
		services,
		session,
		cwd: options.cwd,
		diagnostics: [],
		modelFallbackMessage: undefined,
		setRebindSession() {},
		setBeforeSessionInvalidate() {},
		async newSession() {
			throw new DurableAdapterError("newSession is out of scope; switch durable conversations via the harness");
		},
		async switchSession() {
			throw new DurableAdapterError("switchSession is out of scope; switch durable conversations via the harness");
		},
		async fork() {
			throw new DurableAdapterError("fork is out of scope for this spike");
		},
		async importFromJsonl() {
			throw new DurableAdapterError("importFromJsonl is out of scope for this spike");
		},
		async dispose() {
			core.dispose();
			hostSession.dispose();
			await harness.close(context);
		},
	};
	return { runtime, harness, conversation, hostSession, session, services };
}

/** Pi's coding toolset (read/write/edit/bash, plus powershell on Windows) and code mode. */
async function installDefaultTools(durable, registry) {
	const tools = await import("@earendil-works/pi-durable/tools");
	registry.install(
		durable.defineExtension({
			name: "coding-tools",
			tools: [
				tools.createReadTool(),
				tools.createWriteTool(),
				tools.createEditTool(),
				tools.createBashTool(),
				tools.createPowerShellTool(),
			],
		}),
	);
	const { createCodemodeExtension } = await import("@earendil-works/pi-durable/codemode");
	const { CodemodeSandbox } = await import("@earendil-works/pi-codemode");
	registry.install(createCodemodeExtension({ sandbox: new CodemodeSandbox() }));
}

/** Offline host: no credentials and no network, for tests and the faux smoke run. */
async function createOfflineHost(ca, options) {
	const modelRuntime = await ca.ModelRuntime.create({
		...(options.authPath === undefined ? {} : { authPath: options.authPath }),
		...(options.modelsPath === undefined ? {} : { modelsPath: options.modelsPath }),
		refreshOnCreate: false,
	});
	const settingsManager = ca.SettingsManager.create(options.cwd, options.agentDir, { projectTrusted: true });
	const hostSessionManager = ca.SessionManager.inMemory(options.cwd);
	const { session: hostSession } = await ca.createAgentSession({
		cwd: options.cwd,
		agentDir: options.agentDir,
		modelRuntime,
		settingsManager,
		sessionManager: hostSessionManager,
		model: modelRuntime.getModels()[0],
	});
	return {
		hostSession,
		hostSessionManager,
		services: {
			cwd: options.cwd,
			agentDir: options.agentDir,
			modelRuntime,
			settingsManager,
			resourceLoader: hostSession.resourceLoader,
			diagnostics: [],
		},
	};
}
