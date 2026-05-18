'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Search, ChevronRight, ChevronLeft } from 'lucide-react';
import apiClient, { ApiError } from '@/lib/api-client';
import { Client, Job } from '@/types';
import Input from './ui/Input';
import Button from './ui/Button';
import Alert from './ui/Alert';

interface CreateJobModalProps {
  onClose: () => void;
  onCreated: (job: Job) => void;
}

// Validation helpers
function validateClientForm(f: ClientForm) {
  const errs: Partial<ClientForm> = {};
  if (!f.clientName.trim()) errs.clientName = 'Nome obbligatorio';
  if (!f.email.trim() || !/\S+@\S+\.\S+/.test(f.email)) errs.email = 'Email non valida';
  if (!f.codiceFiscale.trim()) errs.codiceFiscale = 'Codice fiscale obbligatorio';
  if (!f.street.trim()) errs.street = 'Via obbligatoria';
  if (!f.city.trim()) errs.city = 'Città obbligatoria';
  if (!f.province.trim()) errs.province = 'Provincia obbligatoria';
  if (!f.cap.trim()) errs.cap = 'CAP obbligatorio';
  return errs;
}

interface ClientForm {
  clientName: string;
  email: string;
  phone: string;
  codiceFiscale: string;
  partitaIva: string;
  street: string;
  city: string;
  province: string;
  cap: string;
  country: string;
  [key: string]: string;
}

const emptyClientForm: ClientForm = {
  clientName: '',
  email: '',
  phone: '',
  codiceFiscale: '',
  partitaIva: '',
  street: '',
  city: '',
  province: '',
  cap: '',
  country: 'Italia',
};

interface JobForm {
  description: string;
  address: string;
  targetDate: string;
}

