'use client';

import { useState } from 'react';
import Link from 'next/link';
import { CARD_SHOW } from '@/content/card-show';
import { CardShowApiError, type ConfirmDayResult, type LinkAction, postLinkAction } from '@/lib/card-show-api';

/**
 * Página de acción del doble opt-in (Diseño A, §CARDSHOW.6 / ARCHITECTURE §4.CARDSHOW.f).
 *
 * El GET ⛔ NO muta (C4): esta página solo LEE el `token` del query (lo recibe por prop desde el
 * server component) y queda a la espera del clic. El cambio de estado ocurre SOLO al pulsar el botón,
 * que dispara `POST application/json { token }` a `/api/v1/card-show/{confirm|cancel|unsubscribe}`.
 *
 * Copy funcional/transaccional, marca TCG HUNT, ⛔ sin datos del evento (fecha/sede/precio).
 */

type Phase = 'idle' | 'submitting' | 'success' | 'rejected' | 'error';

interface ActionCopy {
  eyebrow: string;
  title: string;
  intro: string;
  button: string;
  busy: string;
  /**
   * Texto de éxito por estado devuelto (`state`) con un defecto. `days` es el desglose por día de la
   * confirmación de GRUPO «los dos días» (§CARDSHOW.12 ⭐M-88): presente ⇒ nombra ambos días.
   */
  success: (state?: string, days?: ConfirmDayResult[]) => string;
}

/** Etiqueta de pantalla de un día, desde el content (fuente de verdad única: `torneos.dias`). */
function dayLabel(day: 'sat' | 'sun'): string {
  return CARD_SHOW.torneos.dias.find((d) => d.id === day)?.label ?? day;
}

/** Une etiquetas en español: «A», «A y B» (el torneo tiene a lo sumo 2 días). */
function joinDays(days: ConfirmDayResult[]): string {
  const labels = days.map((d) => dayLabel(d.day));
  if (labels.length <= 1) return labels.join('');
  return labels.slice(0, -1).join(', ') + ' y ' + labels[labels.length - 1];
}

/**
 * Copy de éxito de la confirmación cuando llega el desglose por día (§CARDSHOW.12 ⭐M-88). Nombra los
 * días confirmados y, si alguno quedó en lista de espera, los nombra aparte. `waitlist` = en espera;
 * cualquier otro estado (confirmed / ya preinscrito) cuenta como preinscrito.
 */
function groupConfirmText(days: ConfirmDayResult[]): string {
  const confirmed = days.filter((d) => d.state !== 'waitlist');
  const waitlisted = days.filter((d) => d.state === 'waitlist');
  if (waitlisted.length === 0) {
    return `¡Listo! Quedaste preinscrito para ${joinDays(confirmed)}.`;
  }
  if (confirmed.length === 0) {
    return `Quedaste en lista de espera para ${joinDays(waitlisted)}. Si se libera un lugar, te avisamos por correo.`;
  }
  return `Quedaste preinscrito para ${joinDays(confirmed)} y en lista de espera para ${joinDays(waitlisted)}; si se libera un lugar te avisamos por correo.`;
}

const COPY: Record<LinkAction, ActionCopy> = {
  confirm: {
    eyebrow: 'Confirmación de registro',
    title: 'Confirma tu registro',
    intro: 'Pulsa el botón para confirmar tu registro al Card Show de TCG HUNT.',
    button: 'Confirmar registro',
    busy: 'Confirmando…',
    success: (state, days) => {
      // GRUPO «los dos días» (§CARDSHOW.12 ⭐M-88): con 2+ días en el desglose se nombran. Con 1 día
      // o sin desglose (leads) ⇒ copy de un día (sin nombrar día).
      if (days && days.length >= 2) return groupConfirmText(days);
      return state === 'waitlist'
        ? 'Quedaste en lista de espera. Si se libera un lugar, te avisamos por correo.'
        : '¡Listo! Tu registro quedó confirmado.';
    },
  },
  cancel: {
    eyebrow: 'Cancelación',
    title: 'Cancela tu preinscripción',
    intro: 'Pulsa el botón para cancelar tu preinscripción al torneo del Card Show de TCG HUNT.',
    button: 'Cancelar preinscripción',
    busy: 'Cancelando…',
    success: () => 'Cancelado. Tu preinscripción quedó cancelada.',
  },
  unsubscribe: {
    eyebrow: 'Baja de correos',
    title: 'Date de baja',
    intro: 'Pulsa el botón para dejar de recibir correos del Card Show de TCG HUNT.',
    button: 'Darme de baja',
    busy: 'Procesando…',
    success: () => 'Te diste de baja. No volverás a recibir correos del Card Show.',
  },
};

