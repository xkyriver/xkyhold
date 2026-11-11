# XkyHold

Simple, encrypted backups of your computer's folders to your own Google
Drive — in the browser, with nothing to install.

XkyHold is the web successor of BackMa (a Windows tray app built on restic
and rclone). It keeps the same goal — a backup tool that needs no
explanation — as a static PWA: files are encrypted in the browser before
they leave the computer, and there is no server.

## Status

Early scaffold. See [docs/PLAN.md](docs/PLAN.md) (Portuguese) for the
architecture, the phases and the open questions.

## Browser support

- **Back up and restore:** Chrome, Edge, Brave, Opera on desktop (needs the
  File System Access API).
- **Restore only:** every other modern browser, including mobile.

## Development

```bash
npm install
npm run dev      # local dev server
npm run check    # type check
npm test         # unit tests
npm run build    # production build in dist/
```

Node version is pinned in `.node-version`.
