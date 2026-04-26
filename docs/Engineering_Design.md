# Continuum 2.0: Engineering Design Document (EDD)

**Date**: April 20, 2026
**Subject**: Global Memory Scaling & Dynamic Identity Unification

---

## 1. Identity & Archetype Architecture
Build 2.4.1 evolves the "Semantic Identity Vault" into a unified cognitive landscape.

### 1.1 Archetype Discovery Pipeline
*   **Extraction**: During the Semantic indexing pass (L3), the LLM identifies "Entities" and "Archetypes" (e.g., "Strategic Authority").
*   **Clustering**: Archetypes are normalized and stored as tags in the `entities` array column of the `semantic_memories` table.

### 1.2 The Semantic Vault API
*   **`GET /brain/archetypes`**: Scans the user's semantic vault and performs real-time frequency analysis.
*   **Dynamic Unification [NEW]**: Implements a **Fuzzy Entity Resolver** that merges similar strings (e.g. "Yongyao" -> "Yongyao Cai") to ensure a clean, high-fidelity ranking.

### 1.3 Fuzzy Evidence Retrieval [NEW]
*   **`GET /brain/archetypes/{name}`**: Retrieves the top 20 items. If the requested name is a variant, the system uses a **seed-based similarity search** to pull evidence from all known name-variants, ensuring zero data loss.

---

## 2. Autonomous Memory Lifecycle (Deep Clean)
Build 2.4.1 introduces the "Great Purge" engine for global-scale hygiene.

### 2.1 Global Paginated Scaling [NEW]
*   **Mechanism**: The `deep_clean_memories.py` task now utilizes **Recursive Pagination** (batch size: 1,000) to bypass default API row limits.
*   **Impact**: Ensures 100% visibility across the entire 1,267+ item global vault.

### 2.2 Punctuation-Agnostic Deduplication [NEW]
*   **Logic**: Before vector matching, the system performs a **Literal Agnostic Sweep**:
    1.  Lowercases all content.
    2.  Strips all non-alphanumeric characters (Punctuation-Blind).
    3.  Consolidates whitespace.
*   **Impact**: Instantly merges fragments like "Who are you?" and "who are you " without requiring LLM overhead.

---

## 🧬 Neural Equation Library (L1-L5 Core)

### 3.1 ACT-R Base-Level Activation (L1-L4)
Continuum uses the **ACT-R (Adaptive Control of Thought—Rational)** formula to determine which memories should stay in the "active" context.
*   **Formula**: $A_i = \ln \left( \sum_{j=1}^n t_j^{-d} \right)$
    *   $A_i$: Activation of memory $i$.
    *   $n$: Number of times memory $i$ has been practiced/retrieved.
    *   $t_j$: Time since the $j$-th practice/mention.
    *   $d$: Decay parameter (standard: 0.5).
*   **Why?**: Traditional databases use `ORDER BY created_at DESC`. Continuum uses **Biological Decay**. Memories mentioned 10 times last year might have higher activation than a random comment made once 5 minutes ago.

### 3.2 Multi-Source Bayesian Truth Discovery (MBTD)
When two facts conflict (e.g., "I live in NY" vs "I live in SF"), the system uses a **weighted consensus** rather than simple overwriting.
*   **Formula**: $c_{new} = \frac{c_{old} \cdot w_{old} + c_{evidence} \cdot w_{evidence}}{w_{old} + w_{evidence}}$
    *   $c$: Confidence score.
    *   $w$: Source weight (Authority).
*   **Weights Table**:
    | Source | weight ($w$) | Reliability |
    | :--- | :--- | :--- |
    | **Manual UI** | 1.0 | Absolute Truth |
    | **Document RAG** | 0.8 | Structured Fact |
    | **AI Synthesis** | 0.7 | Derived Logic |
    | **Voice STT** | 0.5 | Probabilistic/Noisy |
*   **Example**: If you say "I like tea" via voice ($w=0.5$), and later type "I actually prefer coffee" ($w=1.0$), the system calculates a shift towards "Coffee" with 75% confidence, eventually purging "Tea" during the next hygiene cycle.

