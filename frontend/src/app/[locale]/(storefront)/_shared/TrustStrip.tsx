'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { ABOUT_PATH, CONTACT_PHONE, INSTAGRAM_HANDLE, INSTAGRAM_URL, whatsappHref } from '@/lib/about';
import { cn } from '@/lib/cn';

/**
 * Enlace de la franja: tinta subrayada 12 px y 44 px de toque (§CTA-UX.1 candado (c)); cada enlace va entero
 * (`whitespace-nowrap`): si no cabe, baja completo al renglón siguiente.
 */
const LINK =
  'inline-flex min-h-[44px] items-center whitespace-nowrap text-text underline underline-offset-4 hover:text-accent';

/**
 * DESIGN_SYSTEM §CTA-UX.1 (vCTA-1) + criterio 945 (reescrito 2026-11-03, `HECHOS.md` «Checkout y ficha: tres cambios
 * aprobados…» (2)) — franja de confianza en la ficha (bajo los renglones de compra, antes de la lista de deseos) y en
 * el carrito (bajo «Tu carrito»; nunca dentro de la barra de PAGAR). Las cuatro señales de 944, sin pulsar nada:
 * (a) **cómo se paga: solo tarjeta** — ⛔ nunca OXXO (P-CTA-6, API_CONTRACT §CTA.8: texto fijo, sin endpoint);
 * (b) plazo de entrega; (c) WhatsApp, que abre `wa.me`; (d) Instagram, que abre el perfil; y el enlace a «Quiénes
 * somos y contacto».
 *
 * **Un hecho, un sitio** (944: «los mismos datos que Quiénes somos, sin otra fuente»): el método de pago y el plazo
 * son `about.paymentMethod` y `about.deliveryDays`, que también arman las filas «Pago» y «Plazo de entrega» de
 * `/nosotros`; número, enlace de WhatsApp e Instagram salen de `lib/about.ts`, que también lee la página y el JSON-LD.
 *
 * Forma (§CTA-UX.1): un grupo con nombre («Pago, entrega y contacto») y **dos renglones**:
 *  - datos: `<p>` sans 12/16 `muted`; el único « ·» es `aria-hidden` y va **pegado al primer dato** con espacio duro
 *    dentro del mismo bloque irrompible, así que el salto solo puede caer DESPUÉS de él (nunca abre un renglón);
 *  - enlaces: `<ul>` `flex-wrap gap-x-5` **sin separadores** (el subrayado separa); WhatsApp e Instagram abren pestaña
 *    nueva y lo dicen a lector de pantalla (`about.strip.newTab`, `sr-only`; el nombre sigue conteniendo el texto
 *    visible, WCAG 2.5.3). Sin teléfono configurado no hay WhatsApp ni hueco.
 * El ancho a 360 px se mide en navegador (`e2e/cuenta-correo.spec.ts`, candados (b) y (c)).
 */
export function TrustStrip({ className }: { className?: string }) {
  const t = useTranslations('about');
  const locale = useLocale() === 'en' ? 'en' : 'es';
  const phone = CONTACT_PHONE[locale];
  const wa = whatsappHref();
  const newTab = <span className="sr-only">{t('strip.newTab')}</span>;
  return (
    <div
      role="group"
      aria-label={t('strip.groupLabel')}
      data-testid="about-strip"
      className={cn('text-[12px] leading-4', className)}
    >
      <p className="text-muted">
        <span className="whitespace-nowrap">
          <span data-testid="about-strip-payment">{t('strip.payment', { method: t('paymentMethod') })}</span>
          <span aria-hidden>{'\u00a0·'}</span>
        </span>{' '}
        <span data-testid="about-strip-delivery" className="whitespace-nowrap">
          {t('strip.delivery', { days: t('deliveryDays') })}
        </span>
      </p>
      <ul className="flex flex-wrap gap-x-5">
        {wa && (
          <li>
            <a href={wa} target="_blank" rel="noopener noreferrer" className={LINK}>
              {t('strip.whatsapp', { phone })}
              {newTab}
            </a>
          </li>
        )}
        <li>
          <a href={INSTAGRAM_URL} target="_blank" rel="noopener noreferrer" className={LINK}>
            {t('strip.instagram', { handle: INSTAGRAM_HANDLE })}
            {newTab}
          </a>
        </li>
        <li>
          <Link href={ABOUT_PATH} aria-label={t('strip.linkLabel')} className={LINK}>
            {t('strip.link')}
          </Link>
        </li>
      </ul>
    </div>
  );
}
