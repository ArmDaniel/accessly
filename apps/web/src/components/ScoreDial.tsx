import type { Score, ScoreBand } from '@accessly/contracts';

const BAND_LABEL: Record<ScoreBand, string> = {
  excellent: 'Excellent',
  good: 'Good',
  fair: 'Fair',
  poor: 'Poor',
  critical: 'Critical',
};

/**
 * The headline score.
 *
 * The dial is an SVG with `aria-hidden`, because a ring of arcs is meaningless
 * when read aloud. The number and band are rendered as real text beside it, so
 * the information is identical whether you can see the graphic or not — the
 * graphic is genuinely redundant rather than merely captioned.
 *
 * The band name is always present as text, so the colour of the arc is never
 * the only thing carrying the verdict (WCAG 1.4.1).
 */
export function ScoreDial({ score, size = 132 }: { score: Score; size?: number }): React.JSX.Element {
  const radius = (size - 14) / 2;
  const circumference = 2 * Math.PI * radius;
  const filled = (score.value / 100) * circumference;

  return (
    <div className="score">
      <svg
        className="score__dial"
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        aria-hidden="true"
        focusable="false"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--a-border-subtle)"
          strokeWidth="10"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${filled} ${circumference}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          className={`band-${score.band}`}
        />
      </svg>

      <div>
        <p className={`score__value band-${score.band}`} style={{ margin: 0 }}>
          {score.value}
          <span style={{ fontSize: 'var(--a-text-lg)', fontWeight: 400 }}> / 100</span>
        </p>
        <p className="score__band" style={{ margin: 0 }}>
          <strong>{BAND_LABEL[score.band]}</strong> — measured against WCAG 2.1 level{' '}
          {score.target}
        </p>
        {/*
          The band alone is misleading when conformance has failed: "Excellent"
          next to a page that misses a level A criterion reads as a pass. The
          verdict is stated here so the two are never seen apart.
        */}
        {score.conformsTo === null ? (
          <p className="score__band band-critical" style={{ margin: 0, fontWeight: 700 }}>
            Does not conform at level A
          </p>
        ) : null}
      </div>
    </div>
  );
}

export { BAND_LABEL };
