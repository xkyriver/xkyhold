# XkyHold

Simple, encrypted backups of your computer's folders to your own Google
Drive — in the browser, with nothing to install.

XkyHold is the web successor of BackMa (a Windows tray app built on restic
and rclone). It keeps the same goal — a backup tool that needs no
explanation — as a static PWA: files are encrypted in the browser before
they leave the computer, and there is no server.

Live at https://xkyhold.xkyriver.com.

## Status

Working app, being opened to the public. See [docs/PLAN.md](docs/PLAN.md)
(Portuguese) for the architecture and the decisions,
[docs/LAUNCH.md](docs/LAUNCH.md) (Portuguese) for the launch, and
[docs/FORMAT.md](docs/FORMAT.md) for the repository format.

## Pages

- `/` and `/pt/`: the landing page in English and Portuguese
  (`index.html`, `pt/index.html`, `src/landing/`, share images
  `public/og.png` and `public/og-pt.png`). `public/landing-redirect.js`
  sends a browser that already has a backup set up to the app, and a
  device in Portuguese from `/` to `/pt/`.
- `/app/`: the app (`app/index.html`).

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

## License

XkyHold is free software under the [GNU Affero General Public License,
version 3](LICENSE) (AGPL-3.0-only). If you run a modified version for other
people, for example on your own website, you must offer them its source
code under the same license.
