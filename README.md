# Accessly

Accessibility auditing, scoring, and continuous monitoring against **WCAG 2.1**.

Accessly audits a page, reports every failure with the success criterion it
breaks and how to fix it, and then keeps watching — re-checking on a schedule
and telling you which deploy introduced a regression.

It does the same for the **documents** you publish — PDFs, Word files, decks,
spreadsheets, EPUBs, caption tracks — and for **recorded sessions**, which
answer the questions markup cannot: where focus went when the dialog closed,
whether the route change was announced, whether anything told the user their
form submitted.

---

## Getting started

```bash
npm install
```

```bash
npm run dev
```

That starts the API on `http://127.0.0.1:4000` and the web app on
`http://localhost:5173`, with `/api` proxied to the API so nothing in the client
knows about ports.

```bash
npm test
```

```bash
npm run typecheck
```

`npm run verify` runs all three gates (typecheck, tests, self-audit) — the
same thing CI should run. Working with an AI agent or new to the repo? Start
with `AGENTS.md`: the map, the invariants and the conventions in one file.

---

## Layout

```
packages/
  contracts/   The shared vocabulary: the WCAG 2.1 catalogue, domain types,
               and the zod schemas the API and web app both speak.
  core/        The rule engine. Pure, dependency-light, and runnable anywhere:
               HTML or an accessibility tree in, scored report out. Also holds
               the format-neutral tree and the journey analyser.
  media/       Format adapters: PDF, Word, PowerPoint, Excel, EPUB, captions.
               Bytes in, accessibility tree out.
  tracker/     The browser tracker customers embed to record a session.
apps/
  api/         HTTP API, layered routes → services → repositories, plus the
               monitoring watcher.
  web/         Vite + React: marketing site, self-service scanner, client and
               monitoring dashboards, and the printable report.
```

The client-facing application lives under `/dashboard`:

| Route | For |
| --- | --- |
| `/dashboard` | Any client — registered pages, scores, scan and remove, recent audits. |
| `/dashboard/monitoring` | Subscribed clients — watch status, forced checks, frequency, and the event timeline. |
| `/dashboard/audits/:id` | One report, led by its diff against the previous audit. |
| `/dashboard/journeys` | Recorded sessions, replayed as a transcript with the defects anchored to the moment they happened. |

The dependency direction is one-way and enforced by the workspace boundary:

```
web     ─┐
         ├─→ contracts ←─ core ←─ media
api     ─┘                ↑        ↑
         └────────────────┴────────┘
tracker ─→ contracts
```

The tracker depends on contracts alone. It ships to a customer's page, so it
carries the message protocol and nothing else.

`web` cannot import anything from `api`. It only knows the contracts. Swapping
the in-memory repositories for Postgres is a change to
`apps/api/src/container.ts` and a new set of adapters — no service, route or
frontend file changes.

---

## The engine

### Every rule cites a criterion

A rule that cannot name the WCAG 2.1 success criterion it enforces does not
ship. The registry validates every citation against the published
Recommendation at load time, so a typo is a startup crash rather than a
mis-attributed line in someone's compliance report.

```ts
const imageAlt = elementRule({
  id: 'image-alt',
  title: 'Images have a text alternative',
  criteria: ['1.1.1'],
  impact: 'critical',
  techniques: ['H37', 'F65'],
  selector: 'img',
  evaluate: (element) => { /* … */ },
});
```

### "I cannot tell" is a real answer

Accessly does not run a browser. When a value cannot be resolved it reports
`cantTell` and says why — it does not guess. A tool that reports failures a
customer cannot reproduce teaches them to ignore the whole report.

The CSS resolver is built to make that answer rare rather than routine:

- **Custom properties are resolved**, including chains and fallbacks. A resolver
  that gives up at `var(--ink)` cannot check contrast on any site built this
  decade.
- **Selectors are matched by the DOM**, so descendant and compound selectors
  work.
- **Theme variants are resolved separately.** A `prefers-color-scheme: dark`
  block is a second palette, and text that passes in light mode can fail in dark
  mode. Both are checked, and a failure names which theme it is in.
- **An unresolvable value makes the whole result undecidable**, even when an
  inherited value is available to fall back on. Otherwise `color: var(--missing)`
  silently reports a confident, wrong ratio for a colour the element does not
  actually have — and a wrong number is worse than no number.

### Coverage is published in three buckets, not one

No automated tool can evaluate all 78 success criteria, and the usual way of
hiding that is to count "we prompt a human to check this" as coverage. We could
reach 78/78 tomorrow that way and it would mean nothing.

