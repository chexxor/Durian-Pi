Agents in a team get defined across roughly six separable layers, and different traditions (classical MAS, LLM frameworks, recent research) attack each layer with a different vocabulary. Here's the full map.
1. Identity & persona — who the agent is

The most common mechanism is simply the system prompt: a persona bundles role, expertise/domain knowledge, communication style, behavioral traits, and goals/motivations, plus explicit capability boundaries 4. Concrete instantiations:
Mechanism 	How it defines the agent
Prompt-based persona 	Detailed system prompt + "act as" role-play instructions + background narratives + few-shot examples 4
CrewAI triad 	role (area of expertise), goal (directs decisions), backstory (context that colors problem-solving) 7
MetaGPT profile 	name, profile, goal, and constraints per role 5
Psychometric injection 	Big Five traits operationalized as Goldberg bipolar adjective pairs (e.g. unkind–kind) plus 9-level qualifiers, prepended to the system prompt 8
Fine-tuning 	Reserved for personas/behaviors prompting can't reliably achieve 4

The psychometric route is notable because it's measurable: agreeableness is the only Big Five dimension whose wording significantly changes communication state and quality — conscientiousness and openness shape individual work style but not the team's communication 8.
2. Skills & capabilities — what the agent can do

Two distinct design moves: equip (give tools) and scope (state limits).

    Tools are the skills an agent calls to act on the world — built-in, imported, or custom 7.
    MetaGPT initializes specific context and skills per role: a Product Manager gets web search, an Engineer can execute code 5.
    Prompts should explicitly state what an agent should not do, and which tool set it's restricted to 4.
    A2A formalizes this as Agent Cards — advertised capabilities that enable dynamic, capability-aware task delegation based on real-time awareness of who can do what 1.

3. Role & organizational position — where the agent sits

Role is distinct from persona: it's the agent's slot in the division of labor.

    Role-based protocols give each agent a segmented objective drawn from domain knowledge; AgentVerse assigns specific responsibilities, MetaGPT encodes SOPs where each role carries expert-level knowledge 6. Unambiguous role specialization is what lets complex work decompose into smaller, specific tasks 5.
    The classical MAS tradition built explicit organizational models: AGR is based on agent, group, and role as its core concepts 19; MOISE defines roles (constraining individual behavior), organizational links (regulating social exchanges), and groups (constraining agent layout) 11.
    Static vs dynamic assignment: static architectures fix channels from domain rules, while dynamic ones have a management agent generate personas and tailored system prompts in real time — e.g. Solo Performance Prompting identifies relevant personas from the input 6.

4. Culture, values & norms — the team's shared operating ethos

This is the layer you flagged, and it's the least mature. Three approaches stand out:

Society architecture. Some systems model agents inside a broader social environment governed by shared norms or rules, producing emergent behavior — Generative Agents form friendships and adapt behavior from past experience 1.

Constitutions as explicit, priority-ordered rules. A constitution is a set of natural-language rules, each with a short name, behavioral guidance, and an explicit priority level; when rules conflict, the highest-priority applicable rule governs 3. These can be evolved: Constitutional Evolution optimizes rules against a Societal Stability Score combining productivity (utilitarian), survival of the worst-off (Rawlsian), and conflict penalty (negative externalities), using LLM-driven evolutionary search over multiple migrating islands 3 3. The winning rules were operationally specific and prioritized — "Deposit First," "Survival Focus," "Dynamic Targeting," "Conflict Avoidance" — rather than vague ("Be Helpful") 3.

Cultural dimensions. Cross-cultural psychology supplies the vocabulary: Hofstede's individualism/collectivism, power distance, uncertainty avoidance, etc., and Hall's high-context vs. low-context communication — the lesson being that the same instruction or negotiation strategy can be interpreted differently across cultural settings 2. Values can also be represented as value–belief–norm structures that link beliefs, values, and decisions, moving beyond static persona labels toward explanatory structures 2. The human-centered survey's framework treats culture, values, cognition, and cooperation as things to model jointly with the MAS infrastructure, not bolt on 2.
5. Collaboration rules & protocols — how they're allowed to work together

IBM draws the cleanest first cut: rule-based collaboration tightly controls agent actions/communication with a shared policy (if-then statements, state machines, logic frameworks), whereas role-based collaboration assigns responsibilities within an organizational framework, each role carrying its own functions, permissions, and objectives 9. The collaboration survey adds a third: model-based strategies 6.

