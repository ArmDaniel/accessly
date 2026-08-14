import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SUCCESS_CRITERIA } from '@accessly/contracts';
import { createHarness, GOOD_PAGE, type Harness } from './helpers.js';

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness({ 'https://example.test/': GOOD_PAGE });
});

afterEach(async () => {
  await harness.app.close();
});

describe('GET /health', () => {
  it('reports the engine version and rule count', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.status).toBe('ok');
    expect(body.engine.wcagVersion).toBe('2.1');
    expect(body.rules).toBeGreaterThan(0);
  });
});

describe('GET /v1/wcag/criteria', () => {
  it('publishes the full WCAG 2.1 catalogue', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/v1/wcag/criteria' });
    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.version).toBe('2.1');
    expect(body.criteria).toHaveLength(SUCCESS_CRITERIA.length);
    expect(body.principles).toHaveLength(4);
    expect(body.guidelines).toHaveLength(13);
  });
});

describe('GET /v1/rules', () => {
  it('publishes rule coverage in three buckets, so gaps cannot hide', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/v1/rules' });
    expect(response.statusCode).toBe(200);

    const { coverage, rules } = response.json();
    expect(rules.length).toBeGreaterThan(0);

    // Decided, flagged-for-review and untouched must account for every
    // criterion exactly once. Merging the first two would let an advisory
    // "please check this" masquerade as coverage.
    expect(coverage.criteriaTotal).toBe(SUCCESS_CRITERIA.length);
    expect(
      coverage.criteriaCovered + coverage.criteriaReviewPrompted + coverage.criteriaUncovered,
    ).toBe(SUCCESS_CRITERIA.length);

    expect(coverage.covered).toHaveLength(coverage.criteriaCovered);
    expect(coverage.reviewPrompted).toHaveLength(coverage.criteriaReviewPrompted);
    expect(coverage.uncovered).toHaveLength(coverage.criteriaUncovered);

    // The gap is real and must be published rather than rounded away.
    expect(coverage.criteriaUncovered).toBeGreaterThan(0);

    const ids = [
      ...coverage.covered,
      ...coverage.reviewPrompted,
      ...coverage.uncovered,
    ].map((c: { id: string }) => c.id);
    expect(new Set(ids).size).toBe(SUCCESS_CRITERIA.length);
  });

  it('declares for every rule whether it can decide an outcome', async () => {
    const { rules } = (await harness.app.inject({ method: 'GET', url: '/v1/rules' })).json();
    for (const rule of rules) {
      expect(['automated', 'advisory']).toContain(rule.detection);
    }
    // Both kinds exist; a catalogue of only advisory rules would prove nothing.
    expect(rules.some((r: { detection: string }) => r.detection === 'automated')).toBe(true);
    expect(rules.some((r: { detection: string }) => r.detection === 'advisory')).toBe(true);
  });

  it('gives every rule at least one criterion', async () => {
    const body = (await harness.app.inject({ method: 'GET', url: '/v1/rules' })).json();
    for (const rule of body.rules) {
      expect(rule.criteria.length).toBeGreaterThan(0);
    }
  });
});

