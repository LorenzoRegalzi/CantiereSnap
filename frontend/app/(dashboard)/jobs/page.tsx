'use client';

import { useState, useEffect, useRef } from 'react';
import { Plus, SlidersHorizontal, X } from 'lucide-react';
import { fetchAllPages } from '@/lib/api-client';
import { Job, JobStatus } from '@/types';
import JobCard, { STATUS_LABELS, STATUS_COLORS } from '@/components/JobCard';
import JobDetailPanel from '@/components/JobDetailPanel';
import CreateJobModal from '@/components/CreateJobModal';
import Alert from '@/components/ui/Alert';

const ALL_STATUSES: JobStatus[] = ['Quote', 'Accepted', 'InProgress', 'Completed', 'Invoiced'];

// Skeleton card for loading state
function SkeletonCard() {
  return (
    <div className="animate-pulse rounded-lg border border-brand-border bg-white p-4 shadow-sm">
      <div className="mb-2 flex justify-between">
        <div className="h-3 w-12 rounded bg-stone-200" />
        <div className="h-3 w-3 rounded-full bg-stone-200" />
      </div>
      <div className="mb-1 h-4 w-3/4 rounded bg-stone-200" />
      <div className="mb-3 h-3 w-full rounded bg-stone-200" />
      <div className="h-3 w-1/2 rounded bg-stone-200" />
    </div>
  );
}

function KanbanColumn({
  status,
  jobs,
  loading,
  onCardClick,
}: {
  status: JobStatus;
  jobs: Job[];
  loading: boolean;
  onCardClick: (job: Job) => void;
}) {
  return (
    <div className="flex shrink-0 flex-col" style={{ minWidth: 260, width: 260 }}>
      {/* Column header */}
      <div className="mb-3 flex items-center gap-2">
        <span className={`h-2.5 w-2.5 rounded-full ${STATUS_COLORS[status]}`} />
        <h2 className="text-sm font-semibold text-brand-text">{STATUS_LABELS[status]}</h2>
        <span className="ml-auto rounded-full bg-stone-200 px-2 py-0.5 text-xs font-medium text-brand-muted">
          {loading ? '—' : jobs.length}
        </span>
      </div>

      {/* Cards */}
      <div className="space-y-3 overflow-y-auto pb-4" style={{ maxHeight: 'calc(100vh - 220px)' }}>
        {loading ? (
          <>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </>
        ) : (
          jobs.map((job) => (
            <JobCard key={job.jobId} job={job} onClick={onCardClick} />
          ))
        )}
      </div>
    </div>
  );
}

