import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { JourneyReport } from '@accessly/contracts';
import { App } from '../src/App.js';
import { documentAround, expectNoViolations } from './a11y.js';

/**
 * The journey player.
 *
 * The player replays what a screen-reader user experienced, so it had better be
 * usable by one. The tests below are mostly about that: keyboard operation,
 * `aria-current` marking the playhead rather than a colour, and — the subtle
 * one — the live region staying quiet during playback so the recording does not
 * talk over itself.
 */

const REPORT: JourneyReport = {
  id: '00000000-0000-4000-8000-000000000901',
  traceId: 'trace-1',
  journeyId: '00000000-0000-4000-8000-000000000801',
  organisationId: '00000000-0000-4000-8000-000000000001',
  name: 'Checkout',
  startedAt: '2026-01-01T09:00:00.000Z',
  summary: {
    frames: 4,
    durationMs: 4_000,
    announcements: 1,
    focusMoves: 1,
    focusLosses: 1,
    keyboardOnly: true,
    truncated: false,
  },
  timeline: [
    {
      index: 0,
      offsetMs: 0,
      kind: 'session-start',
      summary: 'Session started on https://example.test/.',
      focus: null,
      focusRole: null,
      focusCause: null,
      announcement: null,
      politeness: null,
      url: 'https://example.test/',
      stepId: null,
      findingIds: [],
    },
    {
      index: 1,
      offsetMs: 900,
      kind: 'focus',
      summary: 'Focus moved to button “Delete account” (by keyboard).',
      focus: 'Delete account',
      focusRole: 'button',
      focusCause: 'keyboard',
      announcement: null,
      politeness: null,
      url: 'https://example.test/',
      stepId: 'open-basket',
      findingIds: [],
    },
    {
      index: 2,
      offsetMs: 1_800,
      kind: 'announced',
      summary: 'Announced: “Account deleted”.',
      focus: 'Delete account',
      focusRole: 'button',
      focusCause: null,
      announcement: 'Account deleted',
      politeness: 'polite',
      url: 'https://example.test/',
      stepId: null,
      findingIds: [],
    },
    {
      index: 3,
      offsetMs: 2_400,
      kind: 'focus-lost',
      summary: 'Focus was lost — it returned to the document.',
      focus: null,
      focusRole: null,
      focusCause: 'lost',
      announcement: null,
      politeness: null,
      url: 'https://example.test/',
      stepId: null,
      findingIds: ['finding-1'],
    },
  ],
  findings: [
    {
      id: 'finding-1',
      ruleId: 'journey-focus-not-lost',
      ruleTitle: 'Focus is never lost',
      criteria: ['2.4.3'],
      level: 'A',
      impact: 'critical',
      outcome: 'failed',
      message: 'Focus was lost 2.4s into the session.',
      remediation: 'Move focus deliberately whenever the focused element goes away.',
      frameIndex: 3,
      offsetMs: 2_400,
    },
  ],
  steps: [
    {
      stepId: 'open-basket',
      label: 'Open the basket',
      satisfied: false,
      detail: 'Expectation not met: nothing was announced.',
    },
  ],
};

interface Route {
  match: (url: string, method: string) => boolean;
  body: unknown;
}

let routes: Route[] = [];

function stubFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const route = routes.find((r) => r.match(url, init?.method ?? 'GET'));
      return {
        ok: Boolean(route),
        status: route ? 200 : 404,
        json: async () => route?.body ?? { title: 'Not found', status: 404 },
      } as Response;
    }),
  );
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  routes = [
    {
      match: (u) => u.endsWith('/v1/journey-reports?limit=50'),
      body: { items: [REPORT], nextCursor: null },
    },
    { match: (u) => u.endsWith('/v1/journeys'), body: { items: [], nextCursor: null } },
    { match: (u) => u.includes(`/v1/journey-reports/${REPORT.id}`), body: REPORT },
  ];
  stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Open the page and start the replay of the one recorded session. */
async function openPlayer(user: ReturnType<typeof userEvent.setup>) {
  renderAt('/dashboard/journeys');
  await user.click(await screen.findByRole('button', { name: /replay checkout/i }));
  return screen.findByRole('group', { name: /replay controls/i });
}

describe('recorded sessions page', () => {
  it('has no confirmed WCAG failures with a session listed', async () => {
    const { container } = renderAt('/dashboard/journeys');
    await screen.findByRole('rowheader', { name: 'Checkout' });
    expectNoViolations(documentAround(container.innerHTML));
  });

  it('has no confirmed WCAG failures with the player open', async () => {
    const user = userEvent.setup();
    const { container } = renderAt('/dashboard/journeys');
    await user.click(await screen.findByRole('button', { name: /replay checkout/i }));
    await screen.findByRole('group', { name: /replay controls/i });

    expectNoViolations(documentAround(container.innerHTML));
  });

  it('states what a recording contains, since that is a data-protection question', async () => {
    renderAt('/dashboard/journeys');
    expect(
      await screen.findByText(/never the contents of a form field/i),
    ).toBeInTheDocument();
  });

  it('names the session in each row action rather than a list of “Replay”', async () => {
    renderAt('/dashboard/journeys');
    expect(await screen.findByRole('button', { name: /replay checkout/i })).toBeInTheDocument();
  });

  it('explains an unmet expectation instead of only marking it failed', async () => {
    const user = userEvent.setup();
    await openPlayer(user);

    expect(await screen.findByText(/nothing was announced/i)).toBeInTheDocument();
    expect(screen.getByText('Not met')).toBeInTheDocument();
  });

  it('tells a first-time visitor how to produce a recording', async () => {
    routes = [
      { match: (u) => u.includes('/v1/journey-reports'), body: { items: [], nextCursor: null } },
      { match: (u) => u.endsWith('/v1/journeys'), body: { items: [], nextCursor: null } },
    ];

    renderAt('/dashboard/journeys');
    expect(await screen.findByText(/No sessions recorded yet/i)).toBeInTheDocument();
  });
});

