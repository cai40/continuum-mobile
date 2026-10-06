# Continuum Project Memo: v3.4.67 (Legal Fortress)
**Date**: April 26, 2026
**Subject**: Compliance Hardening & Freemium Pivot

## 1. Executive Summary
This release marks the transition of Continuum 2.0 from a feature-gated prototype to a capacity-gated production suite. We have successfully implemented the "Legal Fortress" architecture to ensure App Store readiness and pivoted the business model to offer all memory layers to every user.

## 2. Key Accomplishments

### A. Legal Compliance ("The Fortress")
*   **Mandatory Onboarding**: Implemented a full-screen, un-skippable Legal Gate that forces users to review and accept the Privacy Policy and Terms of Use.
*   **Immutable Audit Log**: Created a dedicated backend ledger (`legal_compliance_audit`) that captures consent metadata (Email, IP, Timestamp, Version) and persists even after account deletion.
*   **Proof-of-Consent Receipts**: Automated background email dispatch system that sends verification receipts to the user and the master account (cai40@yahoo.com).

### B. Business Model Pivot (Full Neural Access)
*   **Unlocked Memory**: Removed all tier-based blocks on L1-L5 memory layers. All users now have access to their entire cognitive vault.
*   **Capacity Gating**: Introduced "Neural Storage" caps (500 / 5,000 / 50,000 facts) to manage database density and infrastructure costs.
*   **Daily Heartbeat Quotas**: Implemented daily conversation limits (10 / 100 / Unlimited) to manage LLM API overhead.

### C. Store Readiness Audit ✅
*   **Privacy & Safety**: Verified mandatory "Account Deletion" and legal links are prominently visible in Settings.
*   **Hardware Permissions**: Audited `app.json` for clear, user-centric permission descriptions (Mic, Camera, FaceID).
*   **Support Accessibility**: Added a direct "Contact Support" email link to meet App Store requirements.
*   **Branding Consistency**: Synchronized all UI headers and manifest metadata to the official "Continuum 2.0" identity.

### D. UI/UX Evolution
*   **Neural Capacity Monitor**: Added a real-time storage and quota visualization dashboard in the Setup menu.
*   **Dual Subscription Path**: Redesigned the membership interface to offer "Subscribe Now" and "Free Trial" options for Pro/Elite tiers.

## 3. Infrastructure Status
*   **Frontend**: EAS Production Update `v3.4.85` live on all devices.
*   **Backend**: Render Deployment `v3.4.65` live on cloud.
*   **Email Bridge**: Render Bridge `2026.10.06` live.
*   **Database**: Schema migrated to support legal audit and capacity tracking.

## 4. Next Steps
*   **App Store Submission**: Review the EAS build logs and proceed with final submission to App Store Connect.
*   **Agentic Roadmap**: Begin preliminary design for "Action Tokens" (Function Calling) to allow the AI to interact with external apps.

---

# Continuum Project Memo: v3.4.85 (Chat Grounding & In-Context Memory)
**Date**: October 6, 2026
**Subject**: Anti-Hallucination Grounding, Chat Reading Capabilities, Multilingual Voice Matching

## 1. Summary of Changes
1. **Chat Window Grounding**:
   - Updated Grounding Prompt Rules 1, 4, 10, and added Rule 13 to strictly define user inputs in earlier conversation turns as authoritative ground truth.
   - Forbade assistant disclaimers/meta-denials claiming inability to read the chat window or access past conversation messages.
2. **Meta-Denial Self-Healing (`sanitizeRecallHistory`)**:
   - Superseded prior assistant replies that contain reading disclaimers ("无法读取当前聊天窗口", "As an AI I do not have access to current chat") before passing them to the upstream LLM, preventing negative feedback loops.
3. **Context Length & Entity Retention**:
   - Expanded message upload limit from 20 to 50 turns.
   - Implemented entity-aware back-retrieval for older matching messages using CJK and Latin keyword extraction.
4. **CJK & English Memory Retrieval**:
   - Added particle-aware segmentation for Chinese recall phrases and persona prompts.
   - Enabled direct L1 pinning for extracted persona summaries from chat.
5. **Voice Mode Auto-Language Matching**:
   - Integrated dynamic language switching ensuring the assistant answers in the exact language spoken by the user.

---
*End of Memo*
