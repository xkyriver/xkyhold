# Google OAuth client

XkyHold signs in with Google Identity Services (token model) and asks for a
single scope, `https://www.googleapis.com/auth/drive.file`: the app only
sees files and folders it created itself. The scope is non-sensitive.

The client ID is not a secret — it ships in the page. A web client used
this way has no client secret in the app.

## One-time setup (Google Cloud console)

1. https://console.cloud.google.com → create a project, e.g. `xkyhold`.
2. **APIs & Services → Library** → enable **Google Drive API**.
3. **Google Auth Platform → Branding**: app name `XkyHold`, support email,
   developer contact email.
4. **Google Auth Platform → Audience**: user type **External**. While the
   app is in "Testing", add your own account under **Test users**.
5. **Google Auth Platform → Data Access → Add or remove scopes** → add
   `.../auth/drive.file`.
6. **Google Auth Platform → Clients → Create client**:
   - Application type: **Web application**
   - Name: `XkyHold web`
   - Authorized JavaScript origins: `http://localhost:5173`
     (add the production origin once the domain is decided)
   - Authorized redirect URIs: leave empty
7. Copy the client ID (`….apps.googleusercontent.com`).

## Local development

```bash
cp .env.example .env.local
# put the client ID in VITE_GOOGLE_CLIENT_ID
npm run dev
```

Open http://localhost:5173 (not 127.0.0.1 — the origin must match exactly)
and click "Sign in with Google".

## Current state (13 November 2026)

- Project `xkyhold`, client "XkyHold web".
- Authorized JavaScript origins: `http://localhost:5173` and
  `https://xkyhold.xkyriver.com`.
- Audience: External, publishing status **In production**. Any Google
  account can sign in. There is no user cap, because `drive.file` is not a
  sensitive scope.
- Branding: home page `https://xkyhold.xkyriver.com`, privacy
  `/privacy`, terms `/terms`, authorized domain `xkyriver.com` (verified in
  Search Console through a TXT record on the zone; keep that record).
  Logo: `docs/google-logo-120.png`.
- Verification Center: branding **verified**, shown to users. Data access
  needs no verification. Nothing is pending at Google.
- The owner checked with a personal Gmail account that was never a test user: the
  consent screen shows the name and the logo, with no warnings, and
  sign-in, backup and restore work.

## Work or school accounts

A Google Workspace organisation can block third-party apps. Its admin then
approves XkyHold in the Admin console (Security → Access and data control →
API controls → Manage Third-Party App Access), by client ID. The console
proposes only the sign-in scopes; `drive.file` has to be added with "Add
more OAuth scopes". The privacy page tells admins what to approve
(`/privacy#admins`). The owner confirmed on 13 November 2026 that a
company account works end to end once `drive.file` is added.

## If something changes

- A new logo, name or link in Branding has to be verified again before
  users see it.
- Adding any sensitive or restricted scope would bring back data-access
  verification and the user cap. Don't.
