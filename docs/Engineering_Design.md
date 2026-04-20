# Continuum 2.0: Engineering Design Document (EDD)

**Date**: April 20, 2026
**Subject**: Technical Implementation of Identity Archetypes & Semantic Deduplication

---

## 1. Identity & Archetype Architecture
Build 2.4.0 introduces the "Semantic Identity Vault," a system for discovering and visualizing the user's cognitive pillars.

### 1.1 Archetype Discovery Pipeline
*   **Extraction**: During the Semantic indexing pass (L3), the LLM identifies "Entities" and "Archetypes" (e.g., "Strategic Guardian").
*   **Clustering**: Archetypes are normalized and stored as tags in the `entities` array column of the `semantic_memories` table.
*   **Ranking**: The `/brain/archetypes` endpoint performs a frequency analysis across the vault to identify the Top 10 most prominent archetypes.

### 1.2 The Semantic Vault API
*   **`GET /brain/archetypes`**: Scans the user's semantic vault and returns the Top 10 archetypes with their associated fragment counts.
*   **`GET /brain/archetypes/{name}`**: Retrieves the Top 20 memory items for a specific archetype, ordered by `importance_score` (descending).

---

## 2. Autonomous Memory Lifecycle (Sleep Cycle)
To maintain high performance and low redundancy, Build 2.4.0 implements a vector-based "Deep Clean" system.

### 2.1 Semantic Deduplication Engine
*   **Similarity Threshold**: 0.90 (90% vector similarity).
*   **Mechanism**: The `deep_clean_memories.py` background task runs every 50 messages.
*   **Logic**:
    1.  Fetch latest fragments across all layers.
    2.  Calculate cosine similarity using OpenAI `text-embedding-3-small`.
    3.  If similarity > 0.90, the older fragment is purged, and its metadata is consolidated into the newer core truth.
*   **Battery Safety**: All vector calculations are offloaded to the Render cloud backend to ensure zero impact on mobile hardware.

---

## 3. The 5-Layer Memory Hierarchy (Refined)

| Layer | Type | Implementation |
| :--- | :--- | :--- |
| **L1** | **Working Memory** | Pinned facts loaded in `AppContext` for immediate prompt injection. |
| **L2** | **Episodic Memory** | Raw chat history (last 500 segments) with inverted rendering. |
| **L3** | **Semantic Profile** | Deduplicated "Permanent Truths" and Archetypes. |
| **L4** | **Temporal Events** | Life markers and chronological log of significant dates. |
| **L5** | **Global Knowledge** | Document-level RAG (PDF/Text) via Render worker. |

---

## 4. Deployment & Sync Protocol
*   **Channel Mapping**: 
    - `preview` channel -> `preview` branch (Feature testing).
    - `production` channel -> `production` branch (Stable release).
*   **OTA Sync**: `Updates.fetchUpdateAsync()` triggered via the "Cloud Sync Intelligence" button to bypass background polling delays.