### 3.3 Topological Manifold Mapping (UMAP)
Identity discovery requires understanding the **shape** of your data.
*   **Algorithm**: **Uniform Manifold Approximation and Projection (UMAP)**.
*   **Technical Goal**: Reduce 1,536-dim vectors to a 5-dim manifold where distance represents **Contextual Relation**, not just word similarity.
*   **Comparison**:
    - **PCA (Linear)**: Fails to capture non-linear identity clusters.
    - **t-SNE (Local)**: Good for visualization but breaks "Global Structure" (can't tell how "Career" relates to "Family").
    - **UMAP (Hybrid)**: Preserves local clusters while maintaining the global distance between different "archetype islands."

### 3.4 Ebbinghaus Forgetting Curves (Maintenance)
The "Self-Healing Brain" passes a periodic **Retention Filter**.
*   **Formula**: $R = e^{-t/S}$
    *   $R$: Retention probability.
    *   $S$: Stability (Memory Strength).
*   **Dynamic Stability**: $S$ is calculated as $S = \text{mentions} \cdot \text{importance\_score} \cdot \text{base\_delay}$.
*   **The Incinerator**: Fragments where $R < 0.4$ are hard-deleted. This keeps the database lean and prevents "Hallucination Loops" where the AI retrieves its own old, incorrect data as truth.

---

## 4. The 5-Layer Memory Hierarchy (Technical Spec)

| Layer | Type | Database Table | Engine | Retrieval Budget |
| :--- | :--- | :--- | :--- | :--- |
| **L1** | **Immediate** | `pinned_memories` | Direct Scan | All (Top 10-15) |
| **L2** | **Episodic** | `episodic_segments` | **halfvec(768)** | ~750 tokens (10 turns) |
| **L3** | **Semantic** | `semantic_memories` | **halfvec(768)** | ~350 tokens (8 facts) |
| **L3+** | **Identity** | `semantic_profile` | **halfvec(768)** | ~600 tokens (15 traits) |
| **L4** | **Temporal** | `temporal_events` | Chrono Index | Dynamic (as needed) |
| **L5** | **Document** | `document_chunks` | **halfvec(768)** | ~800 tokens (3 chunks) |

### 4.1 Vector Storage & Indexing (v3.4.29)
All vector-capable layers utilize **pgvector 0.8.0** with the following optimized configuration:
*   **DataType**: `halfvec(768)` (16-bit floating point).
*   **Indexing**: HNSW (Hierarchical Navigable Small Worlds).
*   **Operator**: `halfvec_cosine_ops`.
*   **Goal**: Sub-10ms retrieval latency across million-row tables.

### 4.1 Chat Retrieval Protocol (v3.4.22+)
To prevent "Context Flood" and minimize LLM costs, every chat message triggers a multi-phase retrieval process:
1.  **Neural Quantization (v3.4.29) ✅**: All vectors converted to 16-bit halfvec, reducing footprint by 50-75%.
2.  **Autonomic Hygiene (v3.4.33) ✅**: Background task silently vaporizes conversational noise.
3.  **Multimodal Vision (v3.4.37) ✅**: Backend now processes screenshots/photos via Gemini 1.5 Flash.
4.  **Phase 1: Semantic Search**: Initial top-N similarity search via `pgvector` (match threshold: 0.4).
5.  **Phase 2: Graph-Hop Discovery**: Fetches neighbors by overlapping entities to find contextually related memories that may lack direct semantic similarity to the query.
6.  **Phase 3: Hybrid Reranking (ACT-R + Importance)**:
    *   **Formula**: `Score = (Similarity * 0.45) + (Norm_Activation * 0.3) + ((Importance/10) * 0.25)`
    *   **Norm_Activation**: Normalized ACT-R activation score (`max(0, (activation + 5) / 7)`).
7.  **Fact Injection**: Injects the top 8 reranked results into the LLM context.
8.  **Knowledge Injection**: If relevant, pulls from Layer 5 (PDFs/Excel).
9.  **Buffer Injection**: Injects the rolling chat history.

### 4.2 Autonomic Hygiene (Noise Filter) [NEW]
To maintain high-fidelity context, the system autonomously prunes "conversational noise" in the background.

*   **Heuristic 1: Shannon Entropy**: Filters entries where character distribution complexity is below **2.5 bits**.
*   **Heuristic 2: Pattern Matching**: Flags common filler tokens (e.g., "hi", "hello", "test", "anyone there").
*   **Heuristic 3: Length Guard**: Flagging messages < 15 chars that lack significant semantic entities.
*   **Execution**: Triggered as a non-blocking background task after every chat session via `MemoryEngine.autonomous_pruning()`.

### 4.3 Multimodal Vision Protocol (v3.4.37) [NEW]
Continuum supports high-fidelity visual reasoning via the following pipeline:
*   **Ingestion**: Multipart/form-data file uploads from the mobile app.
*   **Processing**: Automatic base64 encoding and "Nested URL" packaging for LangChain.
*   **Routing**: Forced-failover to Gemini 1.5 Flash for any message containing an `image_url`.
*   **Auth**: Isolated Gemini API Key selection to prevent multi-provider key collisions.

### 4.4 Brain Capacity Guard (v3.4.33) [NEW]
To maintain peak performance and prevent database exhaustion, the system enforces a hardware-aligned memory cap.
*   **Hard Cap**: 10,000 items in `semantic_memories`.
*   **Trigger**: Background task checks count after every interaction.
*   **Pruning Strategy**:
    1.  Target items with `importance_score < 8`.
    2.  Order by `timestamp` (oldest first).
    3.  Batch prune 500 items per cycle to restore headroom.

### 4.5 Maintenance Cadence & Triggers [NEW]
The following table defines the execution frequency for all memory maintenance tasks:

| Task | Frequency | Trigger | Logic |
| :--- | :--- | :--- | :--- |
| **Noise Purge** | Real-Time | Post-Chat (Background) | Shannon Entropy + Pattern Match |
| **Capacity Guard** | Real-Time | Post-Chat (Background) | 10k Item Pruning |
| **Episodic Archiving** | Real-Time | Post-Chat (Background) | L2 Neural Summarization |
| **Neural Decay** | Periodic | External Cron (Daily/Weekly) | Ebbinghaus Curve ($R < 0.4$) |
| **Synthesis** | Periodic | External Cron (Daily/Weekly) | Bayesian Consolidation (MBTD) |
| **Tiered Archiving** | Threshold | Deep Clean Cycle | Volume (>1k) or Time (>60d) |

---

## 5. Tiered Intelligence Architecture (Hot/Cold) [NEW]
To achieve **Infinite Memory** on free-tier infrastructure, Continuum utilizes a Neural Sluice to move heavy vector data between Postgres and low-cost S3 storage.

### 5.1 The Archival Trigger
*   **Volume Trigger**: When a user's table (e.g., `semantic_memories`) exceeds 1,000 rows.
*   **Time Trigger**: Automatically moving rows older than 60 days to the Cold Layer.

### 5.2 The "Semantic Anchor" Protocol
To prevent total amnesia of archived data:
1.  **Summarization**: Generate a 1-paragraph summary of the 100 rows being moved.
2.  **Anchor Creation**: Store the summary as a single "Anchor" row in Postgres with a link to the Cold File ID.
3.  **Search**: If a search query matches an **Anchor**, the AI fetches the JSON from Supabase Storage and re-indexes it temporarily to find the answer.

### 5.3 Technical Stack
*   **Archive Format**: Gzipped JSON.
*   **Storage API**: Supabase Storage (`supabase.storage.from('archives').upload()`).
*   **Database Cleanup**: `DELETE` from Postgres after confirmed archival.
 
## 6. High-Availability & Security Protocols [NEW]
Build 3.4.45 introduces production-grade stability and security layers to ensure cross-platform consistency.
 
### 6.1 Resilient Background Archiving (L2 Restoration)
*   **Mechanism**: Prioritized execution of `archive_interaction` within the `handle_post_chat_tasks` background queue.
*   **Safety**: If the LLM summarization (Gemini 1.5) fails, the system triggers a **Diagnostic Heartbeat** fallback, saving the raw interaction snippet to ensure zero data loss.
 
### 6.2 Parallel Neural Backfill Engine
*   **Logic**: High-speed restoration of historical data via a **Semaphore-controlled Concurrent Processor**.
*   **Implementation**: Utilizes `asyncio.Semaphore(5)` to process up to 5 conversation pairs simultaneously while respecting Gemini free-tier rate limits.
*   **Performance**: Achieved **5x throughput** improvement during the April 18-25 restoration cycle.
 
### 6.3 Supabase RLS (Row Level Security) Framework
*   **Architecture**: Hardened security policies applied to all memory tables to enable secure, direct access from the mobile app (Anon Key).
*   **Policy Logic**: `ALTER TABLE ... ENABLE ROW LEVEL SECURITY; CREATE POLICY ... FOR ALL USING (user_id::text = auth.uid()::text);`
*   **Impact**: Bridges the "Service Key vs. User Key" gap, ensuring that data inserted via backend scripts is visible to the user's authenticated session on mobile.
 
### 6.4 Environmental Awareness Protocol
*   **Location Awareness**: Real-time integration with `wttr.in` for localized weather injection into the system prompt.
*   **Temporal Awareness**: Implementation of `client_time` sync to override server-side timestamps, ensuring the AI is aware of the user's local day/time during mobile interactions.

## 6. Deployment & Sync Protocol
## 6. Workflow Session Log

### Session 2026-04-21: Neural Re-Link & Identity Unification
*   **Incident**: User reported "Zero Memories" in the Vault despite active chat history.
*   **Root Cause**: User ID mismatch following an authentication provider update.
    *   **Legacy ID (UUID)**: `1cdaf8bb-e812-4658-99b0-0245e387f319` (Supabase Native)
    *   **Current ID (String)**: `user_3CBsq25n-l73bdatPXyzFmsW1dVH` (External Auth/Clerk)
*   **Solution**: Executed a `Neural Re-Link` script using the **Supabase Service Role Key** to perform a mass `PATCH` update.
*   **Impact**: 455 semantic memories and associated document chunks successfully migrated to the current session.
*   **Verification**: Global Audit confirmed 455 records active under the new identity.
