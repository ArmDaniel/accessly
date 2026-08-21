import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { CreateJourneyInput, Journey } from '@accessly/contracts';
import { App } from '../src/App.js';
import { resolveIds, slugify } from '../src/components/JourneyForm.js';
import { documentAround, expectNoViolations } from './a11y.js';

/**
 * Authoring a journey.
 *
 * A repeating group of fieldsets is one of the harder accessible patterns, and
 * most of what is asserted here is the part that is usually missing: that
 * adding and removing a step moves focus somewhere deliberate and says so, and
 * that nine "What happens" fields are still distinguishable from one another.
 */

const JOURNEY: Journey = {
  id: '00000000-0000-4000-8000-000000000801',
  organisationId: '00000000-0000-4000-8000-000000000001',
  siteId: null,
  name: 'Checkout',
  description: 'Add an item and pay for it.',
  startUrl: 'https://example.test/basket',
  steps: [
    {
      id: 'open-basket',
      label: 'Open the basket',
      action: 'click',
      expect: { announces: 'basket', keyboardOnly: true },
    },
  ],
  createdAt: '2026-01-01T09:00:00.000Z',
  updatedAt: '2026-01-01T09:00:00.000Z',
};

interface Route {
  match: (url: string, method: string) => boolean;
  body: unknown;
  status?: number;
}

let routes: Route[] = [];
let posted: CreateJourneyInput[] = [];
let deleted: string[] = [];

function stubFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';

      if (url.endsWith('/v1/journeys') && method === 'POST') {
        posted.push(JSON.parse(String(init?.body)) as CreateJourneyInput);
        return { ok: true, status: 201, json: async () => JOURNEY } as Response;
      }
      if (url.includes('/v1/journeys/') && method === 'DELETE') {
        deleted.push(url.split('/').pop() as string);
        return { ok: true, status: 204, json: async () => null } as Response;
      }

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

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/dashboard/journeys']}>
      <App />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  posted = [];
  deleted = [];
  routes = [
    { match: (u) => u.includes('/v1/journey-reports'), body: { items: [], nextCursor: null } },
    { match: (u) => u.endsWith('/v1/journeys'), body: { items: [JOURNEY], nextCursor: null } },
  ];
  stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function openForm(user: ReturnType<typeof userEvent.setup>) {
  renderPage();
  await user.click(await screen.findByRole('button', { name: /define a journey/i }));
  return screen.findByRole('heading', { name: /define a journey/i });
}

// ─────────────────────────────────────────────────────────────────────────────
// Id derivation
// ─────────────────────────────────────────────────────────────────────────────

