# Continuum 2.0: Product Requirements Document (PRD)

**Version**: 3.4.67 (Legal Fortress)
**Date**: April 26, 2026
**Platform**: iOS (Primary) / Android (Compatible)

---

## 1. Core Architecture
Continuum 2.0 is built on a high-resiliency, distributed architecture designed for 24/7 availability.

*   **Frontend**: React Native via Expo SDK 54 (Managed Workflow).
*   **Backend**: Python FastAPI hosted on Render (Cloud-Native).
*   **Database**: Supabase (Postgres + pgvector) for identity and memory storage.
*   **Build Pipeline**: EAS (Expo Application Services) with Automated OTA (Over-the-Air) updates.

---

## 2. Feature Specification

### 2.1 Identity Architecture (The "Semantic Vault")
*   **Identity Archetype Discovery**: Automatic extraction and ranking of high-level persona pillars.
*   **Dynamic Identity Unification [NEW]**: Real-time fuzzy entity resolution (e.g., merging "Yongyao" and "Yongyao Cai") to ensure a single, authoritative identity record.
*   **Identity Hardening (Diamond Facts) [NEW]**: High-speed synthesis of raw facts into deep identity traits (Family, Career, Vitality) for maximum persona stability.
*   **Identity Vault UI**: An interactive dashboard in Settings that visualizes the user's top 10 most prominent archetypes.
*   **Archetype Evidence Drilling**: Users can expand any archetype to view the top 20 most important memory fragments defining that specific trait.

### 2.2 Memory Intelligence Vault (The "Brain")
Continuum uses a multi-tier cognitive architecture based on the **ACT-R (Adaptive Control of Thought—Rational)** theory, separating memory into functional layers that mimic human information processing.

| Layer | Functional Module | Purpose | Database Table |
| :--- | :--- | :--- | :--- |
| **L1** | **Immediate** | Pinned Facts | `pinned_memories` |
| **L2** | **Episodic** | Recent Experience | `episodic_segments` |
| **L3** | **Semantic** | Core Knowledge | `semantic_memories` |
| **L3+** | **Identity** | Subconscious | `semantic_profile` |
| **L4** | **Temporal** | History / Trends | `temporal_events` |
| **L5** | **Document** | External Brain | `document_chunks` |
| **L6** | **Procedural** | Reusable Workflows *(planned)* | `procedural_skills` *(planned — see §2.11)* |

### 2.3 Neural Retrieval Strategy (Token Budget)
To maintain high-speed conversational intelligence, Continuum uses a surgical retrieval strategy rather than full-brain scanning. Every chat turn injects a specific "Context Budget" into the LLM:

*   **Identity Profile (L3+)**: Top 15 traits (~600 tokens).
*   **Semantic Facts (L3)**: 8 relevant fragments (~350 tokens).
*   **Document Knowledge (L5)**: 3 high-similarity chunks (~800 tokens).
*   **Conversation History**: Last 10 turns (~750 tokens).
*   **System Overhead**: Prompt & Persona instructions (~150 tokens).
*   **Total Context Per Message**: **~2,650 Tokens**.

### 2.3 Autonomous Memory Maintenance (The "Self-Healing Brain")
Continuum does not just store data; it performs **Active Neural Maintenance** to prevent "Semantic Drift" and "Information Rot."

#### 2.3.1 Multi-Source Bayesian Truth Discovery (MBTD)
Unlike standard databases that overwrite data, Continuum treats new information as **Evidence**.
*   **The Algorithm**: When a conflict is detected (Similarity > 0.85), the system calculates a new **Consensus Score** based on source authority.
*   **Authority Weights**:
    - **Manual (Keyboard)**: 1.0 (Absolute Truth).
    - **Synthesis (AI Merge)**: 0.8 (High Confidence).
    - **STT (Voice)**: 0.5 (Noisy Evidence).
*   **Comparison**: Traditional CRUD (Create, Read, Update, Delete) is binary. MBTD is **Probabilistic**, allowing the AI to "change its mind" only when the evidence weight is high enough.

#### 2.3.2 Ebbinghaus Neural Decay (Forgetting)
To maintain high-speed retrieval, the system vaporizes "Cognitive Noise."
*   **Equation**: $R = e^{-t/S}$ (where $R$ is retention, $t$ is time, and $S$ is memory stability).
*   **Stability (S)**: Boosted every time a memory is mentioned or retrieved.
*   **The Incinerator**: Any fragment with a retention score below **0.4** that hasn't been reinforced is hard-deleted.
*   **Strategic Advantage**: Prevents the "Infinite Context" problem where old, irrelevant data (e.g., "I'm hungry" from 3 years ago) pollutes the LLM's current reasoning.

