'use client';

import { useRef, useState } from 'react';
import { Camera, Check, X, Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface PhotoUploaderProps {
  label: string;
  /** captura móvil: input type=file accept=image/* capture=environment */
  onFile?: (file: File) => void;
  hint?: string;
}

type UploadState = 'empty' | 'uploading' | 'done' | 'error';

/**
 * PhotoUploader (DESIGN_SYSTEM §7.10): captura de cámara móvil, preview,
 * subida con progreso (presign PUT del contrato §8). En mock, simula la subida.
 */
export function PhotoUploader({ label, onFile, hint }: PhotoUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<UploadState>('empty');
  const [preview, setPreview] = useState<string | null>(null);

  function handleFile(file: File | undefined) {
    if (!file) return;
    setPreview(URL.createObjectURL(file));
    setState('uploading');
    onFile?.(file);
    // MOCK: pendiente presign PUT a object storage (contrato §8 /uploads/presign).
    setTimeout(() => setState('done'), 700);
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-text">{label}</span>
      <div
        className={cn(
          'relative flex aspect-[5/7] w-full max-w-[180px] flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-3 text-center',
          state === 'error' ? 'border-danger' : 'border-border-strong',
        )}
        aria-busy={state === 'uploading'}
      >
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt={label} className="absolute inset-0 h-full w-full rounded-md object-cover" />
        ) : (
          <Camera size={28} className="text-muted" aria-hidden />
        )}
        {state === 'uploading' && (
          <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-white">
            <Loader2 size={22} className="animate-spin" aria-hidden />
          </span>
        )}
        {state === 'done' && (
          <span className="absolute right-2 top-2 rounded-full bg-success p-1 text-white">
            <Check size={14} aria-hidden />
          </span>
        )}
        {state === 'error' && (
          <span className="absolute right-2 top-2 rounded-full bg-danger p-1 text-white">
            <X size={14} aria-hidden />
          </span>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-md border border-border-strong bg-surface px-4 text-sm font-medium hover:bg-surface-2"
      >
        <Camera size={18} aria-hidden /> {preview ? 'Retomar' : label}
      </button>
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}
