# AGENTS.md — working in this repository

A guide for coding agents (and humans) who need to be productive here fast.
Read this before making changes. The short version:

```
npm install
npm run verify   # typecheck + full test suite + self-audit gate
```

If `npm run verify` does not pass, the work is not done.

---

## What this project is

Accessly audits **web pages, documents and recorded sessions** against
**WCAG 2.1** and reports every failure with the success criterion it breaks,
how to fix it, and a progress score. It also continuously monitors registered
pages and reports regressions per deploy. The product's core promise is
*evidence-grade honesty*: it never guesses, it says `cantTell` when the
evidence cannot decide an outcome, and it publishes its own coverage gaps
rather than rounding them away.

Three surfaces, one report shape:

- **Pages** — HTML parsed into a DOM, checked by DOM rules.
- **Documents** — PDF, Word, PowerPoint, Excel, EPUB and caption files parsed
  into a *format-neutral accessibility tree*, checked by node and tree rules.
  HTML runs through both surfaces, so nothing is lost.
- **Journeys** — a recorded session replayed as a transcript of focus moves and
  announcements, checked by journey rules. These decide the criteria the static
  engine can only ever call `cantTell` (2.4.3 focus order, 2.1.2 keyboard trap,
  4.1.3 status messages), because they are properties of a *sequence*.

## Layout

```
packages/
  contracts/  The shared vocabulary. WCAG 2.1 catalogue, domain types, zod
              request schemas. Both apps depend on it; it depends on nothing.
  core/       The rule engine. Pure TypeScript: HTML or an accessibility tree
              in, scored report out. Also holds the tree abstraction
              (`src/tree/`) and the journey analyser (`src/journey/`).
              No HTTP, no storage, no clock — those are injected.
  media/      Format adapters: bytes in, accessibility tree out. One file per
              format; the only package that unzips or sniffs anything.
  tracker/    The browser tracker customers embed. Records focus, live-region
              announcements, dialogs and navigation — never input values.
              `src/index.ts` is the library, `src/embed.ts` the script-tag
              lifecycle, `build.mjs` the bundle a customer installs.
apps/
  api/        Fastify HTTP API. routes → services → repositories, plus the
              monitoring watcher loop.
  web/        Vite + React SPA. Marketing site, scanner, dashboards, printable
              report, and its own self-audit script.
```

Dependency direction (enforced by workspace boundaries):

```
web     ─┐
         ├─→ contracts ←─ core ←─ media
api     ─┘                ↑        ↑
         └────────────────┴────────┘
tracker ─→ contracts
```

`tracker` depends on contracts alone — it ships to a customer's page, so it
must stay small and must not drag the engine along with it.

`web` must never import from `api` — it only knows contracts. Everything
stateful is wired in `apps/api/src/container.ts` (the composition root);
swapping storage or the fetcher means changing that one file.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | API on :4000 + web on :5173 (with `/api` proxy). |
| `npm test` | Full Vitest suite (all packages). |
| `npm run test:watch` | Vitest in watch mode. |
| `npm run typecheck` | `tsc -b` across the workspace. This is also the linter. |
| `npm run build:tracker` | Builds the distributable tracker bundle. Fails if it exceeds its 16 kB budget. |
| `npm run audit:self` | Renders all 15 web routes server-side and runs our own engine over them. Exits non-zero on any confirmed level A/AA failure. |
| `npm run build` | Production build of the web app. |
| `npm run verify` | typecheck + test + audit:self. Run this before declaring done. |

There is no ESLint config. Type discipline, tests, and the self-audit gate are
the quality controls — do not weaken them to make a change pass.

## How to make common changes

**Add or change a rule** — `packages/core/src/rules/*.ts`. Every rule must:
- cite at least one real criterion (validated against the catalogue at load
  time — a typo crashes at startup, on purpose),
- return `PASS`/`SKIP`/verdict objects from `./define.js`,
- mark `detection: 'advisory'` if it can only ever raise a question, never
  settle one (advisory rules are excluded from coverage and the score),
- get a trigger test *and* a clean-page test in `packages/core/test/rules.test.ts`.
  A rule that fires on correct markup is worse than no rule — that is the
  suite's strongest guarantee.

