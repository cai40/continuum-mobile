# Continuum 2.0: Product Requirements Document (PRD)

**Version**: 2.4.0-20260418-1800 (Stabilized)
**Date**: April 19, 2026
**Platform**: iOS (Primary) / Android (Compatible)

---

## 1. Core Architecture
Continuum 2.0 is built on a high-resiliency, distributed architecture designed for 24/7 availability.

*   **Frontend**: React Native via Expo SDK 54 (Managed Workflow).
*   **Backend**: Python FastAPI hosted on Render (Cloud-Native).
*   **Database**: Supabase (Postgres + pgvector) for identity and memory storage.
*   **Build Pipeline**: EAS (Expo Application Services) with automated PNG validation.

---

## 2. Feature Specification

### 2.1 Identity & Security (The "Secure Gate")
*   **Password Visibility**: Users must be able to toggle password visibility to ensure accuracy during manual entry.
*   **Self-Service Recovery**: Integrated "Forgot Password" functionality via Supabase email resets.
*   **Verified Signup**: Mandatory email verification link before account activation.
*   **iOS KeyChain**: Full support for native AutoFill and credential management.

### 2.2 Memory Intelligence Vault (The "Brain")
Continuum uses a tiered hierarchy to manage cognitive load and retrieval accuracy.

| Layer | Name | Purpose | Implementation |
| :--- | :--- | :--- | :--- |
| **L1** | **Working Memory** | Immediate Context | User-pinned facts and critical active session data. |
| **L2** | **Semantic Profile** | Personality & Traits | Extracted "User Identity" summary. |
| **L3** | **Temporal Events** | Chronological Log | High-level life markers and date-specific facts. |
| **L4** | **Episodic Memory** | Recent Experience | Raw conversational segments for high-speed retrieval. |
| **L5** | **Global Knowledge** | Deep RAG | External files and indexed document archives. |

*   **Collapsible Memory Vault**: All memory layers in the Data & Memory Vault must be collapsible to optimize vertical space and improve navigation for power users with large datasets.

### 2.3 Hands-Free Voice Interface (The "Pulse")
*   **Neural STT**: Instant, low-latency transcription via `expo-speech-recognition`.
*   **Streaming Reassembly**: Real-time rendering of fragmented AI tokens for a "living" conversation feel.

### 2.4 Multimodal Ingestion (Vision & Intelligence)
*   **Visual Context**: ✅ Operational. Users can attach images to chat messages for high-fidelity Vision analysis.
*   **Document Indexing**: ✅ Operational. Support for PDF and Text (with .docx roadmap) to populate the L5 Global Knowledge base via the Render indexer.
*   **Seamless Integration**: Dedicated "Paperclip" in chat and "Sync Document" in settings vault for bulk ingestion.

## 3. Commercialization & Subscription Model

### 3.1 Tiered Access
*   **Free ($0/mo)**: Core Chat + L4 Memory sync (100 msg limit).
*   **Pro ($9.99/mo)**: Unlimited L1-L4 sync + Premium Voice Mode + No Ads.
*   **Elite ($24.99/mo)**: L5 Global RAG + External Document Indexing + Multi-Device Handshake.

### 3.2 Subscription Management (Compliance)
*   **In-App Management**: Dedicated screen for Restoring Purchases and Downgrading.
*   **Compliance Cancellation**: Direct deep-linking to Apple's Subscription Settings for user-controlled cancellations.
*   **Graceful Revocation**: Immediate UI feedback and feature gating upon plan changes.

---

## 4. Maintenance & Reliability

### 4.1 Zero-Downtime Updates (OTA)
*   **Automatic Check**: App checks for JS updates on every launch (`ON_LOAD`).
*   **Manual Sync**: A dedicated "Cloud Sync Intelligence" button in Settings allows users to pull updates without logging out.
*   **Force Reload**: Fail-safe option to restart the JS engine if the cache becomes stale.

### 4.2 Error Handling
*   **Red Screen Recovery**: Global error boundary prevents app crashes and offers a "Hard Reboot" button to clear corrupt state.

---

## 5. Roadmap: Completed & Future
*   **L5 RAG Deployment**: ✅ Complete. Render.com document processing worker is live.
*   **Multimodal Ingestion**: ✅ Complete. Vision and PDF indexing are operational.
*   **Cloud-Native Autonomy**: ✅ Complete. Session persistence and auto-refresh enabled for "PC-off" independence.
*   **App Store Submission**: In progress. Completing the screenshot suite and metadata submission.
*   **Local AI Engine**: Investigating on-device Whisper/Llama models for local-only Elite tier processing.
