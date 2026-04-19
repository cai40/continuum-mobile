# Continuum 2.0: Engineering Design Document (EDD)

**Date**: April 19, 2026
**Subject**: Technical Implementation of Autonomous Memory Systems & Subscription Gating

---

## 1. The 5-Layer Memory Architecture
Continuum uses a hierarchical memory system to balance retrieval speed with contextual depth.

| Layer | Type | Storage | Implementation Detail |
| :--- | :--- | :--- | :--- |
| **L1** | **Working / Pinned** | Local + Supabase | High-priority facts manually or automatically "pinned." Loaded immediately on app start. |
| **L2** | **Semantic Profile** | pgvector (Supabase) | Derived "User Identity." Extracted using LLM summarization of L4 segments. |
| **L3** | **Temporal Events** | PostgreSQL | Chronological markers (e.g., "Project X started on Oct 12"). Extracted via NLP. |
| **L4** | **Episodic Memory** | Local + Postgres | Recent raw conversational segments. Synchronized in 20-message chunks for high-speed local retrieval. |
| **L5** | **Global Knowledge** | pgvector (RAG) | External files, indexed documents, and long-term historical archives. Accessed via vector search. |

### 1.1 Extraction Engine (L4 -> L2/L3)
Memory is not just stored; it is transformed through a background pipeline:
*   **LLM Processing**: Every 50 messages, the Backend triggers an "Intelligence Pass." An LLM analyzes the latest L4 Episodic segments.
*   **Entity Extraction**: It identifies new people, preferences, or facts (L2 Semantic Profile).
*   **Temporal Tagging**: It dates significant events (L3 Temporal Log) based on conversational context.
*   **L1 Promotion**: Facts mentioned with high frequency (re-occurrence > 3) or manually "pinned" by the user are promoted to L1 Working Memory.

---

## 2. Authentication & Identity Flow
Designed for zero-persistence "Safe Boot" with high-convenience AutoFill.

### 2.1 Supabase Configuration
```javascript
export const supabase = createClient(URL, KEY, {
  auth: {
    storage: AsyncStorage,
    persistSession: true, // Persists session for PC-off autonomy
    autoRefreshToken: true, // Ensures tokens are updated in background
    detectSessionInUrl: false,
  },
});
```

---

## 3. Hands-Free Voice Engine
A multimodal bridge between on-device neural processing and cloud-native inference.

### 3.1 Speech-to-Text (STT) Pipeline
1.  **On-Device**: `expo-speech-recognition` listens for the `result` event.
2.  **Streaming Proxy**: Partial transcripts are sent to the UI immediately.
3.  **Silence Detection**: A 2.5s silence timer (managed via `useRef`) automatically triggers the `sendMessage` sequence.

---

## 4. Resiliency & Diagnostics

### 4.1 Global Pulse Engine (`pulseFetch`)
To handle Render.com's "free-tier sleep" and network instability:
1.  **Cold-Start Detection**: If the server returns `503` or times out, the engine sets `cloudWakingUp: true`.
2.  **Network Resilience**: Added catch-all retry for generic network failures (switching from Wi-Fi to LTE).
3.  **Exponential Wait**: Retries every 6 seconds for up to 3 attempts before surfacing an error to the user.

### 4.2 Error Boundary (The Red Screen)
*   **Mechanism**: Wraps `AppShell`. When a JS exception occurs, it prevents the app process from exiting and renders a recovery view.
*   **Recovery**: Provides a direct hook to `Updates.reloadAsync()` to force a JS-bundle refresh.

---

## 5. Subscription & Tier Management

### 5.1 Three-Tier Gate Logic
The memory and feature availability are gated based on the user's subscription tier.

| Tier | Gate Level | Feature Access Implementation |
| :--- | :--- | :--- |
| **Free** | `core` | `L4_SYNC_LIMIT = 100`. No access to `L5_RAG`. |
| **Pro** | `advisor` | `L1-L4_UNLIMITED`. Enable `VOICE_MODE_PREMIUM`. |
| **Elite** | `elite` | `L5_RAG_ENABLED`. Multi-device sync enabled. |

### 5.2 Subscription Management UI
*   **Downgrade to Free**: Revokes Pro/Elite features immediately on the device. Alerts user that the Apple ID subscription must still be manually cancelled to stop billing.
*   **Cancel Subscription**: Utilizes `itms-apps://apps.apple.com/account/subscriptions` deep-link to redirect user to Apple's official management page (required for App Store compliance).
*   **Restore Purchases**: Calls `react-native-iap` `getAvailablePurchases()` to synchronize local state with App Store receipts.
*   **Status**: ✅ Implemented in `SubscriptionSection.js`

---

## 6. Development Workflow: Fast Iteration

### 6.1 OTA Update Protocol (The "Nuclear" Protocol)
*   **Target Branch**: **`default`** (Binary 16 and subsequent builds listen to the default branch for updates).
*   **Command**: `npx eas update --branch default --message '...'`
*   **Forced Sync**: Every update MUST include a `BUILD_ID` bump in `LoginSection.js` to ensure cache-busting.

### 6.2 Internal Syncing Tool
*   **Implementation**: A "Cloud Sync Intelligence" button is added to the main Settings menu.
*   **Logic**: It first checks for updates; if none are found, it offers a "Force Reload" to clear any potentially stuck JS cache.
*   **Status**: ✅ Implemented in `SettingsSection.js`

---

## 7. Login & Account UX Status

### 7.1 Implemented Features
*   **Password Visibility Toggle**: ✅ Implemented.
*   **Forgot Password (Email Reset)**: ✅ Implemented.
*   **Email Verification on Sign Up**: ✅ Implemented.
*   **Membership Section**: Added a dedicated row in Settings -> Account to view and manage subscription status.

### 7.2 iOS AutoFill / KeyChain
*   **Status**: ✅ Fully Functional in **Binary 16**.
*   **Note**: `associatedDomains` was removed from `app.json` to allow clean building; AutoFill now relies on standard OS-level credential detection which is stable for this version.

---

## 8. Build History & Costs

| Build | ID | Status | Reason |
| :--- | :--- | :--- | :--- |
| Binary 14 | 1c3... | Stable | Initial Subscription Foundation |
| Binary 15 | (Failed) | Error | Improper `checkOnLaunch` schema |
| **Binary 16** | **3bd...** | **Production** | Final UI + Entitlement Stability |

**Current Credit Balance Reminder**: Always use OTA via the `default` branch unless native changes are required.

---

## 9. Future Roadmap: Phase 5
- [x] **Subscription Gating**: ✅ Complete in Binary 16.
- [x] **L5 Knowledge Base**: ✅ Complete. Render.com vector indexing for PDF/Text is live.
- [x] **Multimodal Ingestion (Vision & Documents)**: ✅ Complete.
- [x] **Collapsible Memory Architecture**: ✅ Complete.
- [x] **Cloud Stability**: ✅ Complete. Switched to Supavisor (Port 6543) and fixed SQL `text` import.
- [ ] **Extended Formats**: Add support for `.docx` and Excel ingestion.

---

## 10. Workspace & Environment Setup
To ensure consistency across development sessions, the workspace is standardized as follows:

- **Initialization Command**: `open workspace continuum2.0`
- **Root Directory**: `continuum2.0/`
- **Component Layout**:
    - **`continuum-core/`**: Contains the Python FastAPI backend, memory engine logic, and database migration scripts.
    - **`continuum-mobile/`**: Contains the React Native (Expo) frontend application, assets, and mobile-specific documentation.

