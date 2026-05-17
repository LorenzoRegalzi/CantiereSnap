'use client';

import { MapPin, Calendar, AlertTriangle } from 'lucide-react';
import { Job, JobStatus } from '@/types';

// Status dot color map
export const STATUS_COLORS: Record<JobStatus, string> = {
  Quote: 'bg-stone-400',
  Accepted: 'bg-amber-500',
  InProgress: 'bg-blue-500',
  Completed: 'bg-teal-600',
  Invoiced: 'bg-slate-900',
};

// Human-readable Italian labels
export const STATUS_LABELS: Record<JobStatus, string> = {
  Quote: 'Preventivo',
  Accepted: 'Accettato',
  InProgress: 'In Corso',
  Completed: 'Completato',
  Invoiced: 'Fatturato',
};

// Next status for advance-status action
export const NEXT_STATUS: Partial<Record<JobStatus, JobStatus>> = {
  Quote: 'Accepted',
  Accepted: 'InProgress',
  InProgress: 'Completed',
  Completed: 'Invoiced',
};

// Italian labels for the advance button
export const ADVANCE_LABELS: Partial<Record<JobStatus, string>> = {
  Quote: 'Accetta Preventivo',
  Accepted: 'Inizia Lavoro',
  InProgress: 'Completa Lavoro',
  Completed: 'Segna come Fatturato',
};

interface JobCardProps {
  job: Job;
  onClick: (job: Job) => void;
}

function isOverdue(targetDate: string, status: JobStatus): boolean {
  if (status === 'Completed' || status === 'Invoiced') return false;
  return new Date(targetDate) < new Date();
}

export default function JobCard({ job, onClick }: JobCardProps) {
  const overdue = job.targetDate ? isOverdue(job.targetDate, job.status) : false;

  const formattedDate = job.targetDate
    ? new Date(job.targetDate).toLocaleDateString('it-IT', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : null;

  return (
    <div
      onClick={() => onClick(job)}
      className="cursor-pointer rounded-lg border border-brand-border bg-white p-4 shadow-sm transition-shadow hover:shadow-md"
    >
      {/* Top row: job id + status dot */}
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs text-brand-muted">#{job.jobIdFormatted}</span>
        <span className={`h-2.5 w-2.5 rounded-full ${STATUS_COLORS[job.status]}`} />
      </div>

      {/* Client name */}
      <p className="truncate font-semibold text-brand-text">{job.clientName}</p>

      {/* Description */}
      <p className="mt-0.5 text-sm text-brand-muted line-clamp-2">
        {job.description.length > 80 ? job.description.slice(0, 80) + '…' : job.description}
      </p>

      {/* Address */}
      <div className="mt-2 flex items-start gap-1 text-xs text-brand-muted">
        <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{job.address}</span>
      </div>

      {/* Target date */}
      {formattedDate && (
        <div
          className={`mt-1 flex items-center gap-1 text-xs ${overdue ? 'text-red-600' : 'text-brand-muted'}`}
        >
          {overdue ? (
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <Calendar className="h-3.5 w-3.5 shrink-0" />
          )}
          <span>{formattedDate}</span>
        </div>
      )}
    </div>
  );
}
