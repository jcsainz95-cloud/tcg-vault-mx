'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Banner } from '@/components/ui/Banner';

/**
 * Rango del MOTIVO. **3–500 tras `trim()` — es el del contrato** (§M6-K.4: el mismo exacto que
 * `SellRequestItem.rejectionReason`, *«el mismo concepto no estrena una segunda talla»*).
 * ⚠️ ux-ui proponía 10–300 y **gana el contrato**; su argumento —«"no" no es un motivo»— no se
 * pierde: **baja de validación a guía de redacción** (el hint y los presets, §34.6b).
 */
export const REJECTION_REASON_MIN = 3;
export const REJECTION_REASON_MAX = 500;
/** A partir de aquí se pinta el contador: antes es ruido. */
const COUNTER_FROM = 440;

const PRESETS = ['unreadable', 'missingSide', 'notAnId', 'expired', 'nameMismatch', 'other'] as const;
type Preset = (typeof PRESETS)[number];

export interface KycRejectDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (reason: string) => void;
  submitting?: boolean;
  /** Error ya traducido de la mutación (`useErrorMessage`): ⛔ nunca el inglés del servidor. */
  submitError?: string | null;
  /** `true` cuando el servidor señaló el campo (`details.field === 'rejectionReason'`): P-4. */
  submitErrorOnField?: boolean;
  /** Preselección: con una cara ausente, el motivo que toca ya está escrito (§34.3c). */
  initialPreset?: Preset;
}

/**
 * El formulario de rechazo (DESIGN_SYSTEM §34.6b). Dos cosas lo definen:
 *
 * 1. **El motivo es obligatorio y lo lee el cliente TAL CUAL** — y eso se dice **en el propio
 *    formulario**, no en una nota de release. Los motivos sugeridos escriben **frases completas y
 *    editables**: es ahí donde de verdad cambia lo que la gente escribe.
 * 2. **No hay segunda confirmación.** El formulario, con su motivo obligatorio y su advertencia de
 *    que el cliente lo leerá, **ya es** la confirmación (§7.6: una sola fricción, la útil).
 */
export function KycRejectDialog({
  open,
  onClose,
  onSubmit,
  submitting,
  submitError,
  submitErrorOnField,
  initialPreset,
}: KycRejectDialogProps) {
  const t = useTranslations('admin.m6.kycReview');
  const tc = useTranslations('common');
  const [preset, setPreset] = useState<Preset | null>(null);
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fieldId = useId();
  const hintId = `${fieldId}-hint`;
  const errorId = `${fieldId}-error`;

  // Al abrir: estado limpio y, si la pantalla sabe cuál es el motivo (falta una cara), ya escrito.
  useEffect(() => {
    if (!open) return;
    setTouched(false);
    if (initialPreset && initialPreset !== 'other') {
      setPreset(initialPreset);
      setReason(t(`rejectPreset.${initialPreset}`));
    } else {
      setPreset(null);
      setReason('');
    }
  }, [open, initialPreset, t]);

  // El servidor señaló el campo ⇒ el foco va AL CAMPO, no a un banner (P-4, §34.6d).
  useEffect(() => {
    if (submitErrorOnField) textareaRef.current?.focus();
  }, [submitErrorOnField]);

  const trimmed = reason.trim();
  const valid = trimmed.length >= REJECTION_REASON_MIN && trimmed.length <= REJECTION_REASON_MAX;
  const showError = (touched && !valid) || !!submitErrorOnField;

  function choose(next: Preset) {
    setPreset(next);
    if (next === 'other') {
      setReason('');
      textareaRef.current?.focus();
    } else {
      setReason(t(`rejectPreset.${next}`));
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('rejectTitle')}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button
            type="button"
            variant="accent"
            /* ⛔ Deshabilitado con motivo inválido: cero peticiones con 2 caracteres (candado KY-6). */
            disabled={!valid || submitting}
            loading={submitting}
            onClick={() => {
              setTouched(true);
              if (valid) onSubmit(trimmed);
            }}
          >
            {submitting ? t('rejecting') : t('rejectConfirm')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <fieldset className="flex flex-col gap-1">
          <legend className="eyebrow mb-1">{t('rejectPresetLabel')}</legend>
          {PRESETS.map((p) => (
            <label
              key={p}
              className="flex min-h-[44px] cursor-pointer items-center gap-3 border-b border-border py-1 text-sm"
            >
              <input
                type="radio"
                name="kyc-reject-preset"
                value={p}
                checked={preset === p}
                onChange={() => choose(p)}
                className="h-4 w-4 accent-[color:var(--color-accent)]"
              />
              <span>{t(`rejectPreset.${p}`)}</span>
            </label>
          ))}
        </fieldset>

        <div className="flex flex-col gap-1">
          <label htmlFor={fieldId} className="eyebrow">
            {t('rejectReasonLabel')}
          </label>
          <textarea
            id={fieldId}
            ref={textareaRef}
            rows={4}
            value={reason}
            maxLength={REJECTION_REASON_MAX}
            onChange={(e) => {
              setReason(e.target.value);
              // Escribir a mano deja de ser «el preset»: el texto manda, el radio solo lo propuso.
              if (preset && preset !== 'other') setPreset(null);
            }}
            onBlur={() => setTouched(true)}
            aria-invalid={showError || undefined}
            aria-describedby={showError ? `${hintId} ${errorId}` : hintId}
            className="w-full border border-border bg-surface p-3 text-sm text-text outline-none focus-visible:shadow-focus"
          />
          <div className="flex items-start justify-between gap-3">
            <p id={hintId} className="text-xs text-muted">
              {t('rejectReasonHint')}
            </p>
            {reason.length >= COUNTER_FROM && (
              <span className="tabular shrink-0 font-mono text-[11px] text-muted">
                {t('rejectReasonCounter', { n: reason.length })}
              </span>
            )}
          </div>
          {showError && (
            <p id={errorId} role="alert" className="text-xs text-accent">
              {submitErrorOnField && submitError ? submitError : t('rejectReasonInvalid')}
            </p>
          )}
        </div>

        {/* Las dos notas de §34.6b.3: el cliente lo lee tal cual, y no se escriben datos de otro. */}
        <div className="flex flex-col gap-1 text-xs text-muted">
          <p>{t('rejectNoticeVerbatim')}</p>
          <p>{t('rejectNoticeThirdParty')}</p>
        </div>

        {/* Cualquier otro error: dentro del modal, que NO se cierra, y el motivo NO se pierde. */}
        {submitError && !submitErrorOnField && (
          <Banner variant="danger" role="alert">
            {submitError}
          </Banner>
        )}
      </div>
    </Modal>
  );
}