describe('POST /v1/audits', () => {
  it('audits pasted HTML', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/audits',
      payload: { source: 'inline', html: GOOD_PAGE, target: 'AA' },
    });

    expect(response.statusCode).toBe(201);
    const report = response.json();
    expect(report.status).toBe('succeeded');
    expect(report.target).toBe('AA');
    expect(report.score.value).toBeGreaterThan(0);
    expect(report.subject.title).toBe('An accessible product page');
  });

  it('audits a fetched URL', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/audits',
      payload: { source: 'url', url: 'https://example.test/', target: 'AA' },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().subject.url).toBe('https://example.test/');
    expect(harness.fetcher.calls).toEqual(['https://example.test/']);
  });

  it('defaults to level AA, which is what the law requires', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/audits',
      payload: { source: 'inline', html: GOOD_PAGE },
    });
    expect(response.json().target).toBe('AA');
  });

  it('rejects a malformed URL with field-level problem details', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/audits',
      payload: { source: 'url', url: 'not-a-url' },
    });

    expect(response.statusCode).toBe(422);
    expect(response.headers['content-type']).toMatch(/application\/problem\+json/);

    const problem = response.json();
    expect(problem.title).toBeTruthy();
    expect(problem.errors.url[0]).toMatch(/http/i);
  });

  it('rejects an unknown source discriminator', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/audits',
      payload: { source: 'ftp', url: 'https://example.test/' },
    });
    expect(response.statusCode).toBe(422);
  });

  it('rejects an empty inline document', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/audits',
      payload: { source: 'inline', html: '' },
    });
    expect(response.statusCode).toBe(422);
  });

  it('returns 502 when the page cannot be fetched', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/audits',
      payload: { source: 'url', url: 'https://missing.test/' },
    });

    expect(response.statusCode).toBe(502);
    expect(response.json().title).toMatch(/could not be retrieved/i);
  });

  it('404s when the referenced site does not exist', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/audits',
      payload: {
        source: 'inline',
        html: GOOD_PAGE,
        siteId: '00000000-0000-4000-8000-000000009999',
      },
    });
    expect(response.statusCode).toBe(404);
  });
});

describe('GET /v1/audits/:id', () => {
  it('returns a stored report', async () => {
    const created = await harness.app.inject({
      method: 'POST',
      url: '/v1/audits',
      payload: { source: 'inline', html: GOOD_PAGE },
    });
    const id = created.json().id;

    const fetched = await harness.app.inject({ method: 'GET', url: `/v1/audits/${id}` });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json().id).toBe(id);
  });

  it('404s for an unknown id', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: '/v1/audits/00000000-0000-4000-8000-000000009999',
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().status).toBe(404);
  });

  it('422s for an id that is not a uuid', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/v1/audits/nonsense' });
    expect(response.statusCode).toBe(422);
  });
});

describe('sites', () => {
  const site = { url: 'https://example.test/', label: 'Marketing home', target: 'AA' };

  it('creates, reads, updates and deletes a site', async () => {
    const created = await harness.app.inject({ method: 'POST', url: '/v1/sites', payload: site });
    expect(created.statusCode).toBe(201);
    const id = created.json().id;

    const read = await harness.app.inject({ method: 'GET', url: `/v1/sites/${id}` });
    expect(read.json().label).toBe('Marketing home');

    const updated = await harness.app.inject({
      method: 'PATCH',
      url: `/v1/sites/${id}`,
      payload: { label: 'Home page' },
    });
    expect(updated.json().label).toBe('Home page');
    // A patch must not silently reset the fields it did not mention.
    expect(updated.json().url).toBe(site.url);

    const deleted = await harness.app.inject({ method: 'DELETE', url: `/v1/sites/${id}` });
    expect(deleted.statusCode).toBe(204);

    const gone = await harness.app.inject({ method: 'GET', url: `/v1/sites/${id}` });
    expect(gone.statusCode).toBe(404);
  });

  it('refuses to register the same URL twice for one organisation', async () => {
    await harness.app.inject({ method: 'POST', url: '/v1/sites', payload: site });
    const second = await harness.app.inject({ method: 'POST', url: '/v1/sites', payload: site });

    expect(second.statusCode).toBe(409);
    expect(second.json().detail).toMatch(/Marketing home/);
  });

  it('scopes the site list to the calling organisation', async () => {
    await harness.app.inject({ method: 'POST', url: '/v1/sites', payload: site });

    const otherOrg = await harness.app.inject({
      method: 'GET',
      url: '/v1/sites',
      headers: { 'x-accessly-organisation': '00000000-0000-4000-8000-000000000002' },
    });
    expect(otherOrg.json().items).toHaveLength(0);

    const sameOrg = await harness.app.inject({ method: 'GET', url: '/v1/sites' });
    expect(sameOrg.json().items).toHaveLength(1);
  });

  it('records the latest score on the site after an audit', async () => {
    const created = await harness.app.inject({ method: 'POST', url: '/v1/sites', payload: site });
    const siteId = created.json().id;

    const audit = await harness.app.inject({
      method: 'POST',
      url: '/v1/audits',
      payload: { source: 'url', url: 'https://example.test/', siteId },
    });

    const read = await harness.app.inject({ method: 'GET', url: `/v1/sites/${siteId}` });
    expect(read.json().latestAuditId).toBe(audit.json().id);
    expect(read.json().latestScore).toBe(audit.json().score.value);
  });
});

