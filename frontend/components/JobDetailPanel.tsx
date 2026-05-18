'use client';

import { useEffect, useState } from 'react';
import { X, MapPin, Calendar, ArrowRight, ChevronDown, ChevronUp } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { Job, JobDetails, JobStatus, Quote, QuoteItem } from '@/types';
import { STATUS_COLORS, STATUS_LABELS, NEXT_STATUS, ADVANCE_LABELS } from './JobCard';
import Alert from './ui/Alert';
import Button from './ui/Button';
import QuoteGenerator from './QuoteGenerator';
import QuoteEditor from './QuoteEditor';
import { formatCurrency } from '@/lib/format';

interface JobDetailPanelProps {
  job: Job;
  onClose: () => void;
  onStatusUpdated: (jobId: string, newStatus: JobStatus) => void;
}

// Skeleton line
function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-stone-200 ${className}`} />;
}

function DetailSkeleton() {
  return (
    <div className="space-y-4 p-6">
      <Skeleton className="h-6 w-40" />
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-px w-full" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-4 w-1/2" />
    </div>
  );
}

const QUOTE_STATUS_LABELS: Record<string, string> = {
  Draft: 'Bozza',
  Approved: 'Approvato',
  Sent: 'Inviato',
};

const QUOTE_STATUS_COLORS: Record<string, string> = {
  Draft: 'bg-amber-100 text-amber-800',
  Approved: 'bg-teal-100 text-teal-800',
  Sent: 'bg-blue-100 text-blue-800',
};

export default function JobDetailPanel({ job, onClose, onStatusUpdated }: JobDetailPanelProps) {
  const [details, setDetails] = useState<JobDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [advancing, setAdvancing] = useState(false);
  const [alert, setAlert] = useState<{ variant: 'success' | 'error'; message: string } | null>(null);
  const [quoteState, setQuoteState] = useState<{ quote: Quote; items: QuoteItem[] } | null>(null);
  const [quoteExpanded, setQuoteExpanded] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setDetails(null);

    apiClient
      .get<JobDetails>(`/jobs/${job.jobId}/details`)
      .then(({ data }) => {
        if (!cancelled) {
          setDetails(data);
          // If the details include a quote, seed the quote state
          if (data.quote) {
            setQuoteState({ quote: data.quote, items: (data.quote as unknown as { items?: QuoteItem[] }).items ?? [] });
          }
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [job.jobId]);

  const currentStatus = details?.status ?? job.status;
  const nextStatus = NEXT_STATUS[currentStatus];

  async function handleAdvance() {
    if (!nextStatus) return;
    setAdvancing(true);
    setAlert(null);

    try {
      await apiClient.patch(`/jobs/${job.jobId}/status`, { status: nextStatus });
      onStatusUpdated(job.jobId, nextStatus);
      // Refresh details
      const { data } = await apiClient.get<JobDetails>(`/jobs/${job.jobId}/details`);
      setDetails(data);
      setAlert({ variant: 'success', message: `Stato aggiornato: ${STATUS_LABELS[nextStatus]}` });
    } catch {
      setAlert({ variant: 'error', message: 'Errore durante l\'aggiornamento dello stato.' });
    } finally {
      setAdvancing(false);
    }
  }

  const formattedDate = job.targetDate
    ? new Date(job.targetDate).toLocaleDateString('it-IT', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/40"
        onClick={onClose}
      />

      {/* Panel — desktop: right slide-in; mobile: full screen */}
      <div className="fixed inset-y-0 right-0 z-50 flex w-full flex-col bg-white shadow-2xl md:w-[480px]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-brand-border px-6 py-4">
          <div>
            <h2 className="text-lg font-bold text-brand-primary">
              Lavoro #{job.jobIdFormatted}
            </h2>
            <span
              className={`mt-1 inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium text-white ${STATUS_COLORS[currentStatus]}`}
            >
              {STATUS_LABELS[currentStatus]}
            </span>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-brand-muted hover:bg-stone-100 hover:text-brand-text"
            aria-label="Chiudi"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <DetailSkeleton />
          ) : details ? (
            <div className="space-y-6 p-6">
              {/* Alert */}
              {alert && (
                <Alert
                  variant={alert.variant}
                  message={alert.message}
                  onDismiss={() => setAlert(null)}
                />
              )}

              {/* Client info */}
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-muted">
                  Cliente
                </h3>
                <div className="rounded-lg border border-brand-border bg-stone-50 p-4">
                  <p className="font-semibold text-brand-text">{details.clientName}</p>
                </div>
              </section>

              {/* Description */}
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-muted">
                  Descrizione
                </h3>
                <p className="text-sm text-brand-text">{details.description}</p>
              </section>

              {/* Address + date */}
              <section className="space-y-2">
                <div className="flex items-start gap-2 text-sm text-brand-muted">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-brand-accent" />
                  <span>{details.address}</span>
                </div>
                {formattedDate && (
                  <div className="flex items-center gap-2 text-sm text-brand-muted">
                    <Calendar className="h-4 w-4 shrink-0 text-brand-accent" />
                    <span>{formattedDate}</span>
                  </div>
                )}
              </section>

              {/* Advance status action */}
              {nextStatus && (
                <section>
                  <Button
                    onClick={handleAdvance}
                    loading={advancing}
                    className="w-full"
                  >
                    {ADVANCE_LABELS[currentStatus]}
                  </Button>
                </section>
              )}

              {/* Status timeline */}
              {details.statusHistory.length > 0 && (
                <section>
                  <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-brand-muted">
                    Cronologia stati
                  </h3>
                  <ol className="space-y-3">
                    {[...details.statusHistory].reverse().map((entry, i) => (
                      <li key={i} className="flex items-center gap-2 text-sm">
                        <span className="text-brand-text">{entry.fromStatus}</span>
                        <ArrowRight className="h-3.5 w-3.5 text-brand-muted" />
                        <span className="font-medium text-brand-text">{entry.toStatus}</span>
                        <span className="ml-auto text-xs text-brand-muted">
                          {new Date(entry.changedAt).toLocaleString('it-IT', {
                            day: 'numeric',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </li>
                    ))}
                  </ol>
                </section>
              )}

              {/* Preventivo section */}
              <section className="rounded-lg border border-brand-border">
                {/* Collapsible header */}
                <button
                  onClick={() => setQuoteExpanded((o) => !o)}
                  className="flex w-full items-center justify-between px-4 py-3 text-left"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-brand-muted">
                      Preventivo
                    </span>
                    {quoteState && (
                      <>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${QUOTE_STATUS_COLORS[quoteState.quote.status]}`}>
                          {QUOTE_STATUS_LABELS[quoteState.quote.status]}
                        </span>
                        <span className="text-xs font-semibold text-brand-text">
                          {formatCurrency(quoteState.quote.totalAmount)}
                        </span>
                      </>
                    )}
                  </div>
                  {quoteExpanded ? (
                    <ChevronUp className="h-4 w-4 text-brand-muted" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-brand-muted" />
                  )}
                </button>

                {quoteExpanded && (
                  <div className="border-t border-brand-border p-4">
                    {!quoteState ? (
                      <QuoteGenerator
                        jobId={job.jobId}
                        jobDescription={details.description || job.description}
                        onGenerated={(quote, items) => setQuoteState({ quote, items })}
                      />
                    ) : (
                      <QuoteEditor
                        jobId={job.jobId}
                        quote={quoteState.quote}
                        items={quoteState.items}
                        readOnly={quoteState.quote.status === 'Sent'}
                        onQuoteUpdated={(quote, items) => setQuoteState({ quote, items })}
                      />
                    )}
                  </div>
                )}
              </section>

              {/* Placeholder sections for future cards */}
              <section className="space-y-3">
                <div className="rounded-lg border border-dashed border-brand-border p-4">
                  <p className="text-xs font-semibold uppercase text-brand-muted">Foto</p>
                  <p className="mt-1 text-sm text-brand-muted">Nessuna foto caricata.</p>
                </div>
                <div className="rounded-lg border border-dashed border-brand-border p-4">
                  <p className="text-xs font-semibold uppercase text-brand-muted">Materiali</p>
                  <p className="mt-1 text-sm text-brand-muted">Nessun materiale registrato.</p>
                </div>
                <div className="rounded-lg border border-dashed border-brand-border p-4">
                  <p className="text-xs font-semibold uppercase text-brand-muted">Fattura</p>
                  <p className="mt-1 text-sm text-brand-muted">Nessuna fattura.</p>
                </div>
              </section>
            </div>
          ) : (
            <div className="p-6 text-sm text-brand-muted">
              Impossibile caricare i dettagli del lavoro.
            </div>
          )}
        </div>
      </div>
    </>
  );
}
