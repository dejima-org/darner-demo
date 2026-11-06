# Security policy

## What darner-demo is

A static site. There's no backend, no model and no sandbox behind it, and it holds no credential: the web host serves files, and the forge's CI builds them. A visitor's sessions live in their own browser's `localStorage`, under `darner-demo`, and `src/demo.js` answers darner-web's requests in the browser, so nothing they type, start or upload is sent anywhere. With scripts off, a submitted form goes to the web host, which refuses it.

The pages are darner-web's, captured from darner itself, and are served with darner-web's own CSP and headers (`deploy/nginx.conf`). What an agent would write, such as the demo task's output and the self-test's text, is rendered by darner's own templates and `app.js`, so it's as inert as darner makes it, and no more: a flaw in that rendering is darner's, and shows here too. `src/demo.js` inserts no HTML, only text.

## Reporting a vulnerability

Email **report@dejima.page**. Please don't open a public issue for a vulnerability; a report there is a disclosure. A flaw in what darner-web renders is darner's: see [darner's SECURITY.md](https://github.com/dejima-org/darner/blob/main/SECURITY.md).

The organisation-wide policy, including what you can expect in return, is [dejima's SECURITY.md](https://github.com/dejima-org/dejima/blob/main/SECURITY.md). Only what's served from `main` is supported, and nothing is promised.

## No warranty

GPL-3.0-or-later, sections 15 and 16. This is provided as-is.
