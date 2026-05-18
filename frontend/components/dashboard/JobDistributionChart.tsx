'use client';

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { JobsStats } from '@/types';
import { STATUS_LABELS } from '@/components/JobCard';

// Matches STATUS_COLORS from JobCard but as hex for Recharts
const STATUS_HEX: Record<string, string> = {
  Quote: '#a8a29e',       // stone-400
  Accepted: '#f59e0b',    // amber-500
  InProgress: '#3b82f6',  // blue-500
  Completed: '#0d9488',   // teal-600
  Invoiced: '#0f172a',    // slate-900
};

interface Props {
  data: JobsStats;
}

interface TooltipPayload {
  name: string;
  value: number;
}

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: TooltipPayload[];
}) {
  if (!active || !payload?.length) return null;
  const { name, value } = payload[0];
  return (
    <div className="rounded-lg border border-brand-border bg-white px-3 py-2 shadow-md text-sm">
      <p className="text-brand-text">
        {name}: <span className="font-semibold">{value}</span>
      </p>
    </div>
  );
}

export default function JobDistributionChart({ data }: Props) {
  const chartData = Object.entries(data.byStatus)
    .filter(([, count]) => count > 0)
    .map(([status, count]) => ({
      name: STATUS_LABELS[status as keyof typeof STATUS_LABELS] ?? status,
      value: count,
      status,
    }));

  if (chartData.length === 0) {
    return (
      <div className="flex h-[250px] items-center justify-center text-sm text-brand-muted">
        Nessun dato disponibile
      </div>
    );
  }

  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={250}>
        <PieChart>
          <Pie
            data={chartData}
            cx="50%"
            cy="50%"
            innerRadius={65}
            outerRadius={95}
            paddingAngle={2}
            dataKey="value"
          >
            {chartData.map((entry) => (
              <Cell
                key={entry.status}
                fill={STATUS_HEX[entry.status] ?? '#94a3b8'}
              />
            ))}
          </Pie>
          <Tooltip content={<CustomTooltip />} />
          <Legend
            formatter={(value) => (
              <span className="text-xs text-brand-text">{value}</span>
            )}
          />
        </PieChart>
      </ResponsiveContainer>

      {/* Center label */}
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold text-brand-text">{data.total}</span>
        <span className="text-xs text-brand-muted">lavori totali</span>
      </div>
    </div>
  );
}
