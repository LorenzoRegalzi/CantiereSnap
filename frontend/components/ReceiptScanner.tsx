'use client';

import { useRef, useState } from 'react';
import { ScanLine, X, Check } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { Material } from '@/types';
import Button from './ui/Button';

interface ReceiptScannerProps {
  jobId: string;
  onScanned: (items: Material[], totalCost: number) => void;
}

interface ScannedItem extends Material {
  _draft: { itemName: string; quantity: string; cost: string };
}

const LOADING_MESSAGES = [
  'Analisi dell\'immagine...',
  'Estrazione del testo...',
  'Identificazione dei materiali...',
  'Calcolo dei costi...',
];

export default function ReceiptScanner({ jobId, onScanned }: ReceiptScannerProps) {
  const [open, setOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [msgIdx, setMsgIdx] = useState(0);
  const [scannedItems, setScannedItems] = useState<ScannedItem[] | null>(null);
  const [sourceImageUrl, setSourceImageUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const msgTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const MAX_BYTES = 10 * 1024 * 1024;

  async function handleFile(f: File) {
    if (f.size > MAX_BYTES) {
      setErrorMsg('Il file supera il limite di 10 MB.');
      return;
    }
    setScanning(true);
    setErrorMsg(null);
    setMsgIdx(0);

    // Cycle through loading messages
    let i = 0;
    msgTimer.current = setInterval(() => {
      i = (i + 1) % LOADING_MESSAGES.length;
      setMsgIdx(i);
    }, 3000);

    try {
      // Step 1: get presigned upload URL (reuse photo upload endpoint)
      // f.type can be empty on mobile camera captures; fall back to image/jpeg
      const mimeType = f.type || 'image/jpeg';

      const { data: urlData } = await apiClient.post<{
        photoId: string;
        uploadUrl: string;
        headers: Record<string, string>;
        s3Key: string;
      }>(`/jobs/${jobId}/photos/upload-url`, {
        fileName: f.name,
        mimeType,
        tag: 'Before',
      });

      // Step 2: upload to S3
      await fetch(urlData.uploadUrl, {
        method: 'PUT',
        headers: urlData.headers,
        body: f,
      });

      // Step 3: scan receipt with Claude Vision
      const { data: scanResult } = await apiClient.post<{
        items: Material[];
        sourceImageUrl: string;
      }>(`/jobs/${jobId}/materials/scan`, { s3Key: urlData.s3Key });

      setScannedItems(
        scanResult.items.map((item) => ({
          ...item,
          _draft: {
            itemName: item.itemName,
            quantity: String(item.quantity),
            cost: String(item.cost),
          },
        }))
      );
      setSourceImageUrl(scanResult.sourceImageUrl);
    } catch {
      setErrorMsg('Errore durante la scansione. Riprova o aggiungi i materiali manualmente.');
    } finally {
      if (msgTimer.current) clearInterval(msgTimer.current);
      setScanning(false);
    }
  }

  function updateDraft(materialId: string, field: 'itemName' | 'quantity' | 'cost', value: string) {
    setScannedItems((prev) =>
      prev?.map((it) =>
        it.materialId === materialId ? { ...it, _draft: { ...it._draft, [field]: value } } : it
      ) ?? null
    );
  }

  async function confirmItems() {
    if (!scannedItems) return;

    // Save each edited item via PUT (sets verified: true)
    const updates = scannedItems.filter((it) => {
      return (
        it._draft.itemName !== it.itemName ||
        parseFloat(it._draft.quantity) !== it.quantity ||
        parseFloat(it._draft.cost) !== it.cost
      );
    });

    await Promise.allSettled(
      updates.map((it) =>
        apiClient.put(`/jobs/${jobId}/materials/${it.materialId}`, {
          itemName: it._draft.itemName,
          quantity: parseFloat(it._draft.quantity),
          cost: parseFloat(it._draft.cost),
        })
      )
    );

    // Refresh materials list
    try {
      const { data } = await apiClient.get<{ items: Material[]; totalCost: number }>(
        `/jobs/${jobId}/materials`
      );
      onScanned(data.items, data.totalCost);
    } catch {
      // Pass through what we have
      const total = scannedItems.reduce((s, it) => s + parseFloat(it._draft.cost || '0'), 0);
      onScanned(
        scannedItems.map((it) => ({
          ...it,
          itemName: it._draft.itemName,
          quantity: parseFloat(it._draft.quantity),
          cost: parseFloat(it._draft.cost),
          verified: true,
        })),
        total
      );
    }

    reset();
  }

  function reset() {
    setOpen(false);
    setScanning(false);
    setScannedItems(null);
    setSourceImageUrl(null);
    setErrorMsg(null);
    setMsgIdx(0);
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-lg border border-brand-border px-3 py-1.5 text-sm font-medium text-brand-muted hover:bg-stone-50"
      >
        <ScanLine className="h-4 w-4" />
        Scansiona Scontrino
      </button>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png"
        capture="environment"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }}
      />

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-brand-border px-5 py-4">
              <h3 className="font-semibold text-brand-text">Scansiona Scontrino</h3>
              {!scanning && (
                <button onClick={reset} className="rounded p-1 text-brand-muted hover:bg-stone-100">
                  <X className="h-5 w-5" />
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              {/* Error */}
              {errorMsg && (
                <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{errorMsg}</div>
              )}

              {/* Initial choice */}
              {!scanning && !scannedItems && (
                <div className="space-y-4">
                  <p className="text-sm text-brand-muted">
                    Scatta una foto dello scontrino o ricevuta. L&apos;AI estrarrà automaticamente i materiali e i costi.
                  </p>
                  <Button onClick={() => inputRef.current?.click()} className="w-full">
                    <ScanLine className="h-4 w-4" />
                    Scegli immagine
                  </Button>
                </div>
              )}

              {/* Loading */}
              {scanning && (
                <div className="flex flex-col items-center gap-4 py-10">
                  <div className="h-10 w-10 animate-spin rounded-full border-4 border-brand-accent border-t-transparent" />
                  <p className="text-sm font-medium text-brand-text">Scansione in corso...</p>
                  <p className="text-xs text-brand-muted transition-all">{LOADING_MESSAGES[msgIdx]}</p>
                </div>
              )}

              {/* Results */}
              {scannedItems && (
                <div className="space-y-4">
                  <div className="flex flex-col gap-4 md:flex-row">
                    {/* Receipt image */}
                    {sourceImageUrl && (
                      <div className="md:w-1/3">
                        <img
                          src={sourceImageUrl}
                          alt="Scontrino"
                          className="w-full rounded-lg border border-brand-border object-contain"
                        />
                      </div>
                    )}

                    {/* Extracted items table */}
                    <div className="flex-1">
                      <p className="mb-2 text-xs font-semibold uppercase text-brand-muted">
                        Materiali estratti ({scannedItems.length})
                      </p>
                      <div className="overflow-x-auto rounded-lg border border-brand-border">
                        <table className="w-full text-sm">
                          <thead className="border-b border-brand-border bg-stone-50">
                            <tr>
                              <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-brand-muted">Nome</th>
                              <th className="w-16 px-3 py-2 text-right text-xs font-semibold uppercase text-brand-muted">Qtà</th>
                              <th className="w-24 px-3 py-2 text-right text-xs font-semibold uppercase text-brand-muted">Costo</th>
                              <th className="w-20 px-3 py-2 text-center text-xs font-semibold uppercase text-brand-muted">Conf.</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-brand-border bg-white">
                            {scannedItems.map((it) => (
                              <tr
                                key={it.materialId}
                                className={it.confidence < 80 ? 'bg-amber-50' : ''}
                                title={it.confidence < 80 && it.warning ? it.warning : undefined}
                              >
                                <td className="px-3 py-1.5">
                                  <input
                                    type="text"
                                    value={it._draft.itemName}
                                    onChange={(e) => updateDraft(it.materialId, 'itemName', e.target.value)}
                                    className="w-full rounded border border-transparent px-1 py-0.5 text-sm hover:border-brand-border focus:border-brand-accent focus:outline-none"
                                  />
                                </td>
                                <td className="px-3 py-1.5">
                                  <input
                                    type="number"
                                    step="0.01"
                                    value={it._draft.quantity}
                                    onChange={(e) => updateDraft(it.materialId, 'quantity', e.target.value)}
                                    className="w-full rounded border border-transparent px-1 py-0.5 text-right text-sm hover:border-brand-border focus:border-brand-accent focus:outline-none"
                                  />
                                </td>
                                <td className="px-3 py-1.5">
                                  <input
                                    type="number"
                                    step="0.01"
                                    value={it._draft.cost}
                                    onChange={(e) => updateDraft(it.materialId, 'cost', e.target.value)}
                                    className="w-full rounded border border-transparent px-1 py-0.5 text-right text-sm hover:border-brand-border focus:border-brand-accent focus:outline-none"
                                  />
                                </td>
                                <td className={`px-3 py-1.5 text-center text-xs font-medium ${it.confidence >= 80 ? 'text-teal-600' : 'text-amber-600'}`}>
                                  {it.confidence}%
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-3">
                    <Button onClick={confirmItems} className="flex-1">
                      <Check className="h-4 w-4" />
                      Conferma materiali
                    </Button>
                    <button
                      onClick={() => setOpen(false)}
                      className="text-sm text-brand-accent hover:underline"
                    >
                      Aggiungi manualmente
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
