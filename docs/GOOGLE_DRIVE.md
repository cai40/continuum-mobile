# Google Drive (read-only)

Continuum can list and download files from your Google Drive and attach them in chat.

## Scope

- OAuth scope: `https://www.googleapis.com/auth/drive.readonly`
- Continuum **cannot** create, edit, or delete Drive files
- Google Docs / Sheets / Slides are exported (PDF / XLSX / PPTX) before attach

## One-time Google Cloud setup

1. Open [Google Cloud Console](https://console.cloud.google.com/)
2. Create or select a project
3. Enable **Google Drive API**
4. Configure OAuth consent screen (External or Internal)
5. Create credentials → **OAuth client ID**
   - Application type: **Web application** (recommended for Expo AuthSession)
   - Authorized redirect URI: copy from Continuum **Setup → Google Drive** (usually `continuum://oauth`)
6. Optional: also create iOS / Android clients with:
   - iOS bundle ID: `com.continuum.advisor.cloud`
   - Android package: `com.continuum.advisor.cloud`

## In Continuum

1. Setup → **Google Drive**
2. Paste Web Client ID (and optional iOS/Android IDs)
3. Tap **Connect Google Drive** and sign in
4. In chat, paperclip → **Google Drive** → pick a file

## Native build note

This feature uses `expo-auth-session`, `expo-web-browser`, and `expo-secure-store`.
A **new EAS / TestFlight build** is required once so those native modules are in the binary.
After that, JS updates can ship via OTA.
