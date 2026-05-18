'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Euro, CheckCircle, Clock, AlertTriangle } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { formatCurrency } from '@/lib/format';
import { DashboardSummary, RevenueData, JobsStats } from '@/types';
import KpiCard from '@/components/dashboard/KpiCard';
import RevenueChart from '@/components/dashboard/RevenueChart';
import JobDistributionChart from '@/components/dashboard/JobDistributionChart';
import OverdueWidget from '@/components/dashboard/OverdueWidget';

const MONTH_NAMES_FULL_IT: Record<string, string> = {
  '01': 'Gennaio', '02': 'Febbraio', '03': 'Marzo', '04': 'Aprile',
  '05': 'Maggio', '06': 'Giugno', '07': 'Luglio', '08': 'Agosto',
  '09': 'Settembre', '10': 'Ottobre', '11': 'Novembre', '12': 'Dicembre',
};

function getMonthLabel(yyyyMM: string): string {
  const [year, mm] = yyyyMM.split('-');
  return `${MONTH_NAMES_FULL_IT[mm] ?? mm} ${year}`;
}

function todayYYYYMM(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function monthsAgo(n: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Convert YYYY-MM to first/last day strings for the API
function toStartDate(yyyyMM: string): string {
  return `${yyyyMM}-01`;
}

function toEndDate(yyyyMM: string): string {
  const [y, m] = yyyyMM.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return `${yyyyMM}-${String(last).padStart(2, '0')}`;
}

// Skeleton block
function Skeleton({ className }: { className: string }) {
  return <div className={`animate-pulse rounded bg-gray-200 ${className}`} />;
}

function KpiSkeleton() {
  return (
    <div className="flex overflow-hidden rounded-lg bg-white shadow-sm">
      <div className="w-1.5 shrink-0 bg-gray-200" />
      <div className="flex flex-1 flex-col gap-2 p-4">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-8 w-20" />
        <Skeleton className="h-3 w-36" />
      </div>
    </div>
  );
}

export default function AnalyticsPage() {
  const router = useRouter();
  const today = todayYYYYMM();

  const [startMonth, setStartMonth] = useState(() => monthsAgo(11));
  const [endMonth, setEndMonth] = useState(today);

  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [revenue, setRevenue] = useState<RevenueData | null>(null);
  const [jobsStats, setJobsStats] = useState<JobsStats | null>(null);

  const [loadingInit, setLoadingInit] = useState(true);
  const [loadingRevenue, setLoadingRevenue] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overdueVisible, setOverdueVisible] = useState(true);

  // Fetch summary + jobs-stats once on mount
  useEffect(() => {
    async function fetchInit() {
      setLoadingInit(true);
      setError(null);
      try {
        const [s, j] = await Promise.all([
          apiClient.get<DashboardSummary>('/dashboard/summary'),
          apiClient.get<JobsStats>('/dashboard/jobs-stats'),
        ]);
        setSummary(s.data);
        setJobsStats(j.data);
      } catch {
        setError('Impossibile caricare i dati. Riprova più tardi.');
      } finally {
        setLoadingInit(false);
      }
    }
    fetchInit();
  }, []);

  // Fetch revenue when date range changes
  const fetchRevenue = useCallback(async (start: string, end: string) => {
    setLoadingRevenue(true);
    try {
      const { data } = await apiClient.get<RevenueData>('/dashboard/revenue', {
        params: { startDate: toStartDate(start), endDate: toEndDate(end) },
      });
      setRevenue(data);
    } catch {
      // non-fatal: revenue chart just won't show
    } finally {
      setLoadingRevenue(false);
    }
  }, []);

  useEffect(() => {
    fetchRevenue(startMonth, endMonth);
  }, [startMonth, endMonth, fetchRevenue]);

  function applyPreset(months: number) {
    setStartMonth(monthsAgo(months - 1));
    setEndMonth(today);
  }

  const isEmpty =
    !loadingInit && summary && summary.totalJobs === 0 && summary.monthlyRevenue === 0;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-brand-primary">Analisi</h1>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Overdue alert */}
      {!loadingInit && summary && summary.overdueInvoices > 0 && overdueVisible && (
        <OverdueWidget
          count={summary.overdueInvoices}
          onDismiss={() => setOverdueVisible(false)}
        />
      )}

      {/* Empty state hint */}
      {isEmpty && (
        <div className="rounded-lg border border-brand-border bg-white p-6 text-center shadow-sm">
          <p className="text-lg font-semibold text-brand-text">Benvenuto su CantiereSnap!</p>
          <p className="mt-1 text-sm text-brand-muted">
            Inizia creando il tuo primo lavoro dalla sezione Lavori.
          </p>
          <button
            onClick={() => router.push('/jobs')}
            className="mt-4 rounded-lg bg-brand-primary px-4 py-2 text-sm font-medium text-white hover:bg-brand-primary/90"
          >
            Vai ai Lavori →
          </button>
        </div>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {loadingInit ? (
          <>
            <KpiSkeleton />
            <KpiSkeleton />
            <KpiSkeleton />
            <KpiSkeleton />
          </>
        ) : summary ? (
          <>
            {/* Card 1: Fatturato mensile */}
            <KpiCard
              title="Fatturato Mensile"
              value={formatCurrency(summary.monthlyRevenue)}
              subtitle={getMonthLabel(summary.month)}
              icon={Euro}
              accentColor="bg-amber-500"
            />

            {/* Card 2: Tasso di completamento */}
            <KpiCard
              title="Tasso di Completamento"
              value={`${summary.completionRate}%`}
              subtitle={`${summary.completedJobs}/${summary.totalJobs} lavori`}
              icon={CheckCircle}
              accentColor="bg-teal-500"
            >
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
                <div
                  className="h-full rounded-full bg-teal-500 transition-all"
                  style={{ width: `${Math.min(summary.completionRate, 100)}%` }}
                />
              </div>
            </KpiCard>

            {/* Card 3: Tempo medio preventivo → fattura */}
            <KpiCard
              title="Preventivo → Fattura"
              value={
                summary.avgQuoteToInvoiceDays != null
                  ? `${summary.avgQuoteToInvoiceDays} giorni`
                  : 'N/D'
              }
              subtitle="dalla generazione preventivo all'emissione fattura"
              icon={Clock}
              accentColor="bg-slate-500"
            />

            {/* Card 4: Fatture scadute */}
            <KpiCard
              title="Fatture Scadute"
              value={summary.overdueInvoices === 0 ? 'Nessuna' : String(summary.overdueInvoices)}
              subtitle={summary.overdueInvoices > 0 ? 'Vedi dettagli →' : 'Tutto in ordine'}
              icon={AlertTriangle}
              accentColor={summary.overdueInvoices > 0 ? 'bg-red-500' : 'bg-teal-500'}
              onClick={
                summary.overdueInvoices > 0
                  ? () => router.push('/invoices?status=Overdue')
                  : undefined
              }
            />
          </>
        ) : null}
      </div>

      {/* Date range + Revenue chart */}
      <div className="rounded-lg bg-white p-5 shadow-sm">
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <h2 className="text-base font-semibold text-brand-text">Fatturato nel Tempo</h2>

          <div className="flex flex-wrap items-center gap-2 ml-auto">
            {/* Quick presets */}
            <button
              onClick={() => { setStartMonth(today); setEndMonth(today); }}
              className="rounded-md border border-brand-border px-2.5 py-1 text-xs text-brand-text hover:bg-gray-50"
            >
              Questo mese
            </button>
            <button
              onClick={() => applyPreset(3)}
              className="rounded-md border border-brand-border px-2.5 py-1 text-xs text-brand-text hover:bg-gray-50"
            >
              Ultimi 3 mesi
            </button>
            <button
              onClick={() => applyPreset(6)}
              className="rounded-md border border-brand-border px-2.5 py-1 text-xs text-brand-text hover:bg-gray-50"
            >
              Ultimi 6 mesi
            </button>
            <button
              onClick={() => applyPreset(12)}
              className="rounded-md border border-brand-border px-2.5 py-1 text-xs text-brand-text hover:bg-gray-50"
            >
              Ultimo anno
            </button>

            {/* Manual pickers */}
            <label className="flex items-center gap-1 text-xs text-brand-muted">
              Da
              <input
                type="month"
                value={startMonth}
                max={endMonth}
                onChange={(e) => setStartMonth(e.target.value)}
                className="rounded border border-brand-border px-2 py-1 text-xs text-brand-text"
              />
            </label>
            <label className="flex items-center gap-1 text-xs text-brand-muted">
              A
              <input
                type="month"
                value={endMonth}
                min={startMonth}
                max={today}
                onChange={(e) => setEndMonth(e.target.value)}
                className="rounded border border-brand-border px-2 py-1 text-xs text-brand-text"
              />
            </label>
          </div>
        </div>

        {loadingRevenue ? (
          <Skeleton className="h-[300px] w-full" />
        ) : revenue ? (
          <RevenueChart data={revenue} />
        ) : (
          <div className="flex h-[300px] items-center justify-center text-sm text-brand-muted">
            Nessun dato disponibile per il periodo selezionato
          </div>
        )}
      </div>

      {/* Bottom row: job distribution */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-lg bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-base font-semibold text-brand-text">Distribuzione Lavori</h2>
          {loadingInit ? (
            <Skeleton className="h-[250px] w-full" />
          ) : jobsStats ? (
            <JobDistributionChart data={jobsStats} />
          ) : null}
        </div>

        {/* Stats summary panel */}
        <div className="rounded-lg bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-base font-semibold text-brand-text">Riepilogo Stato Lavori</h2>
          {loadingInit ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : jobsStats ? (
            <div className="space-y-2">
              {Object.entries(jobsStats.byStatus).map(([status, count]) => {
                const pct = jobsStats.total > 0 ? (count / jobsStats.total) * 100 : 0;
                const STATUS_LABELS_MAP: Record<string, string> = {
                  Quote: 'Preventivo',
                  Accepted: 'Accettato',
                  InProgress: 'In Corso',
                  Completed: 'Completato',
                  Invoiced: 'Fatturato',
                  Cancelled: 'Annullato',
                };
                const STATUS_BAR_COLOR: Record<string, string> = {
                  Quote: 'bg-stone-400',
                  Accepted: 'bg-amber-500',
                  InProgress: 'bg-blue-500',
                  Completed: 'bg-teal-600',
                  Invoiced: 'bg-slate-800',
                  Cancelled: 'bg-red-400',
                };
                return (
                  <div key={status}>
                    <div className="mb-0.5 flex justify-between text-xs">
                      <span className="text-brand-text">{STATUS_LABELS_MAP[status] ?? status}</span>
                      <span className="font-medium text-brand-text">{count}</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
                      <div
                        className={`h-full rounded-full transition-all ${STATUS_BAR_COLOR[status] ?? 'bg-gray-400'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
              <p className="mt-3 text-right text-xs text-brand-muted">
                Totale: <span className="font-semibold text-brand-text">{jobsStats.total}</span>
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
