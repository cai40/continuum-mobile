# Continuum Mobile — Agent Instructions

**Read this file first** before changing the email bridge, IMAP, or shipping any mobile release.

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
| **Render (email bridge)** | auto-deploys on push to `master` |
| **GitHub / PR review** | feature branch `cursor/<name>-5b08` |

### Rule: never leave deployable work on a feature branch alone

If you change anything the **deployed bridge runs** (below), you **must merge to `master` and push `master`** before marking the task complete:

- `integrations/email-bridge/**`
- `skills/@gzlicanyi/imap-smtp-email/**`
- `skills/email-triage/**`
- `skills/continuum-brain/**` (when bridge setup scripts change)

**Workflow every time:**

1. Create branch: `cursor/<descriptive-name>-5b08`
2. Implement, commit, push branch, open/update PR
3. **Merge to `master` and push `origin master`** (fast-forward or merge commit)
4. Confirm `git log origin/master -1` contains your fix

Do **not** tell the user to pull a feature branch name unless `master` is blocked and you document why.

### What went wrong before (do not repeat)

- Fixes landed only on `cursor/increase-email-fetch-limit-5b08`
- `master` was never updated, so the deployed bridge kept running old code
- Symptoms looked like bugs (e.g. `Invalid time format`) but were **deploy drift**

---

## Deploying the bridge

`master` is the deploy branch: pushing to it auto-deploys `continuum-email-bridge` on Render.
There are no user-run commands, no SSH, and no shell on the bridge host — all configuration is
Render service environment variables (`YAHOO_EMAIL`, `YAHOO_APP_PASSWORD`, `BRIDGE_SECRET`,
`CONTINUUM_API_URL`).

After a bridge change, confirm the new build is live:

```bash
curl -s https://continuum-email-bridge.onrender.com/health
```

---

## Render cloud email

Base URL: `{API_URL}/integrations/email` — set in `src/constants/Config.js` as
`RENDER_EMAIL_BRIDGE_URL`. **Every** bridge call the app makes (chat/stream, `/mail/*`,
`/slack/*`, `/zillow/*`, `/fetch-excerpt`, `/email-jobs*`, `/memories/*`, `/daily-cleanup/*`)
goes through this backend proxy, which authorizes with the signed-in user's Supabase bearer
and injects `X-Bridge-Secret` from its own environment. The bridge is therefore never called
directly by the client and `BRIDGE_SECRET` is not stored on the device.

1. Deploy Node bridge: `integrations/render-email-bridge/README.md` (Render Web Service + `YAHOO_EMAIL` / `YAHOO_APP_PASSWORD` secrets).
2. Copy `integrations/continuum-backend/email_router.py` into continuum-backend; mount router.
3. On main Render service set `CONTINUUM_EMAIL_BRIDGE_URL` + `CONTINUUM_EMAIL_BRIDGE_SECRET`.
4. `apiService.setBridgeAuthToken()` is fed the current session token from `AppContext`, so no
   bridge caller has to thread it through manually.

The Settings → Email & Bridge secret field is now an **optional device override**; leave it blank.

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

- `"bridge_version": "..."` (from `integrations/email-bridge/bridgeVersion.js`)
- `"features": { "date_range": true, ... }`

If `bridge_version` is **missing**, the bridge is still on old code — wait for the Render deploy to finish before debugging app logic.

**When you change bridge behavior**, bump `bridgeVersion.version` in `bridgeVersion.js`.

---

## Email feature map

| Feature | Config / code |
|---------|----------------|
| Max emails per batch | `MAX_LIMIT` in `emailFetchOptions.js` |
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
- [ ] Merged to `master` so Render redeploys the bridge
- [ ] `bridgeVersion.js` bumped if bridge/IMAP behavior changed
- [ ] User given `/health` check to confirm deploy
- [ ] PR updated with summary + verify steps

---

## Other context

- Handover / product state: `MEMO.md`
- Email bridge setup: `integrations/email-bridge/` and `integrations/render-email-bridge/`