Rules come in four kinds. `element`/`document` rules see a DOM and only ever
run against HTML. `node`/`tree` rules see the format-neutral tree and run
against every format (narrow with `media: [...]` when a check genuinely only
applies to one). `appliesToMedia` in `engine/types.ts` is what enforces that a
DOM rule never gets pointed at a PDF.

**Add a format** — write an adapter in `packages/media/src/` returning an
`AccessibleTree`, register it in that package's `index.ts`, and add its
signature to `detect.ts`. Nothing downstream changes: the rules, scoring,
report and watcher diff are already format-neutral. Record a `TreeUnknown`
only when something was *unreadable* — an absent language in a readable
properties file is a real failure, and reaching for `unknown` there blunts the
mechanism everywhere.

**Add a journey rule** — `packages/core/src/journey/rules.ts`. It receives a
reconstructed `Session` and returns findings anchored to a frame index, so the
player can highlight the moment rather than listing it separately.

**Change the API surface** — start in `packages/contracts/src/schemas.ts`
(request shape) and `types.ts` (domain shape). Both apps compile against
these; the compiler will show you everything affected. Keep errors as
RFC 9457 problem details (`apps/api/src/http/problem.ts`).

**Change the UI** — `apps/web/src/pages/*` with `components/primitives.tsx`
(Field, Callout, Disclosure, Badge…). Accessibility is not optional here:
every state change a user must know about goes through a live region; every
error is announced and focusable; colour is never the only cue. When unsure,
copy the closest existing pattern — then check it against
`apps/web/test/pages.test.tsx`, which audits our own markup with our engine.

**Change persistence** — implement the ports in
`apps/api/src/repositories/types.ts` and rebind in `container.ts`. Nothing
else may import a concrete repository.

## Invariants — breaking these is a regression even if tests pass

1. **Tenancy.** Every service method that reads or writes takes the calling
   organisation; foreign resources are reported as 404 (not 403 — existence
   must not leak). `x-accessly-organisation` resolves the tenant in
   `apps/api/src/http/context.ts`; auth lands there and nowhere else.
2. **SSRF.** `apps/api/src/services/url-guard.ts` guards every fetch — the
   initial URL *and every redirect hop* (the fetcher follows redirects
   manually for exactly this reason). Private, loopback, link-local, CGNAT,
   and the IPv6 tunnel ranges are all refused. If you touch fetching, the
   tests in `apps/api/test/url-guard.test.ts` and `fetcher.test.ts` are
   security controls.
3. **`cantTell` is a real answer.** Never turn an undecidable check into a
   guess. The CSS resolver makes unresolvable values fail loudly precisely
   because a wrong number is worse than no number.
4. **Coverage is three buckets** (decided / flagged for review / not tested).
   Never merge buckets to make the number look better.
5. **The score is a progress metric, `Score.conformsTo` is the verdict.**
   Conformance is binary per WCAG; the UI must always show the two together.
6. **The engine stays pure.** No I/O in `packages/core` — time, randomness
   and identity are injected by the caller.
7. **Watcher scheduling never backlogs.** `nextPollAt` is computed from *now*;
   a down site must not queue a week of polls.
8. **A trace never carries tenancy.** `POST /v1/traces` is the one endpoint
   posted to by a script on somebody else's page. The organisation comes from
   the request context, never from the body, and the report id is issued
   server-side so a replayed POST cannot overwrite an existing report.
9. **A truncated recording says so.** The tracker sets `truncated` when its
   message budget runs out. "The session ended" and "we stopped listening"
   produce identical traces and opposite verdicts, so nothing may report an
   absence as a finding without checking it.
10. **The tracker records no content.** Focus, announcements, dialogs, routes
   and navigation keys only — never input values, never the DOM. A replay of a
   checkout must stay a transcript, not a data-protection liability.

## Testing map

