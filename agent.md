# Continuum Mobile — Agent Instructions

**Read this file first** before changing OpenClaw bridge, IMAP, VPS-related code, or shipping any mobile release.

---

## Device testing (mandatory — all projects, all releases)

**Never ship a release based only on unit tests, Node scripts, or “bundle compiles.”** A successful EAS export or CI green build is **not** device testing.

### Rule

Before marking any release complete — OTA update, TestFlight build, store build, or hotfix — you **must** verify the changed behavior on a **real device or official simulator** for every platform you ship (at minimum **iOS** for this app).

### Minimum bar per release

1. Install the **exact build or OTA update** you are about to publish (not just `master` source in a dev shell).
2. Walk through the **user path end-to-end** for every feature you touched.
3. Confirm the app **does not crash** on launch, on the changed flow, and on background/foreground resume.
4. Only then run `eas update`, `eas build`, or tell the user the release is ready.

### What does not count as device testing

- Running extraction or logic in **Node.js** only
- `eas update` / `expo export` succeeding with no runtime test
- Assuming dynamic imports or heavy native/JS libs are safe because the bundle built
- Asking the user to be the first tester

### What went wrong before (do not repeat)

- PDF attach fix was “tested” in Node and via EAS bundle export only
- `pdfjs-dist` was shipped OTA without opening the app on iOS
- Attaching a PDF **crashed Continuum AI Advisor** on device
- Bundle success ≠ runtime safety on Hermes/iOS

### If device testing is blocked

Do **not** deploy. State clearly what is blocked (no simulator, no TestFlight, no device access) and ship only after device verification — or revert to a known-safe approach.

---

## Git branch policy (mandatory)

This repo has two audiences:

| Audience | What they pull |
|----------|----------------|
| **VPS (Mr. Cai)** | `git pull origin master` only |
| **GitHub / PR review** | feature branch `cursor/<name>-5b08` |

### Rule: never leave deployable work on a feature branch alone

If you change anything the **VPS runs** (below), you **must merge to `master` and push `master`** before marking the task complete:

- `integrations/continuum-bridge/**`
- `skills/@gzlicanyi/imap-smtp-email/**`
- `skills/email-triage/**`
- `skills/continuum-brain/**` (when VPS setup scripts change)

**Workflow every time:**

1. Create branch: `cursor/<descriptive-name>-5b08`
2. Implement, commit, push branch, open/update PR
3. **Merge to `master` and push `origin master`** (fast-forward or merge commit)
4. Confirm `git log origin/master -1` contains your fix

Do **not** tell the user to pull a feature branch name unless `master` is blocked and you document why.

### What went wrong before (do not repeat)

- Fixes landed only on `cursor/increase-email-fetch-limit-5b08`
- User ran `git pull origin master` on VPS → old code kept running
- Symptoms looked like bugs (e.g. `Invalid time format`) but were **deploy drift**

---

## VPS deploy commands (copy-paste for user)

Always give **one line**, `master` only:

```bash
export PATH="/usr/local/bin:/usr/bin:$PATH" && cd /tmp/continuum-mobile && git pull origin master && bash integrations/continuum-bridge/sync-imap-skill.sh && systemctl --user restart continuum-bridge
```

If the repo is missing on VPS:

```bash
export PATH="/usr/local/bin:/usr/bin:$PATH" && git clone https://github.com/cai40/continuum-mobile.git /tmp/continuum-mobile && cd /tmp/continuum-mobile && bash integrations/continuum-bridge/setup-bridge-service.sh && bash integrations/continuum-bridge/sync-imap-skill.sh
```

Tell the user to run commands **one line at a time** if paste breaks on iPhone/Termius.

---

## Render cloud email (no user VPS)

App route: `POST {API_URL}/integrations/email/chat/stream` when **Render cloud email** is ON in Settings.

1. Deploy Node bridge: `integrations/render-email-bridge/README.md` (Render Web Service + `YAHOO_EMAIL` / `YAHOO_APP_PASSWORD` secrets).
2. Copy `integrations/continuum-backend/email_router.py` into continuum-backend; mount router.
3. On main Render service set `CONTINUUM_EMAIL_BRIDGE_URL` + `CONTINUUM_EMAIL_BRIDGE_SECRET`.

Verify:

```bash
curl -s https://continuum-backend-0q9j.onrender.com/integrations/email/status
```

---

## Verify bridge deploy (required after bridge changes)

After any bridge/IMAP change, ensure `/health` reports the new build:

```bash
curl -s http://127.0.0.1:8787/health
```

Expect:

- `"bridge_version": "..."` (from `integrations/continuum-bridge/bridgeVersion.js`)
- `"features": { "date_range": true, ... }`

If `bridge_version` is **missing**, the VPS is still on old code — do not debug app logic until pull + restart succeed.

**When you change bridge behavior**, bump `bridgeVersion.version` in `bridgeVersion.js`.

---

## OpenClaw / email feature map

| Feature | Config / code |
|---------|----------------|
| Max emails per batch | `MAX_LIMIT` / `MAX_OPENCLAW_EMAIL_LIMIT` (1000) |
| Pagination offset | `emailFetchOptions.js`, `--offset` on IMAP |
| Date range fetch | `emailDateRange.js`, `--since` / `--before` on IMAP |
| Month / year ranges | `parseMonthRangeFromMessage`, `parseYearRangeFromMessage` in `emailDateRange.js` |
| Clean up inbox | `emailDelete.js` (`CLEANUP_INTENT`, `resolveCleanupUids`) + `email-triage` classifier |
| Move to folder | `emailMove.js` + `imap.js move --to <folder>` |
| Web search | `src/utils/webSearch.js` (direct chat) or bridge / Render email bridge |
| Render cloud email | `email_router.py` + `render-email-bridge/`; app `renderEmailChatStream` |
| Over-limit permission | `emailPermission.js` — blocks trash/move until `yes proceed` / `confirm` |
| Lite fetch (large batches) | `--lite` on IMAP check (headers + snippet only) |
| Lookback window | Settings **Email Lookback** (`7d`, `30d`) — **ignored** when user gives explicit dates |

Chat examples that must work:

- `Skip 100, fetch next 250 emails`
- `Fetch emails from 6/20/2026 back to 4/1/2026`
- `Clean up inbox from 4/1/2026 to 6/15/2026`
- `Clean up June 2026` / `Clean up for 2026`
- `Move all emails from Min Zhang (njsgas@gmail.com) to Min folder`
- `What was Norway's latest soccer match result?` (web search — direct chat or bridge)
- `Search the web for ...`
- Over limit → user replies `yes proceed` before trash/move runs

---

## PR checklist (before closing task)

- [ ] Merged to `master` and pushed
- [ ] **Device-tested** on iOS (and Android if changed) — real device or simulator, exact release artifact
- [ ] VPS command uses `git pull origin master` (not feature branch)
- [ ] `bridgeVersion.js` bumped if bridge/IMAP behavior changed
- [ ] User given `/health` check to confirm deploy
- [ ] PR updated with summary + verify steps

---

## Other context

- Handover / product state: `MEMO.md`
- OpenClaw setup: `docs/OPENCLAW_INTEGRATION.md`
- OpenClaw agent snippet: `integrations/continuum-bridge/AGENTS-continuum.snippet.md`
