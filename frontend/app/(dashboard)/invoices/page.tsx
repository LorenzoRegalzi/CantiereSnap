'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import apiClient from '@/lib/api-client';
import { Invoice } from '@/types';
import { formatCurrency, formatDate } from '@/lib/format';
import Button from '@/components/ui/Button';

type FilterStatus = 'all' | Invoice['status'];

const TABS: { key: FilterStatus; label: string }[] = [
  { key: 'all',      label: 'Tutte' },
  { key: 'Draft',    label: 'Bozza' },
  { key: 'Sent',     label: 'Inviate' },
  { key: 'Paid',     label: 'Pagate' },
  { key: 'Overdue',  label: 'Scadute' },
];

const STATUS_LABELS: Record<Invoice['status'], string> = {
  Draft: 'Bozza',
  Sent: 'Inviata',
  Paid: 'Pagata',
  Overdue: 'Scaduta',
};

const STATUS_COLORS: Record<Invoice['status'], string> = {
  Draft: 'bg-stone-100 text-stone-600',
  Sent: 'bg-blue-100 text-blue-700',
  Paid: 'bg-teal-100 text-teal-700',
  Overdue: 'bg-red-100 text-red-700',
};

export default function InvoicesPage() {
  const router = useRouter();
  const [filter, setFilter] = useState<FilterStatus>('all');
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [nextToken, setNextToken] = useState<string | undefined>();
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    setLoading(true);
    setInvoices([]);
    setNextToken(undefined);
    const params: Record<string, string> = {};
    if (filter !== 'all') params.status = filter;
    apiClient
      .get<{ items: Invoice[]; nextToken?: string }>('/invoices', { params })
      .then(({ data }) => {
        setInvoices(data.items);
        setNextToken(data.nextToken);
      })
      .finally(() => setLoading(false));
  }, [filter]);

  async function loadMore() {
    if (!nextToken) return;
    setLoadingMore(true);
    const params: Record<string, string> = { nextToken };
    if (filter !== 'all') params.status = filter;
    try {
      const { data } = await apiClient.get<{ items: Invoice[]; nextToken?: string }>('/invoices', { params });
      setInvoices((prev) => [...prev, ...data.items]);
      setNextToken(data.nextToken);
    } finally {
      setLoadingMore(false);
    }
  }

  function handleRowClick(inv: Invoice) {
    router.push(`/jobs?open=${inv.jobId}`);
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-brand-primary">Fatture</h1>

      {/* Filter tabs */}
      <div className="flex flex-wrap gap-2">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              filter === tab.key
                ? 'bg-brand-primary text-white'
                : 'bg-stone-100 text-brand-muted hover:bg-stone-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-14 animate-pulse rounded-lg bg-stone-200" />
          ))}
        </div>
      ) : invoices.length === 0 ? (
        <div className="rounded-lg border border-dashed border-brand-border py-16 text-center text-sm text-brand-muted">
          Nessuna fattura emessa. Completa un lavoro e genera la prima fattura!
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto rounded-lg border border-brand-border">
            <table className="w-full text-sm">
              <thead className="border-b border-brand-border bg-stone-50">
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-brand-muted">
                  <th className="px-4 py-3">N. Fattura</th>
                  <th className="px-4 py-3">Lavoro</th>
                  <th className="px-4 py-3">Cliente</th>
                  <th className="px-4 py-3 text-right">Importo</th>
                  <th className="px-4 py-3">Stato</th>
                  <th className="px-4 py-3">Scadenza</th>
                  <th className="px-4 py-3">Emessa</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => {
                  const isPastDue =
                    inv.status !== 'Paid' && inv.dueDate && new Date(inv.dueDate) < new Date();
                  return (
                    <tr
                      key={`${inv.jobId}-${inv.invoiceNumber}`}
                      onClick={() => handleRowClick(inv)}
                      className="cursor-pointer border-b border-brand-border/50 last:border-0 hover:bg-stone-50"
                    >
                      <td className="px-4 py-3 font-mono text-sm font-semibold text-brand-text">
                        {inv.invoiceNumber}
                      </td>
                      <td className="px-4 py-3 text-brand-muted">#{inv.jobId}</td>
                      <td className="px-4 py-3 text-brand-text">{inv.clientName}</td>
                      <td className="px-4 py-3 text-right font-medium text-brand-text">
                        {formatCurrency(inv.totalAmount)}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_COLORS[inv.status]}`}>
                          {STATUS_LABELS[inv.status]}
                        </span>
                      </td>
                      <td className={`px-4 py-3 ${isPastDue ? 'font-medium text-red-600' : 'text-brand-muted'}`}>
                        {inv.dueDate ? formatDate(inv.dueDate) : '—'}
                      </td>
                      <td className="px-4 py-3 text-brand-muted">{formatDate(inv.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="space-y-3 md:hidden">
            {invoices.map((inv) => {
              const isPastDue =
                inv.status !== 'Paid' && inv.dueDate && new Date(inv.dueDate) < new Date();
              return (
                <div
                  key={`${inv.jobId}-${inv.invoiceNumber}`}
                  onClick={() => handleRowClick(inv)}
                  className="cursor-pointer rounded-lg border border-brand-border bg-white p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-mono font-semibold text-brand-text">{inv.invoiceNumber}</p>
                      <p className="text-sm text-brand-muted">{inv.clientName}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_COLORS[inv.status]}`}>
                        {STATUS_LABELS[inv.status]}
                      </span>
                      <span className="font-semibold text-brand-text">{formatCurrency(inv.totalAmount)}</span>
                    </div>
                  </div>
                  <div className="mt-2 flex justify-between text-xs text-brand-muted">
                    <span>Lavoro #{inv.jobId}</span>
                    {inv.dueDate && (
                      <span className={isPastDue ? 'font-medium text-red-600' : ''}>
                        Scad. {formatDate(inv.dueDate)}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {nextToken && (
            <div className="pt-2 text-center">
              <Button variant="outline" loading={loadingMore} onClick={loadMore} className="w-auto px-6">
                Carica altri
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