#### 2.3.4 Neural Quantization (16-bit Compression)
To support global-scale growth on free-tier infrastructure, Continuum utilizes **Half-Precision (16-bit) Vector Storage**.
*   **Strategy**: All 768-dim embeddings are cast from `float32` to `halfvec(768)`.
*   **Impact**: Instant **50% reduction** in database footprint without meaningful loss in retrieval accuracy.
*   **Performance**: Accelerates cosine similarity calculations by reducing data movement from disk to CPU.

#### 2.3.5 Autonomic Hygiene (Self-Cleaning) [NEW]
Continuum maintains its own cognitive health via a dual-phase maintenance strategy.
*   **Phase 1: Real-Time Pruning (Post-Chat)**: Triggered automatically after every interaction to vaporize conversational noise (Shannon Entropy < 2.5 bits) and enforce the **10,000 item Brain Capacity Guard**.
*   **Phase 2: Deep Neural Consolidation (Periodic)**: A background maintenance job (Cron) that executes the Ebbinghaus Neural Decay (forgetting) logic and performs high-level synthesis of contradictory facts.
*   **Benefit**: Ensures the "Brain" remains high-fidelity and performance-optimized without user intervention.

### 2.5 Tiered Intelligence (Hot/Cold Storage) [NEW]
To achieve **Infinite Memory** without exceeding database limits (500MB), Continuum employs a dual-layer storage strategy:
*   **The Hot Layer (Active Brain)**: Postgres-based `pgvector` storage for recent and high-confidence memories. Capped at ~1,000 items per user.
*   **The Cold Layer (The Vault)**: Supabase Storage (S3) for historical data (>60 days). Stored as compressed JSON files.
*   **Scalability**: Increases effective memory capacity from ~10,000 items to **~5,000,000 items** on the free tier.
 
### 2.6 Resilient Memory & Temporal Intelligence [NEW]
*   **Prioritized Archiving**: Conversational summaries are processed immediately post-chat via a dedicated background queue to prevent memory "freezes."
*   **Neural Backfill Engine**: A parallel high-speed restoration tool capable of re-digesting weeks of missing chat data into L2/L3 layers.
*   **Environmental IQ**: Real-time GPS/Weather integration via `wttr.in` and localized client-time synchronization.
*   **Security RLS (Row Level Security)**: Production-grade security policies that enable cross-platform vault consistency while protecting user privacy.

### 2.8 Data Sovereignty & User Isolation [NEW]
*   **Logical Fortress**: Every user's "Neural Vault" is mathematically isolated. 
*   **Zero Cross-Talk**: Privacy-first retrieval ensures User A's AI can never access User B's memories or document chunks.
*   **GDPR Compliance**: Implementation of the "Absolute Purge" (Kill Switch) allows users to irreversibly wipe their identity from all database layers and vector manifolds.

### 2.9 Neural Capacity & Quota System [NEW]
Transitioned from "Feature Gating" to "Capacity Gating" to provide high value to all users while maintaining sustainable infrastructure costs.
*   **Full 5-Layer Access**: All users (Free/Pro/Elite) have immediate access to L1-L5 memory layers.
*   **Neural Storage (Fact Capacity)**: Hard-cap on total stored memory fragments to manage database density.
    - **Free**: 500 Facts
    - **Pro**: 5,000 Facts
    - **Elite**: 50,000 Facts
*   **Daily Heartbeat (Message Quota)**: Daily limit on LLM interactions to manage API overhead.
    - **Free**: 10 Conversations / Day
    - **Pro**: 100 Conversations / Day
    - **Elite**: Unlimited (9,999)

### 2.10 Legal Compliance Gate (The "Fortress") [NEW]
*   **Mandatory Onboarding**: Users are forced to review and accept the Privacy Policy and Terms of Use before accessing any memory layers.
*   **Immutable Audit Ledger**: Consent is recorded in a dedicated database table (`legal_compliance_audit`) that is protected from deletion, even during account wipes.
*   **Verified Receipts**: Automatic email dispatch to the user and administrator (cai40@yahoo.com) upon legal acceptance, creating a permanent off-chain record of consent.
*   **Scroll-to-Accept**: UI requirement ensuring users physically scroll through the legal text before the "Accept" button becomes active.

