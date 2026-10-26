'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';

/** Lo aplicado, tal como lo dijo el servidor (`discount` `applied`). `savedLabel` ya formateado por el padre. */
export interface CodeRowApplied {
  code: string;
  /** `true` ⇒ C3b («Ahorras {importe} de envío»). */
  shipping: boolean;
  /** Importe ya formateado (MX$…) de `discountCents` o `shippingWaivedCents`. ⛔ Nunca una cuenta del front. */
  savedLabel: string;
}

export interface CodeRowProps {
  /** C1 (checkout) o C1b (retiro: solo códigos de envío gratis). Es la única diferencia entre pantallas. */
  variant?: 'checkout' | 'withdrawal';
  applied: CodeRowApplied | null;
  /** S3 «Aplicando…»: campo y botón apagados, no reenvía con doble toque. */
  pending: boolean;
  /** S5/S6/S9: el texto del error (`role="alert"`); el campo conserva lo escrito y el foco. */
  error: string | null;
  /** S8: bloqueo por intentos (C9 llega en `error`). Campo y botón apagados, sin cuenta regresiva. */
  blocked: boolean;
  /** C8 (reemplazo) / C12 (dejó de aplicar): aviso `role="status"`, no error. */
  notice: string | null;
  /** Normalizado (mayúsculas, sin espacios). El padre llama al servidor. */
  onApply: (code: string) => void;
  onRemove: () => void;
}

/** §DSC-UX.1: se normaliza a mayúsculas sin espacios al teclear; ≤ 40 (tope del contrato §DSC.6). */
export function normalizeCodeInput(raw: string): string {
  return raw.toUpperCase().replace(/\s+/g, '').slice(0, 40);
}

/**
 * `CodeRow` (DESIGN_SYSTEM §DSC-UX.1): el renglón «¿Tienes un código?» con sus estados S1-S10. Una sola pieza para
 * checkout de invitado, con cuenta (bóveda) y retiro; nunca un `dialog`. El componente NO llama a la API ni decide
 * textos de negocio: el padre (`useDiscountCode`) traduce el `discount` del servidor a `applied`/`error`/`notice`.
 */
