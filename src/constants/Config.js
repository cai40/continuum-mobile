export const API_URL = "https://continuum-backend-0q9j.onrender.com";
// Email is proxied by the backend (/integrations/email/*), which forwards the user
// bearer plus the shared X-Bridge-Secret from its own env, so BRIDGE_SECRET no
// longer has to be stored or sent by the client.
export const RENDER_EMAIL_BRIDGE_URL = `${API_URL}/integrations/email`;
export const DEFAULT_EMAIL_LIMIT = 5000;
// The previous default. A stored value equal to this is treated as an untouched
// carry-over rather than a deliberate choice, so installs that never customized
// the field pick up the new default instead of silently keeping the old cap.
export const LEGACY_DEFAULT_EMAIL_LIMIT = 25;
export const MAX_EMAIL_LIMIT = 50000;
// Bridge-side default scan cap for a daily cleanup run (DAILY_CLEANUP_LIMIT on
// Render overrides it). Display only — the run cap is decided by the bridge.
export const DAILY_CLEANUP_SCAN_LIMIT = 5000;
// Bridge-side default lookback window for a daily cleanup run. Display only —
// must stay in step with DEFAULT_CLEANUP_LOOKBACK in the email bridge.
export const DAILY_CLEANUP_LOOKBACK = "30d";
export const DEFAULT_EMAIL_RECENT = '7d';
export const SUPABASE_URL = 'https://yybojfgjhtrwqhtavorg.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_o9AuvayIw6vnMtnqhdTpNg__V7pA5i5';
export const SENTRY_DSN = 'https://f2d74237bcb38ceb544825358e7972f4@o4511229827088384.ingest.us.sentry.io/4511229855006720'; 
export const HARDWARE_TOKEN_LIMIT = 4000;
export const SYNC_COOLDOWN = 30000; // 30s
export const SILENCE_THRESHOLD = -35; // dB
export const SHORT_SILENCE_TIMEOUT = 2000; // 2s
export const LONG_SILENCE_TIMEOUT = 10000; // 10s
// How long a pause in speech may last before hands-free voice mode treats the turn as
// finished and sends it. The recognizer used to end the turn by itself after a second or
// two of quiet, which cut slow speakers off mid-sentence, so the turn is ended by this
// pause budget instead. User-adjustable in Setup → Voice & Audio.
export const VOICE_PAUSE_DEFAULT_MS = 4000;
export const VOICE_PAUSE_OPTIONS = [
  { value: 2000, label: '2 seconds', desc: 'Quickest — sends soon after you stop speaking' },
  { value: 3000, label: '3 seconds', desc: 'A short pause' },
  { value: 4000, label: '4 seconds', desc: 'Default — a comfortable pause mid-sentence' },
  { value: 6000, label: '6 seconds', desc: 'Relaxed — for slower, deliberate speech' },
  { value: 10000, label: '10 seconds', desc: 'Longest — for slow speech with thinking pauses' },
];
export const BUILD_ID = "3.4.112-WanqingSharedReality";
export const APP_VERSION = "3.4.112";
export const GIT_COMMIT = '48a3161';
