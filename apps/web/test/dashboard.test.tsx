import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../src/App.js';
import { ErrorBoundary } from '../src/components/ErrorBoundary.js';
import { documentAround, expectNoViolations } from './a11y.js';

/**
 * Dashboard tests.
 *
 * The API is stubbed at `fetch` rather than at the module boundary, so the real
 * client code — including its error handling and its header logic — is exercised.
 */

const SITE = {
  id: '00000000-0000-4000-8000-000000000101',
  organisationId: '00000000-0000-4000-8000-000000000001',
  url: 'https://example.test/',
  label: 'Example home',
  target: 'AA',
  createdAt: '2026-01-01T09:00:00.000Z',
  latestAuditId: '00000000-0000-4000-8000-000000000201',
  latestScore: 82,
};

const WATCH = {
  id: '00000000-0000-4000-8000-000000000301',
  siteId: SITE.id,
  organisationId: SITE.organisationId,
  interval: 'daily',
  status: 'active',
  lastContentHash: 'abc',
  lastPolledAt: '2026-01-01T09:00:00.000Z',
  nextPollAt: '2026-01-02T09:00:00.000Z',
  auditUnchanged: false,
  createdAt: '2026-01-01T09:00:00.000Z',
};

const EVENTS = [
  {
    id: 'e2',
    watchId: WATCH.id,
    kind: 'regressed',
    at: '2026-01-01T09:00:05.000Z',
    auditId: '00000000-0000-4000-8000-000000000201',
    message: 'Accessibility regressed by 6 points. 2 new issue(s) were introduced.',
    scoreDelta: -6,
  },
  {
    id: 'e1',
    watchId: WATCH.id,
    kind: 'polled',
    at: '2026-01-01T09:00:00.000Z',
    auditId: null,
    message: 'Checked https://example.test/.',
    scoreDelta: null,
  },
];

interface Route {
  match: (url: string, method: string) => boolean;
  body: unknown;
  status?: number;
}

let routes: Route[] = [];
const calls: Array<{ url: string; method: string; hasContentType: boolean }> = [];

function stubFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const headers = (init?.headers ?? {}) as Record<string, string>;
      calls.push({ url, method, hasContentType: 'content-type' in headers });

      const route = routes.find((r) => r.match(url, method));
      const status = route?.status ?? (route ? 200 : 404);

      return {
        ok: status >= 200 && status < 300,
        status,
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
  calls.length = 0;
  routes = [
    { match: (u, m) => u.endsWith('/v1/sites') && m === 'GET', body: { items: [SITE], nextCursor: null } },
    { match: (u, m) => u.endsWith('/v1/watches') && m === 'GET', body: { items: [WATCH], nextCursor: null } },
    { match: (u, m) => u.includes('/v1/audits') && m === 'GET', body: { items: [], nextCursor: null } },
    { match: (u) => u.includes('/events'), body: { items: EVENTS, nextCursor: null } },
  ];
  stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('client dashboard', () => {
  it('has no confirmed WCAG failures', async () => {
    const { container } = renderAt('/dashboard');
    await screen.findByRole('rowheader', { name: /example home/i });
    expectNoViolations(documentAround(container.innerHTML));
  });

  it('lists registered pages in a table with row headers', async () => {
    renderAt('/dashboard');

    const table = await screen.findByRole('table', { name: /pages you have registered/i });
    const row = within(table).getByRole('rowheader', { name: /example home/i });
    expect(row).toBeInTheDocument();
  });

  it('shows the score with its band as text, not colour alone', async () => {
    renderAt('/dashboard');
    const row = await screen.findByRole('rowheader', { name: /example home/i });
    const cells = row.closest('tr')!;
    // "82" alone leaves the reader to invent their own threshold for "good".
    expect(within(cells).getByText('Fair')).toBeInTheDocument();
    expect(within(cells).getByText('82')).toBeInTheDocument();
  });

  it('names the page in each row action, so a button list is not all "Scan"', async () => {
    renderAt('/dashboard');
    expect(await screen.findByRole('button', { name: /scan example home/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /view report for example home/i })).toBeInTheDocument();
  });

  it('announces the outcome of an action in a live region', async () => {
    const user = userEvent.setup();
    routes.unshift({
      match: (u, m) => u.endsWith('/v1/audits') && m === 'POST',
      body: { id: 'a1', score: { value: 91 }, summary: { total: 4 } },
      status: 201,
    });

    renderAt('/dashboard');
    await user.click(await screen.findByRole('button', { name: /scan example home/i }));

    await waitFor(() => {
      const status = screen
        .getAllByRole('status')
        .find((el) => /Scanned Example home/.test(el.textContent ?? ''));
      expect(status).toBeDefined();
      expect(status).toHaveTextContent(/Score 91 out of 100/);
    });
  });

  it('requires confirmation before removing a page, and focuses the confirm button', async () => {
    const user = userEvent.setup();
    renderAt('/dashboard');

    await user.click(await screen.findByRole('button', { name: /^remove$/i }));

    const confirm = await screen.findByRole('button', { name: /yes, remove it/i });
    // Focus must move to the confirming control so a keyboard user is on it.
    expect(confirm).toHaveFocus();
    // The question is announced, not only shown.
    expect(screen.getByRole('alert')).toHaveTextContent(/Remove Example home/);
  });

  it('can be cancelled without performing the action', async () => {
    const user = userEvent.setup();
    renderAt('/dashboard');

    await user.click(await screen.findByRole('button', { name: /^remove$/i }));
    await user.click(screen.getByRole('button', { name: /cancel/i }));

    expect(screen.queryByRole('button', { name: /yes, remove it/i })).not.toBeInTheDocument();
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
  });

  it('validates the add-page form on submit and links errors to fields', async () => {
    const user = userEvent.setup();
    renderAt('/dashboard');

    await screen.findByRole('rowheader', { name: /example home/i });
    await user.click(screen.getByRole('button', { name: /add page/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveFocus();

    const urlInput = screen.getByRole('textbox', { name: /page address/i });
    expect(urlInput).toHaveAttribute('aria-invalid', 'true');

    const describedBy = (urlInput.getAttribute('aria-describedby') ?? '').split(' ');
    const messages = describedBy.map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
    expect(messages).toMatch(/enter the address/i);
  });

  it('shows a guiding empty state rather than a blank table', async () => {
    routes[0] = {
      match: (u, m) => u.endsWith('/v1/sites') && m === 'GET',
      body: { items: [], nextCursor: null },
    };

    renderAt('/dashboard');
    expect(await screen.findByText(/have not registered any pages yet/i)).toBeInTheDocument();
  });
});

describe('monitoring dashboard', () => {
  it('has no confirmed WCAG failures', async () => {
    const { container } = renderAt('/dashboard/monitoring');
    await screen.findByRole('heading', { name: 'Example home', level: 3 });
    expectNoViolations(documentAround(container.innerHTML));
  });

  it('states watch status and frequency as words', async () => {
    renderAt('/dashboard/monitoring');
    await screen.findByRole('heading', { name: 'Example home', level: 3 });

    const card = screen.getByRole('article', { name: 'Example home' });

    // Each badge carries a screen-reader prefix naming what the word means, so
    // "Active" is never announced as a bare adjective with no subject.
    expect(within(card).getByText('Status:')).toBeInTheDocument();
    expect(within(card).getByText('Active')).toBeInTheDocument();
    expect(within(card).getByText('Frequency:')).toBeInTheDocument();

    // "Every day" also appears as a select option, so assert the control's
    // value rather than matching the text twice.
    expect(within(card).getByRole('combobox', { name: /check frequency/i })).toHaveValue('daily');
  });

  it('labels every per-watch control with the page it affects', async () => {
    renderAt('/dashboard/monitoring');
    await screen.findByRole('heading', { name: 'Example home', level: 3 });

    expect(screen.getByRole('button', { name: /check now.*example home/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /pause monitoring for example home/i })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /check frequency for example home/i })).toBeInTheDocument();
  });

  it('does not change context when the frequency select changes', async () => {
    const user = userEvent.setup();
    renderAt('/dashboard/monitoring');
    await screen.findByRole('heading', { name: 'Example home', level: 3 });

    await user.selectOptions(
      screen.getByRole('combobox', { name: /check frequency/i }),
      'hourly',
    );

    // 3.2.2 On Input: selecting must not submit. A separate Apply button does.
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
    expect(screen.getByRole('button', { name: /apply new frequency/i })).toBeEnabled();
  });

  it('sends a bodyless POST without a JSON content-type', async () => {
    const user = userEvent.setup();
    routes.unshift({
      match: (u, m) => u.includes('/poll') && m === 'POST',
      body: { watchId: WATCH.id, kind: 'unchanged' },
    });

    renderAt('/dashboard/monitoring');
    await user.click(await screen.findByRole('button', { name: /check now/i }));

    await waitFor(() => {
      const poll = calls.find((c) => c.url.includes('/poll'));
      expect(poll).toBeDefined();
      // Declaring a JSON body and sending none is a protocol error the server
      // rejects, which broke every forced check.
      expect(poll?.hasContentType).toBe(false);
    });
  });

  it('renders the event timeline with the score change spelled out', async () => {
    const user = userEvent.setup();
    renderAt('/dashboard/monitoring');

    await user.click(await screen.findByRole('button', { name: /timeline for example home/i }));

    const table = await screen.findByRole('table', { name: /every check, change and audit/i });
    // The event kind is a labelled badge...
    expect(within(table).getByText('Regressed')).toBeInTheDocument();
    // ...and the delta names its direction rather than relying on a minus sign.
    expect(within(table).getByText('regressed')).toBeInTheDocument();
    expect(within(table).getByText('-6')).toBeInTheDocument();
  });

  it('explains what monitoring is when nothing is being watched', async () => {
    routes[1] = {
      match: (u, m) => u.endsWith('/v1/watches') && m === 'GET',
      body: { items: [], nextCursor: null },
    };

    renderAt('/dashboard/monitoring');
    expect(await screen.findByText(/nothing is being monitored yet/i)).toBeInTheDocument();
  });

  it('surfaces a failed request in an assertive region', async () => {
    routes[1] = {
      match: (u, m) => u.endsWith('/v1/watches') && m === 'GET',
      body: { title: 'The service is unavailable.', status: 503 },
      status: 503,
    };

    renderAt('/dashboard/monitoring');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/service is unavailable/i);
  });
});

describe('recent audits pagination', () => {
  const audit = (id: string, title: string) => ({
    id,
    subject: { title, url: `https://example.test/${id}` },
    startedAt: '2026-01-01T09:00:00.000Z',
    score: { value: 90 },
    summary: { total: 1 },
  });

  it('loads older audits on demand and follows the cursor exactly once', async () => {
    const user = userEvent.setup();
    // Matched first: the cursor page. Then the plain first page.
    routes.unshift(
      {
        match: (u, m) => u.includes('cursor=a2') && m === 'GET',
        body: { items: [audit('a3', 'Third page')], nextCursor: null },
      },
      {
        match: (u, m) => u.includes('/v1/audits') && !u.includes('/v1/audits/') && m === 'GET',
        body: { items: [audit('a1', 'First page'), audit('a2', 'Second page')], nextCursor: 'a2' },
      },
    );

    renderAt('/dashboard');
    const table = await screen.findByRole('table', { name: /audits run across all your pages/i });
    expect(within(table).getAllByRole('row')).toHaveLength(3); // header + 2

    await user.click(screen.getByRole('button', { name: /show older audits/i }));

    await waitFor(() => {
      expect(within(table).getAllByRole('row')).toHaveLength(4); // header + 3
    });
    expect(within(table).getByRole('rowheader', { name: /third page/i })).toBeInTheDocument();
    // The cursor was used, and the button disappears when the list is exhausted.
    expect(calls.some((c) => c.url.includes('cursor=a2'))).toBe(true);
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /show older audits/i })).not.toBeInTheDocument();
    });
  });
});

describe('audit detail', () => {
  it('shows the friendly not-found state for a missing report', async () => {
    routes.unshift({
      match: (u, m) => u.includes('/v1/audits/00000000-0000-4000-8000-0000000002ff') && m === 'GET',
      body: { title: 'Audit not found', status: 404 },
      status: 404,
    });

    renderAt('/dashboard/audits/00000000-0000-4000-8000-0000000002ff');
    expect(await screen.findByText(/that report does not exist/i)).toBeInTheDocument();
  });
});

describe('error boundary', () => {
  it('contains a render error and announces it assertively', async () => {
    function Explodes(): React.JSX.Element {
      throw new Error('kaboom');
    }

    render(
      <ErrorBoundary>
        <Explodes />
      </ErrorBoundary>,
    );

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/could not be shown/i);
    // Recovery options are real, keyboard-operable controls.
    expect(screen.getByRole('link', { name: /back to the home page/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reload the page/i })).toBeInTheDocument();
  });
});