### 2.7 Smart Biometric Vault & Infrastructure [NEW]
*   **Secure Autofill Architecture**: Implementation of hardware-level (FaceID/TouchID) biometric verification used to decrypt and populate credentials into the login interface. Prioritizes user agency and manual account switching over hard-gated entry.
*   **Deep-Link Authentication Bridge**: Custom URI scheme (`continuum://`) and backend redirect handler to ensure 100% success rate for email verification flows, bypassing 404 "Not Found" errors during user registration.
*   **Unified OTA Sync**: Real-time version synchronization across all app diagnostic panels to ensure users are always aware of their current "Cloud Brain" status.

### 2.4 Hands-Free Voice Interface (The "Pulse")
*   **Neural STT**: Instant transcription with multilingual cycling (EN, ZH, ES).
*   **Neural Voice**: Six high-fidelity neural voices for AI response.

### 2.11 Procedural Learning Layer (L6 — "Neural Skills") [PLANNED]
Continuum today excels at **declarative learning** (what the user knows: facts, identity, episodic history via L1–L5). It does **not** yet support **procedural learning** (how to execute multi-step workflows). This section defines the future L6 layer to close that gap and match — then exceed — agent frameworks that auto-create reusable skills (e.g., Hermes Agent).

#### 2.11.1 Design Rationale
| Learning Type | Current Continuum (L1–L5) | L6 Target |
| :--- | :--- | :--- |
| **Declarative** ("what you know") | ✅ Facts, identity, documents, temporal events | Extend existing layers |
| **Procedural** ("how you do things") | ❌ Not implemented | ✅ Auto-created, reusable workflows |

L6 integrates with — not replaces — the existing memory stack. Declarative memory (L3/L3+) tells the agent *who the user is*; procedural memory (L6) tells the agent *how to serve them efficiently* on recurring tasks.

#### 2.11.2 L6 Memory Layer Specification
| Layer | Functional Module | Purpose | Database Table |
| :--- | :--- | :--- | :--- |
| **L6** | **Procedural** | Reusable Workflows & Action Sequences | `procedural_skills` |

**Schema (proposed)**:
*   `id`, `user_id`, `name`, `description` — skill identity and one-line trigger summary
*   `procedure` — structured steps (JSON: ordered actions, tool calls, verification checks, known pitfalls)
*   `embedding` — `halfvec(768)` for semantic skill retrieval (same quantization as L2–L5)
*   `source_session_id` — originating chat session for audit trail
*   `use_count`, `success_count`, `last_used_at` — usage telemetry for ACT-R activation
*   `confidence_score` — MBTD-weighted reliability (0.0–1.0)
*   `status` — `active` \| `stale` \| `archived` (mirrors Curator-style lifecycle)
*   `created_at`, `updated_at`

#### 2.11.3 Closed Learning Loop (Observe → Distill → Reuse → Refine)
1.  **Observe**: Post-chat background task inspects completed sessions for procedural patterns — multi-step tool use (≥5 steps), error recovery, user corrections ("No, do X instead"), or repeated similar task shapes across sessions.
2.  **Distill**: LLM synthesizes a structured `procedural_skills` record — not a raw log — capturing steps, preconditions, verification, and anti-patterns. Stored with vector embedding for retrieval.
3.  **Reuse**: On new chat turns, L6 skills are retrieved via the existing hybrid reranking pipeline (semantic similarity + ACT-R activation + importance). Only matching skills are injected into context (progressive disclosure: name + description in system prompt; full procedure loaded when relevance score exceeds threshold).
4.  **Refine**: When a loaded skill fails or the user corrects execution, the background fork patches the skill (targeted delta, not full rewrite). Successful re-runs increment `success_count` and boost activation stability.

#### 2.11.4 Skill Curator (Autonomic Maintenance)
Extends the existing Autonomic Hygiene engine (§2.3.5) with procedural-specific rules:
*   **Stale transition**: Skills unused for 30 days → `stale`; 90 days → `archived` (same thresholds as Hermes Curator baseline).
*   **Consolidation**: Periodic cron job merges near-duplicate skills (cosine similarity > 0.90) into umbrella skills with merged procedures.
*   **Capacity guard**: L6 counts toward Neural Storage caps (§2.9) or a dedicated skill cap (TBD at implementation).
*   **Human review surface**: Settings UI lists active/stale/archived skills; user can pin, edit, or delete any skill.