describe('tenancy', () => {
  const ORG_A = '00000000-0000-4000-8000-000000000001'; // demo org (default)
  const ORG_B = '00000000-0000-4000-8000-00000000000b';
  const orgBHeaders = { 'x-accessly-organisation': ORG_B };

  /**
   * Cross-tenant access must be a 404, not a 403: "forbidden" confirms the
   * id exists under some other tenant, which is exactly what an enumeration
   * probe wants to learn.
   */
  it('hides another organisation\'s site from every :id route', async () => {
    const created = await harness.app.inject({
      method: 'POST',
      url: '/v1/sites',
      payload: { url: 'https://example.test/', label: 'A site', target: 'AA' },
    });
    expect(created.json().organisationId).toBe(ORG_A);
    const id = created.json().id;

    expect((await harness.app.inject({ method: 'GET', url: `/v1/sites/${id}`, headers: orgBHeaders })).statusCode).toBe(404);
    expect((await harness.app.inject({ method: 'PATCH', url: `/v1/sites/${id}`, headers: orgBHeaders, payload: { label: 'Stolen' } })).statusCode).toBe(404);
    expect((await harness.app.inject({ method: 'DELETE', url: `/v1/sites/${id}`, headers: orgBHeaders })).statusCode).toBe(404);

    // The owner still sees it after org B's attempts.
    expect((await harness.app.inject({ method: 'GET', url: `/v1/sites/${id}` })).statusCode).toBe(200);
  });

  it('does not let one organisation audit onto another\'s site', async () => {
    const created = await harness.app.inject({
      method: 'POST',
      url: '/v1/sites',
      payload: { url: 'https://example.test/', label: 'A site', target: 'AA' },
    });
    const siteId = created.json().id;

    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/audits',
      headers: orgBHeaders,
      payload: { source: 'inline', html: GOOD_PAGE, siteId },
    });
    expect(response.statusCode).toBe(404);
  });

  it('does not let one organisation watch another\'s site', async () => {
    const created = await harness.app.inject({
      method: 'POST',
      url: '/v1/sites',
      payload: { url: 'https://example.test/', label: 'A site', target: 'AA' },
    });
    const siteId = created.json().id;

    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/watches',
      headers: orgBHeaders,
      payload: { siteId, interval: 'daily' },
    });
    expect(response.statusCode).toBe(404);
  });

  it('scopes the audit list, reads, diffs and watch routes to the caller', async () => {
    const site = await harness.app.inject({
      method: 'POST',
      url: '/v1/sites',
      payload: { url: 'https://example.test/', label: 'A site', target: 'AA' },
    });
    const audit = await harness.app.inject({
      method: 'POST',
      url: '/v1/audits',
      payload: { source: 'url', url: 'https://example.test/', siteId: site.json().id },
    });
    const watch = await harness.app.inject({
      method: 'POST',
      url: '/v1/watches',
      payload: { siteId: site.json().id, interval: 'daily' },
    });
    const auditId = audit.json().id;
    const watchId = watch.json().id;

    // Org B's list is empty even though org A has an audit.
    const list = await harness.app.inject({ method: 'GET', url: '/v1/audits', headers: orgBHeaders });
    expect(list.json().items).toHaveLength(0);

    expect((await harness.app.inject({ method: 'GET', url: `/v1/audits/${auditId}`, headers: orgBHeaders })).statusCode).toBe(404);
    expect((await harness.app.inject({ method: 'GET', url: `/v1/audits/${auditId}/diff`, headers: orgBHeaders })).statusCode).toBe(404);
    expect((await harness.app.inject({ method: 'GET', url: `/v1/watches/${watchId}`, headers: orgBHeaders })).statusCode).toBe(404);
    expect((await harness.app.inject({ method: 'GET', url: `/v1/watches/${watchId}/events`, headers: orgBHeaders })).statusCode).toBe(404);
    expect((await harness.app.inject({ method: 'POST', url: `/v1/watches/${watchId}/poll`, headers: orgBHeaders })).statusCode).toBe(404);
    expect((await harness.app.inject({ method: 'DELETE', url: `/v1/watches/${watchId}`, headers: orgBHeaders })).statusCode).toBe(404);

    // And the owner still sees everything.
    const ownList = await harness.app.inject({ method: 'GET', url: '/v1/audits' });
    expect(ownList.json().items).toHaveLength(1);
  });

  it('treats a URL with and without a trailing slash as the same site', async () => {
    await harness.app.inject({
      method: 'POST',
      url: '/v1/sites',
      payload: { url: 'https://example.test/', label: 'Home', target: 'AA' },
    });
    const second = await harness.app.inject({
      method: 'POST',
      url: '/v1/sites',
      payload: { url: 'https://example.test', label: 'Home again', target: 'AA' },
    });
    expect(second.statusCode).toBe(409);
  });
});

