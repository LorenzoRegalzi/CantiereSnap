'use client';

import { LucideIcon } from 'lucide-react';

interface KpiCardProps {
  title: string;
  value: string;
  subtitle: string;
  icon: LucideIcon;
  accentColor: string;
  children?: React.ReactNode;
  onClick?: () => void;
}

export default function KpiCard({
  title,
  value,
  subtitle,
  icon: Icon,
  accentColor,
  children,
  onClick,
}: KpiCardProps) {
  return (
    <div
      className={`relative flex overflow-hidden rounded-lg bg-white shadow-sm ${onClick ? 'cursor-pointer hover:shadow-md transition-shadow' : ''}`}
      onClick={onClick}
    >
      {/* Left accent stripe */}
      <div className={`w-1.5 shrink-0 ${accentColor}`} />

      <div className="flex flex-1 flex-col gap-1 p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-brand-muted">{title}</p>
          <Icon className="h-5 w-5 text-brand-muted" />
        </div>

        <p className="text-3xl font-bold text-brand-text">{value}</p>

        <p className="text-xs text-brand-muted">{subtitle}</p>

        {children && <div className="mt-1">{children}</div>}
      </div>
    </div>
  );
}
