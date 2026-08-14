import type {
  AuditDiff,
  AuditReport,
  CreateAuditInput,
  CreateSiteInput,
  CreateWatchInput,
  ProblemDetails,
  Site,
  UpdateWatchInput,
  Watch,
  WatchEvent,
} from '@accessly/contracts';

/**
 * The only place in the web app that talks HTTP.
 *
 * Everything is typed from @accessly/contracts, so the compiler catches a
 * frontend that has drifted from the API rather than the user catching it.
 */

const BASE = '/api';

/** An API error the UI can render — carries the field-level messages. */
export class ApiError extends Error {
  constructor(
    readonly problem: ProblemDetails,
    readonly status: number,
  ) {
    super(problem.title);
    this.name = 'ApiError';
  }

  /** Messages for a specific form field, if the API returned any. */
  fieldErrors(field: string): readonly string[] {
    return this.problem.errors?.[field] ?? [];
  }

  get detail(): string | undefined {
    return this.problem.detail;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        // Only declare a JSON body when there actually is one. Sending
        // `content-type: application/json` with an empty body is a protocol
        // error, and Fastify rejects it — which breaks every bodyless POST
        // (a forced poll) and every DELETE.
        ...(init?.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    throw new ApiError(
      {
        type: 'https://accessly.eu/problems/network_error',
        title: 'We could not reach the Accessly service.',
        status: 0,
        detail: 'Check your connection and try again.',
      },
      0,
    );
  }

  if (response.status === 204) return undefined as T;

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const problem: ProblemDetails =
      body && typeof body === 'object' && 'title' in body
        ? (body as ProblemDetails)
        : {
            type: 'https://accessly.eu/problems/unknown',
            title: 'Something went wrong.',
            status: response.status,
          };
    throw new ApiError(problem, response.status);
  }

  return body as T;
}

export interface CriterionSummary {
  readonly id: string;
  readonly title: string;
  readonly level: string;
}

export interface Paginated<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}

export const api = {
  health: () => request<{ status: string; rules: number }>('/health'),

  createAudit: (input: CreateAuditInput) =>
    request<AuditReport>('/v1/audits', { method: 'POST', body: JSON.stringify(input) }),

  getAudit: (id: string) => request<AuditReport>(`/v1/audits/${id}`),

  listAudits: (options: { siteId?: string; cursor?: string; limit?: number } = {}) => {
    const params = new URLSearchParams();
    if (options.siteId) params.set('siteId', options.siteId);
    if (options.cursor) params.set('cursor', options.cursor);
    if (options.limit !== undefined) params.set('limit', String(options.limit));
    const query = params.toString();
    return request<Paginated<AuditReport>>(`/v1/audits${query ? `?${query}` : ''}`);
  },

  /** Null when the audit has no earlier one to compare against. */
  getAuditDiff: (id: string) => request<AuditDiff | null>(`/v1/audits/${id}/diff`),

  // ── Sites ──────────────────────────────────────────────────────────────────

  listSites: () => request<Paginated<Site>>('/v1/sites'),

  getSite: (id: string) => request<Site>(`/v1/sites/${id}`),

  createSite: (input: CreateSiteInput) =>
    request<Site>('/v1/sites', { method: 'POST', body: JSON.stringify(input) }),

  deleteSite: (id: string) => request<void>(`/v1/sites/${id}`, { method: 'DELETE' }),

  listSiteAudits: (id: string) => request<Paginated<AuditReport>>(`/v1/sites/${id}/audits`),

  // ── Watches ────────────────────────────────────────────────────────────────

  listWatches: () => request<Paginated<Watch>>('/v1/watches'),

  createWatch: (input: CreateWatchInput) =>
    request<Watch>('/v1/watches', { method: 'POST', body: JSON.stringify(input) }),

  updateWatch: (id: string, patch: UpdateWatchInput) =>
    request<Watch>(`/v1/watches/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  deleteWatch: (id: string) => request<void>(`/v1/watches/${id}`, { method: 'DELETE' }),

  /** Force a check now, rather than waiting for the schedule. */
  pollWatch: (id: string) =>
    request<{ watchId: string; kind: string; auditId?: string; scoreDelta?: number; changed?: boolean }>(
      `/v1/watches/${id}/poll`,
      { method: 'POST' },
    ),

  listWatchEvents: (watchId: string) =>
    request<Paginated<WatchEvent>>(`/v1/watches/${watchId}/events`),

  rules: () =>
    request<{
      engineVersion: string;
      rules: readonly {
        id: string;
        title: string;
        help: string;
        criteria: readonly string[];
        impact: string;
        detection: 'automated' | 'advisory';
        techniques: readonly string[];
        scope: string;
      }[];
      coverage: {
        criteriaTotal: number;
        criteriaCovered: number;
        criteriaReviewPrompted: number;
        criteriaUncovered: number;
        covered: readonly CriterionSummary[];
        reviewPrompted: readonly CriterionSummary[];
        uncovered: readonly CriterionSummary[];
      };
    }>('/v1/rules'),
};
