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
4. Configure OAuth consent screen (External), add yourself as a **Test user**
5. Create credentials → **OAuth client ID**
   - Application type: **iOS**
   - Bundle ID: `com.continuum.advisor.cloud`
   - Continuum builds the redirect as `com.googleusercontent.apps.<CLIENT_ID>:/oauthredirect`
6. Do **not** use a Web or Desktop client on iPhone — Google blocks those with Continuum’s browser OAuth flow (`Error 400: invalid_request` / OAuth policy)

## In Continuum

1. Setup → **Google Drive**
2. Paste the **iOS** Client ID into iOS Client ID
3. Tap **Connect Google Drive** and sign in
4. In chat, paperclip → **Google Drive** → pick a file

## Native build note

This feature uses `expo-auth-session`, `expo-web-browser`, and `expo-secure-store`.
A **new EAS / TestFlight build** is required once so those native modules are in the binary.
After that, JS updates can ship via OTA.
