type MetricCardProps = {
  label: string;
  value: string | number;
  sub?: string;
  alert?: string;
  tone?: "teal" | "rose" | "amber" | "default";
  sparkPoints?: number[];
};

export function MetricCard({ label, value, sub, alert, tone = "default", sparkPoints }: MetricCardProps) {
  return (
    <div className="metricCard">
      <div className="metricLabel">{label}</div>
      <div className={`metricValue ${tone !== "default" ? tone : ""}`}>{value}</div>
      {alert ? <div className="metricAlert">{alert}</div> : null}
      {sub && !alert ? <div className="metricSub">{sub}</div> : null}
      {sparkPoints && sparkPoints.length > 1 ? (
        <Sparkline points={sparkPoints} tone={tone} />
      ) : null}
    </div>
  );
}

type SparklineProps = {
  points: number[];
  tone?: "teal" | "rose" | "amber" | "default";
};

export function Sparkline({ points, tone = "teal" }: SparklineProps) {
  const w = 100;
  const h = 24;
  const pad = 2;

  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;

  const xs = points.map((_, i) => pad + (i / (points.length - 1)) * (w - pad * 2));
  const ys = points.map((v) => pad + (1 - (v - min) / range) * (h - pad * 2));

  const d = xs.map((x, i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(" ");

  const colorMap: Record<string, string> = {
    teal: "#2dd4bf",
    rose: "#fb7185",
    amber: "#fbbf24",
    default: "#60a5fa",
  };

  const color = colorMap[tone] ?? colorMap.default;

  return (
    <svg className="sparkline" width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.7" />
    </svg>
  );
}