| Suite | Guards |
| --- | --- |
| `packages/contracts/test/wcag` | Catalogue matches the published Recommendation (78 criteria, 30/20/28). |
| `packages/core/test/rules` | Every rule fires on bad markup and stays silent on good markup. |
| `packages/core/test/scoring` | Score composition, conformance verdict, diffing. |
| `packages/core/test/{color,accname,styles}` | Contrast maths, accname 1.2 ordering, CSS resolution. |
| `apps/api/test/api` | Routes, validation, problem details, **tenancy**, pagination. |
| `apps/api/test/{watcher,url-guard,fetcher}` | Scheduling, SSRF controls, redirect re-validation. |
| `apps/web/test/pages` | Our own markup audited by our own engine, per route. |
| `apps/web/test/dashboard` | Dashboard behaviour, live regions, fetch stubbing. |
| `apps/web/test/theme` | Token contrast, type scale, motion, forced colours. |
| `packages/core/test/journey` | Trace reconstruction, journey rules, step expectations. |
| `packages/media/test/adapters` | Format detection and every adapter, incl. “no HTML-only rule ever runs against a document”. |
| `packages/tracker/test/tracker` | The tracker in jsdom, incl. that it never records a value. |
| `packages/tracker/test/{embed,bundle}` | Script-tag config, lifecycle delivery, and the built artefact evaluated in jsdom. |
| `apps/api/test/journeys` | Journey CRUD, trace ingestion, **tenancy of a browser-supplied id**. |
| `apps/api/test/media-audits` | Uploaded documents end to end, incl. refusals with a reason. |
| `apps/web/test/journeys` | The player: keyboard operation, `aria-current`, and silence during playback. |

Test data flows through injected `FixedClock` / `SequentialIdGenerator`
(`apps/api/test/helpers.ts`), so assertions can name exact timestamps and ids.

## Conventions

- ESM throughout; relative imports inside a package use explicit `.js`
  extensions (the packages compile to Node ESM).
- Comments explain *why*, not *what* — the codebase's comments are its
  design docs. Preserve them when editing; add one when a decision is
  non-obvious.
- Error messages are written for a person to read (they surface in customer
  reports). No codes without words.
- Zod validates at the HTTP edge (`apps/api/src/routes/*`); services throw
  `DomainError` subclasses; only `http/error-handler.ts` knows about status
  codes.
- Web styling: design tokens in `apps/web/src/styles/tokens.css` — never
  hardcode a colour that already exists as a token (the footer once shipped
  at 1.76:1 contrast because of exactly that).

## Known non-goals (do not "fix" these silently)

- No authentication (demo organisation via header) — the seam is
  `http/context.ts`.
- No persistence (in-memory repositories implementing the real ports).
- No crawling / no JavaScript execution (single page per audit, markup as
  served).
- No media decoding — video and audio containers are not opened. Submit the
  caption track, or audit the page that embeds the player.
- No PDF text extraction — the PDF adapter reads structure only (tagging,
  language, title, figure alt), and reports `cantTell` when object streams or
  encryption hide it.
- No trace replay of pixels. There is no DOM snapshot and there never will be;
  the journey player renders a transcript.
- No notification delivery on `regressed` events yet (the event trail is the
  evidence surface).

Each is stated in the README's "What this phase does not include" — keep that
section truthful when the scope changes.

<!-- pane-agent-context:start -->
## Pane

The developer is using Pane for this repository. Pane can manage saved repositories and create user-visible panes with terminal-backed tools for planning, discussion, and implementation work.

Use `runpane agent-context` for a brief Pane command schema. Use `runpane agent-context --command "panes create"` or another command name for the detailed schema only when needed.

After creating panes or sending terminal input, validate with bounded panel output before reporting success.

Common commands:
- `runpane repos list --json`
- `runpane repos add --path <repo> --yes --json`
- `runpane panes create --repo active --name <name> --agent codex --prompt "<task>" --yes`
- `runpane panels list --pane <pane-id> --json`
- `runpane panels output --panel <panel-id> --limit 200 --json`
- `runpane panels input --panel <panel-id> --text "<input>" --yes`

WSL note: if `runpane repos list` cannot find `/tmp/pane-daemon.../daemon.sock`, Pane may be running on Windows. Try `powershell.exe -NoProfile -Command 'Set-Location $env:TEMP; runpane repos list --json'`, then create panes through the same PowerShell form using the saved WSL repo name or id.
<!-- pane-agent-context:end -->
