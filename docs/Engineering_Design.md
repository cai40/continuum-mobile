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
| **L4** | **Episodic Memory** | Local + Postgres | -   **Inverted Rendering Engine**: High-performance `FlatList` with `inverted={true}` for instant message visibility.
-   **Contextual Haptic Menus**: Unified long-press interaction for "Copy Text" and "Delete Selection."
-   **Live Cloud Pulse**: Real-time server telemetry via Render environment variables.
- Strict Memory Cap: Hard limit of 500 records in `AppContext` to prevent OOM (Out of Memory) crashes on mobile hardware.
- Chronos Metadata: Every message is tagged with UTC ISO strings, formatted locally to `MMM DD, HH:mm`.
Synchronized in 20-message chunks for high-speed local retrieval. |
| **L5** | **Global Knowledge** | pgvector (RAG) | External files, indexed documents, and long-term historical archives. Accessed via vector search. |

### 1.1 Extraction Engine (L4 -> L2/L3)
Memory is not just stored; it is transformed through a background pipeline:
*   **LLM Processing**: Every 50 messages, the Backend triggers an "Intelligence Pass." An LLM analyzes the latest L4 Episodic segments.
*   **Entity Extraction**: It identifies new people, preferences, or facts (L2 Semantic Profile).
*   **Temporal Tagging**: It dates significant events (L3 Temporal Log) based on conversational context.
*   **L1 Promotion**: Facts mentioned with high frequency (re-occurrence > 3) or manually "pinned" by the user are promoted to L1 Working Memory.

---

## 11. Autonomous Memory Lifecycle & Pruning
To prevent "Memory Bloat" and ensure the system remains high-speed over years of use, Continuum implements a tiered lifecycle.

### 11.1 Capacity Guard (The Hard Cap)
*   **Threshold**: 10,000 semantic fragments per user.
*   **Logic**: When the threshold is exceeded, the system triggers `autonomous_pruning()`.
*   **Strategy**: It identifies the 500 oldest records where `importance_score < 8`.
*   **Immunity**: Records with `importance_score >= 8` (Core Truths) are protected from automatic deletion.

### 11.2 Neural Decay (ACT-R Implementation)
*   **Algorithm**: `Activation = log(sum(t_i ^ -d))` where `t_i` is the time since the i-th mention and `d` is the decay parameter (0.5).
*   **Mechanism**: Memories that are not "recalled" (accessed via RAG) for an extended period see their activation score drop.
*   **Archiving**: Memories with an activation score below -1.5 are automatically tagged as `archived` and removed from the active retrieval context.

### 11.3 Consolidation Cycle (The "Sleep" Phase)
*   **Trigger**: Every 50 messages.
*   **Task 1 (Deep Clean)**: Synthesizes related fragments into high-level summaries to reduce redundancy.
*   **Task 2 (Neural Decay)**: Runs the `deprioritize_stale` check to archive low-activation data.

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

### 2.2 Session Handshake & Persistence Strategy
To prevent unnecessary redirects to the login screen during OTA reloads, a 500ms grace period is implemented in `AppContext.js`. 

**Session-Agnostic Messaging**: Unlike secondary states, the `messages` array is **not** cleared on logout. This ensures that the user's conversational context remains visible locally across sessions. A full purge only occurs during a manual "Hard Reset" or when a different user successfully authenticates.
- `POST /chat/delete`: Selective message pruning (Integer ID array).
- `GET /system/status`: Real-time deployment telemetry (Commit, Region, Service ID).

---

## 3. Hands-Free Voice Engine
A multimodal bridge between on-device neural processing and cloud-native inference.

### 3.1 Speech-to-Text (STT) Pipeline
1.  **On-Device**: `expo-speech-recognition` listens for the `result` event.
2.  **Multilingual Routing**: Supports `en-US`, `zh-CN`, and `es-ES`. Implemented via a cycling toggle that updates the `sttLang` state in the global context.
3.  **Crash Shield**: Wrapped in a safety net that falls back to `en-US` if a specific locale fails to initialize on the hardware.
4.  **Streaming Proxy**: Partial transcripts are sent to the UI immediately.
5.  **Silence Detection**: A 2.5s silence timer (managed via `useRef`) automatically triggers the `sendMessage` sequence.

---

## 4. Resiliency & Diagnostics

