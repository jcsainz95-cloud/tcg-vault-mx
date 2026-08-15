'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Camera, Check, X, Loader2, Upload } from 'lucide-react';
import { cn } from '@/lib/cn';
import { presignUpload, uploadToPresignedUrl } from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import type { UploadPurpose } from '@/types/contract';

/**
 * Fallback de tamaño en cliente si el presign no trae `maxBytes`. La fuente de
 * verdad del límite es `presign.maxBytes` (el backend fija el mismo tope en la firma).
 */
export const DEFAULT_MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

export interface PhotoUploaderProps {
  label: string;
  /** propósito del presign; hoy el contrato §8 solo admite `kyc_ine`. */
  purpose?: UploadPurpose;
  /** se invoca con la `uploadKey` del presign cuando la subida termina OK. */
  onUploaded?: (uploadKey: string) => void;
  /** se invoca al limpiar/re-tomar antes de una nueva subida. */
  onCleared?: () => void;
  hint?: string;
  /** tamaño máximo en bytes (default 10 MB). */
  maxBytes?: number;
  disabled?: boolean;
}

type UploadState = 'empty' | 'uploading' | 'done' | 'error';

/**
 * IneUploader (DESIGN_SYSTEM §7.10) — ÚNICO uploader del sistema (v1.2). Captura la
 * imagen del INE (cámara móvil o archivo), valida tipo/tamaño en cliente, pide el
 * presign `kyc_ine` (contrato §8), sube por PUT directo al storage privado y expone
 * la `uploadKey` para asociarla a la solicitud/KYC. Solo acepta imágenes (`image/*`).
 */
export function PhotoUploader({
  label,
  purpose = 'kyc_ine',
  onUploaded,
  onCleared,
  hint,
  maxBytes = DEFAULT_MAX_UPLOAD_BYTES,
  disabled,
}: PhotoUploaderProps) {
  const t = useTranslations('ine');
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<UploadState>('empty');
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const errId = useId();
  // Guarda el object URL vigente para revocarlo al re-seleccionar / desmontar (evita fuga).
  const previewUrlRef = useRef<string | null>(null);

  const mbLabel = (bytes: number) => `${Math.round(bytes / (1024 * 1024))} MB`;

  function setPreviewUrl(url: string | null) {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = url;
    setPreview(url);
  }

  // Libera el último object URL al desmontar el componente.
  useEffect(() => () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
  }, []);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    onCleared?.();

    // Validación de TIPO en cliente: solo imágenes (el backend además rechaza no-imagen).
    if (!file.type.startsWith('image/')) {
      setPreviewUrl(null);
      setState('error');
      setError(t('errNotImage'));
      return;
    }

    setError(null);
    setPreviewUrl(URL.createObjectURL(file));
    setState('uploading');
    try {
      // presign → PUT directo al object storage privado con el Content-Type de imagen.
      // `contentLength` deja que el backend fije el tamaño exacto en la firma (S-B3).
      const presign = await presignUpload({
        purpose,
        contentType: file.type,
        contentLength: file.size,
      });
      // Fuente única de verdad del límite = el presign; la constante local es fallback.
      const effectiveMax = presign.maxBytes ?? maxBytes;
      if (file.size > effectiveMax) {
        setState('error');
        setError(t('errTooLarge', { max: mbLabel(effectiveMax) }));
        return;
      }
      await uploadToPresignedUrl(presign, file);
      setState('done');
      onUploaded?.(presign.uploadKey);
    } catch (e) {
      setState('error');
      const code = e instanceof ApiClientError ? e.code : undefined;
      setError(
        code === 'FILE_TOO_LARGE'
          ? t('errTooLarge', { max: mbLabel(maxBytes) })
          : code === 'VALIDATION_ERROR'
            ? t('errNotImage')
            : t('errUpload'),
      );
    }
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
            <span className="sr-only">{t('uploading')}</span>
          </span>
        )}
        {state === 'done' && (
          <span className="absolute right-2 top-2 rounded-full bg-success p-1 text-white" aria-hidden>
            <Check size={14} />
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
        disabled={disabled || state === 'uploading'}
        aria-label={label}
        onChange={(e) => {
          void handleFile(e.target.files?.[0]);
          // permite re-seleccionar el mismo archivo tras un error
          e.target.value = '';
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled || state === 'uploading'}
        aria-describedby={error ? errId : undefined}
        className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-md border border-border-strong bg-surface px-4 text-sm font-medium hover:bg-surface-2 focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_var(--color-focus-ring)] disabled:opacity-45 disabled:cursor-not-allowed"
      >
        {state === 'done' ? (
          <>
            <Upload size={18} aria-hidden /> {t('retake')}
          </>
        ) : (
          <>
            <Camera size={18} aria-hidden /> {state === 'uploading' ? t('uploading') : t('takePhoto')}
          </>
        )}
      </button>
      {error ? (
        <p id={errId} role="alert" className="flex items-center gap-1 text-xs text-danger">
          <X size={12} aria-hidden /> {error}
        </p>
      ) : state === 'done' ? (
        <p className="flex items-center gap-1 text-xs text-success">
          <Check size={12} aria-hidden /> {t('uploaded')}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
}
