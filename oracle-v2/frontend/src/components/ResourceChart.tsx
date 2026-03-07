import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export interface ResourcePoint {
  time: string;
  cpu: number;
  memory: number;
}

interface ResourceChartProps {
  points: ResourcePoint[];
}

export function ResourceChart({ points }: ResourceChartProps) {
  if (points.length === 0) {
    return <div style={{ color: 'var(--text-muted)' }}>No resource samples yet.</div>;
  }

  return (
    <div style={{ width: '100%', height: 220 }}>
      <ResponsiveContainer>
        <LineChart data={points}>
          <XAxis dataKey="time" tick={{ fill: '#7f88ac', fontSize: 11 }} />
          <YAxis domain={[0, 100]} tick={{ fill: '#7f88ac', fontSize: 11 }} />
          <Tooltip
            contentStyle={{
              background: '#121425',
              border: '1px solid #343853',
              color: '#d6dcff',
              borderRadius: 8,
            }}
          />
          <Line type="monotone" dataKey="cpu" stroke="#f59e0b" dot={false} strokeWidth={2} />
          <Line type="monotone" dataKey="memory" stroke="#60a5fa" dot={false} strokeWidth={2} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
