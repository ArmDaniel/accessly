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

Accessly audits web pages against **WCAG 2.1** and reports every failure with
the success criterion it breaks, how to fix it, and a progress score. It also
continuously monitors registered pages and reports regressions per deploy.
The product's core promise is *evidence-grade honesty*: it never guesses, it
says `cantTell` when markup cannot decide an outcome, and it publishes its own
coverage gaps rather than rounding them away.

## Layout

```
packages/
  contracts/  The shared vocabulary. WCAG 2.1 catalogue, domain types, zod
              request schemas. Both apps depend on it; it depends on nothing.
  core/       The rule engine. Pure TypeScript: HTML in, scored report out.
              No HTTP, no storage, no clock — those are injected.
apps/
  api/        Fastify HTTP API. routes → services → repositories, plus the
              monitoring watcher loop.
  web/        Vite + React SPA. Marketing site, scanner, dashboards, printable
              report, and its own self-audit script.
```

Dependency direction (enforced by workspace boundaries):

```
web  ─┐
      ├─→ contracts ←─ core
api  ─┘                ↑
      └────────────────┘
```

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
| `npm run audit:self` | Renders all 14 web routes server-side and runs our own engine over them. Exits non-zero on any confirmed level A/AA failure. |
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
- No notification delivery on `regressed` events yet (the event trail is the
  evidence surface).

Each is stated in the README's "What this phase does not include" — keep that
section truthful when the scope changes.
