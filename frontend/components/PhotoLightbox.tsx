'use client';

import { useEffect, useState } from 'react';
import { X, ChevronLeft, ChevronRight, Pencil } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { Photo } from '@/types';
import { formatDate } from '@/lib/format';

interface PhotoLightboxProps {
  photos: Photo[];
  initialIndex: number;
  onClose: () => void;
  onPhotoUpdated: (photo: Photo) => void;
}

const TAG_LABELS: Record<string, string> = { Before: 'Prima', After: 'Dopo' };
const TAG_COLORS: Record<string, string> = {
  Before: 'bg-blue-500 text-white',
  After: 'bg-teal-500 text-white',
};

export default function PhotoLightbox({ photos, initialIndex, onClose, onPhotoUpdated }: PhotoLightboxProps) {
  const [idx, setIdx] = useState(initialIndex);
  const [editingDesc, setEditingDesc] = useState(false);
  const [draftDesc, setDraftDesc] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState(false);

  const photo = photos[idx];
  const jobId = (photo as unknown as { jobId?: string }).jobId;

  // Trap keyboard navigation
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') setIdx((i) => Math.max(0, i - 1));
      if (e.key === 'ArrowRight') setIdx((i) => Math.min(photos.length - 1, i + 1));
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [photos.length, onClose]);

  function startEditDesc() {
    setDraftDesc(photo.aiDescription ?? '');
    setEditingDesc(true);
  }

  async function saveDesc(jobIdParam: string) {
    setSaving(true);
    try {
      const { data } = await apiClient.patch<Photo>(`/jobs/${jobIdParam}/photos/${photo.photoId}`, {
        aiDescription: draftDesc,
      });
      onPhotoUpdated(data);
      setEditingDesc(false);
      setSavedMsg(true);
      setTimeout(() => setSavedMsg(false), 2000);
    } catch {
      // Keep editing open on failure
    } finally {
      setSaving(false);
    }
  }

  async function changeTag(newTag: 'Before' | 'After', jobIdParam: string) {
    try {
      const { data } = await apiClient.patch<Photo>(`/jobs/${jobIdParam}/photos/${photo.photoId}`, {
        tag: newTag,
      });
      onPhotoUpdated(data);
    } catch {
      // silent — UI won't update on failure
    }
  }

  if (!photo) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-black/90"
      role="dialog"
      aria-modal="true"
    >
      {/* Top bar */}
      <div className="flex items-center justify-between p-4">
        <span className="text-sm text-white/60">{idx + 1} / {photos.length}</span>
        <button onClick={onClose} className="rounded-full p-1.5 text-white/70 hover:bg-white/10">
          <X className="h-6 w-6" />
        </button>
      </div>

      {/* Image area */}
      <div className="relative flex flex-1 items-center justify-center overflow-hidden">
        {/* Prev arrow */}
        {idx > 0 && (
          <button
            onClick={() => setIdx(idx - 1)}
            className="absolute left-2 z-10 rounded-full bg-black/40 p-2 text-white hover:bg-black/60"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
        )}

        <img
          key={photo.photoId}
          src={photo.imageUrl}
          alt={photo.aiDescription ?? 'Foto cantiere'}
          className="max-h-full max-w-full object-contain"
        />

        {/* Next arrow */}
        {idx < photos.length - 1 && (
          <button
            onClick={() => setIdx(idx + 1)}
            className="absolute right-2 z-10 rounded-full bg-black/40 p-2 text-white hover:bg-black/60"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        )}
      </div>

      {/* Bottom info panel */}
      <div className="border-t border-white/10 bg-black/70 p-4 text-white">
        {/* Tag selection */}
        <div className="mb-3 flex items-center gap-2">
          <span className="text-xs text-white/50">Tipo:</span>
          {(['Before', 'After'] as const).map((t) => (
            <button
              key={t}
              onClick={() => jobId && changeTag(t, jobId)}
              className={`rounded-full px-3 py-0.5 text-xs font-semibold transition-opacity ${
                photo.tag === t ? TAG_COLORS[t] : 'bg-white/10 text-white/50 hover:bg-white/20'
              }`}
            >
              {TAG_LABELS[t]}
            </button>
          ))}
          <span className="ml-auto text-xs text-white/40">{formatDate(photo.uploadedAt)}</span>
        </div>

        {/* AI description */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="text-xs text-white/50">Descrizione AI</span>
            {!editingDesc && photo.aiDescription && (
              <button
                onClick={startEditDesc}
                className="rounded p-0.5 text-white/40 hover:text-white/80"
                title="Modifica descrizione"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            )}
            {savedMsg && <span className="ml-1 text-xs text-teal-400">Descrizione aggiornata</span>}
          </div>

          {editingDesc ? (
            <div className="flex gap-2">
              <textarea
                value={draftDesc}
                onChange={(e) => setDraftDesc(e.target.value)}
                rows={2}
                className="flex-1 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-sm text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-brand-accent"
              />
              <div className="flex flex-col gap-1">
                <button
                  onClick={() => jobId && saveDesc(jobId)}
                  disabled={saving}
                  className="rounded-lg bg-brand-accent px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
                >
                  {saving ? '...' : 'Salva'}
                </button>
                <button
                  onClick={() => setEditingDesc(false)}
                  className="rounded-lg border border-white/20 px-3 py-1.5 text-xs text-white/60 hover:bg-white/10"
                >
                  Annulla
                </button>
              </div>
            </div>
          ) : photo.aiDescription ? (
            <p className="text-sm text-white/80">{photo.aiDescription}</p>
          ) : (
            <p className="text-sm italic text-white/30">Descrizione AI in elaborazione...</p>
          )}
        </div>

        {/* TODO: add delete button when DELETE /photos/:photoId endpoint is available */}
      </div>
    </div>
  );
}