describe('cursor pagination', () => {
  it('terminates on a cursor that no longer resolves instead of restarting', async () => {
    for (let i = 0; i < 3; i += 1) {
      await harness.app.inject({
        method: 'POST',
        url: '/v1/audits',
        payload: { source: 'inline', html: GOOD_PAGE },
      });
    }

    // A cursor naming a deleted (or foreign) audit must end the page.
    // Returning page 1 again would loop a client that follows nextCursor.
    const response = await harness.app.inject({
      method: 'GET',
      url: '/v1/audits?cursor=00000000-0000-4000-8000-000000009999&limit=2',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().items).toHaveLength(0);
    expect(response.json().nextCursor).toBeNull();
  });

  it('pages through every audit exactly once', async () => {
    for (let i = 0; i < 5; i += 1) {
      await harness.app.inject({
        method: 'POST',
        url: '/v1/audits',
        payload: { source: 'inline', html: GOOD_PAGE },
      });
    }

    const seen: string[] = [];
    let cursor: string | null = null;
    for (;;) {
      const url = `/v1/audits?limit=2${cursor ? `&cursor=${cursor}` : ''}`;
      const page: { items: readonly { id: string }[]; nextCursor: string | null } = (
        await harness.app.inject({ method: 'GET', url })
      ).json();
      seen.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
      if (!cursor) break;
    }
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
  });

  it('honours limit and cursor on /v1/sites/:id/audits', async () => {
    const site = await harness.app.inject({
      method: 'POST',
      url: '/v1/sites',
      payload: { url: 'https://example.test/', label: 'A site', target: 'AA' },
    });
    for (let i = 0; i < 3; i += 1) {
      await harness.app.inject({
        method: 'POST',
        url: '/v1/audits',
        payload: { source: 'url', url: 'https://example.test/', siteId: site.json().id },
      });
    }

    const first = (
      await harness.app.inject({ method: 'GET', url: `/v1/sites/${site.json().id}/audits?limit=2` })
    ).json();
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toBeTruthy();

    const second = (
      await harness.app.inject({
        method: 'GET',
        url: `/v1/sites/${site.json().id}/audits?limit=2&cursor=${first.nextCursor}`,
      })
    ).json();
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
  });
});

describe('error handling', () => {
  it('returns problem details for an unknown route', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/v1/nope' });
    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toMatch(/application\/problem\+json/);

    const problem = response.json();
    expect(problem.type).toMatch(/^https:\/\/accessly\.eu\/problems\//);
    expect(problem.status).toBe(404);
    expect(problem.instance).toBe('/v1/nope');
  });

  it('never leaks an internal message in a 500', async () => {
    // A route that throws an unexpected error must produce a generic problem.
    harness.app.get('/boom', async () => {
      throw new Error('connection string postgres://user:hunter2@db');
    });

    const response = await harness.app.inject({ method: 'GET', url: '/boom' });
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain('hunter2');
    expect(response.json().title).toMatch(/went wrong/i);
  });
});
