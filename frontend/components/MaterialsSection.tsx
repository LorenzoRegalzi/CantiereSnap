'use client';

import { useRef, useState } from 'react';
import { AlertTriangle, Check, Plus, X } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { Material } from '@/types';
import { formatCurrency } from '@/lib/format';

interface MaterialsSectionProps {
  jobId: string;
  initialItems: Material[];
  initialTotalCost: number;
  onMaterialsChanged: (items: Material[], totalCost: number) => void;
}

interface AddDraft {
  itemName: string;
  quantity: string;
  cost: string;
}

interface EditingCell {
  materialId: string;
  field: 'itemName' | 'quantity' | 'cost';
}

function confidenceColor(c: number) {
  return c >= 80 ? 'text-teal-600' : 'text-amber-600';
}

export default function MaterialsSection({
  jobId,
  initialItems,
  initialTotalCost,
  onMaterialsChanged,
}: MaterialsSectionProps) {
  const [items, setItems] = useState<Material[]>(initialItems);
  const [totalCost, setTotalCost] = useState(initialTotalCost);
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const [draftValue, setDraftValue] = useState('');
  const [adding, setAdding] = useState(false);
  const [addDraft, setAddDraft] = useState<AddDraft>({ itemName: '', quantity: '', cost: '' });
  const [addErrors, setAddErrors] = useState<Partial<AddDraft>>({});
  const [alert, setAlert] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function startEdit(materialId: string, field: EditingCell['field'], value: string | number) {
    setDraftValue(String(value));
    setEditingCell({ materialId, field });
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  async function commitEdit() {
    if (!editingCell) return;
    const { materialId, field } = editingCell;
    setEditingCell(null);

    const prev = items.find((m) => m.materialId === materialId);
    if (!prev) return;

    const update: Partial<Material> = {};
    if (field === 'itemName') update.itemName = draftValue.trim() || prev.itemName;
    else if (field === 'quantity') update.quantity = parseFloat(draftValue) || prev.quantity;
    else if (field === 'cost') update.cost = parseFloat(draftValue) || prev.cost;

    const updated = { ...prev, ...update };
    const nextItems = items.map((m) => (m.materialId === materialId ? updated : m));
    setItems(nextItems);

    try {
      const { data } = await apiClient.put<Material>(
        `/jobs/${jobId}/materials/${materialId}`,
        update
      );
      const mergedItems = nextItems.map((m) => m.materialId === materialId ? data : m);
      const newTotal = Math.round(mergedItems.reduce((s, m) => s + m.cost, 0) * 100) / 100;
      setItems(mergedItems);
      setTotalCost(newTotal);
      onMaterialsChanged(mergedItems, newTotal);
    } catch {
      setItems(items);
      setAlert("Errore durante il salvataggio.");
    }
  }

  async function handleAdd() {
    const errors: Partial<AddDraft> = {};
    if (!addDraft.itemName.trim()) errors.itemName = 'Richiesto';
    if (!addDraft.quantity || parseFloat(addDraft.quantity) <= 0) errors.quantity = 'Richiesto';
    if (!addDraft.cost || parseFloat(addDraft.cost) < 0) errors.cost = 'Richiesto';
    if (Object.keys(errors).length > 0) { setAddErrors(errors); return; }

    try {
      const { data } = await apiClient.post<Material>(
        `/jobs/${jobId}/materials`,
        {
          itemName: addDraft.itemName.trim(),
          quantity: parseFloat(addDraft.quantity),
          cost: parseFloat(addDraft.cost),
        }
      );
      const newItems = [...items, data];
      const newTotal = Math.round(newItems.reduce((s, m) => s + m.cost, 0) * 100) / 100;
      setItems(newItems);
      setTotalCost(newTotal);
      onMaterialsChanged(newItems, newTotal);
      setAdding(false);
      setAddDraft({ itemName: '', quantity: '', cost: '' });
      setAddErrors({});
    } catch {
      setAlert("Errore durante l'aggiunta del materiale.");
    }
  }

  function CellDisplay({ mat, field }: { mat: Material; field: EditingCell['field'] }) {
    const isEditing = editingCell?.materialId === mat.materialId && editingCell?.field === field;
    const raw = mat[field];

    if (isEditing) {
      return (
        <input
          ref={inputRef}
          type={field === 'itemName' ? 'text' : 'number'}
          step="0.01"
          value={draftValue}
          onChange={(e) => setDraftValue(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
            if (e.key === 'Escape') setEditingCell(null);
          }}
          className="w-full rounded border border-brand-accent bg-amber-50 px-1 py-0.5 text-sm focus:outline-none"
        />
      );
    }

    return (
      <span
        onClick={() => startEdit(mat.materialId, field, raw)}
        className="block cursor-pointer rounded px-1 py-0.5 text-sm hover:bg-stone-100"
        title="Clicca per modificare"
      >
        {field === 'cost' ? formatCurrency(raw as number) : raw}
      </span>
    );
  }

  return (
    <div className="space-y-3">
      {alert && (
        <div className="flex items-center justify-between rounded-lg bg-red-50 p-3 text-sm text-red-700">
          <span>{alert}</span>
          <button onClick={() => setAlert(null)}><X className="h-4 w-4" /></button>
        </div>
      )}

      {items.length === 0 && !adding ? (
        <p className="text-sm text-brand-muted">Nessun materiale registrato.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-brand-border">
          <table className="w-full text-sm">
            <thead className="border-b border-brand-border bg-stone-50">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-brand-muted">Nome materiale</th>
                <th className="w-20 px-3 py-2 text-right text-xs font-semibold uppercase text-brand-muted">Qtà</th>
                <th className="w-28 px-3 py-2 text-right text-xs font-semibold uppercase text-brand-muted">Costo (€)</th>
                <th className="w-24 px-3 py-2 text-center text-xs font-semibold uppercase text-brand-muted">Confidenza</th>
                <th className="w-28 px-3 py-2 text-center text-xs font-semibold uppercase text-brand-muted">Stato</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-border bg-white">
              {items.map((mat) => (
                <tr key={mat.materialId} className="hover:bg-stone-50">
                  <td className="px-3 py-2">
                    <CellDisplay mat={mat} field="itemName" />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <CellDisplay mat={mat} field="quantity" />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <CellDisplay mat={mat} field="cost" />
                  </td>
                  <td className="px-3 py-2 text-center">
                    <span
                      className={`flex items-center justify-center gap-1 text-xs font-medium ${confidenceColor(mat.confidence)}`}
                      title={mat.confidence < 80 && mat.warning ? mat.warning : undefined}
                    >
                      {mat.confidence < 80 && (
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                      )}
                      {mat.confidence}%
                    </span>
                  </td>
                  <td className="px-3 py-2 text-center">
                    {mat.verified ? (
                      <span className="flex items-center justify-center gap-1 text-xs font-medium text-teal-600">
                        <Check className="h-3.5 w-3.5" /> Verificato
                      </span>
                    ) : (
                      <span className="text-xs font-medium text-amber-600">Da verificare</span>
                    )}
                  </td>
                </tr>
              ))}

              {adding && (
                <tr className="bg-amber-50">
                  <td className="px-3 py-2">
                    <input
                      type="text"
                      placeholder="Nome materiale"
                      value={addDraft.itemName}
                      onChange={(e) => setAddDraft((p) => ({ ...p, itemName: e.target.value }))}
                      className={`w-full rounded border px-1.5 py-0.5 text-sm focus:outline-none ${addErrors.itemName ? 'border-red-400' : 'border-brand-border'}`}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      step="0.01"
                      placeholder="0"
                      value={addDraft.quantity}
                      onChange={(e) => setAddDraft((p) => ({ ...p, quantity: e.target.value }))}
                      className={`w-full rounded border px-1.5 py-0.5 text-right text-sm focus:outline-none ${addErrors.quantity ? 'border-red-400' : 'border-brand-border'}`}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={addDraft.cost}
                      onChange={(e) => setAddDraft((p) => ({ ...p, cost: e.target.value }))}
                      className={`w-full rounded border px-1.5 py-0.5 text-right text-sm focus:outline-none ${addErrors.cost ? 'border-red-400' : 'border-brand-border'}`}
                    />
                  </td>
                  <td className="px-3 py-2" />
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-center gap-1">
                      <button onClick={handleAdd} className="rounded p-1 text-teal-600 hover:bg-teal-50">
                        <Check className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => { setAdding(false); setAddErrors({}); }} className="rounded p-1 text-brand-muted hover:bg-stone-100">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Add material button */}
      {!adding && (
        <button
          onClick={() => setAdding(true)}
          className="flex items-center gap-1.5 text-sm font-medium text-brand-accent hover:opacity-80"
        >
          <Plus className="h-4 w-4" />
          Aggiungi materiale
        </button>
      )}

      {/* Total */}
      {(items.length > 0 || adding) && (
        <div className="text-right text-sm font-semibold text-brand-text">
          Costo totale materiali: {formatCurrency(totalCost)}
        </div>
      )}
    </div>
  );
}