export default function CreateJobModal({ onClose, onCreated }: CreateJobModalProps) {
  const [step, setStep] = useState<1 | 2>(1);

  // Step 1 — client selection
  const [searchQuery, setSearchQuery] = useState('');
  const [clients, setClients] = useState<Client[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [showNewClientForm, setShowNewClientForm] = useState(false);
  const [clientForm, setClientForm] = useState<ClientForm>(emptyClientForm);
  const [clientFormErrors, setClientFormErrors] = useState<Partial<ClientForm>>({});
  const [clientSaving, setClientSaving] = useState(false);
  const [clientError, setClientError] = useState('');

  // Step 2 — job details
  const [jobForm, setJobForm] = useState<JobForm>({ description: '', address: '', targetDate: '' });
  const [jobFormErrors, setJobFormErrors] = useState<Partial<JobForm>>({});
  const [jobSaving, setJobSaving] = useState(false);
  const [jobError, setJobError] = useState('');

  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const searchClients = useCallback((q: string) => {
    if (!q.trim()) {
      setClients([]);
      return;
    }
    setSearchLoading(true);
    apiClient
      .get<{ items: Client[] }>('/clients', { params: { search: q, limit: 8 } })
      .then(({ data }) => setClients(data.items))
      .catch(() => setClients([]))
      .finally(() => setSearchLoading(false));
  }, []);

  useEffect(() => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => searchClients(searchQuery), 300);
    return () => {
      if (searchTimeout.current) clearTimeout(searchTimeout.current);
    };
  }, [searchQuery, searchClients]);

  async function handleCreateClient() {
    const errs = validateClientForm(clientForm);
    if (Object.keys(errs).length > 0) {
      setClientFormErrors(errs);
      return;
    }
    setClientSaving(true);
    setClientError('');
    try {
      const { data } = await apiClient.post<Client>('/clients', {
        clientName: clientForm.clientName,
        email: clientForm.email,
        phone: clientForm.phone || undefined,
        codiceFiscale: clientForm.codiceFiscale,
        partitaIva: clientForm.partitaIva || undefined,
        address: {
          street: clientForm.street,
          city: clientForm.city,
          province: clientForm.province,
          cap: clientForm.cap,
          country: clientForm.country,
        },
      });
      setSelectedClient(data);
      setShowNewClientForm(false);
      setStep(2);
    } catch (err) {
      if (err instanceof ApiError && err.field) {
        setClientFormErrors({ [err.field]: err.message });
      } else {
        setClientError('Errore durante la creazione del cliente. Riprova.');
      }
    } finally {
      setClientSaving(false);
    }
  }

  function validateJobForm(): boolean {
    const errs: Partial<JobForm> = {};
    if (!jobForm.description.trim() || jobForm.description.trim().length < 20)
      errs.description = 'La descrizione deve avere almeno 20 caratteri (necessario per la generazione del preventivo AI).';
    if (!jobForm.address.trim() || jobForm.address.trim().length < 5)
      errs.address = 'Indirizzo obbligatorio (min. 5 caratteri)';
    if (!jobForm.targetDate) errs.targetDate = 'Data prevista obbligatoria';
    setJobFormErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleCreateJob() {
    if (!selectedClient || !validateJobForm()) return;
    setJobSaving(true);
    setJobError('');
    try {
      const { data } = await apiClient.post<Job>('/jobs', {
        clientId: selectedClient.clientId,
        description: jobForm.description,
        address: jobForm.address,
        targetDate: jobForm.targetDate,
      });
      onCreated(data);
    } catch {
      setJobError('Errore durante la creazione del lavoro. Riprova.');
    } finally {
      setJobSaving(false);
    }
  }

  const today = new Date().toISOString().split('T')[0];

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/50" onClick={onClose} />

      {/* Modal */}
      <div className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-brand-border px-6 py-4">
          <h2 className="text-lg font-bold text-brand-primary">
            {step === 1 ? 'Seleziona Cliente' : 'Dettagli Lavoro'}
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-brand-muted hover:bg-stone-100 hover:text-brand-text"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Step indicators */}
        <div className="flex gap-0 border-b border-brand-border">
          {[1, 2].map((s) => (
            <div
              key={s}
              className={`flex-1 py-2 text-center text-xs font-medium ${
                step === s
                  ? 'border-b-2 border-brand-accent text-brand-accent'
                  : 'text-brand-muted'
              }`}
            >
              Passo {s}
            </div>
          ))}
        </div>

        <div className="max-h-[70vh] overflow-y-auto p-6">
          {step === 1 && (
            <div className="space-y-4">
              {!showNewClientForm ? (
                <>
                  {/* Search */}
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-muted" />
                    <input
                      type="text"
                      placeholder="Cerca per nome, email o codice fiscale..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full rounded-lg border border-brand-border py-2.5 pl-9 pr-3 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-brand-accent"
                    />
                  </div>

                  {/* Results */}
                  {searchLoading && (
                    <p className="text-center text-sm text-brand-muted">Ricerca...</p>
                  )}
                  {!searchLoading && searchQuery && clients.length === 0 && (
                    <p className="text-center text-sm text-brand-muted">
                      Nessun cliente trovato.
                    </p>
                  )}
                  {clients.length > 0 && (
                    <ul className="divide-y divide-brand-border rounded-lg border border-brand-border">
                      {clients.map((c) => (
                        <li key={c.clientId}>
                          <button
                            onClick={() => {
                              setSelectedClient(c);
                              setStep(2);
                            }}
                            className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-stone-50"
                          >
                            <div>
                              <p className="font-medium text-brand-text">{c.clientName}</p>
                              <p className="text-xs text-brand-muted">
                                {c.email} · {c.codiceFiscale}
                              </p>
                            </div>
                            <ChevronRight className="h-4 w-4 text-brand-muted" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}

                  <button
                    onClick={() => setShowNewClientForm(true)}
                    className="w-full text-center text-sm font-medium text-brand-accent hover:underline"
                  >
                    + Nuovo cliente
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => setShowNewClientForm(false)}
                    className="flex items-center gap-1 text-sm text-brand-muted hover:text-brand-text"
                  >
                    <ChevronLeft className="h-4 w-4" /> Torna alla ricerca
                  </button>

                  {clientError && (
                    <Alert variant="error" message={clientError} onDismiss={() => setClientError('')} />
                  )}

                  <div className="space-y-3">
                    <Input
                      label="Nome completo *"
                      value={clientForm.clientName}
                      onChange={(e) => setClientForm({ ...clientForm, clientName: e.target.value })}
                      error={clientFormErrors.clientName}
                    />
                    <Input
                      label="Email *"
                      type="email"
                      value={clientForm.email}
                      onChange={(e) => setClientForm({ ...clientForm, email: e.target.value })}
                      error={clientFormErrors.email}
                    />
                    <Input
                      label="Telefono"
                      type="tel"
                      value={clientForm.phone}
                      onChange={(e) => setClientForm({ ...clientForm, phone: e.target.value })}
                    />
                    <Input
                      label="Codice Fiscale *"
                      value={clientForm.codiceFiscale}
                      onChange={(e) => setClientForm({ ...clientForm, codiceFiscale: e.target.value })}
                      error={clientFormErrors.codiceFiscale}
                    />
                    <Input
                      label="Partita IVA"
                      value={clientForm.partitaIva}
                      onChange={(e) => setClientForm({ ...clientForm, partitaIva: e.target.value })}
                    />
                    <p className="text-xs font-semibold uppercase text-brand-muted">Indirizzo</p>
                    <Input
                      label="Via *"
                      value={clientForm.street}
                      onChange={(e) => setClientForm({ ...clientForm, street: e.target.value })}
                      error={clientFormErrors.street}
                    />
                    <div className="grid grid-cols-2 gap-3">
                      <Input
                        label="Città *"
                        value={clientForm.city}
                        onChange={(e) => setClientForm({ ...clientForm, city: e.target.value })}
                        error={clientFormErrors.city}
                      />
                      <Input
                        label="Provincia *"
                        value={clientForm.province}
                        onChange={(e) => setClientForm({ ...clientForm, province: e.target.value })}
                        error={clientFormErrors.province}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <Input
                        label="CAP *"
                        value={clientForm.cap}
                        onChange={(e) => setClientForm({ ...clientForm, cap: e.target.value })}
                        error={clientFormErrors.cap}
                      />
                      <Input
                        label="Paese"
                        value={clientForm.country}
                        onChange={(e) => setClientForm({ ...clientForm, country: e.target.value })}
                      />
                    </div>
                  </div>

                  <Button onClick={handleCreateClient} loading={clientSaving}>
                    Crea cliente e continua
                  </Button>
                </>
              )}
            </div>
          )}

          {step === 2 && selectedClient && (
            <div className="space-y-4">
              {/* Selected client card */}
              <div className="flex items-center justify-between rounded-lg border border-brand-border bg-stone-50 px-4 py-3">
                <div>
                  <p className="font-medium text-brand-text">{selectedClient.clientName}</p>
                  <p className="text-xs text-brand-muted">{selectedClient.email}</p>
                </div>
                <button
                  onClick={() => setStep(1)}
                  className="text-xs font-medium text-brand-accent hover:underline"
                >
                  Cambia
                </button>
              </div>

              {jobError && (
                <Alert variant="error" message={jobError} onDismiss={() => setJobError('')} />
              )}

              <div className="space-y-3">
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-brand-text">
                    Descrizione lavoro *
                  </label>
                  <textarea
                    rows={4}
                    placeholder="Descrivi il lavoro da eseguire..."
                    value={jobForm.description}
                    onChange={(e) => setJobForm({ ...jobForm, description: e.target.value })}
                    className={`rounded-lg border px-3 py-2.5 text-sm placeholder:text-brand-muted focus:border-transparent focus:outline-none focus:ring-2 focus:ring-brand-accent ${
                      jobFormErrors.description ? 'border-red-400 bg-red-50' : 'border-brand-border'
                    }`}
                  />
                  {jobFormErrors.description && (
                    <p className="text-xs text-red-600">{jobFormErrors.description}</p>
                  )}
                </div>

                <Input
                  label="Indirizzo cantiere *"
                  placeholder="Via Roma 42, Carmagnola (TO)"
                  value={jobForm.address}
                  onChange={(e) => setJobForm({ ...jobForm, address: e.target.value })}
                  error={jobFormErrors.address}
                />

                <Input
                  label="Data prevista *"
                  type="date"
                  min={today}
                  value={jobForm.targetDate}
                  onChange={(e) => setJobForm({ ...jobForm, targetDate: e.target.value })}
                  error={jobFormErrors.targetDate}
                />
              </div>

              <Button onClick={handleCreateJob} loading={jobSaving}>
                Crea Lavoro
              </Button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