### 4.1 Global Pulse Engine (`pulseFetch`)
To handle Render.com's "free-tier sleep" and network instability:
1.  **Cold-Start Detection**: If the server returns `503` or times out, the engine sets `cloudWakingUp: true`.
2.  **Network Resilience**: Added catch-all retry for generic network failures (switching from Wi-Fi to LTE).
3.  **Automated Data Hydration**: Triggered on session change. Automatically calls `syncRemoteHistory()` and `onRefreshMemories()` to populate the local state. Implements a **3-attempt exponential retry** to handle backend cold-starts on Render.com.
4.  **Persistent Component Stack**: Replaced conditional rendering with a **Visibility Stack** (`display: flex/none`) for the main navigation. This prevents component unmounting, preserves scroll positions, and eliminates "re-loading" animations when switching between Continuum and Setup.
5.  **Zero-Latency Hydration (Instant Snap)**: Implemented an `isInitialLoad` ref logic in `ChatSection.js`. On the first mount after app start or login, the list performs a zero-delay `scrollToEnd({ animated: false })`. Animated scrolling is only re-enabled for active messages post-hydration to eliminate initial UI lag.
6.  **Exponential Wait**: Retries every 6 seconds for up to 3 attempts before surfacing an error to the user.

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

### 6.1 OTA Update Protocol: The "Two-Lane" System
To prevent version drift and ensure stability, the development workflow is split into two isolated lanes:

| Lane | Purpose | Channel | Branch | Shortcut Command |
| :--- | :--- | :--- | :--- | :--- |
| **Stable** | Daily use / Production | `production` | `production` | `npm run deploy` |
| **Preview** | Feature testing | `preview` | `preview` | `eas update --branch preview` |

*   **Target Branch**: **`production`** is the primary source of truth for the stable app.
*   **Target Channel**: All production binaries must be pointed to the `production` channel.
*   **Versioning Source of Truth**: `src/constants/Config.js` -> `BUILD_ID`. Every update MUST include a `BUILD_ID` bump to ensure cache-busting and UI consistency.

### 6.2 Deployment & Automation (DevOps)
*   **Production Push (Mobile)**: `npm run deploy` — Executes `eas update --branch production`.
*   **Auto-Deploy (Backend)**: Triggered automatically on every Git push to the `main` branch via the GitHub Webhook.
*   **Technical Watermarking**: Standardized a 6pt normal-weight vertical stack beneath primary titles in `App.js` and `LoginSection.js` for instant version verification.

### 6.3 The Webhook Bridge (GitHub -> Render)
To maintain the "No-Click" deployment flow, a manual webhook is established between GitHub and Render:
1.  **Repository**: `https://github.com/cai40/continuum-backend`
2.  **Webhook URL**: [Render Deploy Hook URL] (Found in Render -> Settings -> Deploy Hook).
3.  **Content Type**: `application/json`
4.  **Event**: `Just the push event`.
5.  **Render Root Directory**: Must be set to **[Empty]** if the GitHub repo root matches the backend root.

### 6.4 Infrastructure Map (External Dependencies)
| Component | Provider | Configuration / URL |
| :--- | :--- | :--- |
| **Mobile App** | Expo (EAS) | Channel: `production`, Branch: `production` |
| **Backend API** | Render.com | `https://continuum-backend-0q9j.onrender.com` |
| **Primary Database** | Supabase | PostgreSQL + pgvector (Port 6543) |
| **Error Shield** | Sentry | Connected (v7.2.0) |
| **Neural Logic** | Google/Groq | Gemini-1.5-Pro / Llama-3-70b (via UnifiedLLM) |

### 6.4 Internal Syncing Tool
*   **Implementation**: A "Cloud Sync Intelligence" button in **Settings -> Data**.
*   **Logic**: Checks for new EAS updates; if none found, offers a "Force Reload" to clear the local JS engine cache.
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
- [x] **Multimodal Ingestion (Vision & Documents)**: ✅ Complete.
- [x] **Collapsible Memory Architecture**: ✅ Complete.
- [x] **Cloud Stability**: ✅ Complete. Switched to Supavisor (Port 6543) and fixed SQL `text` import.
- [x] **Multilingual Voice Core**: ✅ Complete. Supporting EN/ZH/ES cycling.
- [ ] **Extended Formats**: Add support for `.docx` and Excel ingestion.

---

## 10. Workspace & Environment Setup
To ensure consistency across development sessions, the workspace is standardized as follows:

- **Initialization Command**: `open workspace continuum2.0`
- **Root Directory**: `continuum2.0/`
- **Component Layout**:
    - **`continuum-core/`**: Contains the Python FastAPI backend, memory engine logic, and database migration scripts.
    - **`continuum-mobile/`**: Contains the React Native (Expo) frontend application, assets, and mobile-specific documentation.

