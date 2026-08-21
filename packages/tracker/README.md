# @accessly/tracker

Records what a user *experienced* — where focus went, what was announced, which
dialogs opened — and posts it to Accessly, which turns it into a report.

It is not a session replay. There is no DOM snapshot, no stylesheet, no
screenshot, and **no input values**: only the fact that a field was edited. A
pixel replay of a checkout is a data-protection liability; a transcript of focus
and announcements is not, and it is the part you cannot reconstruct from a video
anyway.

## Install

One tag, at the end of `<head>` or anywhere in `<body>`:

```html
<script src="https://cdn.accessly.eu/accessly-tracker.js"
        data-endpoint="https://api.accessly.eu/v1/traces"
        data-organisation="00000000-0000-4000-8000-000000000001"
        defer></script>
```

| Attribute | Required | Meaning |
| --- | --- | --- |
| `data-endpoint` | yes, to send | Where to POST the trace. Omit it and the tracker still records, so you can inspect `Accessly.current.tracker.build()` from the console. |
| `data-organisation` | yes, in production | Sent as `x-accessly-organisation`. Traces without it land in the demo tenant. |
| `data-journey` | no | Check this recording against a journey definition's declared expectations. |
| `data-autostart` | no | `false` records nothing until you call `Accessly.install()` yourself. |
| `data-max-messages` | no | Lower the message budget. It cannot be raised — see below. |

Including the tag twice is safe: the second load defers to the first rather than
recording everything twice.

## Using it as a library

```ts
import { Tracker } from '@accessly/tracker';

const tracker = new Tracker({ endpoint: '/v1/traces', organisationId: 'org-1' });
tracker.start();

tracker.startStep('checkout', 'Open checkout');
// …
tracker.endStep(true);

await tracker.flush();
```

`packages/tracker/dist/accessly-tracker.esm.js` is the same thing prebuilt, for
bundlers that would rather not compile TypeScript from `node_modules`.

## When the trace is sent

On `visibilitychange` to hidden, with `pagehide` as a backstop. Not
`beforeunload`, which never fires on mobile when the user switches apps — which
is most sessions. Delivery is guarded, so both firing sends once.

The request uses `fetch` with `keepalive`, because an ordinary request started
during unload is cancelled along with the document.

## The message budget

`keepalive` gives a request about 64 KB. A trace that outgrew it would be
rejected by the browser rather than trimmed, so the tracker caps itself at 1000
messages instead — and when it hits that cap it sets `truncated` on the trace.

That flag matters. A session that ended and a recording that stopped produce
identical-looking traces, and mean completely different things: without it the
analyser would cheerfully report "nothing was ever announced" about a page it
simply stopped watching. The report says so, and the player shows a warning.

## Build

```bash
npm run build:tracker
```

Writes `dist/accessly-tracker.js` (IIFE, defines `window.Accessly`) and
`dist/accessly-tracker.esm.js`. The build fails if the browser bundle exceeds
16 kB — the tracker's argument is that watching a session is cheap, and a bundle
that quietly grew would refute that in production long before anyone noticed it
in a diff.

`packages/tracker/test/bundle.test.ts` builds and then evaluates the artefact in
jsdom, so what is tested is what ships.
