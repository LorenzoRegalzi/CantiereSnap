'use client';

import { useState, useEffect, useRef } from 'react';
import { Sparkles } from 'lucide-react';
import apiClient, { ApiError } from '@/lib/api-client';
import { Quote, QuoteItem, QuoteGenerateResponse } from '@/types';
import Alert from './ui/Alert';
import Button from './ui/Button';

interface QuoteGeneratorProps {
  jobId: string;
  jobDescription: string;
  onGenerated: (quote: Quote, items: QuoteItem[]) => void;
}

const LOADING_MESSAGES = [
  'Analisi della descrizione...',
  'Calcolo dei materiali...',
  'Stima dei costi...',
  'Preparazione del preventivo...',
];

export default function QuoteGenerator({ jobId, jobDescription, onGenerated }: QuoteGeneratorProps) {
  const [notes, setNotes] = useState('');
  const [generating, setGenerating] = useState(false);
  const descriptionTooShort = jobDescription.trim().length < 20;
  const [msgIndex, setMsgIndex] = useState(0);
  const [alert, setAlert] = useState<{ variant: 'success' | 'error'; message: string } | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (generating) {
      intervalRef.current = setInterval(() => {
        setMsgIndex((i) => (i + 1) % LOADING_MESSAGES.length);
      }, 4000);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
      setMsgIndex(0);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [generating]);

  async function pollUntilReady(signal: AbortSignal): Promise<void> {
    const POLL_INTERVAL_MS = 5000;
    const MAX_ATTEMPTS = 12; // 60 seconds

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (signal.aborted) return;

      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      if (signal.aborted) return;

      try {
        const { data } = await apiClient.get<{ quote: Quote; items: QuoteItem[] }>(
          `/jobs/${jobId}/quote`
        );
        if ((data.quote.status as string) === 'processing') continue;
        if (data.quote.status === 'failed') {
          setAlert({
            variant: 'error',
            message: 'La generazione AI non è riuscita. Puoi inserire le voci manualmente.',
          });
          onGenerated({ status: 'Draft', totalAmount: 0, itemCount: 0 }, []);
          return;
        }
        // status === 'Draft' — ready
        onGenerated(data.quote, data.items);
        return;
      } catch {
        // Transient poll error — keep trying
      }
    }

    // Timed out after MAX_ATTEMPTS
    setAlert({
      variant: 'error',
      message: 'Il preventivo è ancora in elaborazione. Ricarica la pagina tra qualche secondo.',
    });
  }

  async function handleGenerate() {
    setGenerating(true);
    setAlert(null);
    const abortController = new AbortController();

    try {
      const response = await apiClient.post<{ status: string } | QuoteGenerateResponse>(
        `/jobs/${jobId}/quote/generate`,
        { description: jobDescription, notes: notes.trim() || undefined }
      );

      // 202 Accepted — generation dispatched async, start polling
      if ((response.data as { status: string }).status === 'processing') {
        await pollUntilReady(abortController.signal);
        return;
      }

      // Legacy 201 sync path (never reached on current backend, kept for safety)
      const syncData = response.data as QuoteGenerateResponse;
      onGenerated(syncData.quote, syncData.items);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // Quote already exists — load and show it
        try {
          const { data } = await apiClient.get<{ quote: Quote; items: QuoteItem[] }>(
            `/jobs/${jobId}/quote`
          );
          if (data.quote.status === 'processing') {
            await pollUntilReady(abortController.signal);
          } else {
            onGenerated(data.quote, data.items);
          }
          return;
        } catch {
          setAlert({ variant: 'error', message: 'Errore durante il caricamento del preventivo esistente.' });
        }
      } else if (err instanceof ApiError && err.status === 502) {
        setAlert({
          variant: 'error',
          message: 'Il servizio AI non è momentaneamente disponibile. Puoi inserire le voci manualmente.',
        });
        onGenerated({ status: 'Draft', totalAmount: 0, itemCount: 0 }, []);
      } else {
        setAlert({ variant: 'error', message: 'Errore durante la generazione del preventivo.' });
      }
    } finally {
      abortController.abort();
      setGenerating(false);
    }
  }

  if (generating) {
    return (
      <div className="flex flex-col items-center gap-6 rounded-lg border border-brand-border bg-white p-8">
        <div className="relative flex h-16 w-16 items-center justify-center">
          <div className="absolute inset-0 animate-ping rounded-full bg-amber-100 opacity-75" />
          <Sparkles className="relative h-8 w-8 text-brand-accent" />
        </div>
        <div className="text-center">
          <p className="text-sm font-medium text-brand-text transition-all duration-500">
            {LOADING_MESSAGES[msgIndex]}
          </p>
          <p className="mt-1 text-xs text-brand-muted">Questo può richiedere 15–25 secondi</p>
        </div>
        <div className="flex gap-1">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-2 w-2 animate-bounce rounded-full bg-brand-accent"
              style={{ animationDelay: `${i * 0.15}s` }}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-brand-border bg-white p-5">
      <div className="mb-4 flex items-center gap-2">
        <Sparkles className="h-5 w-5 text-brand-accent" />
        <h3 className="font-semibold text-brand-primary">Genera Preventivo AI</h3>
      </div>

      {alert && (
        <div className="mb-4">
          <Alert variant={alert.variant} message={alert.message} onDismiss={() => setAlert(null)} />
        </div>
      )}

      {/* Read-only job description */}
      <div className="mb-4">
        <p className="mb-1 text-xs font-medium text-brand-muted">Descrizione lavoro</p>
        <p className={`rounded-lg border px-3 py-2.5 text-sm text-brand-text ${descriptionTooShort ? 'border-red-300 bg-red-50' : 'border-brand-border bg-stone-50'}`}>
          {jobDescription}
        </p>
        {descriptionTooShort && (
          <p className="mt-1.5 text-xs text-red-600">
            La descrizione è troppo corta ({jobDescription.length}/20 caratteri). Modifica il lavoro e aggiungi più dettagli prima di generare il preventivo.
          </p>
        )}
      </div>

      {/* Optional notes */}
      {!descriptionTooShort && (
        <div className="mb-5">
          <label className="mb-1 block text-xs font-medium text-brand-muted">
            Note aggiuntive (opzionale)
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Es: il cliente preferisce rubinetteria Grohe, budget massimo €5.000..."
            className="w-full rounded-lg border border-brand-border bg-white px-3 py-2.5 text-sm text-brand-text placeholder:text-brand-muted focus:border-transparent focus:outline-none focus:ring-2 focus:ring-brand-accent"
          />
        </div>
      )}

      <Button
        onClick={handleGenerate}
        disabled={descriptionTooShort}
        className="w-full bg-brand-accent text-white hover:opacity-90"
      >
        <Sparkles className="h-4 w-4" />
        Genera Preventivo
      </Button>
    </div>
  );
}
