'use client';

import { useState, useRef } from 'react';
import { Trash2, Plus, Check, X, Download, Send, FileText } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { Quote, QuoteItem, QuoteFinalizeResponse } from '@/types';
import { formatCurrency, formatDateTime, round2 } from '@/lib/format';
import Alert from './ui/Alert';
import Button from './ui/Button';

interface QuoteEditorProps {
  jobId: string;
  quote: Quote;
  items: QuoteItem[];
  readOnly?: boolean;
  onQuoteUpdated: (quote: Quote, items: QuoteItem[]) => void;
}

interface EditingCell {
  seq: number;
  field: 'description' | 'quantity' | 'unit' | 'unitPrice';
}

interface NewItemDraft {
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
}

// Defined outside QuoteEditor so React never sees a new component type on re-render.
// If defined inside, every render creates a new function reference → React unmounts
// the old input on the first keystroke, firing onBlur → commitEdit → clears editingCell.
interface EditableCellProps {
  seq: number;
  field: EditingCell['field'];
  value: string | number;
  type?: 'text' | 'number';
  align?: 'left' | 'right';
  readOnly: boolean;
  editingCell: EditingCell | null;
  draftValue: string;
  inputRef: React.RefObject<HTMLInputElement>;
  onStartEdit: (seq: number, field: EditingCell['field'], value: string | number) => void;
  onDraftChange: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}

function EditableCell({
  seq, field, value, type = 'text', align = 'left',
  readOnly, editingCell, draftValue, inputRef,
  onStartEdit, onDraftChange, onCommit, onCancel,
}: EditableCellProps) {
  const isEditing = editingCell?.seq === seq && editingCell?.field === field;

  if (readOnly) {
    return (
      <span className={`block ${align === 'right' ? 'text-right' : ''}`}>
        {field === 'unitPrice' ? formatCurrency(value as number) : value}
      </span>
    );
  }

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        type={type}
        step={type === 'number' ? '0.01' : undefined}
        value={draftValue}
        onChange={(e) => onDraftChange(e.target.value)}
        onBlur={onCommit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); onCommit(); }
          if (e.key === 'Escape') onCancel();
        }}
        className={`w-full rounded border border-brand-accent bg-amber-50 px-1.5 py-0.5 text-sm focus:outline-none ${align === 'right' ? 'text-right' : ''}`}
      />
    );
  }

  return (
    <span
      onClick={() => onStartEdit(seq, field, value)}
      className={`block cursor-pointer rounded px-1 py-0.5 text-sm hover:bg-stone-100 ${align === 'right' ? 'text-right' : ''}`}
      title="Clicca per modificare"
    >
      {field === 'unitPrice' ? formatCurrency(value as number) : value}
    </span>
  );
}

// Persist the full items array to the backend in a single call.
// Returns the server's canonical items (re-sequenced from 1) so callers
// can keep local state in sync with the stored sequence numbers.
async function saveItems(jobId: string, items: QuoteItem[]): Promise<QuoteItem[]> {
  const { data } = await apiClient.post<{ quote: Quote; items: QuoteItem[] }>(
    `/jobs/${jobId}/quote/items`,
    {
      items: items.map(({ seq, description, quantity, unit, unitPrice }) => ({
        seq,
        description,
        quantity,
        unit,
        unitPrice,
      })),
    },
  );
  return data.items;
}