So every rule declares whether it can **decide** an outcome or only **flag** one
for review, and `GET /v1/rules` reports three numbers:

| Bucket | Meaning | Counts towards the score |
| --- | --- | --- |
| Decided | A failure can be detected from the markup | yes |
| Flagged for review | We raise the question, a human answers it | no |
| Not tested | Nothing looks at it | no |

Current position: **49 decided, 9 flagged, 20 untested**. At level A and AA
specifically: 41 decided, 8 flagged, 1 untested (2.5.1 Pointer Gestures, which
requires operating the page).

Criteria in the last two buckets are excluded from the score in *both*
directions — counting them as passes would inflate every score, counting them as
failures would make a perfect page unreachable.

### How the score works

- **75% criterion coverage** — the weighted share of automatable in-scope
  criteria that pass. Level A weighs 3, AA weighs 2, AAA weighs 1.
- **25% instance density** — how much of the page is affected, weighted by
  impact. One missing `alt` and two hundred fail 1.1.1 identically as far as
  conformance goes, but they are not the same amount of work.

The score is a **progress metric**. The conformance verdict is reported
separately and is binary, because that is what WCAG actually says: one unmet
level A criterion means the page does not conform, whatever the number says.
`Score.conformsTo` carries that verdict and the UI never shows one without the
other.

---

## The watcher

Polling is content-addressed. Every check fetches the page and hashes the
normalised markup; an audit is only spent when the hash moved. That keeps cost
proportional to how often you ship, and it makes the event stream meaningful —
a `changed` event corresponds to a real deploy.

| Event | Meaning |
| --- | --- |
| `polled` | We requested the page. |
| `unchanged` | Byte-for-byte identical; no audit run. |
| `changed` | Content moved. An audit follows. |
| `audited` | A fresh report was produced. |
| `regressed` / `improved` | The score moved, with the issues named. |
| `poll_failed` | Unreachable. The schedule advances anyway. |

That last row matters: the next poll is scheduled from *now*, never from the
missed slot, so a site that was down for a week does not come back to a week of
backlogged audits firing at once.

---

## Documents

A PDF and a web page are the same problem wearing different clothes: something
has a structure, and assistive technology either can follow it or cannot. So
every format is parsed into one **accessibility tree** — nodes with a role, a
name, a level, a locator — and a single set of rules runs over it.

| Format | What we read |
| --- | --- |
| Word (`.docx`) | Real headings (`w:pStyle`, not big text), list structure, image alt from `wp:docPr descr`, header rows, language. |
| PowerPoint (`.pptx`) | Slide titles from the title placeholder, picture alt, charts and tables. |
| Excel (`.xlsx`) | Header rows declared as tables or autofilters, default sheet names. |
| EPUB | The spine, each chapter through the HTML path, and the `schema:accessibility*` metadata. |
| PDF | Tagging (`/MarkInfo`, `/StructTreeRoot`), language, title, `DisplayDocTitle`, figure alt. |
| Captions (`.vtt`, `.srt`) | Reading rate, cue duration, overlap, speaker identification. |

The format is decided by **sniffing the bytes**, not the extension. Where a
file cannot be read — object streams in a PDF, an encrypted document, a
truncated archive — the tree records an *unknown* and the affected rules report
`cantTell`. That mechanism is only for the unreadable: a Word file whose
properties are perfectly legible and simply declare no language is a real
failure, and calling it undecidable would blunt the distinction everywhere.

---

## Journeys

Some criteria are not properties of markup at all. 2.4.3 Focus Order is a
property of what happens when you press Tab. 4.1.3 Status Messages is a
property of what was said after you pressed the button. A static checker can
only ever return `cantTell` for those — which is exactly what ours does, and
exactly the gap journeys close.

The tracker (`packages/tracker`) is embedded on a page and records a flat
stream of numerically-typed messages: focus moves and their cause, live-region
announcements and their politeness, dialogs opening and closing, route changes,
navigation keys. The shape is adapted from OpenReplay's session replay — a node
mirror, appendable messages, batched delivery — because that design is proven
for recording cheaply on the page being recorded.

What is *not* recorded is the point of the adaptation. There is no DOM
snapshot, no stylesheet, no screenshot, and no input value — only that a field
was edited. A pixel replay of a checkout is a data-protection liability; a
transcript of focus and announcements is not, and it is the part you cannot
reconstruct from a video anyway.

A **journey** is the declarative half — the flow you want monitored, written by
the accessibility specialist rather than by whoever owns the test suite:

```ts
{
  id: 'close-dialog',
  label: 'Close the confirmation dialog',
  action: 'press',
  expect: { announces: 'cancelled', keyboardOnly: true },
}
```

