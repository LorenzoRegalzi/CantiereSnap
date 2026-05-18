'use client';

import { useState } from 'react';
import { Camera } from 'lucide-react';
import { Photo } from '@/types';
import { formatDate } from '@/lib/format';

interface PhotoGalleryProps {
  photos: Photo[];
  onPhotoClick: (index: number) => void;
}

type Filter = 'all' | 'Before' | 'After';

const TAG_LABELS: Record<string, string> = { Before: 'Prima', After: 'Dopo' };
const TAG_COLORS: Record<string, string> = {
  Before: 'bg-blue-500',
  After: 'bg-teal-500',
};

function SkeletonThumbnail() {
  return <div className="aspect-square animate-pulse rounded-xl bg-stone-200" />;
}

export default function PhotoGallery({ photos, onPhotoClick }: PhotoGalleryProps) {
  const [filter, setFilter] = useState<Filter>('all');

  const filtered = filter === 'all' ? photos : photos.filter((p) => p.tag === filter);

  return (
    <div className="space-y-3">
      {/* Filter tabs */}
      <div className="flex gap-1">
        {(['all', 'Before', 'After'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              filter === f
                ? 'bg-brand-accent text-white'
                : 'bg-stone-100 text-brand-muted hover:bg-stone-200'
            }`}
          >
            {f === 'all' ? 'Tutte' : TAG_LABELS[f]}
            <span className="ml-1 opacity-70">
              ({f === 'all' ? photos.length : photos.filter((p) => p.tag === f).length})
            </span>
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-8 text-brand-muted">
          <Camera className="h-8 w-8 opacity-40" />
          <p className="text-sm">Nessuna foto caricata. Scatta la prima foto del cantiere!</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
          {filtered.map((photo) => {
            // Find the actual index in the full list for lightbox navigation
            const globalIdx = photos.indexOf(photo);
            return (
              <button
                key={photo.photoId}
                onClick={() => onPhotoClick(globalIdx)}
                className="group relative aspect-square overflow-hidden rounded-xl shadow-sm ring-1 ring-black/5 focus:outline-none focus:ring-2 focus:ring-brand-accent"
              >
                <img
                  src={photo.imageUrl}
                  alt={photo.aiDescription ?? 'Foto cantiere'}
                  className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
                />
                {/* Tag badge */}
                <span className={`absolute left-1.5 top-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold text-white ${TAG_COLORS[photo.tag]}`}>
                  {TAG_LABELS[photo.tag]}
                </span>
                {/* Date overlay */}
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-2 py-1.5">
                  <p className="text-[10px] text-white/90">{formatDate(photo.uploadedAt)}</p>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export { SkeletonThumbnail };