export function CodeRow({ variant = 'checkout', applied, pending, error, blocked, notice, onApply, onRemove }: CodeRowProps) {
  const t = useTranslations('checkout.discount');
  const id = useId();
  const inputId = `${id}-code`;
  const errorId = `${id}-err`;
  const [open, setOpen] = useState(false);
  /** «Usar otro código» con uno ya aplicado (S7): el campo aparece bajo la fila aplicada. */
  const [another, setAnother] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const appliedRef = useRef<HTMLDivElement>(null);
  const prevApplied = useRef<string | null>(applied?.code ?? null);
  const focusInputNext = useRef(false);

  // Foco (§DSC-UX.1): tras aplicar con éxito, a la fila «aplicado»; tras «Quitar», al renglón; al abrir, al campo.
  useEffect(() => {
    const before = prevApplied.current;
    const now = applied?.code ?? null;
    prevApplied.current = now;
    if (now && now !== before) {
      setDraft('');
      setAnother(false);
      setOpen(false);
      appliedRef.current?.focus();
    } else if (!now && before) {
      setOpen(false);
      setAnother(false);
      // El foco vuelve al renglón plegado en el siguiente pintado.
      requestAnimationFrame(() => toggleRef.current?.focus());
    }
  }, [applied?.code]);

  useEffect(() => {
    if (focusInputNext.current && (open || another)) {
      focusInputNext.current = false;
      inputRef.current?.focus();
    }
  }, [open, another]);

  // El error deja el foco en el campo (S5/S6/S9).
  useEffect(() => {
    if (error && (open || another || !applied)) inputRef.current?.focus();
  }, [error, open, another, applied]);

  const showField = applied ? another : open || !!error;
  const disabled = pending || blocked;
  const label = variant === 'withdrawal' ? t('rowWithdrawal') : t('row');

  function submit() {
    const code = normalizeCodeInput(draft);
    if (!code || disabled) return;
    onApply(code);
  }

  const field = showField && (
    <div className="pb-3 pt-1" data-testid="code-row-field">
      <label htmlFor={inputId} className="eyebrow">
        {t('label')}
      </label>
      <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] items-stretch gap-2">
        <input
          ref={inputRef}
          id={inputId}
          value={draft}
          onChange={(e) => setDraft(normalizeCodeInput(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            } else if (e.key === 'Escape' && draft === '') {
              setOpen(false);
              setAnother(false);
              requestAnimationFrame(() => toggleRef.current?.focus());
            }
          }}
          disabled={disabled}
          maxLength={40}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className={cn(
            'min-h-[44px] w-full min-w-0 bg-transparent px-2 font-mono text-base uppercase text-text outline-none focus:shadow-focus disabled:opacity-60',
            error ? 'border-2 border-accent' : 'border border-border-strong',
          )}
        />
        <button
          type="button"
          onClick={submit}
          disabled={disabled || draft === ''}
          aria-disabled={disabled || draft === '' ? true : undefined}
          className="min-h-[44px] shrink-0 border border-text px-4 text-[11px] font-medium uppercase tracking-label text-text hover:bg-text hover:text-primary-fg disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? t('applying') : t('apply')}
        </button>
      </div>
      {error && (
        <p id={errorId} role="alert" className="mt-2 text-[13px] leading-relaxed text-accent [overflow-wrap:anywhere]">
          {error}
        </p>
      )}
    </div>
  );

  return (
    <div className="min-w-0 border-y border-border" data-testid="code-row" data-state={applied ? 'applied' : showField ? 'open' : 'collapsed'}>
      {applied ? (
        <>
          <div
            ref={appliedRef}
            tabIndex={-1}
            role="status"
            data-testid="code-row-applied"
            className="flex min-w-0 items-center justify-between gap-3 border-l-2 border-success py-1 pl-3 outline-none"
          >
            <p className="min-w-0 text-sm leading-snug text-text">
              <span className="font-mono font-semibold [overflow-wrap:anywhere]">{t('applied', { code: applied.code })}</span>
              <br />
              <span className="tabular text-muted">
                {applied.shipping ? t('savesShipping', { amount: applied.savedLabel }) : t('saves', { amount: applied.savedLabel })}
              </span>
            </p>
            <button
              type="button"
              onClick={onRemove}
              disabled={pending}
              className="min-h-[56px] min-w-[44px] shrink-0 px-2 text-[11px] font-medium uppercase tracking-label text-text underline underline-offset-4 hover:text-accent"
            >
              {t('remove')}
            </button>
          </div>
          {!another && (
            <button
              type="button"
              onClick={() => {
                focusInputNext.current = true;
                setAnother(true);
              }}
              className="flex min-h-[44px] items-center text-sm text-text underline underline-offset-4 hover:text-accent"
            >
              {t('useAnother')}
            </button>
          )}
          {field}
        </>
      ) : (
        <>
          <button
            ref={toggleRef}
            type="button"
            aria-expanded={showField}
            aria-controls={`${id}-panel`}
            onClick={() => {
              if (showField) {
                setOpen(false);
              } else {
                focusInputNext.current = true;
                setOpen(true);
              }
            }}
            className="flex min-h-[48px] w-full items-center justify-between gap-3 text-left text-sm text-text"
          >
            <span className="min-w-0">{label}</span>
            <span aria-hidden className="font-mono text-base text-muted">
              {showField ? '−' : '+'}
            </span>
          </button>
          <div id={`${id}-panel`}>{field}</div>
        </>
      )}
      <p role="status" aria-live="polite" data-testid="code-row-notice" className="text-[13px] leading-relaxed text-text empty:hidden [overflow-wrap:anywhere]">
        {notice ?? ''}
      </p>
    </div>
  );
}