describe('the player', () => {
  it('starts on the first moment and says which one it is', async () => {
    const user = userEvent.setup();
    await openPlayer(user);

    expect(screen.getByText('Moment 1 of 4')).toBeInTheDocument();
    // The moment appears both on the stage and in the transcript.
    expect(screen.getAllByText(/Session started on/).length).toBeGreaterThan(0);
  });

  it('steps forward and back with real buttons', async () => {
    const user = userEvent.setup();
    await openPlayer(user);

    await user.click(screen.getByRole('button', { name: /next moment/i }));
    expect(screen.getByText('Moment 2 of 4')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /previous moment/i }));
    expect(screen.getByText('Moment 1 of 4')).toBeInTheDocument();
  });

  it('disables stepping past either end rather than wrapping silently', async () => {
    const user = userEvent.setup();
    await openPlayer(user);

    expect(screen.getByRole('button', { name: /previous moment/i })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: /next issue/i }));
    expect(screen.getByRole('button', { name: /next moment/i })).toBeDisabled();
  });

  it('marks the playhead with aria-current, not only with a highlight', async () => {
    const user = userEvent.setup();
    await openPlayer(user);

    const timeline = screen.getByRole('list', { name: /full transcript/i });
    const current = within(timeline)
      .getAllByRole('button')
      .filter((button) => button.getAttribute('aria-current') === 'true');

    // Exactly one playhead, and it is the frame the stage is showing.
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent(/Session started/);
  });

  it('gives the scrubber a value text naming the moment, not a frame number', async () => {
    const user = userEvent.setup();
    await openPlayer(user);

    const scrub = screen.getByRole('slider', { name: /position in the session/i });
    expect(scrub).toHaveAttribute('aria-valuetext', expect.stringContaining('Session started'));
    expect(scrub).toHaveAttribute('max', '3');
  });

  it('jumps to the next issue and shows how to fix it', async () => {
    const user = userEvent.setup();
    await openPlayer(user);

    await user.click(screen.getByRole('button', { name: /next issue/i }));

    expect(screen.getByText('Moment 4 of 4')).toBeInTheDocument();
    expect(screen.getByText(/Focus is never lost/)).toBeInTheDocument();
    expect(screen.getByText(/Move focus deliberately/)).toBeInTheDocument();
    expect(screen.getByText(/Fails WCAG 2\.4\.3 \(level A\)/)).toBeInTheDocument();
  });

  it('announces a moment the user stepped to', async () => {
    const user = userEvent.setup();
    await openPlayer(user);

    await user.click(screen.getByRole('button', { name: /next moment/i }));

    const status = screen.getByRole('status', { name: /replay position/i });
    await waitFor(() => expect(status).toHaveTextContent(/Focus moved to button/));
  });

  /*
   * Playback runs on real timers.
   *
   * Fake timers advance the clock but not React's commit between steps, so a
   * chain of self-rescheduling frames only ever moves one step. The recording
   * used here is 2.4 seconds long, which is a cheap enough wait to test the
   * thing that actually ships.
   */
  it('stays silent while playing, so the recording does not talk over itself', async () => {
    const user = userEvent.setup();
    await openPlayer(user);

    await user.click(screen.getByRole('button', { name: 'Play' }));
    const status = screen.getByRole('status', { name: /replay position/i });
    // A live region firing on each of dozens of frames would make a session
    // impossible to listen to, so playback updates the transcript silently.
    expect(status).toHaveTextContent('');

    await waitFor(() => expect(screen.getByText('Moment 2 of 4')).toBeInTheDocument(), {
      timeout: 3_000,
    });
    expect(status).toHaveTextContent('');
  });

  it('announces that playback finished, since nothing else would', async () => {
    const user = userEvent.setup();
    await openPlayer(user);

    await user.click(screen.getByRole('button', { name: 'Play' }));

    const status = screen.getByRole('status', { name: /replay position/i });
    await waitFor(() => expect(status).toHaveTextContent(/Playback finished/), { timeout: 8_000 });
    expect(screen.getByRole('button', { name: 'Play' })).toHaveAttribute('aria-pressed', 'false');
  }, 15_000);

  it('pauses where it is, and says where that is', async () => {
    const user = userEvent.setup();
    await openPlayer(user);

    await user.click(screen.getByRole('button', { name: 'Play' }));
    await waitFor(() => expect(screen.getByText('Moment 2 of 4')).toBeInTheDocument(), {
      timeout: 3_000,
    });
    await user.click(screen.getByRole('button', { name: 'Pause' }));

    expect(screen.getByRole('status', { name: /replay position/i })).toHaveTextContent(/Paused at/);
  }, 15_000);

  it('spells out focus loss in words rather than an empty cell', async () => {
    const user = userEvent.setup();
    await openPlayer(user);
    await user.click(screen.getByRole('button', { name: /next issue/i }));

    expect(screen.getByText(/Nowhere — focus was lost/)).toBeInTheDocument();
  });
});
