# Continuum 2.0: Product Requirements Document (PRD)

**Version**: 2.4.0 (Stellar)
**Date**: April 20, 2026
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

### 2.1 Identity Architecture (The "Semantic Vault") [NEW]
*   **Identity Archetype Discovery**: Automatic extraction and ranking of high-level persona pillars (e.g., "Strategic Guardian," "Relationship Integrity").
*   **Identity Vault UI**: An interactive dashboard in Settings that visualizes the user's top 10 most prominent archetypes.
*   **Archetype Evidence Drilling**: Users can expand any archetype to view the top 20 most important memory fragments defining that specific trait.
*   **Semantic Distribution Stats**: Real-time counter showing the total unique identity markers (858+) tracked by the system.

### 2.2 Memory Intelligence Vault (The "Brain")
Continuum uses a tiered hierarchy to manage cognitive load and retrieval accuracy.

| Layer | Name | Purpose | Implementation |
| :--- | :--- | :--- | :--- |
| **L1** | **Working Memory** | Immediate Context | User-pinned facts and critical active session data. |
| **L2** | **Episodic Memory** | Recent Experience | Raw conversational segments for high-speed retrieval. |
| **L3** | **Semantic Profile** | Identity & Traits | Extracted "User Identity" and Archetype markers. |
| **L4** | **Temporal Events** | Chronological Log | High-level life markers and date-specific facts. |
| **L5** | **Global Knowledge** | Deep RAG | External files and indexed document archives. |

*   **Collapsible Layers**: All memory layers are interactive and collapsible to manage large datasets.

### 2.3 Autonomous Memory Maintenance (The "Self-Healing Brain")
*   **Semantic Mass Purge**: Automatic background deduplication using vector similarity (0.90 threshold) to collapse redundant memories.
*   **Sleep Cycle (Neural Decay)**: Background tasks that consolidate fragments every 50 messages to maintain system speed.
*   **Core Truth Protection**: Facts with Importance 8-10 are exempt from automatic pruning.

### 2.4 Hands-Free Voice Interface (The "Pulse")
*   **Neural STT**: Instant transcription with multilingual cycling (EN, ZH, ES).
*   **Neural Voice**: Six high-fidelity neural voices for AI response.

---

## 3. Commercialization & Subscription Model
*   **Free**: Core Chat + L2 Memory sync (100 msg limit).
*   **Pro**: Unlimited L1-L4 sync + Premium Voice Mode.
*   **Elite**: L5 Global RAG + External Document Indexing.

---

## 4. Roadmap: Status
*   **Identity Architecture**: ✅ Complete. Archetype discovery and Vault UI are operational.
*   **Semantic Deduplication**: ✅ Complete. Autonomous pruning active in background.
*   **Multimodal Ingestion**: ✅ Complete. Vision and PDF indexing are operational.
*   **App Store Submission**: In progress. Metadata and screenshots finalized.
