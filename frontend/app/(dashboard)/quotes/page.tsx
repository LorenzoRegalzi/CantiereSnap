'use client';

import { useEffect, useState } from 'react';
import apiClient, { fetchAllPages } from '@/lib/api-client';
import { Job, Quote, QuoteItem } from '@/types';
import { formatCurrency, formatDate } from '@/lib/format';

interface QuoteRow {
  job: Job;
  quote: Quote;
  items: QuoteItem[];
}

const STATUS_LABELS: Record<string, string> = {
  Draft: 'Bozza',
  Approved: 'Approvato',
  Sent: 'Inviato',
};

const STATUS_COLORS: Record<string, string> = {
  Draft: 'bg-amber-100 text-amber-800',
  Approved: 'bg-teal-100 text-teal-800',
  Sent: 'bg-blue-100 text-blue-800',
};

// Statuses that have (or should have) a quote
const QUOTE_STATUSES = new Set(['Quote', 'Accepted', 'InProgress', 'Completed', 'Invoiced']);

function SkeletonRow() {
  return (
    <tr className="animate-pulse">
      {[1, 2, 3, 4, 5].map((i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-4 rounded bg-stone-200" />
        </td>
      ))}
    </tr>
  );
}

export default function QuotesPage() {
  const [rows, setRows] = useState<QuoteRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const jobs = await fetchAllPages<Job>('/jobs');
        const candidates = jobs.filter((j) => QUOTE_STATUSES.has(j.status));

        // Fetch quotes in parallel; skip jobs that have no quote (404)
        const settled = await Promise.allSettled(
          candidates.map((job) =>
            apiClient
              .get<{ quote: Quote; items: QuoteItem[] }>(`/jobs/${job.jobId}/quote`)
              .then(({ data }) => ({ job, quote: data.quote, items: data.items }))
          )
        );

        const results: QuoteRow[] = [];
        for (const result of settled) {
          if (result.status === 'fulfilled') results.push(result.value);
        }

        if (!cancelled) setRows(results);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  const isEmpty = !loading && rows.length === 0;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold text-brand-primary">Preventivi</h1>

      {isEmpty ? (
        <div className="rounded-lg border border-dashed border-brand-border bg-white p-12 text-center">
          <p className="text-brand-muted">
            Nessun preventivo generato. Crea un lavoro e genera il tuo primo preventivo!
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-brand-border bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-brand-border bg-stone-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-brand-muted">Lavoro</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-brand-muted">Cliente</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-brand-muted">Stato</th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-brand-muted">Totale</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-brand-muted">Data</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-border">
              {loading ? (
                <>
                  <SkeletonRow />
                  <SkeletonRow />
                  <SkeletonRow />
                </>
              ) : (
                rows.map(({ job, quote }) => (
                  <tr
                    key={job.jobId}
                    className="cursor-pointer hover:bg-stone-50"
                    onClick={() => {
                      // Navigate to job detail — open jobs page with this job selected
                      window.location.href = `/jobs?open=${job.jobId}`;
                    }}
                  >
                    <td className="px-4 py-3 font-medium text-brand-text">#{job.jobIdFormatted}</td>
                    <td className="px-4 py-3 text-brand-text">{job.clientName}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[quote.status] ?? 'bg-stone-100 text-stone-600'}`}>
                        {STATUS_LABELS[quote.status] ?? quote.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-brand-text">
                      {formatCurrency(quote.totalAmount)}
                    </td>
                    <td className="px-4 py-3 text-brand-muted">
                      {quote.createdAt ? formatDate(quote.createdAt) : '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
