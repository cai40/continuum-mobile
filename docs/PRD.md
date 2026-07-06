# Continuum 2.0: Product Requirements Document (PRD)

**Version**: 3.4.68 (OpenClaw Email Bridge)
**Date**: July 5, 2026
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

### 2.11 OpenClaw VPS Bridge & Yahoo Email [NEW]
Continuum chat can route through a user-hosted **OpenClaw bridge** on a VPS (HTTPS via Cloudflare tunnel) for live Yahoo IMAP access and Continuum memory, without SSH from the phone.

*   **Bridge service**: Node HTTP server (`continuum-bridge`) on port 8787 — `GET /health`, `POST /chat/stream`.
*   **Email fetch**: Lite IMAP check (headers + snippet) with pagination (`offset`, `limit` up to 1000).
*   **Date-range fetch**: Natural-language ranges parsed server-side (`emailDateRange.js`) and filtered in JS after Yahoo-safe UID scans (no hanging `SEARCH ALL` / absolute `SINCE` on large mailboxes).
    - Day ranges: `Fetch emails from 4/1/2026 to 6/15/2026`
    - Month ranges: `Clean up June 2026`, `Clean up 6/2026`
    - Year ranges: `Clean up for 2026`
*   **Clean up inbox**: User says `clean up` / `clean up inbox` to move matching mail to Trash (requires **Allow email delete** in app Settings):
    - News & newsletters
    - Promotional / advertising mail
    - GitHub & dev/code notifications (GitLab, CI/CD, Dependabot, etc.)
    - Bank & financial **statements** (e-statements)
    - **Never** trashes OTP, security alerts, fraud warnings, DocuSign, or Cash App alerts
*   **Move to folder**: Move mail from a sender to a Yahoo folder (e.g. `Move all emails from Min Zhang to Min folder`). Requires **Allow email delete** (mailbox write permission). Resolves folder by name; max 100 per batch; over-limit permission prompt applies.
*   **Web search**: Live sports, news, and weather (Wikipedia by default; optional Brave Search API on VPS for broader news). Works in **direct chat** (device-side fetch) or via **bridge** (VPS-side). Injected as `[Web search]` block — model must not claim "no internet" when present.
*   **Over-limit permission**: If matches exceed the default fetch limit (250 for date/month/year ranges; 100 for plain cleanup), the bridge **does not trash** until the user replies `yes proceed` / `confirm cleanup`, or raises the limit (e.g. `limit 500`).
*   **Auto-trash (optional)**: Settings toggle to move newsletter/promo/spam on every inbox fetch (max 100; banks/OTP protected).
*   **Anti-hallucination**: Live inbox UIDs injected into the LLM prompt; fresh fetch drops chat history for email turns; grounding rules forbid inventing messages.
*   **Resilience**: SSE opened immediately with keepalive pings during slow IMAP so Cloudflare tunnels do not idle-timeout; HTML error pages sanitized in the app.
*   **Bridge version**: Tracked in `/health` as `bridge_version` (e.g. `2026.07.27`) — VPS must `git pull origin master` + restart after changes.

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
*   **OpenClaw Yahoo Email Bridge**: ✅ Complete. Date-range fetch, clean-up trash rules, month/year phrases, over-limit permission (`bridge_version` 2026.07.27).
*   **App Store Submission**: In progress. Metadata and screenshots finalized.