At the protocol level, the classical mechanisms still underpin everything:

    FIPA-ACL / KQML are built on speech act theory — messages are communicative acts (request, inform, propose) that perform actions rather than merely transfer data 12 10.
    The Contract Net Protocol (Smith, 1980) is a task-sharing protocol that turns allocation into a sealed auction: a manager broadcasts a call for proposals, idle agents bid, and the manager awards 20 13.
    Modern counterparts: MCP (client–server context for agent-to-resource), A2A (peer capability-based delegation via Agent Cards), and ANP (decentralized P2P mesh using DIDs and JSON-LD) 1 1.

The LLM-era paradigms for how messages are formulated: message passing (direct/broadcast), speech acts (directive/persuasive utterances that trigger actions), and blackboard (a shared repository — MetaGPT posts status updates and code to a central pool) 1 1.
6. Communication topology & sequencing — who talks to whom, when
Dimension 	Options
Architecture 	Flat (P2P), Hierarchical (layers w/ oversight + execution), Team (specialized groups), Society (shared norms), Hybrid 1
Structure 	Centralized/star (hub agent manages all), Decentralized/distributed (P2P), Hierarchical 6 6
Goals 	Cooperation (direct or through debate), Competition, Mixed 1 1
Timing strategy 	One-by-one (serial, preserves context, latency + error propagation), Simultaneous-talk (parallel, stale/conflicting state), Simultaneous-talk with summarizer (adds an alignment agent) 1 1
Speaker control 	AutoGen's GroupChatManager picks the next speaker via LLM or a custom function; also round-robin, random, manual, and a pre-defined allowed_speaker_transitions_dict 14 15 16
7. Process / workflow — the team's operating sequence

    MetaGPT is the canonical example: SOPs formalize the workflow so all agents work sequentially — PM → Architect → Project Manager → Engineer → QA — and agents communicate through structured documents and diagrams rather than dialogue, preventing irrelevant or missing content 5 5.
    CrewAI processes: sequential (tasks in order, each output passed forward as context), hierarchical (a generated manager agent assigns work, reviews, validates), and a planned consensual democratic process 7.
    CAMEL uses inception prompting to fix two roles (AI user + AI assistant) with a task-specifier prompt and role-specific system prompts that include termination conditions to prevent role-flipping and infinite loops 17 18.
    Coordination itself is static (domain rules, sequential chaining) or dynamic (management agents assign roles and channels in real time) 6 6.

How the layers combine
Framework 	Dominant layers
CrewAI 	Persona (role/goal/backstory) + process (sequential/hierarchical) + tools 7
MetaGPT 	Role + skills + SOP workflow + blackboard + structured deliverables 5
AutoGen 	Conversational team + speaker-selection rules 14
CAMEL 	Two-role inception prompting, no central controller 17
Classical MAS (AGR/MOISE/FIPA) 	Organization structure + norms + ACL + interaction protocols 11 12
Constitutional Evolution 	Norms as evolved, prioritized rules optimized for collective stability 3
The design tensions worth naming

    Static vs dynamic definition. Fixed roles/protocols give predictability and auditability; dynamic persona/role generation gives adaptability but harder verification 6.
    Rules vs roles vs emergent norms. Rules govern predictable behavior; roles govern who's responsible; emergent norms arise from interaction and are powerful but hard to control 9 1.
    Culture is the frontier, not the solved layer. The human-centered survey's blunt finding: current systems coordinate well at the task level but not yet at the human-social level, and models can appear globally deployable while remaining culturally asymmetric — often reflecting a narrow center of gravity rather than genuinely pluralistic understanding 2 2.
    Trait scoping matters more than trait level. Low agreeableness as a team-wide trait is broadly harmful, but a single low-agreeableness "challenger" deployed as a bounded, lead-position critic can match or slightly exceed baseline — a concrete argument for scoping a trait to a role rather than to the whole team 8.

If you're building one of these, the practical takeaway is that the six layers are independently configurable — and the frameworks differ mostly in which layers they expose to you as first-class configuration versus leaving to prompt engineering. Persona/skills/role tend to be prompt-level; culture/norms and collaboration rules are where you need an explicit mechanism (a constitution, an SOP, an org model, or an ACL) rather than hoping they emerge.