# AGENTS.md

Project-specific guidance for this repo lives in **`agent.md`** (git/deploy policy for the
OpenClaw bridge, IMAP, and VPS). Read that first for anything touching
`integrations/**` or `skills/**`.

This file adds environment/run guidance for automation.

## Cursor Cloud specific instructions

**What this repo is:** `Continuum 2.0` — an Expo SDK 54 / React Native app (`expo ~54`,
`react-native 0.81`, `react 19`). The app is the only product built from the repo root
(`App.js`, `index.js`, `src/`). It talks to hosted services that need **no local secrets**:
the Continuum backend on Render (`API_URL` in `src/constants/Config.js`) and Supabase
(URL + publishable anon key are committed in `Config.js`). `integrations/` (continuum-bridge,
render-email-bridge, continuum-backend) and `skills/` deploy to a **separate VPS/Render**, not
to this dev environment — see `agent.md`.

**Install / run (deps are refreshed by the startup update script — just `npm install`):**
- Start the dev server: `npx expo start` (Metro on `http://localhost:8081`). This is the real
  dev workflow — a developer then opens the app on a **physical device** via Expo Go or a
  dev-client build (scan the QR).
- There are **no `lint` or `test` scripts** and no ESLint/Jest config in this repo
  (`package.json` scripts are only `start`/`android`/`ios`/`web`/`deploy`). Do not invent them.
- `npx expo-doctor` reports only pre-existing patch-version drift and `.jpg` icon/splash
  warnings — non-blocking; do not "fix" by editing app code.

**Verifying a build without a device (headless CI/cloud):** request platform bundles from a
running Metro server; a `HTTP 200` with a multi-MB JS body = successful full compile:
```
curl -s -o /dev/null -w '%{http_code}\n' "http://localhost:8081/index.bundle?platform=ios&dev=true"
curl -s -o /dev/null -w '%{http_code}\n' "http://localhost:8081/index.bundle?platform=android&dev=true"
```
Both compile ~1295 modules. `/system/version` on the Render backend returns the live version.

**Gotchas (non-obvious):**
- **Expo Web does not run this app.** The web bundle *compiles*, but at runtime it throws
  `importing a module from 'react-native' instead of 'react-native-web'` and renders a blank
  page. Cause is native-only modules imported at load (`@sentry/react-native` is `Sentry.init`'d
  at the top of `App.js`; `react-native-iap`, `expo-local-authentication`, `expo-speech-recognition`).
  Do **not** try to "repair" web by editing app code — treat iOS/Android as the only targets.
- **No interactive UI is possible in the cloud VM:** no `/dev/kvm` / CPU virtualization (no
  Android emulator), no Android SDK, and iOS simulators can't run on Linux. Interactive testing
  requires a real device with Expo Go / a dev-client. Use the bundle-compile + backend-reachability
  checks above as headless proof instead.
- Native `ios/`/`android/` folders are gitignored and generated (`expo prebuild` / EAS); they are
  not present in a fresh clone.
