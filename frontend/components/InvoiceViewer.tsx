'use client';

import { useState } from 'react';
import { Download, Send, CheckCircle, AlertTriangle } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { ApiError } from '@/lib/api-client';
import { Invoice } from '@/types';
import { formatCurrency, formatDate } from '@/lib/format';
import Button from './ui/Button';
import Alert from './ui/Alert';
import Input from './ui/Input';

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

interface Props {
  jobId: string;
  invoice: Invoice;
  onStatusChanged: (updated: Invoice) => void;
}

export default function InvoiceViewer({ jobId, invoice, onStatusChanged }: Props) {
  const [updating, setUpdating] = useState(false);
  const [sending, setSending] = useState(false);
  const [showSendForm, setShowSendForm] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState('');
  const [sendMessage, setSendMessage] = useState('');
  const [alert, setAlert] = useState<{ variant: 'success' | 'error'; message: string } | null>(null);

  const subtotal = invoice.totalAmount - invoice.vatAmount;
  const dueDateObj = invoice.dueDate ? new Date(invoice.dueDate) : null;
  const overdueDays = dueDateObj
    ? Math.max(0, Math.floor((Date.now() - dueDateObj.getTime()) / 86400000))
    : 0;
  const isPastDue = dueDateObj ? dueDateObj.getTime() < Date.now() : false;

  async function patchStatus(status: Invoice['status']) {
    setUpdating(true);
    setAlert(null);
    try {
      await apiClient.patch(`/jobs/${jobId}/invoice/status`, { status });
      const { data } = await apiClient.get<Invoice>(`/jobs/${jobId}/invoice`);
      onStatusChanged(data);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Errore durante l\'aggiornamento.';
      setAlert({ variant: 'error', message: msg });
    } finally {
      setUpdating(false);
    }
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    setAlert(null);
    try {
      await apiClient.post(`/jobs/${jobId}/invoice/send`, {
        ...(recipientEmail ? { recipientEmail } : {}),
        ...(sendMessage ? { message: sendMessage } : {}),
      });
      const { data } = await apiClient.get<Invoice>(`/jobs/${jobId}/invoice`);
      onStatusChanged(data);
      setShowSendForm(false);
      setAlert({ variant: 'success', message: 'Fattura inviata al cliente.' });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Errore durante l\'invio.';
      setAlert({ variant: 'error', message: msg });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <p className="text-lg font-bold text-brand-text">
            Fattura n. {invoice.invoiceNumber}
          </p>
          <p className="text-xs text-brand-muted">
            Emessa il {formatDate(invoice.createdAt)}
          </p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_COLORS[invoice.status]}`}>
          {STATUS_LABELS[invoice.status]}
        </span>
      </div>

      {alert && <Alert variant={alert.variant} message={alert.message} onDismiss={() => setAlert(null)} />}

      {/* Overdue banners */}
      {invoice.status === 'Overdue' && (
        <div className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Fattura scaduta! Pagamento in ritardo di {overdueDays} giorni.
        </div>
      )}
      {invoice.status === 'Sent' && isPastDue && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-700">
          Scaduta da {overdueDays} giorni
        </div>
      )}

      {/* Client */}
      <div className="text-sm">
        <span className="font-medium text-brand-muted">Cliente: </span>
        <span className="text-brand-text">{invoice.clientName}</span>
      </div>

      {/* Line items */}
      {invoice.items?.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-brand-border">
          <table className="w-full text-xs">
            <thead className="bg-stone-50">
              <tr className="border-b border-brand-border text-left text-brand-muted">
                <th className="px-3 py-2 font-medium">Descrizione</th>
                <th className="px-3 py-2 font-medium text-right">Qtà</th>
                <th className="px-3 py-2 font-medium">U.M.</th>
                <th className="px-3 py-2 font-medium text-right">Prezzo</th>
                <th className="px-3 py-2 font-medium text-right">Totale</th>
              </tr>
            </thead>
            <tbody>
              {invoice.items.map((item) => (
                <tr key={item.seq} className="border-b border-brand-border/50 last:border-0">
                  <td className="px-3 py-2 text-brand-text">{item.description}</td>
                  <td className="px-3 py-2 text-right text-brand-muted">{item.quantity}</td>
                  <td className="px-3 py-2 text-brand-muted">{item.unit}</td>
                  <td className="px-3 py-2 text-right text-brand-muted">{formatCurrency(item.unitPrice)}</td>
                  <td className="px-3 py-2 text-right font-medium text-brand-text">{formatCurrency(item.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Totals */}
      <div className="space-y-1 rounded-lg border border-brand-border bg-stone-50 p-3 text-sm">
        <div className="flex justify-between">
          <span className="text-brand-muted">Imponibile</span>
          <span className="text-brand-text">{formatCurrency(subtotal)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-brand-muted">IVA {invoice.vatRate}%</span>
          <span className="text-brand-text">{formatCurrency(invoice.vatAmount)}</span>
        </div>
        <div className="flex justify-between border-t border-brand-border pt-1 font-semibold">
          <span className="text-brand-text">Totale</span>
          <span className="text-brand-text">{formatCurrency(invoice.totalAmount)}</span>
        </div>
      </div>

      {/* Payment info */}
      <div className="space-y-1 text-sm">
        {invoice.paymentTerms && (
          <div>
            <span className="text-brand-muted">Termini: </span>
            <span className="text-brand-text">{invoice.paymentTerms}</span>
          </div>
        )}
        {invoice.dueDate && (
          <div>
            <span className="text-brand-muted">Scadenza: </span>
            <span className={isPastDue && invoice.status !== 'Paid' ? 'font-medium text-red-600' : 'text-brand-text'}>
              {formatDate(invoice.dueDate)}
            </span>
          </div>
        )}
        {invoice.paidAt && (
          <div className="flex items-center gap-1.5 text-teal-700">
            <CheckCircle className="h-4 w-4" />
            Pagata il {formatDate(invoice.paidAt)}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="space-y-2 pt-1">
        {/* Download XML — always available */}
        {invoice.xmlUrl && (
          <Button
            variant="outline"
            onClick={() => window.open(invoice.xmlUrl, '_blank')}
          >
            <Download className="h-4 w-4" />
            Scarica XML FatturaPA
          </Button>
        )}

        {invoice.status === 'Draft' && (
          <>
            <Button
              variant="outline"
              onClick={() => patchStatus('Sent')}
              loading={updating}
            >
              Segna come Inviata
            </Button>
            <Button
              variant="outline"
              onClick={() => setShowSendForm((o) => !o)}
            >
              <Send className="h-4 w-4" />
              Invia al Cliente
            </Button>
            {showSendForm && (
              <form onSubmit={handleSend} className="space-y-3 rounded-lg border border-brand-border p-3">
                <Input
                  label="Email destinatario (opzionale)"
                  type="email"
                  value={recipientEmail}
                  onChange={(e) => setRecipientEmail(e.target.value)}
                  placeholder="cliente@esempio.it"
                />
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-brand-text">Messaggio (opzionale)</label>
                  <textarea
                    value={sendMessage}
                    onChange={(e) => setSendMessage(e.target.value)}
                    rows={2}
                    className="rounded-lg border border-brand-border bg-white px-3 py-2.5 text-sm text-brand-text placeholder:text-brand-muted focus:outline-none focus:ring-2 focus:ring-brand-accent focus:border-transparent"
                  />
                </div>
                <Button type="submit" loading={sending}>Invia</Button>
              </form>
            )}
          </>
        )}

        {(invoice.status === 'Sent' || invoice.status === 'Overdue') && (
          <Button
            onClick={() => patchStatus('Paid')}
            loading={updating}
            className="bg-teal-600 text-white hover:bg-teal-700"
          >
            <CheckCircle className="h-4 w-4" />
            Segna come Pagata
          </Button>
        )}
      </div>
    </div>
  );
}