Every recording is checked against those expectations and against the journey
rules, and the result is a report with the same shape as a page audit — except
its body is a timeline, because these defects happen at moments rather than at
elements. The player at `/dashboard/journeys` walks that timeline: play, step,
scrub, jump to the next issue. It is a transcript rather than a video, which
means the person most affected by a focus-order bug can read the evidence for
it.

---

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Status, engine version, rule count. |
| `GET` | `/v1/wcag/criteria` | The full WCAG 2.1 catalogue. |
| `GET` | `/v1/rules` | Rule catalogue **and** published coverage gaps. |
| `POST` | `/v1/audits` | Audit a URL, pasted HTML, or an uploaded document. |
| `GET` | `/v1/audits/:id` | Retrieve a report. |
| `GET` | `/v1/audits/:id/diff` | What changed since the previous audit. |
| `GET/POST/PATCH/DELETE` | `/v1/sites` | Registered pages. |
| `GET/POST/PATCH/DELETE` | `/v1/watches` | Monitoring subscriptions. |
| `GET` | `/v1/watches/:id/events` | The monitoring timeline. |
| `POST` | `/v1/watches/:id/poll` | Force a check now — use this from CI. |
| `GET/POST/PATCH/DELETE` | `/v1/journeys` | Journey definitions — the flows you want monitored. |
| `POST` | `/v1/traces` | Ingest a recorded session; answers with its report. |
| `GET` | `/v1/journey-reports/:id` | One session report, with its timeline. |
| `GET` | `/v1/traces/:id` | The raw messages behind a report — the evidence. |

`POST /v1/traces` is the one endpoint posted to by a script running on
somebody else's page, so its tenancy comes from the request context and never
from the body — otherwise any page could post into any tenant. Trace ids are
chosen by the browser and therefore guessable, so reads of a trace are scoped
at the lookup rather than checked afterwards.

Every route that reads or writes a resource is scoped to the calling
organisation (the `x-accessly-organisation` header); a resource belonging to
another tenant is reported as `404`, never `403`, so an enumeration cannot
even confirm an id exists. List endpoints paginate with a `cursor` query
parameter and return `nextCursor` until exhausted — an unresolvable cursor
ends the page rather than silently restarting it.