export default function JobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [successAlert, setSuccessAlert] = useState('');

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [activeStatuses, setActiveStatuses] = useState<JobStatus[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // Panel / modal state
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);

  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce search input
  useEffect(() => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => {
      if (searchTimeout.current) clearTimeout(searchTimeout.current);
    };
  }, [searchQuery]);

  // Fetch whenever any filter changes. Cancellation flag prevents stale responses
  // from a slow request overwriting results from a faster subsequent one.
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const params: Record<string, string> = {};
        if (debouncedSearch) params.search = debouncedSearch;
        if (startDate) params.startDate = startDate;
        if (endDate) params.endDate = endDate;
        // Omit status entirely when no chips are selected — returns all jobs
        if (activeStatuses.length > 0) params.status = activeStatuses.join(',');

        const items = await fetchAllPages<Job>('/jobs', params);
        if (!cancelled) setJobs(items);
      } catch {
        if (!cancelled) setJobs([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [debouncedSearch, startDate, endDate, activeStatuses, refreshKey]);

  // Group API-returned jobs into columns by status
  function getColumnJobs(status: JobStatus): Job[] {
    return jobs.filter((j) => j.status === status);
  }

  function toggleStatus(s: JobStatus) {
    setActiveStatuses((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
    );
  }

  function handleStatusUpdated(jobId: string, newStatus: JobStatus) {
    setJobs((prev) =>
      prev.map((j) => (j.jobId === jobId ? { ...j, status: newStatus } : j))
    );
    // Update the selected job too so the panel shows the new status instantly
    setSelectedJob((prev) => (prev?.jobId === jobId ? { ...prev, status: newStatus } : prev));
    // Background re-fetch to confirm server state
    setRefreshKey((k) => k + 1);
  }

  function handleJobCreated(job: Job) {
    setJobs((prev) => [job, ...prev]);
    setCreateModalOpen(false);
    setSuccessAlert(`Lavoro #${job.jobIdFormatted} creato con successo`);
  }

  const isEmpty = !loading && jobs.length === 0;

  return (
    <div className="flex h-full flex-col">
      {/* Page header */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-brand-primary">I Miei Lavori</h1>
        <button
          onClick={() => setCreateModalOpen(true)}
          className="flex items-center gap-2 rounded-lg bg-brand-accent px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
        >
          <Plus className="h-4 w-4" />
          Nuovo Lavoro
        </button>
      </div>

      {/* Success alert */}
      {successAlert && (
        <div className="mb-4">
          <Alert variant="success" message={successAlert} onDismiss={() => setSuccessAlert('')} />
        </div>
      )}

      {/* Filter bar */}
      <div className="mb-4 space-y-3">
        {/* Search row */}
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Cerca per cliente o descrizione..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1 rounded-lg border border-brand-border bg-white px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-brand-accent"
          />
          {/* Mobile filters toggle */}
          <button
            onClick={() => setFiltersOpen((o) => !o)}
            className="flex items-center gap-1 rounded-lg border border-brand-border bg-white px-3 py-2 text-sm text-brand-muted hover:text-brand-text md:hidden"
          >
            {filtersOpen ? <X className="h-4 w-4" /> : <SlidersHorizontal className="h-4 w-4" />}
            Filtri
          </button>
        </div>

        {/* Extended filters — always visible on md+, toggled on mobile */}
        <div className={`space-y-3 ${filtersOpen ? 'block' : 'hidden md:block'}`}>
          {/* Date range */}
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-brand-muted">Da</span>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="rounded-lg border border-brand-border bg-white px-3 py-1.5 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-brand-accent"
            />
            <span className="text-brand-muted">A</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="rounded-lg border border-brand-border bg-white px-3 py-1.5 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-brand-accent"
            />
          </div>

          {/* Status chips */}
          <div className="flex flex-wrap gap-2">
            {ALL_STATUSES.map((s) => {
              const active = activeStatuses.includes(s);
              return (
                <button
                  key={s}
                  onClick={() => toggleStatus(s)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    active
                      ? 'border-brand-primary bg-brand-primary text-white'
                      : 'border-brand-border bg-white text-brand-muted hover:border-brand-primary hover:text-brand-text'
                  }`}
                >
                  {STATUS_LABELS[s]}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Empty state */}
      {isEmpty && (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 py-16 text-center">
          <p className="text-brand-muted">
            Non hai ancora nessun lavoro. Crea il tuo primo lavoro!
          </p>
          <button
            onClick={() => setCreateModalOpen(true)}
            className="flex items-center gap-2 rounded-lg bg-brand-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
          >
            <Plus className="h-4 w-4" />
            Nuovo Lavoro
          </button>
        </div>
      )}

      {/* Kanban board */}
      {!isEmpty && (
        <div className="flex flex-1 gap-4 overflow-x-auto pb-4" style={{ scrollSnapType: 'x mandatory' }}>
          {ALL_STATUSES.map((status) => (
            <div key={status} style={{ scrollSnapAlign: 'start' }}>
              <KanbanColumn
                status={status}
                jobs={getColumnJobs(status)}
                loading={loading}
                onCardClick={setSelectedJob}
              />
            </div>
          ))}
        </div>
      )}

      {/* Job detail panel */}
      {selectedJob && (
        <JobDetailPanel
          job={selectedJob}
          onClose={() => setSelectedJob(null)}
          onStatusUpdated={handleStatusUpdated}
        />
      )}

      {/* Create job modal */}
      {createModalOpen && (
        <CreateJobModal
          onClose={() => setCreateModalOpen(false)}
          onCreated={handleJobCreated}
        />
      )}
    </div>
  );
}