export default function QuoteEditor({ jobId, quote, items: initialItems, readOnly = false, onQuoteUpdated }: QuoteEditorProps) {
  const [items, setItems] = useState<QuoteItem[]>(initialItems);
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const [draftValue, setDraftValue] = useState('');
  const [addingRow, setAddingRow] = useState(false);
  const [newItem, setNewItem] = useState<NewItemDraft>({ description: '', quantity: '', unit: '', unitPrice: '' });
  const [newItemErrors, setNewItemErrors] = useState<Partial<NewItemDraft>>({});
  const [confirmDeleteSeq, setConfirmDeleteSeq] = useState<number | null>(null);
  const [alert, setAlert] = useState<{ variant: 'success' | 'error'; message: string } | null>(null);
  const [savingPdf, setSavingPdf] = useState(false);
  const [pdfUrl, setPdfUrl] = useState(quote.pdfUrl ?? null);
  const [quoteStatus, setQuoteStatus] = useState(quote.status);
  const [sentAt, setSentAt] = useState(quote.sentAt ?? null);
  const [sendFormOpen, setSendFormOpen] = useState(false);
  const [sendEmail, setSendEmail] = useState('');
  const [sendMessage, setSendMessage] = useState('');
  const [sending, setSending] = useState(false);
  const editInputRef = useRef<HTMLInputElement>(null);

  const subtotal = round2(items.reduce((s, it) => s + it.lineTotal, 0));
  const iva = round2(subtotal * 0.22);
  const total = round2(subtotal + iva);

  function startEdit(seq: number, field: EditingCell['field'], currentValue: string | number) {
    if (readOnly) return;
    setDraftValue(String(currentValue));
    setEditingCell({ seq, field });
    setTimeout(() => editInputRef.current?.focus(), 0);
  }

  async function commitEdit() {
    if (!editingCell) return;
    const { seq, field } = editingCell;
    setEditingCell(null);

    const prev = items.find((it) => it.seq === seq);
    if (!prev) return;

    let updated: QuoteItem;
    if (field === 'quantity') {
      const qty = round2(parseFloat(draftValue) || prev.quantity);
      updated = { ...prev, quantity: qty, lineTotal: round2(qty * prev.unitPrice) };
    } else if (field === 'unitPrice') {
      const price = round2(parseFloat(draftValue) || prev.unitPrice);
      updated = { ...prev, unitPrice: price, lineTotal: round2(prev.quantity * price) };
    } else {
      updated = { ...prev, [field]: draftValue || prev[field] };
    }

    const nextItems = items.map((it) => (it.seq === seq ? updated : it));
    setItems(nextItems);

    try {
      const saved = await saveItems(jobId, nextItems);
      setItems(saved);
    } catch {
      setItems(items);
      setAlert({ variant: 'error', message: 'Errore durante il salvataggio della modifica.' });
    }
  }

  async function handleDelete(seq: number) {
    const nextItems = items.filter((it) => it.seq !== seq);
    setItems(nextItems);
    setConfirmDeleteSeq(null);
    try {
      const saved = await saveItems(jobId, nextItems);
      setItems(saved);
    } catch {
      setItems(items);
      setAlert({ variant: 'error', message: "Errore durante l'eliminazione della voce." });
    }
  }

  async function handleAddItem() {
    const errors: Partial<NewItemDraft> = {};
    if (newItem.description.trim().length < 5) errors.description = 'Min 5 caratteri';
    if (!newItem.quantity || parseFloat(newItem.quantity) <= 0) errors.quantity = 'Richiesto';
    if (!newItem.unit.trim()) errors.unit = 'Richiesto';
    if (newItem.unitPrice === '' || parseFloat(newItem.unitPrice) < 0) errors.unitPrice = 'Richiesto';

    if (Object.keys(errors).length > 0) {
      setNewItemErrors(errors);
      return;
    }

    const qty = round2(parseFloat(newItem.quantity));
    const price = round2(parseFloat(newItem.unitPrice));
    const nextSeq = items.length > 0 ? Math.max(...items.map((it) => it.seq)) + 1 : 1;
    const item: QuoteItem = {
      seq: nextSeq,
      description: newItem.description.trim(),
      quantity: qty,
      unit: newItem.unit.trim(),
      unitPrice: price,
      lineTotal: round2(qty * price),
    };

    const nextItems = [...items, item];
    setItems(nextItems);
    setAddingRow(false);
    setNewItem({ description: '', quantity: '', unit: '', unitPrice: '' });
    setNewItemErrors({});

    try {
      const saved = await saveItems(jobId, nextItems);
      setItems(saved);
    } catch {
      setItems(items);
      setAlert({ variant: 'error', message: "Errore durante l'aggiunta della voce." });
    }
  }

  // POST /finalize approves the quote (status → Approved, no PDF).
  // POST /send generates the PDF and returns the presigned pdfUrl.
  async function handleFinalize() {
    setSavingPdf(true);
    setAlert(null);
    try {
      await apiClient.post(`/jobs/${jobId}/quote/finalize`);
      const { data } = await apiClient.post<QuoteFinalizeResponse>(`/jobs/${jobId}/quote/send`);
      setPdfUrl(data.pdfUrl);
      setQuoteStatus('Approved');
      onQuoteUpdated({ ...quote, status: 'Approved', pdfUrl: data.pdfUrl }, items);
      setAlert({ variant: 'success', message: 'PDF generato con successo.' });
    } catch {
      setAlert({ variant: 'error', message: 'Errore durante la generazione del PDF.' });
    } finally {
      setSavingPdf(false);
    }
  }

  async function handleSend() {
    if (!sendEmail.trim()) return;
    setSending(true);
    setAlert(null);
    try {
      await apiClient.post(`/jobs/${jobId}/quote/send`, {
        recipientEmail: sendEmail.trim(),
        message: sendMessage.trim() || undefined,
      });
      const now = new Date().toISOString();
      setSentAt(now);
      setQuoteStatus('Sent');
      setSendFormOpen(false);
      onQuoteUpdated({ ...quote, status: 'Sent', sentAt: now }, items);
      setAlert({ variant: 'success', message: `Preventivo inviato a ${sendEmail.trim()}` });
    } catch {
      setAlert({ variant: 'error', message: "Errore durante l'invio del preventivo." });
    } finally {
      setSending(false);
    }
  }

  // Shared props for every EditableCell in the table
  const cellProps = {
    readOnly,
    editingCell,
    draftValue,
    inputRef: editInputRef,
    onStartEdit: startEdit,
    onDraftChange: setDraftValue,
    onCommit: commitEdit,
    onCancel: () => setEditingCell(null),
  };

  return (
    <div className="space-y-4">
      {alert && (
        <Alert variant={alert.variant} message={alert.message} onDismiss={() => setAlert(null)} />
      )}

      {/* Desktop table */}
      <div className="hidden overflow-x-auto rounded-lg border border-brand-border md:block">
        <table className="w-full text-sm">
          <thead className="border-b border-brand-border bg-stone-50">
            <tr>
              <th className="w-8 px-3 py-2.5 text-left text-xs font-semibold uppercase text-brand-muted">#</th>
              <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-brand-muted">Descrizione</th>
              <th className="w-20 px-3 py-2.5 text-right text-xs font-semibold uppercase text-brand-muted">Qtà</th>
              <th className="w-20 px-3 py-2.5 text-left text-xs font-semibold uppercase text-brand-muted">Unità</th>
              <th className="w-28 px-3 py-2.5 text-right text-xs font-semibold uppercase text-brand-muted">Prezzo Unit.</th>
              <th className="w-28 px-3 py-2.5 text-right text-xs font-semibold uppercase text-brand-muted">Totale</th>
              {!readOnly && <th className="w-12 px-3 py-2.5" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-brand-border bg-white">
            {items.map((item) => (
              <tr key={item.seq} className="hover:bg-stone-50">
                <td className="px-3 py-2 text-xs text-brand-muted">{item.seq}</td>
                <td className="min-w-[200px] px-3 py-2">
                  <EditableCell {...cellProps} seq={item.seq} field="description" value={item.description} />
                </td>
                <td className="px-3 py-2">
                  <EditableCell {...cellProps} seq={item.seq} field="quantity" value={item.quantity} type="number" align="right" />
                </td>
                <td className="px-3 py-2">
                  <EditableCell {...cellProps} seq={item.seq} field="unit" value={item.unit} />
                </td>
                <td className="px-3 py-2">
                  <EditableCell {...cellProps} seq={item.seq} field="unitPrice" value={item.unitPrice} type="number" align="right" />
                </td>
                <td className="px-3 py-2 text-right font-medium text-brand-text">
                  {formatCurrency(item.lineTotal)}
                </td>
                {!readOnly && (
                  <td className="px-3 py-2">
                    {confirmDeleteSeq === item.seq ? (
                      <div className="flex items-center gap-1">
                        <button onClick={() => handleDelete(item.seq)} className="rounded p-1 text-red-600 hover:bg-red-50" title="Conferma">
                          <Check className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={() => setConfirmDeleteSeq(null)} className="rounded p-1 text-brand-muted hover:bg-stone-100" title="Annulla">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => setConfirmDeleteSeq(item.seq)} className="rounded p-1 text-brand-muted hover:bg-red-50 hover:text-red-600" title="Elimina voce">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}

            {/* New item row */}
            {addingRow && (
              <tr className="bg-amber-50">
                <td className="px-3 py-2 text-xs text-brand-muted">—</td>
                <td className="px-3 py-2">
                  <input
                    type="text"
                    placeholder="Descrizione voce"
                    value={newItem.description}
                    onChange={(e) => setNewItem((p) => ({ ...p, description: e.target.value }))}
                    className={`w-full rounded border px-1.5 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-brand-accent ${newItemErrors.description ? 'border-red-400' : 'border-brand-border'}`}
                  />
                  {newItemErrors.description && <p className="mt-0.5 text-xs text-red-600">{newItemErrors.description}</p>}
                </td>
                <td className="px-3 py-2">
                  <input type="number" step="0.01" placeholder="0" value={newItem.quantity}
                    onChange={(e) => setNewItem((p) => ({ ...p, quantity: e.target.value }))}
                    className={`w-full rounded border px-1.5 py-0.5 text-right text-sm focus:outline-none focus:ring-1 focus:ring-brand-accent ${newItemErrors.quantity ? 'border-red-400' : 'border-brand-border'}`}
                  />
                </td>
                <td className="px-3 py-2">
                  <input type="text" placeholder="pz" value={newItem.unit}
                    onChange={(e) => setNewItem((p) => ({ ...p, unit: e.target.value }))}
                    className={`w-full rounded border px-1.5 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-brand-accent ${newItemErrors.unit ? 'border-red-400' : 'border-brand-border'}`}
                  />
                </td>
                <td className="px-3 py-2">
                  <input type="number" step="0.01" placeholder="0.00" value={newItem.unitPrice}
                    onChange={(e) => setNewItem((p) => ({ ...p, unitPrice: e.target.value }))}
                    className={`w-full rounded border px-1.5 py-0.5 text-right text-sm focus:outline-none focus:ring-1 focus:ring-brand-accent ${newItemErrors.unitPrice ? 'border-red-400' : 'border-brand-border'}`}
                  />
                </td>
                <td className="px-3 py-2 text-right text-xs text-brand-muted">
                  {newItem.quantity && newItem.unitPrice
                    ? formatCurrency(round2(parseFloat(newItem.quantity || '0') * parseFloat(newItem.unitPrice || '0')))
                    : '—'}
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1">
                    <button onClick={handleAddItem} className="rounded p-1 text-brand-success hover:bg-teal-50" title="Salva voce">
                      <Check className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => { setAddingRow(false); setNewItemErrors({}); }} className="rounded p-1 text-brand-muted hover:bg-stone-100" title="Annulla">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile stacked cards */}
      <div className="space-y-3 md:hidden">
        {items.map((item) => (
          <div key={item.seq} className="rounded-lg border border-brand-border bg-white p-4">
            <div className="mb-2 flex items-start justify-between gap-2">
              <span className="text-xs text-brand-muted">#{item.seq}</span>
              {!readOnly && confirmDeleteSeq === item.seq ? (
                <div className="flex gap-2">
                  <button onClick={() => handleDelete(item.seq)} className="text-xs text-red-600">Elimina</button>
                  <button onClick={() => setConfirmDeleteSeq(null)} className="text-xs text-brand-muted">Annulla</button>
                </div>
              ) : !readOnly ? (
                <button onClick={() => setConfirmDeleteSeq(item.seq)} className="text-brand-muted hover:text-red-600">
                  <Trash2 className="h-4 w-4" />
                </button>
              ) : null}
            </div>
            <p className="mb-3 font-medium text-brand-text">{item.description}</p>
            <div className="grid grid-cols-3 gap-2 text-sm">
              <div><p className="text-xs text-brand-muted">Qtà</p><p>{item.quantity} {item.unit}</p></div>
              <div><p className="text-xs text-brand-muted">Prezzo unit.</p><p>{formatCurrency(item.unitPrice)}</p></div>
              <div><p className="text-xs text-brand-muted">Totale</p><p className="font-semibold">{formatCurrency(item.lineTotal)}</p></div>
            </div>
          </div>
        ))}
      </div>

      {/* Add item button */}
      {!readOnly && !addingRow && (
        <button onClick={() => setAddingRow(true)} className="flex items-center gap-1.5 text-sm font-medium text-brand-accent hover:opacity-80">
          <Plus className="h-4 w-4" />
          Aggiungi voce
        </button>
      )}

      {/* Summary */}
      <div className="ml-auto max-w-xs space-y-1.5 rounded-lg border border-brand-border bg-stone-50 p-4">
        <div className="flex justify-between text-sm text-brand-muted">
          <span>Subtotale</span><span>{formatCurrency(subtotal)}</span>
        </div>
        <div className="flex justify-between text-sm text-brand-muted">
          <span>IVA (22%)</span><span>{formatCurrency(iva)}</span>
        </div>
        <div className="flex justify-between border-t border-brand-border pt-1.5 font-semibold text-brand-text">
          <span>Totale</span><span>{formatCurrency(total)}</span>
        </div>
      </div>

      {/* AI generation metadata */}
      {(quote.generationTimeMs != null || quote.model) && (
        <p className="text-xs text-brand-muted">
          {quote.generationTimeMs != null && <>Generato da AI in {(quote.generationTimeMs / 1000).toFixed(1)}s</>}
          {quote.model && <> · Modello: {quote.model}</>}
        </p>
      )}

      {/* Actions */}
      <div className="space-y-3 pt-2">
        {quoteStatus === 'Draft' && (
          <Button onClick={handleFinalize} loading={savingPdf} className="w-full">
            <FileText className="h-4 w-4" />
            Approva e Genera PDF
          </Button>
        )}

        {(quoteStatus === 'Approved' || quoteStatus === 'Sent') && pdfUrl && (
          <a href={pdfUrl} target="_blank" rel="noopener noreferrer"
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-brand-primary px-4 py-2.5 text-sm font-semibold text-brand-primary transition-opacity hover:opacity-80"
          >
            <Download className="h-4 w-4" />
            Scarica PDF
          </a>
        )}

        {quoteStatus === 'Sent' && sentAt && (
          <p className="text-center text-xs text-brand-muted">
            ✓ Inviato il {formatDateTime(sentAt)}
          </p>
        )}

        {(quoteStatus === 'Approved' || quoteStatus === 'Sent') && !sendFormOpen && (
          <button onClick={() => setSendFormOpen(true)}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-accent px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          >
            <Send className="h-4 w-4" />
            {quoteStatus === 'Sent' ? 'Invia di nuovo' : 'Invia al Cliente'}
          </button>
        )}

        {sendFormOpen && (
          <div className="space-y-3 rounded-lg border border-brand-border bg-stone-50 p-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-brand-muted">Email destinatario</label>
              <input type="email" value={sendEmail} onChange={(e) => setSendEmail(e.target.value)}
                placeholder="cliente@esempio.it"
                className="w-full rounded-lg border border-brand-border bg-white px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-brand-accent"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-brand-muted">Messaggio (opzionale)</label>
              <textarea value={sendMessage} onChange={(e) => setSendMessage(e.target.value)} rows={3}
                placeholder="Gentile Sig. ..., in allegato il preventivo per i lavori..."
                className="w-full rounded-lg border border-brand-border bg-white px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-brand-accent"
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={handleSend} loading={sending} className="flex-1">
                <Send className="h-4 w-4" />
                Invia
              </Button>
              <button onClick={() => setSendFormOpen(false)}
                className="rounded-lg border border-brand-border px-4 py-2 text-sm text-brand-muted hover:bg-stone-100"
              >
                Annulla
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