/**
 * Traduce un error de la acción a un mensaje claro en español. BLOQ-7: el 410 (enlace ya usado) NO se
 * lee como error cuando la acción es `confirm` — lo normal es que ya hubieras confirmado; no hay nada
 * que arreglar. Para `cancel`/`unsubscribe` sí es informativo pero neutro.
 */
function errorText(e: unknown, action: LinkAction): string {
  if (e instanceof CardShowApiError) {
    if (e.status === 410) {
      return action === 'confirm'
        ? 'Parece que este enlace ya se usó. Si ya confirmaste tu registro, no necesitas hacer nada más.'
        : 'Este enlace ya se usó o expiró. Si ya completaste la acción, no necesitas hacer nada más.';
    }
    if (e.status === 429) return 'Demasiados intentos, espera un momento y vuelve a intentarlo.';
  }
  return 'No pudimos completar la acción. Inténtalo de nuevo en un momento.';
}

export function LinkActionClient({ action, token }: { action: LinkAction; token?: string }) {
  const copy = COPY[action];
  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState<string>('');
  const [successState, setSuccessState] = useState<string | undefined>(undefined);
  const [successDays, setSuccessDays] = useState<ConfirmDayResult[] | undefined>(undefined);

  const hasToken = typeof token === 'string' && token.length > 0;

  async function onSubmit() {
    if (!hasToken || phase === 'submitting') return;
    setPhase('submitting');
    try {
      const result = await postLinkAction(action, token as string);
      if (result.ok) {
        setSuccessState(result.state);
        setSuccessDays(result.days);
        setPhase('success');
      } else {
        setMessage(result.message);
        setPhase('rejected');
      }
    } catch (e) {
      setMessage(errorText(e, action));
      setPhase('error');
    }
  }

  return (
    <main className="gutter flex min-h-dvh flex-col justify-center py-16 sm:py-24">
      <div className="max-w-xl">
        <p className="font-brand text-sm uppercase tracking-wordmark text-accent">{CARD_SHOW.footer.marca}</p>
        <p className="eyebrow mt-6">{copy.eyebrow}</p>
        <h1 className="mt-3 font-serif text-h1 leading-[1.1]">{copy.title}</h1>

        {phase === 'success' && (
          <div role="status" className="rule-note mt-8 py-3">
            <p className="font-medium text-text">{copy.success(successState, successDays)}</p>
          </div>
        )}

        {phase === 'rejected' && (
          <div role="status" className="rule-note mt-8 py-3">
            <p className="font-medium text-text">{message}</p>
          </div>
        )}

        {(phase === 'idle' || phase === 'submitting' || phase === 'error') && (
          <>
            <p className="mt-4 max-w-prose text-muted">{copy.intro}</p>

            {!hasToken ? (
              <p role="alert" className="rule-note mt-8 py-3 font-medium text-text">
                Este enlace no es válido. Ábrelo desde el correo que te enviamos.
              </p>
            ) : (
              <>
                <div className="mt-10">
                  <button
                    type="button"
                    onClick={onSubmit}
                    disabled={phase === 'submitting'}
                    className="inline-flex min-h-[48px] items-center bg-accent px-8 text-xs uppercase leading-none tracking-[0.16em] text-accent-fg hover:bg-[color:var(--hunt-red-hover)] disabled:opacity-60"
                  >
                    {phase === 'submitting' ? copy.busy : copy.button}
                  </button>
                </div>
                {phase === 'error' && (
                  <p role="alert" className="mt-6 font-mono text-xs text-accent">
                    {message}
                  </p>
                )}
              </>
            )}
          </>
        )}

        {/* BLOQ-7: salida siempre disponible a la landing (no dejar al usuario en un callejón). */}
        <p className="mt-10">
          <Link
            href="/card-show"
            className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-[0.16em] text-accent underline underline-offset-4 hover:text-[color:var(--hunt-red-hover)]"
          >
            ← Volver al Card Show
          </Link>
        </p>
      </div>
    </main>
  );
}
