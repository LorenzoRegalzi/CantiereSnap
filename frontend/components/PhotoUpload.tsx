'use client';

import { useRef, useState } from 'react';
import { Camera, X } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { Photo } from '@/types';
import Button from './ui/Button';

interface PhotoUploadProps {
  jobId: string;
  onUploaded: (photo: Photo) => void;
}

type UploadStep = 'idle' | 'tag-select' | 'uploading' | 'ai-analysis' | 'done' | 'error';

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

export default function PhotoUpload({ jobId, onUploaded }: PhotoUploadProps) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<UploadStep>('idle');
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [tag, setTag] = useState<'Before' | 'After'>('Before');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  function handleFileSelected(f: File) {
    if (f.size > MAX_BYTES) {
      setErrorMsg('Il file supera il limite di 10 MB.');
      return;
    }
    setErrorMsg(null);
    setFile(f);
    setPreviewUrl(URL.createObjectURL(f));
    setStep('tag-select');
  }

  async function handleUpload() {
    if (!file) return;
    setStep('uploading');
    setErrorMsg(null);

    try {
      // Step 1: get presigned upload URL
      // file.type can be empty on mobile camera captures; fall back to image/jpeg
      const mimeType = file.type || 'image/jpeg';

      const { data: urlData } = await apiClient.post<{
        photoId: string;
        uploadUrl: string;
        headers: Record<string, string>;
        s3Key: string;
      }>(`/jobs/${jobId}/photos/upload-url`, {
        fileName: file.name,
        mimeType,
        tag,
      });

      // Step 2: PUT raw file to S3
      await fetch(urlData.uploadUrl, {
        method: 'PUT',
        headers: urlData.headers,
        body: file,
      });

      setStep('ai-analysis');

      // Step 3: save metadata and trigger AI description
      const { data: photo } = await apiClient.post<Photo>(`/jobs/${jobId}/photos`, {
        photoId: urlData.photoId,
        s3Key: urlData.s3Key,
        tag,
        mimeType: file.type,
        sizeBytes: file.size,
      });

      setStep('done');
      onUploaded(photo);
      // Reset after short delay so the user sees the success state briefly
      setTimeout(reset, 800);
    } catch {
      setStep('error');
      setErrorMsg("Errore durante il caricamento. Riprova.");
    }
  }

  function reset() {
    setOpen(false);
    setStep('idle');
    setFile(null);
    setPreviewUrl(null);
    setTag('Before');
    setErrorMsg(null);
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-lg border border-brand-accent px-3 py-1.5 text-sm font-medium text-brand-accent hover:bg-amber-50"
      >
        <Camera className="h-4 w-4" />
        + Carica Foto
      </button>

      {/* Hidden inputs */}
      <input
        ref={cameraRef}
        type="file"
        accept="image/jpeg,image/png"
        capture="environment"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileSelected(f); e.target.value = ''; }}
      />
      <input
        ref={galleryRef}
        type="file"
        accept="image/jpeg,image/png"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileSelected(f); e.target.value = ''; }}
      />

      {/* Dialog */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-brand-border px-5 py-4">
              <h3 className="font-semibold text-brand-text">Carica Foto</h3>
              <button onClick={reset} className="rounded p-1 text-brand-muted hover:bg-stone-100">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-5">
              {/* Error banner */}
              {errorMsg && (
                <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{errorMsg}</div>
              )}

              {step === 'idle' && (
                <div className="space-y-3">
                  <button
                    onClick={() => cameraRef.current?.click()}
                    className="flex w-full items-center gap-3 rounded-lg border border-brand-border px-4 py-3 text-sm font-medium text-brand-text hover:bg-stone-50"
                  >
                    <Camera className="h-5 w-5 text-brand-accent" />
                    Scatta foto
                  </button>
                  <button
                    onClick={() => galleryRef.current?.click()}
                    className="flex w-full items-center gap-3 rounded-lg border border-brand-border px-4 py-3 text-sm font-medium text-brand-text hover:bg-stone-50"
                  >
                    <span className="text-brand-accent text-xl">🖼️</span>
                    Scegli dalla galleria
                  </button>
                </div>
              )}

              {step === 'tag-select' && previewUrl && (
                <div className="space-y-4">
                  <img
                    src={previewUrl}
                    alt="Anteprima"
                    className="mx-auto max-h-[200px] rounded-lg object-contain shadow"
                  />
                  <p className="text-center text-sm font-medium text-brand-muted">Tipo di foto</p>
                  <div className="flex gap-3">
                    <button
                      onClick={() => setTag('Before')}
                      className={`flex-1 rounded-lg border px-4 py-2.5 text-sm font-semibold transition-colors ${tag === 'Before' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-brand-border text-brand-muted hover:bg-stone-50'}`}
                    >
                      Prima
                    </button>
                    <button
                      onClick={() => setTag('After')}
                      className={`flex-1 rounded-lg border px-4 py-2.5 text-sm font-semibold transition-colors ${tag === 'After' ? 'border-teal-500 bg-teal-50 text-teal-700' : 'border-brand-border text-brand-muted hover:bg-stone-50'}`}
                    >
                      Dopo
                    </button>
                  </div>
                  <Button onClick={handleUpload} className="w-full">
                    Carica
                  </Button>
                </div>
              )}

              {step === 'uploading' && (
                <div className="flex flex-col items-center gap-3 py-6">
                  <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-accent border-t-transparent" />
                  <p className="text-sm text-brand-muted">Caricamento in corso...</p>
                </div>
              )}

              {step === 'ai-analysis' && (
                <div className="flex flex-col items-center gap-3 py-6">
                  <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-accent border-t-transparent" />
                  <p className="text-sm text-brand-muted">Analisi AI in corso...</p>
                </div>
              )}

              {step === 'done' && (
                <div className="flex flex-col items-center gap-3 py-6">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-teal-100 text-teal-600 text-xl">✓</div>
                  <p className="text-sm font-medium text-brand-text">Foto caricata con successo!</p>
                </div>
              )}

              {step === 'error' && (
                <div className="flex justify-center gap-3 pt-2">
                  <Button onClick={() => setStep('tag-select')}>Riprova</Button>
                  <button
                    onClick={reset}
                    className="rounded-lg border border-brand-border px-4 py-2 text-sm text-brand-muted hover:bg-stone-100"
                  >
                    Annulla
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
