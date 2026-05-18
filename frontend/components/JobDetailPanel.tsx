'use client';

import { useEffect, useState } from 'react';
import { X, MapPin, Calendar, ArrowRight, ChevronDown, ChevronUp } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { Invoice, Job, JobDetails, JobStatus, Material, Photo, Quote, QuoteItem } from '@/types';
import { STATUS_COLORS, STATUS_LABELS, NEXT_STATUS, ADVANCE_LABELS } from './JobCard';
import Alert from './ui/Alert';
import Button from './ui/Button';
import QuoteGenerator from './QuoteGenerator';
import QuoteEditor from './QuoteEditor';
import PhotoGallery from './PhotoGallery';
import PhotoLightbox from './PhotoLightbox';
import PhotoUpload from './PhotoUpload';
import MaterialsSection from './MaterialsSection';
import ReceiptScanner from './ReceiptScanner';
import InvoiceCreator from './InvoiceCreator';
import InvoiceViewer from './InvoiceViewer';
import { formatCurrency } from '@/lib/format';

interface JobDetailPanelProps {
  job: Job;
  onClose: () => void;
  onStatusUpdated: (jobId: string, newStatus: JobStatus) => void;
}

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

function SectionHeader({
  label,
  expanded,
  onToggle,
  badge,
}: {
  label: string;
  expanded: boolean;
  onToggle: () => void;
  badge?: React.ReactNode;
}) {
  return (
    <button
      onClick={onToggle}
      className="flex w-full items-center justify-between px-4 py-3 text-left"
    >
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-brand-muted">{label}</span>
        {badge}
      </div>
      {expanded ? (
        <ChevronUp className="h-4 w-4 text-brand-muted" />
      ) : (
        <ChevronDown className="h-4 w-4 text-brand-muted" />
      )}
    </button>
  );
}

