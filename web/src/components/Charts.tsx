// Small, dependency-free chart primitives - no charting library added, in
// keeping with the rest of this app (see server/src/api/server.ts's own
// "no framework" rationale). Just enough SVG/CSS to make the numbers we
// already compute (gameStats.ts) readable at a glance.

const SERIES_COLORS = ["#6d4aff", "#e0607e", "#2aa876", "#e0a52a", "#3d8bdb", "#c2542f"];

export function seriesColor(i: number): string {
  return SERIES_COLORS[i % SERIES_COLORS.length];
}

export function HorizontalBarChart({
  data,
  valueFormatter = (v) => String(v),
}: {
  data: { label: string; value: number; color?: string }[];
  valueFormatter?: (v: number) => string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="bar-chart">
      {data.map((d, i) => (
        <div className="bar-chart-row" key={d.label}>
          <span className="bar-chart-label" title={d.label}>
            {d.label}
          </span>
          <div className="bar-chart-track">
            <div
              className="bar-chart-fill"
              style={{ width: `${(d.value / max) * 100}%`, background: d.color ?? seriesColor(i) }}
            />
          </div>
          <span className="bar-chart-value">{valueFormatter(d.value)}</span>
        </div>
      ))}
    </div>
  );
}

export interface LineSeries {
  label: string;
  color?: string;
  points: { x: number; y: number }[];
}

/** A minimal multi-series line chart (SVG) - built for life-totals-over-turns, but generic over any x/y series. */
export function LineChart({
  series,
  height = 220,
  yMin,
  yLabel,
  xLabel,
}: {
  series: LineSeries[];
  height?: number;
  /** Force the y-axis floor (e.g. 0 for life totals, so eliminations read as "hits the bottom"). */
  yMin?: number;
  yLabel?: string;
  xLabel?: string;
}) {
  const width = 640;
  const padding = { top: 10, right: 16, bottom: 28, left: 40 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;

  const allPoints = series.flatMap((s) => s.points);
  if (allPoints.length === 0) return <p className="muted">Not enough data to chart.</p>;

  const xs = allPoints.map((p) => p.x);
  const ys = allPoints.map((p) => p.y);
  const xMinV = Math.min(...xs, 0);
  const xMaxV = Math.max(...xs, 1);
  const yMinV = Math.min(yMin ?? 0, ...ys);
  const yMaxV = Math.max(...ys, 1);

  const scaleX = (x: number) => padding.left + ((x - xMinV) / (xMaxV - xMinV || 1)) * innerW;
  const scaleY = (y: number) => padding.top + innerH - ((y - yMinV) / (yMaxV - yMinV || 1)) * innerH;

  const yTicks = 4;
  const yTickValues = Array.from({ length: yTicks + 1 }, (_, i) => yMinV + ((yMaxV - yMinV) * i) / yTicks);

  const xTickCount = Math.min(8, xMaxV - xMinV || 1);
  const xTickValues = Array.from({ length: xTickCount + 1 }, (_, i) =>
    Math.round(xMinV + ((xMaxV - xMinV) * i) / xTickCount),
  );

  return (
    <div className="line-chart-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} className="line-chart" role="img">
        {yTickValues.map((v) => (
          <g key={`y${v}`}>
            <line
              x1={padding.left}
              x2={width - padding.right}
              y1={scaleY(v)}
              y2={scaleY(v)}
              stroke="var(--chart-grid)"
              strokeWidth={1}
            />
            <text x={padding.left - 6} y={scaleY(v)} textAnchor="end" dominantBaseline="middle" fontSize={10} fill="var(--chart-axis-text)">
              {Math.round(v)}
            </text>
          </g>
        ))}
        {xTickValues.map((v) => (
          <text
            key={`x${v}`}
            x={scaleX(v)}
            y={height - padding.bottom + 16}
            textAnchor="middle"
            fontSize={10}
            fill="var(--chart-axis-text)"
          >
            {v}
          </text>
        ))}
        {series.map((s, i) => {
          const points = [...s.points].sort((a, b) => a.x - b.x);
          const d = points.map((p, idx) => `${idx === 0 ? "M" : "L"}${scaleX(p.x)},${scaleY(p.y)}`).join(" ");
          const color = s.color ?? seriesColor(i);
          return (
            <g key={s.label}>
              <path d={d} fill="none" stroke={color} strokeWidth={2} />
              {points.map((p, idx) => (
                <circle key={idx} cx={scaleX(p.x)} cy={scaleY(p.y)} r={2.5} fill={color} />
              ))}
            </g>
          );
        })}
      </svg>
      <div className="line-chart-legend">
        {series.map((s, i) => (
          <span key={s.label} className="legend-item">
            <span className="legend-swatch" style={{ background: s.color ?? seriesColor(i) }} />
            {s.label}
          </span>
        ))}
      </div>
      {(xLabel || yLabel) && (
        <p className="muted chart-axis-caption">
          {xLabel ?? ""}
          {xLabel && yLabel ? " · " : ""}
          {yLabel ?? ""}
        </p>
      )}
    </div>
  );
}