Errors are [RFC 9457 Problem Details](https://www.rfc-editor.org/rfc/rfc9457),
with field-level messages written for a person to read. That includes rate
limiting (`429` carries a `retry-after` header) and the 500 path, which never
leaks an internal message.

### Security

`POST /v1/audits` fetches URLs on the caller's instruction, which is an SSRF
primitive by construction. `apps/api/src/services/url-guard.ts` resolves the
hostname and rejects loopback, private, link-local (cloud metadata),
carrier-grade NAT and IPv4-mapped-IPv6 addresses — checking the *resolved*
addresses, not the string, because `internal.example.com` looks public until
you resolve it. Redirects are followed **manually** and every hop is
re-validated, so a public URL that 302s to `http://169.254.169.254/` is
refused at the redirect. The fetch timeout covers the whole exchange —
connection, redirects and body — so a slow-dripping response cannot hold a
request open indefinitely.

---

## Accessibility of Accessly itself

We audit other people's sites; ours is held to the same standard, in CI.

- Every page is run through our own engine in `apps/web/test/pages.test.tsx`.
  The build fails on any confirmed level A or AA failure.
- Contrast is asserted against the design tokens directly
  (`apps/web/test/theme.test.ts`), including a check that the ratios claimed in
  the comments in `tokens.css` are actually true.
- Focus management, route announcement, keyboard operation of the navigation,
  error handling and table semantics all have explicit tests.

Notable implementation details:

- **Skip link is the first element in the DOM**, and `<main>` carries
  `tabindex="-1"` so following it actually moves focus rather than just
  scrolling.
- **Route changes announce and focus.** A SPA fires no page load, so a screen
  reader is told nothing. `NavigationProvider` sits above the routes — it has
  to, because every navigation remounts the page component, and a "first
  render" flag inside the page would suppress every announcement instead of
  just the first.
- **Render errors are contained by an error boundary** that announces itself
  assertively, moves focus to its explanation, and keeps the navigation
  landmarks working — a broken page must not take the whole app or leave a
  screen reader user in silence.
- **Navigation dropdowns are disclosures, not ARIA menus.** `role="menu"`
  carries a contract (roving focus, type-ahead, Home/End) that site navigation
  almost never implements, and half-implementing it is worse than not claiming
  it.
- **Forms validate on submit, never on blur**, so a keyboard user tabbing
  through is not interrupted by errors for fields they have not reached.
- **Colour is never the only cue.** Every badge, band and status carries a text
  label.
- **Atkinson Hyperlegible**, drawn by the Braille Institute to maximise
  distinction between commonly confused glyphs.
- `prefers-reduced-motion` and `forced-colors` are both honoured.

Our own accessibility statement lives at `/accessibility` and lists the
exceptions we know about.

---

## Tests

```
622 tests across 19 files
```

| Suite | What it guards |
| --- | --- |
| `contracts/test/wcag` | The catalogue matches the published Recommendation — 78 criteria, 30/20/28 by level, exact titles. |
| `core/test/color` | Contrast maths against the normative formulae. |
| `core/test/accname` | Accessible name computation against accname 1.2 ordering. |
| `core/test/rules` | Every rule: a page that should trigger it, and one that should not. |
| `core/test/scoring` | Score composition, conformance verdict, manual-review accounting, diffing. |
| `api/test/api` | Routes, validation, problem details, tenancy, pagination. |
| `api/test/watcher` | Scheduling, change detection, regression events, failure handling. |
| `api/test/url-guard` | SSRF — this one is a security control. |
| `api/test/fetcher` | Redirect re-validation against a pinned fake network. |
| `core/test/styles` | Custom-property resolution, selector matching, theme variants. |
| `web/test/pages` | Our own markup, audited by our own engine, plus behaviour. |
| `web/test/dashboard` | Dashboard behaviour, live regions, confirmation flows. |
| `web/test/theme` | Design token contrast, type scale, motion, forced colours. |
| `core/test/journey` | Trace reconstruction, the journey rules, and declared step expectations. |
| `media/test/adapters` | Format detection and every adapter — including that no HTML-only rule ever runs against a document. |
| `tracker/test/tracker` | The tracker in jsdom, including that it never records what someone typed. |
| `api/test/journeys` | Journey CRUD and trace ingestion, with the tenancy of a browser-supplied id. |
| `api/test/media-audits` | Uploaded documents end to end, including refusals that say why. |
| `web/test/journeys` | The player: keyboard operation, `aria-current`, and staying silent during playback. |

The strongest single guarantee is in `core/test/rules`: a correctly authored
page must produce **zero** confirmed failures. A rule that fires on good markup
is worse than no rule.

### Auditing ourselves

```bash
npm run audit:self
```

Server-renders every route with the real stylesheets inlined and runs the engine
over the result, exiting non-zero on any confirmed level A or AA failure. This
is stronger than the jsdom component tests, which resolve no CSS and so can
never decide contrast.

Current result: **14 routes, 0 confirmed failures, average 99/100**, with 33
items flagged for human review. Output is written to `self-audit.json` so a
regression can be diffed rather than argued about.

It found three real defects on its first run, all of the same shape — a colour
hardcoded against a token that flips in dark mode:

- the footer, light text on a surface that becomes light: **1.76:1**
- the primary button, white text on a brand colour that lightens: **1.76:1**
- and, once those were fixed, a missing token silently falling back to inherited
  ink: **2.2:1**

The fix was to introduce paired `--a-on-*` tokens that flip in step with their
backgrounds. The lesson is in `tokens.css` next to them.

Still out of reach without a browser: layout-dependent criteria (reflow, rendered
target size) and anything that only exists after hydration. Those are checked by
hand before a release and listed in `/accessibility`.

---

## What this phase does not include

Stated plainly, because a skeleton that pretends to be finished is worse than
one that does not:

- **No authentication.** Every request resolves to a demo organisation via
  `apps/api/src/http/context.ts`. That is the only file that changes when auth
  lands; every route and service already reads the tenant from it.
- **No persistence.** Repositories are in-memory, implementing the same ports
  (including cursor pagination) that a database adapter will.
- **No crawling.** One page per audit. Multi-page crawling needs a job queue,
  and that is the point at which `POST /v1/audits` becomes `202 Accepted`.
- **No JavaScript execution.** Accessly analyses the markup as served. For
  pages that only exist after hydration, post the rendered HTML.
- **No media decoding.** Video and audio containers are not opened. Submit the
  caption or description track alongside, or audit the page that embeds the
  player — the report says so rather than guessing.
- **No PDF text extraction.** The PDF adapter reads structure only: tagging,
  language, title, figure alt text. Where object streams or encryption hide
  that, it reports `cantTell` rather than assuming the document is untagged.
- **No pixel replay.** A journey trace holds no DOM snapshot and no
  screenshots, by design. The player renders a transcript of focus and
  announcements, which is the thing you cannot reconstruct from a video — and
  is what makes a recording of a checkout safe to keep.
