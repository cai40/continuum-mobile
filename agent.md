# Continuum Mobile — Agent Instructions

**Read this file first** before changing OpenClaw bridge, IMAP, or VPS-related code.

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
| Over-limit permission | `emailPermission.js` — blocks trash until `yes proceed` / `confirm cleanup` |
| Lite fetch (large batches) | `--lite` on IMAP check (headers + snippet only) |
| Lookback window | Settings **Email Lookback** (`7d`, `30d`) — **ignored** when user gives explicit dates |

Chat examples that must work:

- `Skip 100, fetch next 250 emails`
- `Fetch emails from 6/20/2026 back to 4/1/2026`
- `Clean up inbox from 4/1/2026 to 6/15/2026`
- `Clean up June 2026` / `Clean up for 2026`
- Over limit → user replies `yes proceed` before trash runs

---

## PR checklist (before closing task)

- [ ] Merged to `master` and pushed
- [ ] VPS command uses `git pull origin master` (not feature branch)
- [ ] `bridgeVersion.js` bumped if bridge/IMAP behavior changed
- [ ] User given `/health` check to confirm deploy
- [ ] PR updated with summary + verify steps

---

## Other context

- Handover / product state: `MEMO.md`
- OpenClaw setup: `docs/OPENCLAW_INTEGRATION.md`
- OpenClaw agent snippet: `integrations/continuum-bridge/AGENTS-continuum.snippet.md`
