import { Link } from 'react-router-dom';
import { Page } from '../components/Page.js';
import { Callout, Disclosure, Icon, icons } from '../components/primitives.js';

const STEPS = [
  {
    title: 'We fetch the page as it is served',
    body: 'Accessly requests your page the way a browser would and analyses the markup that comes back. It does not execute your JavaScript, which means every finding is reproducible from the source — you can view-source and see the same thing we did.',
    caveat:
      'For pages that only exist after hydration, paste the rendered HTML instead. The scanner accepts markup directly.',
  },
  {
    title: 'Every rule cites a success criterion',
    body: 'A rule that cannot name the WCAG 2.1 criterion it enforces does not ship. The engine validates every citation against the published Recommendation when it starts, so a mis-attributed finding is a startup crash rather than a wrong line in your compliance report.',
    caveat: null,
  },
  {
    title: 'Undecidable is a real answer',
    body: 'When contrast depends on a stylesheet we cannot evaluate, or when a video may or may not need audio description, Accessly says so. It does not guess. A tool that reports false failures teaches its users to ignore all of them.',
    caveat: null,
  },
  {
    title: 'The report is built to be read by someone who was not there',
    body: 'Each finding names the element, quotes the markup, states which criterion it fails and at what level, and says how to fix it. The printed version spells out link destinations and repeats table headers across pages.',
    caveat: null,
  },
] as const;

export function PlatformPage(): React.JSX.Element {
  return (
    <Page
      title="How Accessly works"
      heading="How Accessly works"
      eyebrow="Platform"
      lede="Four design decisions shape everything the product does. They are all about being trustworthy rather than being impressive."
    >
      <div className="section section--tight">
        <div className="container container--narrow">
          <ol className="stack" style={{ paddingInlineStart: '1.2em' }}>
            {STEPS.map((step) => (
              <li key={step.title} style={{ marginBottom: 'var(--a-space-6)' }}>
                <h2 style={{ fontSize: 'var(--a-text-xl)' }}>{step.title}</h2>
                <p>{step.body}</p>
                {step.caveat ? (
                  <Callout tone="info">
                    <p className="mb-0">{step.caveat}</p>
                  </Callout>
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      </div>

      <div className="section section--sunken">
        <div className="container container--narrow">
          <h2>Common questions</h2>

          <Disclosure summary="Does Accessly change anything on my site?">
            <p className="mb-0">
              No. Accessly reads your pages and reports on them. It installs nothing, injects
              nothing, and has no runtime presence on your site at all. Products that inject an
              overlay to &ldquo;fix&rdquo; accessibility at runtime have a poor track record in
              court and a worse one with actual assistive technology users.
            </p>
          </Disclosure>

          <Disclosure summary="Can I run this in CI?">
            <p className="mb-0">
              Yes — the API is the product. <code>POST /v1/audits</code> with either a URL or your
              built HTML, and fail the build on the criteria you care about. The same engine runs
              in CI, in the dashboard, and in the watcher, so a passing build means the same thing
              everywhere.
            </p>
          </Disclosure>

          <Disclosure summary="What about pages behind a login?">
            <p className="mb-0">
              Paste the rendered HTML into the scanner. Accessly never needs your credentials,
              and we would rather not have them. For automated monitoring of authenticated pages,
              post the markup from your own test suite to the API.
            </p>
          </Disclosure>

          <Disclosure summary="Is this enough for an EAA conformance claim?">
            <p>
              On its own, no — and neither is any other automated tool. A conformance claim
              requires evaluating all applicable success criteria, and roughly two-thirds of them
              need a human being.
            </p>
            <p className="mb-0">
              What Accessly does is remove the mechanical failures cheaply, so your manual audit
              budget is spent on the judgement calls that actually need it. See{' '}
              <Link to="/coverage">our rule coverage</Link> for exactly which criteria fall on
              which side.
            </p>
          </Disclosure>
        </div>
      </div>

      <div className="section">
        <div className="container text-center">
          <Link to="/scan" className="btn btn--primary">
            Try it on one page
            <Icon path={icons.arrowRight} size={18} />
          </Link>
        </div>
      </div>
    </Page>
  );
}