export default function JobDetailPanel({ job, onClose, onStatusUpdated }: JobDetailPanelProps) {
  const [details, setDetails] = useState<JobDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [advancing, setAdvancing] = useState(false);
  const [alert, setAlert] = useState<{ variant: 'success' | 'error'; message: string } | null>(null);
  const [quoteState, setQuoteState] = useState<{ quote: Quote; items: QuoteItem[] } | null>(null);

  // Collapsible section state
  const [quoteExpanded, setQuoteExpanded] = useState(true);
  const [photosExpanded, setPhotosExpanded] = useState(true);
  const [materialsExpanded, setMaterialsExpanded] = useState(false);
  const [invoiceExpanded, setInvoiceExpanded] = useState(false);

  // Photos state
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);

  // Materials state
  const [materials, setMaterials] = useState<Material[]>([]);
  const [materialsTotalCost, setMaterialsTotalCost] = useState(0);

  // Invoice state
  const [invoice, setInvoice] = useState<Invoice | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setDetails(null);

    apiClient
      .get<JobDetails>(`/jobs/${job.jobId}/details`)
      .then(({ data }) => {
        if (!cancelled) {
          setDetails(data);
          if (data.quote) {
            setQuoteState({ quote: data.quote, items: (data.quote as unknown as { items?: QuoteItem[] }).items ?? [] });
          }
          setPhotos(data.photos ?? []);
          setMaterials(data.materials ?? []);
          setMaterialsTotalCost(data.materialsTotalCost ?? 0);
          setInvoice(data.invoice ?? null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
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
      const { data } = await apiClient.get<JobDetails>(`/jobs/${job.jobId}/details`);
      setDetails(data);
      setAlert({ variant: 'success', message: `Stato aggiornato: ${STATUS_LABELS[nextStatus]}` });
    } catch {
      setAlert({ variant: 'error', message: 'Errore durante l\'aggiornamento dello stato.' });
    } finally {
      setAdvancing(false);
    }
  }

  function handlePhotoUploaded(photo: Photo) {
    setPhotos((prev) => [photo, ...prev]);
    setPhotosExpanded(true);
  }

  function handlePhotoUpdated(updated: Photo) {
    setPhotos((prev) => prev.map((p) => (p.photoId === updated.photoId ? updated : p)));
  }

  function handleMaterialsChanged(items: Material[], totalCost: number) {
    setMaterials(items);
    setMaterialsTotalCost(totalCost);
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
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />

      {/* Panel */}
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
              {alert && (
                <Alert variant={alert.variant} message={alert.message} onDismiss={() => setAlert(null)} />
              )}

              {/* Client */}
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-muted">Cliente</h3>
                <div className="rounded-lg border border-brand-border bg-stone-50 p-4">
                  <p className="font-semibold text-brand-text">{details.clientName}</p>
                </div>
              </section>

              {/* Description */}
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-muted">Descrizione</h3>
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

              {/* Advance status */}
              {nextStatus && (
                <section>
                  <Button onClick={handleAdvance} loading={advancing} className="w-full">
                    {ADVANCE_LABELS[currentStatus]}
                  </Button>
                </section>
              )}

              {/* Status timeline */}
              {details.statusHistory.length > 0 && (
                <section>
                  <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-brand-muted">Cronologia stati</h3>
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

              {/* Preventivo */}
              <section className="rounded-lg border border-brand-border">
                <SectionHeader
                  label="Preventivo"
                  expanded={quoteExpanded}
                  onToggle={() => setQuoteExpanded((o) => !o)}
                  badge={
                    quoteState ? (
                      <>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${QUOTE_STATUS_COLORS[quoteState.quote.status]}`}>
                          {QUOTE_STATUS_LABELS[quoteState.quote.status]}
                        </span>
                        <span className="text-xs font-semibold text-brand-text">
                          {formatCurrency(quoteState.quote.totalAmount)}
                        </span>
                      </>
                    ) : null
                  }
                />
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

              {/* Foto */}
              <section className="rounded-lg border border-brand-border">
                <SectionHeader
                  label="Foto"
                  expanded={photosExpanded}
                  onToggle={() => setPhotosExpanded((o) => !o)}
                  badge={
                    photos.length > 0 ? (
                      <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-brand-muted">
                        {photos.length}
                      </span>
                    ) : null
                  }
                />
                {photosExpanded && (
                  <div className="border-t border-brand-border p-4 space-y-3">
                    <PhotoUpload jobId={job.jobId} onUploaded={handlePhotoUploaded} />
                    <PhotoGallery
                      photos={photos}
                      onPhotoClick={(idx) => setLightboxIdx(idx)}
                    />
                  </div>
                )}
              </section>

              {/* Materiali */}
              <section className="rounded-lg border border-brand-border">
                <SectionHeader
                  label="Materiali"
                  expanded={materialsExpanded}
                  onToggle={() => setMaterialsExpanded((o) => !o)}
                  badge={
                    materials.length > 0 ? (
                      <>
                        <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-brand-muted">
                          {materials.length}
                        </span>
                        <span className="text-xs font-semibold text-brand-text">
                          {formatCurrency(materialsTotalCost)}
                        </span>
                      </>
                    ) : null
                  }
                />
                {materialsExpanded && (
                  <div className="border-t border-brand-border p-4 space-y-3">
                    <ReceiptScanner
                      jobId={job.jobId}
                      onScanned={(items, totalCost) => {
                        handleMaterialsChanged(items, totalCost);
                        setMaterialsExpanded(true);
                      }}
                    />
                    <MaterialsSection
                      jobId={job.jobId}
                      initialItems={materials}
                      initialTotalCost={materialsTotalCost}
                      onMaterialsChanged={handleMaterialsChanged}
                    />
                  </div>
                )}
              </section>

              {/* Fattura */}
              <section className="rounded-lg border border-brand-border">
                <SectionHeader
                  label="Fattura"
                  expanded={invoiceExpanded}
                  onToggle={() => setInvoiceExpanded((o) => !o)}
                  badge={
                    invoice ? (
                      <>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          invoice.status === 'Draft' ? 'bg-stone-100 text-stone-600'
                          : invoice.status === 'Sent' ? 'bg-blue-100 text-blue-700'
                          : invoice.status === 'Paid' ? 'bg-teal-100 text-teal-700'
                          : 'bg-red-100 text-red-700'
                        }`}>
                          {invoice.status === 'Draft' ? 'Bozza'
                            : invoice.status === 'Sent' ? 'Inviata'
                            : invoice.status === 'Paid' ? 'Pagata'
                            : 'Scaduta'}
                        </span>
                        <span className="text-xs font-semibold text-brand-text">
                          {formatCurrency(invoice.totalAmount)}
                        </span>
                      </>
                    ) : null
                  }
                />
                {invoiceExpanded && (
                  <div className="border-t border-brand-border p-4">
                    {invoice ? (
                      <InvoiceViewer
                        jobId={job.jobId}
                        invoice={invoice}
                        onStatusChanged={(updated) => {
                          setInvoice(updated);
                          if (updated.status === 'Paid') {
                            onStatusUpdated(job.jobId, currentStatus);
                          }
                        }}
                      />
                    ) : currentStatus === 'Completed' ? (
                      <InvoiceCreator
                        jobId={job.jobId}
                        clientName={details.clientName}
                        quoteItems={quoteState?.items ?? []}
                        quoteTotal={quoteState?.quote.totalAmount ?? 0}
                        onCreated={(newInvoice) => {
                          setInvoice(newInvoice);
                          onStatusUpdated(job.jobId, 'Invoiced');
                        }}
                      />
                    ) : (
                      <p className="text-sm text-brand-muted">
                        La fattura può essere emessa quando il lavoro è completato.{' '}
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium text-white ${STATUS_COLORS[currentStatus]}`}>
                          {STATUS_LABELS[currentStatus]}
                        </span>
                      </p>
                    )}
                  </div>
                )}
              </section>
            </div>
          ) : (
            <div className="p-6 text-sm text-brand-muted">
              Impossibile caricare i dettagli del lavoro.
            </div>
          )}
        </div>
      </div>

      {/* Lightbox — rendered outside the panel to cover the full screen */}
      {lightboxIdx !== null && photos.length > 0 && (
        <PhotoLightbox
          photos={photos}
          initialIndex={lightboxIdx}
          onClose={() => setLightboxIdx(null)}
          onPhotoUpdated={handlePhotoUpdated}
        />
      )}
    </>
  );
}