describe('deriving step ids', () => {
  it('makes a readable id from what the step is called', () => {
    expect(slugify('Open the basket', 'step-1')).toBe('open-the-basket');
    expect(slugify('Pay — with a card', 'step-1')).toBe('pay-with-a-card');
  });

  it('strips accents rather than dropping the word', () => {
    expect(slugify('Ștergeți contul', 'step-1')).toBe('stergeti-contul');
  });

  it('falls back to a positional id when a label has nothing usable in it', () => {
    expect(slugify('!!!', 'step-4')).toBe('step-4');
    expect(slugify('', 'step-2')).toBe('step-2');
  });

  it('makes duplicate labels unique instead of losing one of them', () => {
    // Two steps genuinely called the same thing is reasonable to write; the
    // API rejects duplicate ids, so the form has to resolve it.
    const ids = resolveIds([
      { key: 'a', id: '', label: 'Open the basket' },
      { key: 'b', id: '', label: 'Open the basket' },
      { key: 'c', id: '', label: 'Open the basket' },
    ] as never);

    expect(ids).toEqual(['open-the-basket', 'open-the-basket-2', 'open-the-basket-3']);
    expect(new Set(ids).size).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The list
// ─────────────────────────────────────────────────────────────────────────────

describe('the journeys list', () => {
  it('has no confirmed WCAG failures', async () => {
    const { container } = renderPage();
    await screen.findByRole('rowheader', { name: /checkout/i });
    expectNoViolations(documentAround(container.innerHTML));
  });

  it('shows how many steps carry expectations, not just how many exist', async () => {
    renderPage();
    const row = (await screen.findByRole('rowheader', { name: /checkout/i })).closest('tr')!;
    // A step with no expectation is only checked against the journey rules,
    // which is a different thing from being unchecked.
    expect(within(row).getByText(/1 with expectations/i)).toBeInTheDocument();
  });

  it('names the journey in its delete button', async () => {
    renderPage();
    await screen.findByRole('rowheader', { name: /checkout/i });
    expect(screen.getByRole('button', { name: /^delete$/i })).toBeInTheDocument();
  });

  it('confirms before deleting, and announces the result', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('rowheader', { name: /checkout/i });

    await user.click(screen.getByRole('button', { name: /^delete$/i }));
    // The question is announced, not just shown.
    expect(await screen.findByRole('alert')).toHaveTextContent(/delete checkout/i);

    await user.click(screen.getByRole('button', { name: /yes, delete it/i }));
    await waitFor(() => expect(deleted).toEqual([JOURNEY.id]));
    // Twice on purpose: once in the live region, once as a visible echo.
    await waitFor(() => expect(screen.getAllByText(/checkout was deleted/i)).toHaveLength(2));
  });

  it('explains what a journey buys you when there are none', async () => {
    routes = [
      { match: (u) => u.includes('/v1/journey-reports'), body: { items: [], nextCursor: null } },
      { match: (u) => u.endsWith('/v1/journeys'), body: { items: [], nextCursor: null } },
    ];

    renderPage();
    expect(await screen.findByText(/No journeys defined yet/i)).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The form
// ─────────────────────────────────────────────────────────────────────────────

describe('the authoring form', () => {
  it('has no confirmed WCAG failures while open', async () => {
    const user = userEvent.setup();
    const { container } = renderPage();
    await user.click(await screen.findByRole('button', { name: /define a journey/i }));
    await screen.findByRole('heading', { name: /define a journey/i });

    expectNoViolations(documentAround(container.innerHTML));
  });

  it('opens from a button that says it reveals something', async () => {
    renderPage();
    const trigger = await screen.findByRole('button', { name: /define a journey/i });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveAttribute('aria-controls');
  });

  it('numbers each step, so identical field labels stay distinguishable', async () => {
    const user = userEvent.setup();
    await openForm(user);

    expect(screen.getByRole('group', { name: /^step 1/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /add a step/i }));
    expect(screen.getByRole('group', { name: /^step 2/i })).toBeInTheDocument();
  });

  it('names a step in its legend once it has been described', async () => {
    const user = userEvent.setup();
    await openForm(user);

    await user.type(screen.getByRole('textbox', { name: /what happens/i }), 'Open the basket');
    expect(screen.getByRole('group', { name: /step 1: open the basket/i })).toBeInTheDocument();
  });

  it('moves focus into a step it just added', async () => {
    const user = userEvent.setup();
    await openForm(user);

    await user.click(screen.getByRole('button', { name: /add a step/i }));

    // Leaving focus on the Add button means a screen reader user has no idea
    // anything appeared.
    const fields = screen.getAllByRole('textbox', { name: /what happens/i });
    await waitFor(() => expect(fields[1]).toHaveFocus());
  });

  it('announces that a step was added', async () => {
    const user = userEvent.setup();
    await openForm(user);

    await user.click(screen.getByRole('button', { name: /add a step/i }));
    await waitFor(() =>
      expect(screen.getByRole('status', { name: /step changes/i })).toHaveTextContent(
        /step 2 added/i,
      ),
    );
  });

  it('moves focus deliberately when a step is removed', async () => {
    const user = userEvent.setup();
    await openForm(user);

    await user.click(screen.getByRole('button', { name: /add a step/i }));
    await user.click(screen.getByRole('button', { name: /remove step 1/i }));

    // Focus must not fall to the document; it goes to the step that took its
    // place.
    const remaining = screen.getAllByRole('textbox', { name: /what happens/i });
    expect(remaining).toHaveLength(1);
    await waitFor(() => expect(remaining[0]).toHaveFocus());
    expect(screen.getByRole('status', { name: /step changes/i })).toHaveTextContent(
      /step 1 removed/i,
    );
  });

  it('will not let you remove the only step', async () => {
    const user = userEvent.setup();
    await openForm(user);
    expect(screen.getByRole('button', { name: /remove step 1/i })).toBeDisabled();
  });

  it('validates on submit, not on blur, and moves focus to the error', async () => {
    const user = userEvent.setup();
    await openForm(user);

    const name = screen.getByRole('textbox', { name: /^name/i });
    await user.click(name);
    await user.tab();
    // Validating on blur interrupts someone tabbing through a form they have
    // not filled in yet.
    expect(name).not.toHaveAttribute('aria-invalid');

    await user.click(screen.getByRole('button', { name: /save this journey/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/could not be saved/i);
    expect(alert).toHaveFocus();
    expect(screen.getByRole('textbox', { name: /^name/i })).toHaveAttribute('aria-invalid', 'true');
  });

  it('asks for a description of every step before saving', async () => {
    const user = userEvent.setup();
    await openForm(user);

    await user.type(screen.getByRole('textbox', { name: /^name/i }), 'Checkout');
    await user.type(screen.getByRole('textbox', { name: /start address/i }), 'https://example.test/');
    await user.click(screen.getByRole('button', { name: /save this journey/i }));

    expect(await screen.findByText(/describe what happens in this step/i)).toBeInTheDocument();
    expect(posted).toHaveLength(0);
  });

  it('reveals the announcement text field only once it is relevant', async () => {
    const user = userEvent.setup();
    await openForm(user);

    expect(screen.queryByRole('textbox', { name: /announcement must contain/i })).toBeNull();
    await user.click(screen.getByRole('checkbox', { name: /something is announced/i }));
    expect(screen.getByRole('textbox', { name: /announcement must contain/i })).toBeInTheDocument();
  });

  it('saves the expectations as the analyser will read them', async () => {
    const user = userEvent.setup();
    await openForm(user);

    await user.type(screen.getByRole('textbox', { name: /^name/i }), 'Checkout');
    await user.type(
      screen.getByRole('textbox', { name: /start address/i }),
      'https://example.test/basket',
    );
    await user.type(screen.getByRole('textbox', { name: /what happens/i }), 'Open the basket');
    await user.click(screen.getByRole('checkbox', { name: /something is announced/i }));
    await user.type(screen.getByRole('textbox', { name: /announcement must contain/i }), 'basket');
    await user.click(screen.getByRole('checkbox', { name: /without a pointer/i }));

    await user.click(screen.getByRole('button', { name: /save this journey/i }));

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({
      name: 'Checkout',
      startUrl: 'https://example.test/basket',
      steps: [
        {
          id: 'open-the-basket',
          label: 'Open the basket',
          action: 'click',
          expect: { announces: 'basket', keyboardOnly: true },
        },
      ],
    });
  });

  it('omits an expectation object entirely when nothing was declared', async () => {
    const user = userEvent.setup();
    await openForm(user);

    await user.type(screen.getByRole('textbox', { name: /^name/i }), 'Browse');
    await user.type(screen.getByRole('textbox', { name: /start address/i }), 'https://example.test/');
    await user.type(screen.getByRole('textbox', { name: /what happens/i }), 'Look around');
    await user.click(screen.getByRole('button', { name: /save this journey/i }));

    await waitFor(() => expect(posted).toHaveLength(1));
    // An empty `expect` would read as "checked and passed" in the report.
    // Absent means "nothing declared", which is the truth.
    expect(posted[0]?.steps[0]).not.toHaveProperty('expect');
  });

  it('announces the save and closes the form', async () => {
    const user = userEvent.setup();
    await openForm(user);

    await user.type(screen.getByRole('textbox', { name: /^name/i }), 'Checkout');
    await user.type(screen.getByRole('textbox', { name: /start address/i }), 'https://example.test/');
    await user.type(screen.getByRole('textbox', { name: /what happens/i }), 'Open the basket');
    await user.click(screen.getByRole('button', { name: /save this journey/i }));

    await waitFor(() => expect(screen.getAllByText(/checkout was saved/i).length).toBeGreaterThan(0));
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: /define a journey/i })).toBeNull(),
    );
  });

  it('returns focus to the trigger when cancelled', async () => {
    const user = userEvent.setup();
    await openForm(user);

    await user.click(screen.getByRole('button', { name: /cancel/i }));

    const trigger = await screen.findByRole('button', { name: /define a journey/i });
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
