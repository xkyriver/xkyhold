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

## Before going public

- Add the production origin to the client.
- **Audience → Publish app** ("In production"), so any Google account can
  sign in without being listed as a test user.
- Branding verification needs a home page and a privacy policy on a domain
  verified in Search Console.
