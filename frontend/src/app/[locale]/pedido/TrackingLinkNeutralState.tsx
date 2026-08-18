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
   * Token que venía en el enlace (si lo había). Con token se usa la **vía A** del contrato
   * §4-G.4 / DESIGN_SYSTEM §15.7: `{ token }`, sin pedir ningún campo. Sin token (o si el
   * usuario abre "No tengo el enlace") va la **vía B**: `{ email, orderNumber }` JUNTOS —
   * el correo por sí solo NUNCA se acepta.
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
 * Por qué el formulario pide DOS datos (arbitraje del arquitecto, §15.7): un formulario de
 * un único campo de correo es el oráculo de enumeración que prohíbe el criterio 53 —basta
 * con que el correo llegue (o no)— y convierte a la plataforma en emisora de correo hacia
 * terceros. El número de pedido ata la petición a algo que solo tiene quien compró.
 *
 * Neutralidad que NO se relaja: la respuesta es **la misma frase** en la vía A y en la vía B,
 * coincidan o no los datos; el `429` muestra ese mismo mensaje; el resultado se pinta con
 * `Banner info` (nunca verde de éxito ni bermellón de error) y el enfriamiento es idéntico
 * siempre. La validación es **solo local**: formato del correo y que el número de pedido no
 * esté vacío. Ningún campo consulta al servidor (si lo hiciera, el campo sería el oráculo).
 */
export function TrackingLinkNeutralState({ token }: TrackingLinkNeutralStateProps) {
  const t = useTranslations('track.neutral');
  const tTrack = useTranslations('track');
  const headingRef = useRef<HTMLHeadingElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState('');
  const [orderNumber, setOrderNumber] = useState('');
  // Vía B revelada por disclosure: sin token arranca abierta (no hay otra forma de pedirlo);
  // con token permanece cerrada, porque el caso común es bastar el botón (§15.7).
  const [manualOpen, setManualOpen] = useState(!token);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  const useManual = manualOpen || !token;
  const emailOk = isValidEmail(email);
  const orderOk = orderNumber.trim().length > 0;
  const incomplete = useManual && !(emailOk && orderOk);

  // El h1 recibe el foco al montar para que el lector anuncie el estado (§15.7).
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  // El disclosure de la vía B mueve el foco al PRIMER campo al abrirse (§15.7). Solo aplica
  // al camino con token: sin token la vía B ya está desplegada al montar y el foco lo tiene
  // el h1 (que es lo que debe anunciar el lector).
  useEffect(() => {
    if (token && manualOpen) emailRef.current?.focus();
  }, [token, manualOpen]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (sending || cooldown > 0 || incomplete) return;

    setSending(true);
    const request = useManual
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
          {/* Mismo tratamiento neutro SIEMPRE (vía A y vía B): el verde leería como "sí, existe". */}
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
          {useManual && (
            /* Vía B: los dos campos en un fieldset; la intro es su legend (§15.7). */
            <fieldset id="neutral-manual-form" className="max-w-[420px] border-0 p-0">
              <legend className="mb-5 text-sm leading-relaxed text-muted">{t('manualIntro')}</legend>
              <div className="flex flex-col gap-6">
                <Input
                  ref={emailRef}
                  id="neutral-email"
                  label={t('emailLabel')}
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  spellCheck={false}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  aria-invalid={!emailOk || undefined}
                  aria-describedby={!emailOk ? 'neutral-incomplete-note' : undefined}
                />
                {/*
                 * El número de pedido NO lleva `autocomplete` (§15.7) y NO se valida contra
                 * el servidor ni contra ningún catálogo: solo que no esté vacío. Validarlo
                 * en `blur` convertiría este campo en el oráculo que el criterio 53 prohíbe.
                 */}
                <Input
                  id="neutral-order"
                  label={t('orderNumberLabel')}
                  autoComplete="off"
                  value={orderNumber}
                  onChange={(e) => setOrderNumber(e.target.value)}
                  hint={t('orderNumberHelp')}
                  aria-invalid={!orderOk || undefined}
                  // La ayuda del campo se conserva en el describedby; la nota de validación
                  // local se suma solo mientras falte el dato.
                  aria-describedby={
                    orderOk ? 'neutral-order-hint' : 'neutral-incomplete-note neutral-order-hint'
                  }
                />
              </div>
            </fieldset>
          )}

          {/* Nota de validación LOCAL: ni afirma ni niega nada sobre los datos. */}
          <p
            id="neutral-incomplete-note"
            className={incomplete ? 'mt-5 text-xs leading-relaxed text-muted' : 'sr-only'}
          >
            {incomplete ? t('incompleteForm') : ''}
          </p>

          <Button
            type="submit"
            variant="primary"
            loading={sending}
            disabled={incomplete}
            aria-describedby={incomplete ? 'neutral-incomplete-note' : undefined}
            className="mt-6"
          >
            {t('submit')}
          </Button>

          {/* Disclosure de la vía B: solo tiene sentido cuando SÍ hay token (si no, la vía B
              es el único camino y ya está desplegada). */}
          {token && (
            <button
              type="button"
              onClick={() => setManualOpen(true)}
              disabled={manualOpen}
              aria-expanded={manualOpen}
              aria-controls="neutral-manual-form"
              className="mt-5 block text-sm text-accent underline underline-offset-4 hover:text-text disabled:hidden"
            >
              {t('noLinkCta')}
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
