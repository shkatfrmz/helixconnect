// Small, dependency-free inline SVG charts for the usage dashboard. These
// intentionally don't pull in a charting library for two bars and a
// sparkline — plain SVG keeps the bundle light and the styling themeable
// via the existing CSS custom properties.

type BarChartProps = {
  data: { label: string; value: number }[];
  height?: number;
};

export function BarChart({ data, height = 120 }: BarChartProps) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const barWidth = 100 / data.length;
  return (
    <svg className="bar-chart" viewBox={`0 0 100 ${height}`} preserveAspectRatio="none">
      {data.map((d, i) => {
        const h = (d.value / max) * (height - 20);
        const x = i * barWidth + barWidth * 0.15;
        const w = barWidth * 0.7;
        return (
          <g key={d.label}>
            <rect x={x} y={height - 20 - h} width={w} height={Math.max(h, d.value > 0 ? 2 : 0)} rx="1.5" className="bar-chart-bar" />
            <text x={x + w / 2} y={height - 6} textAnchor="middle" className="bar-chart-label">
              {d.label}
            </text>
            <text x={x + w / 2} y={height - 24 - h} textAnchor="middle" className="bar-chart-value">
              {d.value > 0 ? d.value : ""}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

type SparklineProps = {
  values: (number | null)[];
  width?: number;
  height?: number;
};

export function Sparkline({ values, width = 120, height = 28 }: SparklineProps) {
  const points = values.filter((v): v is number => v != null);
  if (points.length < 2) {
    return <span className="tiny">Not enough samples yet</span>;
  }
  const max = Math.max(...points, 1);
  const min = Math.min(...points, 0);
  const range = max - min || 1;
  const step = width / (values.length - 1);
  const coords = values.map((v, i) => {
    const x = i * step;
    if (v == null) return null;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${x},${y}`;
  });
  // Draw through gaps (missed samples) by only connecting consecutive
  // known points rather than one continuous path across nulls.
  const segments: string[][] = [];
  let current: string[] = [];
  for (const c of coords) {
    if (c == null) {
      if (current.length) segments.push(current);
      current = [];
    } else {
      current.push(c);
    }
  }
  if (current.length) segments.push(current);

  return (
    <svg className="sparkline" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      {segments.map((seg, i) => (
        <polyline key={i} points={seg.join(" ")} className="sparkline-line" />
      ))}
    </svg>
  );
}