#### 2.11.5 Neural Retrieval Budget (Updated)
When L6 is enabled, extend the per-message context budget:
*   **Procedural Skills (L6)**: Top 2 relevant skills (~400 tokens).
*   **Revised Total Context Per Message**: **~3,050 Tokens** (current ~2,650 + L6 allocation).

#### 2.11.6 Action Tokens & External Integrations [PLANNED]
L6 lays the foundation for the Agentic Roadmap (Action Tokens / Function Calling):
*   **Phase A (L6 Core)**: Skill creation, retrieval, and in-chat procedural guidance (no external tool execution).
*   **Phase B (Action Tokens)**: Skills reference callable functions (API endpoints, webhooks, MCP tools). Requires approval gates for destructive actions.
*   **Phase C (Channel Gateway)**: External messaging (WeChat, SMS, Yahoo email) routes inbound messages to Continuum backend via a thin gateway (e.g., OpenClaw as channel router only). Continuum remains the single brain — L1–L6 memory, LLM, and identity — across mobile app and all channels.

**Channel integration constraints** (documented for future implementation):
*   Gateway is a **message router**, not a second memory system.
*   Requires `POST /integrations/channel` endpoint with service-token auth and sender-ID → `user_id` mapping.
*   Backend must run always-on (Render upgrade or VPS proxy) to avoid cold-start latency on real-time channels.
*   Channel messages count against Daily Heartbeat quotas (§2.9).

#### 2.11.7 Competitive Positioning
| Capability | Hermes Agent | Continuum (L1–L5 today) | Continuum (L1–L6 target) |
| :--- | :--- | :--- | :--- |
| Auto-create workflow skills | ✅ | ❌ | ✅ |
| Identity & archetype modeling | ⚠️ Basic | ✅ L3+ vault | ✅ |
| Probabilistic fact conflict resolution | ❌ | ✅ MBTD | ✅ |
| Biological memory decay | ⚠️ Skill-only | ✅ Ebbinghaus | ✅ Facts + Skills |
| Document RAG | ⚠️ Via tools | ✅ L5 | ✅ |
| Multi-channel inbox | ✅ Built-in | ❌ | ✅ Via gateway (Phase C) |

**Target outcome**: Continuum becomes the only personal AI with both **deep declarative memory** (identity, facts, documents) and **autonomous procedural learning** (skills), unified in one Supabase-backed brain.

---

## 3. Commercialization & Subscription Model
*   **Free**: Core Chat + L2 Memory sync (100 msg limit).
*   **Pro**: Unlimited L1-L4 sync + Premium Voice Mode.
*   **Elite**: L5 Global RAG + External Document Indexing.

---

## 4. Roadmap: Status
*   **Identity Architecture**: ✅ Complete. Diamond Fact hardening operational.
*   **Semantic Deduplication**: ✅ Complete. Global Paginated Pruning active.
*   **Multimodal Ingestion**: ✅ Complete. Vision and PDF indexing are operational.
*   **Resilient Archiver**: ✅ Complete. v3.4.45 restoration pulse active.
*   **Biometric Vault**: ✅ Complete. Smart Autofill operational in v3.4.47.
*   **Auth Infrastructure**: ✅ Complete. Deep-link verification bridge active.
*   **Data Sovereignty**: ✅ Complete. RLS-hardened Multi-Tenancy active.
*   **App Store Submission**: In progress. Metadata and screenshots finalized.

### 4.1 Future Roadmap (Planned)
*   **L6 Procedural Skills (Neural Skills Layer)**: 📋 Planned. Auto-create, retrieve, patch, and curate reusable workflow skills. See §2.11.
    - **L6 Phase A**: Skill extraction post-chat, `procedural_skills` table, retrieval injection, Settings UI for skill management.
    - **L6 Phase B**: Action Tokens — skills invoke external functions with user approval gates.
    - **L6 Phase C**: Channel Gateway — WeChat, SMS (Twilio), and email (IMAP/SMTP) routed to Continuum backend; gateway is router-only, Continuum owns all memory.
*   **Action Tokens (Function Calling)**: 📋 Planned. Depends on L6 Phase A. See §2.11.6.
*   **Always-On Backend / Channel Latency**: 📋 Planned. Render tier upgrade or VPS warm-proxy required before Phase C go-live.
