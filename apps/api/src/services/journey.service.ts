import {
  TRACE_PROTOCOL_VERSION,
  type CreateJourneyInput,
  type IngestTraceInput,
  type Journey,
  type JourneyReport,
  type JourneyTrace,
  type UpdateJourneyInput,
} from '@accessly/contracts';
import { analyseJourney } from '@accessly/core';
import type { Clock, IdGenerator } from '../domain/clock.js';
import { NotFoundError, ValidationError } from '../domain/errors.js';
import type {
  JourneyReportRepository,
  JourneyRepository,
  Page,
  PageQuery,
  SiteRepository,
  TraceRepository,
} from '../repositories/types.js';

export interface JourneyServiceDeps {
  readonly journeys: JourneyRepository;
  readonly traces: TraceRepository;
  readonly reports: JourneyReportRepository;
  readonly sites: SiteRepository;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

/**
 * Journeys: the definitions of what to monitor, and the traces recorded
 * against them.
 *
 * The division of labour matches the watcher's: this service owns the state a
 * journey has and the ingestion of what came back, while the analysis itself
 * lives in `@accessly/core` and stays pure. That is what lets the same
 * analyser run here, in a test, and one day in a customer's CI pipeline.
 */
export class JourneyService {
  constructor(private readonly deps: JourneyServiceDeps) {}

  async create(input: CreateJourneyInput, organisationId: string): Promise<Journey> {
    if (input.siteId) await this.#requireSite(input.siteId, organisationId);
    this.#assertStepIdsUnique(input.steps);

    const now = this.deps.clock.now().toISOString();
    return this.deps.journeys.create({
      id: this.deps.ids.next(),
      organisationId,
      siteId: input.siteId ?? null,
      name: input.name,
      description: input.description,
      startUrl: input.startUrl,
      steps: input.steps,
      createdAt: now,
      updatedAt: now,
    });
  }

  async findById(id: string, organisationId: string): Promise<Journey> {
    const journey = await this.deps.journeys.findById(id);
    // A journey belonging to another organisation does not exist as far as
    // this caller is concerned — 404, never 403.
    if (!journey || journey.organisationId !== organisationId) {
      throw new NotFoundError('Journey', id);
    }
    return journey;
  }

  async listByOrganisation(organisationId: string): Promise<readonly Journey[]> {
    return this.deps.journeys.listByOrganisation(organisationId);
  }

  async update(id: string, patch: UpdateJourneyInput, organisationId: string): Promise<Journey> {
    await this.findById(id, organisationId);
    if (patch.siteId) await this.#requireSite(patch.siteId, organisationId);
    if (patch.steps) this.#assertStepIdsUnique(patch.steps);

    const updated = await this.deps.journeys.update(id, {
      ...patch,
      ...(patch.siteId === null ? { siteId: null } : {}),
      updatedAt: this.deps.clock.now().toISOString(),
    });
    if (!updated) throw new NotFoundError('Journey', id);
    return updated;
  }

  async delete(id: string, organisationId: string): Promise<void> {
    await this.findById(id, organisationId);
    await this.deps.journeys.delete(id);
  }

  /**
   * Accept a trace from a tracker and turn it into a report.
   *
   * Two things are deliberately not taken from the body. The organisation comes
   * from the request context, because the body was composed by a script on a
   * customer's page and anything in it is under the visitor's control. And the
   * report id is issued here, so a replayed POST cannot overwrite an existing
   * report with different contents.
   */
  async ingest(input: IngestTraceInput, organisationId: string): Promise<JourneyReport> {
    if (input.version > TRACE_PROTOCOL_VERSION) {
      throw new ValidationError(
        `This trace was recorded by a newer tracker (protocol ${input.version}) than this API understands (${TRACE_PROTOCOL_VERSION}).`,
        { version: ['Upgrade the API, or pin the tracker to a supported version.'] },
      );
    }

    const journey = input.journeyId
      ? await this.findById(input.journeyId, organisationId)
      : null;

    const trace: JourneyTrace = {
      id: input.id,
      journeyId: journey?.id ?? null,
      organisationId,
      version: input.version,
      startedAt: input.startedAt,
      durationMs: input.durationMs,
      url: input.url,
      messages: input.messages.map((message) => ({
        ...message,
        t: message.t as JourneyTrace['messages'][number]['t'],
      })),
      client: input.client,
    };

    await this.deps.traces.save(trace);

    const report = analyseJourney({
      trace,
      journey,
      generateId: () => this.deps.ids.next(),
    });

    return this.deps.reports.save(report);
  }

  async findReport(id: string, organisationId: string): Promise<JourneyReport> {
    const report = await this.deps.reports.findById(id);
    if (!report || report.organisationId !== organisationId) {
      throw new NotFoundError('Journey report', id);
    }
    return report;
  }

  async listReports(
    query: PageQuery & { organisationId: string; journeyId?: string | undefined },
  ): Promise<Page<JourneyReport>> {
    // Listing a journey's reports must not confirm that a foreign journey
    // exists, so the journey is resolved through the tenancy check first.
    if (query.journeyId) await this.findById(query.journeyId, query.organisationId);
    return this.deps.reports.list(query);
  }

  /** The raw evidence behind a report, for re-analysis or export. */
  async findTrace(id: string, organisationId: string): Promise<JourneyTrace> {
    const trace = await this.deps.traces.findById(id, organisationId);
    if (!trace) throw new NotFoundError('Trace', id);
    return trace;
  }

  async #requireSite(siteId: string, organisationId: string): Promise<void> {
    const site = await this.deps.sites.findById(siteId);
    if (!site || site.organisationId !== organisationId) {
      throw new NotFoundError('Site', siteId);
    }
  }

  /**
   * Step ids are how a recording is matched back to its definition, so a
   * duplicate would silently make one of the two steps unverifiable.
   */
  #assertStepIdsUnique(steps: CreateJourneyInput['steps']): void {
    const seen = new Set<string>();
    for (const step of steps) {
      if (seen.has(step.id)) {
        throw new ValidationError('Each step needs its own id.', {
          steps: [`The id "${step.id}" is used more than once.`],
        });
      }
      seen.add(step.id);
    }
  }
}
