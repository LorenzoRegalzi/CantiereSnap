'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileText } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { ApiError } from '@/lib/api-client';
import { Invoice, Profile, QuoteItem } from '@/types';
import { formatCurrency } from '@/lib/format';
import Button from './ui/Button';
import Alert from './ui/Alert';
import Input from './ui/Input';

const VAT_RATES = [
  { value: 22, label: '22% — Aliquota ordinaria' },
  { value: 10, label: '10% — Aliquota ridotta' },
  { value: 5,  label: '5% — Aliquota super-ridotta' },
  { value: 4,  label: '4% — Aliquota minima' },
  { value: 0,  label: '0% — Esente IVA' },
];

interface Props {
  jobId: string;
  clientName: string;
  clientCodiceFiscale?: string;
  quoteItems: QuoteItem[];
  quoteTotal: number;
  onCreated: (invoice: Invoice) => void;
}

export default function InvoiceCreator({
  jobId,
  clientName,
  clientCodiceFiscale,
  quoteItems,
  quoteTotal,
  onCreated,
}: Props) {
  const router = useRouter();
  const [profileReady, setProfileReady] = useState<boolean | null>(null);
  const [vatRate, setVatRate] = useState(22);
  const [paymentTerms, setPaymentTerms] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const vatAmount = Math.round(quoteTotal * (vatRate / 100) * 100) / 100;
  const total = quoteTotal + vatAmount;
  const today = new Date().toISOString().split('T')[0];

  useEffect(() => {
    apiClient.get<Profile>('/profile').then(({ data }) => {
      const ok = !!(data.partitaIva && data.codiceFiscale && data.regimeFiscale && data.address?.city);
      setProfileReady(ok);
    }).catch(() => setProfileReady(false));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const { data } = await apiClient.post<Invoice>(`/jobs/${jobId}/invoice`, {
        vatRate,
        paymentTerms,
        dueDate,
        ...(notes ? { notes } : {}),
      });
      onCreated(data);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'INVALID_STATUS_TRANSITION') {
          setError("Il lavoro deve essere in stato 'Completato' per emettere fattura.");
        } else if (err.code === 'CONFLICT') {
          setError('Esiste già una fattura per questo lavoro.');
        } else if (err.code === 'VALIDATION_ERROR') {
          setError('Completa i dati fiscali nel profilo prima di emettere fatture.');
        } else {
          setError(err.message);
        }
      } else {
        setError('Errore durante la creazione della fattura.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (profileReady === null) {
    return <div className="h-8 animate-pulse rounded bg-stone-200" />;
  }

  if (!profileReady) {
    return (
      <div className="space-y-3">
        <Alert
          variant="error"
          message="Per emettere fatture è necessario completare i dati fiscali nel profilo."
        />
        <Button variant="outline" onClick={() => router.push('/profile')}>
          Completa Profilo
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Preview */}
      <div className="rounded-lg border border-brand-border bg-stone-50 p-4 space-y-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-brand-muted">
          Anteprima Fattura
        </h4>
        <div className="text-sm">
          <span className="font-medium text-brand-muted">Cliente: </span>
          <span className="text-brand-text">{clientName}</span>
          {clientCodiceFiscale && (
            <span className="text-brand-muted"> ({clientCodiceFiscale})</span>
          )}
        </div>

        {quoteItems.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-brand-border text-left text-brand-muted">
                  <th className="pb-1 pr-2 font-medium">Descrizione</th>
                  <th className="pb-1 pr-2 font-medium text-right">Qtà</th>
                  <th className="pb-1 pr-2 font-medium">U.M.</th>
                  <th className="pb-1 pr-2 font-medium text-right">Prezzo</th>
                  <th className="pb-1 font-medium text-right">Totale</th>
                </tr>
              </thead>
              <tbody>
                {quoteItems.map((item) => (
                  <tr key={item.seq} className="border-b border-brand-border/50">
                    <td className="py-1 pr-2 text-brand-text">{item.description}</td>
                    <td className="py-1 pr-2 text-right text-brand-muted">{item.quantity}</td>
                    <td className="py-1 pr-2 text-brand-muted">{item.unit}</td>
                    <td className="py-1 pr-2 text-right text-brand-muted">{formatCurrency(item.unitPrice)}</td>
                    <td className="py-1 text-right font-medium text-brand-text">{formatCurrency(item.lineTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="space-y-1 border-t border-brand-border pt-2 text-sm">
          <div className="flex justify-between">
            <span className="text-brand-muted">Imponibile</span>
            <span className="text-brand-text">{formatCurrency(quoteTotal)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-brand-muted">IVA {vatRate}%</span>
            <span className="text-brand-text">{formatCurrency(vatAmount)}</span>
          </div>
          <div className="flex justify-between font-semibold">
            <span className="text-brand-text">Totale</span>
            <span className="text-brand-text">{formatCurrency(total)}</span>
          </div>
        </div>
      </div>

      {error && <Alert variant="error" message={error} onDismiss={() => setError(null)} />}

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-brand-text">Aliquota IVA</label>
          <select
            value={vatRate}
            onChange={(e) => setVatRate(Number(e.target.value))}
            className="rounded-lg border border-brand-border bg-white px-3 py-2.5 text-sm text-brand-text focus:outline-none focus:ring-2 focus:ring-brand-accent focus:border-transparent"
          >
            {VAT_RATES.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </div>

        <Input
          label="Termini di pagamento"
          value={paymentTerms}
          onChange={(e) => setPaymentTerms(e.target.value)}
          placeholder="30 giorni data fattura"
          required
        />

        <Input
          label="Data scadenza"
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          min={today}
          required
        />

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-brand-text">Note (opzionale)</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Note aggiuntive per la fattura..."
            rows={3}
            className="rounded-lg border border-brand-border bg-white px-3 py-2.5 text-sm text-brand-text placeholder:text-brand-muted focus:outline-none focus:ring-2 focus:ring-brand-accent focus:border-transparent"
          />
        </div>

        <Button type="submit" loading={submitting}>
          <FileText className="h-4 w-4" />
          Emetti Fattura
        </Button>
      </form>
    </div>
  );
}
