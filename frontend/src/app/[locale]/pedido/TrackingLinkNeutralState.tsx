'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { resendGuestTrackingLink } from '@/lib/api';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Banner } from '@/components/ui/Banner';
import { isValidEmail } from '../(storefront)/checkout/guest-validation';
import { SUPPORT_CONTACT_FALLBACK } from '../(storefront)/checkout/support-contact';

export interface TrackingLinkNeutralStateProps {
  /**
   * Token que venía en el enlace (si lo había). Con token, el reenvío usa la forma
   * `{ token }` del contrato §4-G.4 (camino preferente); sin él hace falta el par
   * `{ email, orderNumber }` — `email` a secas NUNCA se acepta.
   */
  token?: string;
}

/** Enfriamiento visible tras cada intento. Idéntico en TODOS los casos, incluido el 429. */
const COOLDOWN_SECONDS = 60;
/** Latencia mínima visible: que "encontrado" y "no encontrado" tarden lo mismo en pantalla. */
const MIN_VISIBLE_MS = 700;

/**
 * `TrackingLinkNeutralState` (DESIGN_SYSTEM §15.7, criterios 52 y 53) — **superficie de
 * seguridad**.
 *
 * REGLA NÚMERO UNO: una sola pantalla para TODOS los fallos. Token expirado, manipulado,
 * inventado, de otro pedido, revocado, pedido inexistente o `429` ⇒ exactamente este
 * componente, el mismo texto y el mismo layout. Aquí NO se ramifica por código de estado ni
 * se imprime el `errorCode`: cualquier diferencia visible convierte la pantalla en un
 * oráculo ("¿este correo compró aquí?").
 *
 * Por eso también: el resultado del reenvío se pinta SIEMPRE igual (`Banner info`, nunca
 * verde de éxito ni bermellón de error), el enfriamiento es el mismo siempre, y el `429`
 * muestra el mismo mensaje que un envío correcto. El backend responde `202 ACCEPTED` exista
 * o no el pedido (§4-G.4); esta UI no delata la diferencia.
 */
export function TrackingLinkNeutralState({ token }: TrackingLinkNeutralStateProps) {
  const t = useTranslations('track.neutral');
  const tTrack = useTranslations('track');
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [email, setEmail] = useState('');
  const [orderNumber, setOrderNumber] = useState('');
  const [manualForm, setManualForm] = useState(!token);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  // El h1 recibe el foco al montar para que el lector anuncie el estado (§15.7).
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (sending || cooldown > 0) return;

    // Validación LOCAL de formato únicamente: el campo nunca se valida contra el servidor.
    let invalid = false;
    if (manualForm) {
      if (!isValidEmail(email)) {
        setEmailError(t('emailInvalid'));
        invalid = true;
      } else setEmailError(null);
      if (!orderNumber.trim()) {
        setOrderError(t('orderNumberRequired'));
        invalid = true;
      } else setOrderError(null);
      if (invalid) return;
    }

    setSending(true);
    const request = manualForm
      ? { email: email.trim(), orderNumber: orderNumber.trim() }
      : { token: token as string };
    try {
      await Promise.all([
        resendGuestTrackingLink(request),
        new Promise((resolve) => setTimeout(resolve, MIN_VISIBLE_MS)),
      ]);
    } catch {
      // Deliberado: CUALQUIER fallo (429, red, 400) se pinta igual que el éxito. No hay
      // rama de error en esta pantalla.
    } finally {
      setSending(false);
      setSent(true);
      setCooldown(COOLDOWN_SECONDS);
    }
  }

  return (
    <div className="gutter max-w-xl py-16" data-testid="tracking-neutral-state">
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="font-serif text-[30px] leading-[1.1] text-text outline-none lg:text-[38px]"
      >
        {t('title')}
      </h1>
      <p className="rule-note mt-6 text-[15px] leading-[1.7] text-muted">{t('body')}</p>

      {sent ? (
        <div className="mt-8">
          {/* Mismo tratamiento neutro SIEMPRE: el verde leería como "sí, existe". */}
          <Banner variant="info" role="status">
            {t('result')}
          </Banner>
          <p className="mt-4 font-mono text-xs text-muted" aria-live="off">
            {cooldown > 0 ? t('cooldown', { seconds: cooldown }) : ''}
          </p>
          <span className="sr-only" role="status">
            {cooldown > 0 ? t('cooldownAnnounce') : ''}
          </span>
          {cooldown === 0 && (
            <Button variant="secondary" className="mt-4" onClick={() => setSent(false)}>
              {t('submit')}
            </Button>
          )}
        </div>
      ) : (
        <form onSubmit={submit} className="mt-8">
          {manualForm && (
            <div className="flex max-w-[420px] flex-col gap-6">
              <Input
                label={t('emailLabel')}
                type="email"
                inputMode="email"
                autoComplete="email"
                spellCheck={false}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                error={emailError ?? undefined}
              />
              {/*
               * El contrato §4-G.4 NO acepta `email` a secas: exige `{ email, orderNumber }`
               * juntos, justamente para que el reenvío no sirva de oráculo ("¿este correo
               * compró aquí?") ni de vector de spam a terceros. Por eso el formulario pide
               * también el número de pedido, que el comprador tiene en su correo.
               */}
              <Input
                label={t('orderNumberLabel')}
                value={orderNumber}
                onChange={(e) => setOrderNumber(e.target.value)}
                hint={t('orderNumberHelp')}
                error={orderError ?? undefined}
              />
            </div>
          )}
          <Button type="submit" variant="primary" loading={sending} className="mt-7">
            {t('submit')}
          </Button>
          {!manualForm && (
            <button
              type="button"
              onClick={() => setManualForm(true)}
              className="mt-5 block text-sm text-accent underline underline-offset-4 hover:text-text"
            >
              {t('noLinkToggle')}
            </button>
          )}
        </form>
      )}

      {/* El reclamo NO necesita enlace vigente: siempre queda esta salida (PROJECT §J). */}
      <div className="mt-10 border-t border-border pt-8">
        <p className="text-sm leading-relaxed text-muted">{t('claimAlternative')}</p>
        <Link
          href="/register"
          className="mt-3 inline-block text-sm text-accent underline underline-offset-4 hover:text-text"
        >
          {tTrack('createAccountCta')}
        </Link>
      </div>
      <p className="mt-4 text-xs leading-relaxed text-muted">
        {t('support', { contact: SUPPORT_CONTACT_FALLBACK })}
      </p>
    </div>
  );
}
