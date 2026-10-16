'use client';

import { useState } from 'react';
import { CARD_SHOW } from '@/content/card-show';
import { CardShowApiError, type LinkAction, postLinkAction } from '@/lib/card-show-api';

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
  /** Texto de éxito por estado devuelto (`state`) con un defecto. */
  success: (state?: string) => string;
}

const COPY: Record<LinkAction, ActionCopy> = {
  confirm: {
    eyebrow: 'Confirmación de registro',
    title: 'Confirma tu registro',
    intro: 'Pulsa el botón para confirmar tu registro al Card Show de TCG HUNT.',
    button: 'Confirmar registro',
    busy: 'Confirmando…',
    success: (state) =>
      state === 'waitlist'
        ? 'Quedaste en lista de espera. Si se libera un lugar, te avisamos por correo.'
        : '¡Listo! Tu registro quedó confirmado.',
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

/** Traduce un error de la acción a un mensaje claro en español. */
function errorText(e: unknown): string {
  if (e instanceof CardShowApiError) {
    if (e.status === 410) return 'Este enlace ya se usó o expiró.';
    if (e.status === 429) return 'Demasiados intentos, espera un momento y vuelve a intentarlo.';
  }
  return 'No pudimos completar la acción. Inténtalo de nuevo en un momento.';
}

export function LinkActionClient({ action, token }: { action: LinkAction; token?: string }) {
  const copy = COPY[action];
  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState<string>('');
  const [successState, setSuccessState] = useState<string | undefined>(undefined);

  const hasToken = typeof token === 'string' && token.length > 0;

  async function onSubmit() {
    if (!hasToken || phase === 'submitting') return;
    setPhase('submitting');
    try {
      const result = await postLinkAction(action, token as string);
      if (result.ok) {
        setSuccessState(result.state);
        setPhase('success');
      } else {
        setMessage(result.message);
        setPhase('rejected');
      }
    } catch (e) {
      setMessage(errorText(e));
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
            <p className="font-medium text-text">{copy.success(successState)}</p>
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
      </div>
    </main>
  );
}
