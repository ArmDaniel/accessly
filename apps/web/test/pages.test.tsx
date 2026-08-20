import { describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../src/App.js';
import { documentAround, expectNoViolations } from './a11y.js';

function renderAt(path: string): { container: HTMLElement } {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

const ROUTES = [
  ['/', 'Accessibility you can actually prove'],
  ['/scan', 'Scan a page for accessibility issues'],
  ['/platform', 'How Accessly works'],
  ['/monitoring', 'Watch every page you ship'],
  ['/standards', 'The WCAG 2.1 success criteria'],
  ['/standards/eaa', 'The European Accessibility Act'],
  ['/pricing', 'Pricing'],
  ['/about', 'About Accessly'],
  ['/contact', 'Contact us'],
  ['/accessibility', 'Accessibility statement for Accessly'],
  ['/dashboard', 'Your dashboard'],
  ['/dashboard/monitoring', 'Monitoring'],
  ['/does-not-exist', 'We could not find that page'],
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Automated audit of our own markup
// ─────────────────────────────────────────────────────────────────────────────

describe('every page passes our own engine', () => {
  it.each(ROUTES)('%s has no confirmed WCAG 2.1 AA failures', (path) => {
    const { container } = renderAt(path);
    expectNoViolations(documentAround(container.innerHTML));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Structure
// ─────────────────────────────────────────────────────────────────────────────

describe('page structure', () => {
  it.each(ROUTES)('%s has exactly one h1, naming the page', (path, heading) => {
    renderAt(path);
    const h1s = screen.getAllByRole('heading', { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0]).toHaveTextContent(heading);
  });

  it.each(ROUTES)('%s exposes the required landmarks', (path) => {
    renderAt(path);
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
  });

  it('gives every navigation landmark a distinct accessible name', () => {
    renderAt('/');
    const navs = screen.getAllByRole('navigation');
    expect(navs.length).toBeGreaterThan(1);

    const names = navs.map((nav) => nav.getAttribute('aria-label'));
    // Unnamed duplicates are the specific failure this guards against — a
    // landmarks list showing "navigation, navigation, navigation".
    expect(names.every((name) => name && name.length > 0)).toBe(true);
    expect(new Set(names).size).toBe(names.length);
  });

  it('places the skip link first in the DOM so one Tab reaches it', () => {
    const { container } = renderAt('/');
    const focusable = container.querySelectorAll('a[href], button, input, select, textarea');
    const first = focusable[0];

    expect(first).toHaveTextContent('Skip to main content');
    expect(first?.getAttribute('href')).toBe('#main-content');
    expect(container.querySelector('#main-content')).not.toBeNull();
  });

  it('makes the skip link target focusable', () => {
    // Without tabindex="-1" the skip link scrolls but does not move focus, so
    // the next Tab press returns to the navigation.
    const { container } = renderAt('/');
    expect(container.querySelector('#main-content')).toHaveAttribute('tabindex', '-1');
  });

  it('does not skip heading levels on any page', () => {
    for (const [path] of ROUTES) {
      const { container } = renderAt(path);
      const levels = Array.from(container.querySelectorAll('h1,h2,h3,h4,h5,h6')).map((h) =>
        Number(h.tagName[1]),
      );

      let previous = 0;
      for (const level of levels) {
        if (previous > 0) {
          expect(level, `${path} jumps from h${previous} to h${level}`).toBeLessThanOrEqual(
            previous + 1,
          );
        }
        previous = level;
      }
      cleanupBetween();
    }
  });
});

function cleanupBetween(): void {
  document.body.innerHTML = '';
}

// ─────────────────────────────────────────────────────────────────────────────
// Navigation
// ─────────────────────────────────────────────────────────────────────────────

describe('primary navigation', () => {
  it('uses a disclosure button, not a link, for dropdowns', async () => {
    renderAt('/');
    const trigger = screen.getByRole('button', { name: 'Platform' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveAttribute('aria-controls');
  });

  it('reveals its panel on activation and hides it again', async () => {
    const user = userEvent.setup();
    renderAt('/');

    const trigger = screen.getByRole('button', { name: 'Platform' });
    const panel = document.getElementById(trigger.getAttribute('aria-controls') as string);

    expect(panel).toHaveAttribute('hidden');

    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(panel).not.toHaveAttribute('hidden');

    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(panel).toHaveAttribute('hidden');
  });

  it('is operable by keyboard alone', async () => {
    const user = userEvent.setup();
    renderAt('/');

    const trigger = screen.getByRole('button', { name: 'Platform' });
    trigger.focus();
    await user.keyboard('{Enter}');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });

  it('closes on Escape and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    renderAt('/');

    const trigger = screen.getByRole('button', { name: 'Platform' });
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    await user.keyboard('{Escape}');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    // Returning focus is the half that is usually missed: without it, focus
    // lands on <body> and the user tabs from the top of the page again.
    expect(trigger).toHaveFocus();
  });

  it('names every link in a dropdown panel', async () => {
    const user = userEvent.setup();
    renderAt('/');

    const trigger = screen.getByRole('button', { name: 'Standards' });
    await user.click(trigger);

    const panel = document.getElementById(trigger.getAttribute('aria-controls') as string)!;
    const links = within(panel).getAllByRole('link');
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link.textContent?.trim().length ?? 0).toBeGreaterThan(0);
    }
  });

  /*
   * Regression: the drawer used to stay open on top of the page the user had
   * just navigated to.
   *
   * The original implementation compared the location key against a ref during
   * render and called setState inline. React renders twice in development, and
   * the first pass mutated the ref, so by the second pass no change was
   * detected and the drawer never closed. It also could not see a back or
   * forward navigation at all.
   */
  it('closes the mobile drawer after following a link in it', async () => {
    const user = userEvent.setup();
    renderAt('/');

    const toggle = screen.getByRole('button', { name: /menu/i });
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    const nav = document.getElementById(toggle.getAttribute('aria-controls') as string)!;
    await user.click(within(nav).getByRole('link', { name: 'Pricing' }));

    await waitFor(() => expect(toggle).toHaveAttribute('aria-expanded', 'false'));
  });

  it('closes the mobile drawer on Escape and returns focus to the toggle', async () => {
    const user = userEvent.setup();
    renderAt('/');

    const toggle = screen.getByRole('button', { name: /menu/i });
    await user.click(toggle);

    await user.keyboard('{Escape}');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveFocus();
  });

  it('closes a dropdown panel when the route changes underneath it', async () => {
    const user = userEvent.setup();
    renderAt('/');

    const trigger = screen.getByRole('button', { name: 'Platform' });
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    // Navigating from anywhere — not just from inside the panel — must close it.
    await user.click(screen.getAllByRole('link', { name: 'Pricing' })[0]!);
    await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'false'));
  });

  it('marks the current page with aria-current', () => {
    renderAt('/pricing');
    const current = screen.getAllByRole('link', { name: 'Pricing' })[0];
    expect(current).toHaveAttribute('aria-current', 'page');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Links
// ─────────────────────────────────────────────────────────────────────────────

describe('links', () => {
  it('gives every link an accessible name', () => {
    for (const [path] of ROUTES) {
      const { container } = renderAt(path);
      for (const link of Array.from(container.querySelectorAll('a[href]'))) {
        const name = (link.textContent ?? '').trim() || link.getAttribute('aria-label') || '';
        expect(name.length, `${path}: a link has no accessible name`).toBeGreaterThan(0);
      }
      cleanupBetween();
    }
  });

  it('announces links that open a new window', () => {
    for (const [path] of ROUTES) {
      const { container } = renderAt(path);
      for (const link of Array.from(container.querySelectorAll('a[target="_blank"]'))) {
        expect(
          (link.textContent ?? '').toLowerCase(),
          `${path}: a new-window link is unannounced`,
        ).toMatch(/new window|opens in/);
      }
      cleanupBetween();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The scanner form
// ─────────────────────────────────────────────────────────────────────────────

describe('scanner form', () => {
  it('labels every control', () => {
    renderAt('/scan');

    expect(screen.getByRole('textbox', { name: /page address/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /a published page/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /html i paste in/i })).toBeInTheDocument();
    // Exact match: /level aa/i would also match "Level AAA".
    expect(screen.getByRole('radio', { name: /^level aa \(recommended\)$/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /^level aaa$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /run the scan/i })).toBeInTheDocument();
  });

  it('groups radio buttons under a named group', () => {
    renderAt('/scan');
    expect(screen.getByRole('group', { name: /what would you like to scan/i })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /conformance level/i })).toBeInTheDocument();
  });

  it('connects the hint to the field with aria-describedby', () => {
    renderAt('/scan');
    const input = screen.getByRole('textbox', { name: /page address/i });
    const describedBy = input.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();

    const hint = document.getElementById(describedBy!.split(' ')[0]!);
    expect(hint?.textContent).toMatch(/full URL/i);
  });

  it('marks required fields in text, not with a bare asterisk', () => {
    renderAt('/scan');
    const label = screen.getByText(/page address/i).closest('label');
    expect(label?.textContent).toMatch(/\(required\)/);
    expect(label?.textContent).not.toMatch(/\*/);
  });

  it('swaps to a labelled textarea when pasting markup', async () => {
    const user = userEvent.setup();
    renderAt('/scan');

    await user.click(screen.getByRole('radio', { name: /html i paste in/i }));
    expect(screen.getByRole('textbox', { name: /html source/i })).toBeInTheDocument();
  });

  it('reports a submit-time error in an alert region and moves focus to it', async () => {
    const user = userEvent.setup();
    renderAt('/scan');

    await user.click(screen.getByRole('button', { name: /run the scan/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/could not run that scan/i);
    // Focus must land on the error, or a screen reader user has no idea the
    // submission failed.
    expect(alert).toHaveFocus();
  });

  it('links the error message to the field it belongs to', async () => {
    const user = userEvent.setup();
    renderAt('/scan');

    await user.click(screen.getByRole('button', { name: /run the scan/i }));

    const input = await screen.findByRole('textbox', { name: /page address/i });
    expect(input).toHaveAttribute('aria-invalid', 'true');

    const ids = (input.getAttribute('aria-describedby') ?? '').split(' ');
    const messages = ids.map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
    expect(messages).toMatch(/enter a url/i);
  });

  it('does not validate before the user submits', async () => {
    const user = userEvent.setup();
    renderAt('/scan');

    const input = screen.getByRole('textbox', { name: /page address/i });
    await user.click(input);
    await user.tab();

    // Validating on blur interrupts a screen reader user tabbing through a form
    // with errors for fields they have not reached yet.
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps the submit button in place while running', () => {
    renderAt('/scan');
    const button = screen.getByRole('button', { name: /run the scan/i });
    // aria-busy rather than disabling or replacing it: focus must not be lost.
    expect(button).toHaveAttribute('aria-busy', 'false');
  });
});

describe('scanning a document', () => {
  it('offers documents and media as a third source', () => {
    renderAt('/scan');
    expect(screen.getByRole('radio', { name: /a document or media file/i })).toBeInTheDocument();
  });

  it('swaps to a labelled file input, with the formats named in text', async () => {
    const user = userEvent.setup();
    renderAt('/scan');

    await user.click(screen.getByRole('radio', { name: /a document or media file/i }));

    const input = screen.getByLabelText(/^Document /i);
    expect(input).toHaveAttribute('type', 'file');

    // The accept list is a hint to the file picker, never the check — an
    // extension is the least reliable thing about a file — so the formats are
    // also spelled out where everyone can read them.
    const describedBy = input.getAttribute('aria-describedby');
    const hint = document.getElementById(describedBy!.split(' ')[0]!);
    expect(hint?.textContent).toMatch(/PDF, Word, PowerPoint/i);
    expect(input.getAttribute('accept')).toContain('.pdf');
  });

  it('says which file is too large rather than failing silently', async () => {
    const user = userEvent.setup();
    renderAt('/scan');

    await user.click(screen.getByRole('radio', { name: /a document or media file/i }));

    const input = screen.getByLabelText(/^Document /i) as HTMLInputElement;
    const huge = new File(['x'], 'huge.pdf', { type: 'application/pdf' });
    // A real 6 MB buffer would make this test slow for no extra coverage.
    Object.defineProperty(huge, 'size', { value: 6_000_000 });
    await user.upload(input, huge);

    await user.click(screen.getByRole('button', { name: /run the scan/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/huge\.pdf is 6 MB\. The limit is 5 MB\./);
    expect(alert).toHaveFocus();
  });

  it('asks for a file before submitting an empty upload', async () => {
    const user = userEvent.setup();
    renderAt('/scan');

    await user.click(screen.getByRole('radio', { name: /a document or media file/i }));
    await user.click(screen.getByRole('button', { name: /run the scan/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/choose the document/i);
  });

  it('does not carry an error from one source across to another', async () => {
    const user = userEvent.setup();
    renderAt('/scan');

    await user.click(screen.getByRole('button', { name: /run the scan/i }));
    await screen.findByRole('alert');

    // An error read for the URL field is simply wrong for a file input.
    await user.click(screen.getByRole('radio', { name: /a document or media file/i }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Live regions and route changes
// ─────────────────────────────────────────────────────────────────────────────

describe('route announcements', () => {
  it('renders a polite live region for route changes', () => {
    const { container } = renderAt('/');
    const status = container.querySelector('[role="status"][aria-live="polite"]');
    expect(status).not.toBeNull();
    expect(status).toHaveClass('visually-hidden');
  });

  it('sets the document title from the route', () => {
    renderAt('/pricing');
    expect(document.title).toMatch(/Pricing.*Accessly/);
  });

  it('announces and focuses the new page after a client-side navigation', async () => {
    const user = userEvent.setup();
    renderAt('/');

    await user.click(screen.getAllByRole('link', { name: 'Pricing' })[0]!);

    const heading = await screen.findByRole('heading', { level: 1, name: 'Pricing' });
    expect(heading).toHaveFocus();
    expect(document.title).toMatch(/Pricing/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tables and data
// ─────────────────────────────────────────────────────────────────────────────

describe('tables', () => {
  it('gives every table a caption and scoped headers', () => {
    for (const path of ['/standards', '/monitoring', '/accessibility']) {
      const { container } = renderAt(path);
      const tables = container.querySelectorAll('table');
      expect(tables.length).toBeGreaterThan(0);

      for (const table of Array.from(tables)) {
        expect(table.querySelector('caption'), `${path}: table has no caption`).not.toBeNull();
        for (const th of Array.from(table.querySelectorAll('th'))) {
          expect(th.getAttribute('scope'), `${path}: a header cell has no scope`).toBeTruthy();
        }
      }
      cleanupBetween();
    }
  });

  it('makes horizontally scrollable regions reachable by keyboard', () => {
    const { container } = renderAt('/standards');
    for (const region of Array.from(container.querySelectorAll('.table-wrap'))) {
      // A scroll container that cannot receive focus cannot be scrolled with a
      // keyboard, which makes its overflow content unreachable.
      expect(region).toHaveAttribute('tabindex', '0');
      expect(region).toHaveAttribute('role', 'region');
      expect(region.getAttribute('aria-label')?.length ?? 0).toBeGreaterThan(0);
    }
  });
});

describe('WCAG explorer', () => {
  it('lists all 78 criteria and announces the filtered count', async () => {
    const user = userEvent.setup();
    renderAt('/standards');

    // Scoped to main: the route announcer is also a status region, and it
    // lives outside the page content.
    const main = screen.getByRole('main');
    const status = within(main).getAllByRole('status').find((el) => /criteria match/.test(el.textContent ?? ''));

    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveTextContent('78 criteria match');

    await user.type(screen.getByRole('searchbox', { name: /search criteria/i }), 'contrast');

    // The count is announced, not silently changed.
    expect(status).toHaveTextContent(/criteria match/i);
    expect(status).not.toHaveTextContent('78 criteria match');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Images and icons
// ─────────────────────────────────────────────────────────────────────────────

describe('images and icons', () => {
  it('hides decorative SVGs from assistive technology', () => {
    for (const [path] of ROUTES) {
      const { container } = renderAt(path);
      for (const svg of Array.from(container.querySelectorAll('svg'))) {
        const labelled = svg.getAttribute('role') === 'img' && svg.getAttribute('aria-label');
        const hidden = svg.getAttribute('aria-hidden') === 'true';
        expect(
          Boolean(labelled) || hidden,
          `${path}: an SVG is neither labelled nor hidden`,
        ).toBe(true);
        // focusable="false" keeps legacy browsers from tabbing into it.
        expect(svg.getAttribute('focusable')).toBe('false');
      }
      cleanupBetween();
    }
  });

  it('renders the wordmark as text rather than an image', () => {
    renderAt('/');
    const brand = screen.getAllByRole('link', { name: /accessly/i })[0];
    expect(brand?.textContent).toContain('Accessly');
    expect(brand?.querySelector('img')).toBeNull();
  });
});
