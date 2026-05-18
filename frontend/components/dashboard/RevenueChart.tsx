'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { formatCurrency } from '@/lib/format';
import { RevenueData } from '@/types';

const MONTH_NAMES_IT: Record<string, string> = {
  '01': 'Gen',
  '02': 'Feb',
  '03': 'Mar',
  '04': 'Apr',
  '05': 'Mag',
  '06': 'Giu',
  '07': 'Lug',
  '08': 'Ago',
  '09': 'Set',
  '10': 'Ott',
  '11': 'Nov',
  '12': 'Dic',
};

function formatMonthLabel(month: string): string {
  const [year, mm] = month.split('-');
  return `${MONTH_NAMES_IT[mm] ?? mm} '${year.slice(2)}`;
}

interface Props {
  data: RevenueData;
}

interface TooltipPayload {
  value: number;
  payload: { month: string };
}

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: TooltipPayload[];
}) {
  if (!active || !payload?.length) return null;
  const { value, payload: item } = payload[0];
  return (
    <div className="rounded-lg border border-brand-border bg-white px-3 py-2 shadow-md text-sm">
      <p className="font-medium text-brand-text">{formatMonthLabel(item.month)}</p>
      <p className="text-amber-600">{formatCurrency(value)}</p>
    </div>
  );
}

export default function RevenueChart({ data }: Props) {
  const chartData = data.months.map((m) => ({
    ...m,
    label: formatMonthLabel(m.month),
  }));

  return (
    <div>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={chartData} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 12, fill: '#6b7280' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tickFormatter={(v) => `€${(v / 1000).toFixed(0)}k`}
            tick={{ fontSize: 12, fill: '#6b7280' }}
            axisLine={false}
            tickLine={false}
            width={50}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: '#fef3c7' }} />
          <Bar dataKey="revenue" fill="#d97706" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>

      <p className="mt-2 text-right text-sm text-brand-muted">
        Totale periodo:{' '}
        <span className="font-semibold text-brand-text">{formatCurrency(data.total)}</span>
      </p>
    </div>
  );
}
