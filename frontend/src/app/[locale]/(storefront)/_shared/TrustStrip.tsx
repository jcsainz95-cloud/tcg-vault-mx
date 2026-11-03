'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { ABOUT_PATH, CONTACT_PHONE, INSTAGRAM_HANDLE, INSTAGRAM_URL, whatsappHref } from '@/lib/about';
import { cn } from '@/lib/cn';

/** Enlace de la franja: tinta subrayada y 44 px de toque (MKT-CONV.4); los externos abren en pestaña nueva. */
const LINK =
  'inline-flex min-h-[44px] items-center text-text underline underline-offset-4 hover:text-accent';

/**
 * DESIGN_SYSTEM MKT-CONV.4 (B2) + criterio 945 (reescrito 2026-11-03, `HECHOS.md` «Checkout y ficha: tres cambios
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
 * Forma: sans 12 px muted, sin versalitas, iconos ni caja; separadores `aria-hidden`; parte en renglones a 360 px
 * (`flex-wrap`, cada señal entera). ⚠ La maqueta de cuatro señales NO está en DESIGN_SYSTEM (MKT-CONV.4 fija la de
 * una línea «Pago seguro · Envío a México · Quiénes somos»): textos y forma provisionales, petición a ux-ui en
 * FRONTEND_NOTES §CTA-FE. «Pago seguro» se conserva (D-E, dueño 2026-11-01) y gana el método.
 */
export function TrustStrip({ className }: { className?: string }) {
  const t = useTranslations('about');
  const locale = useLocale() === 'en' ? 'en' : 'es';
  const phone = CONTACT_PHONE[locale];
  const wa = whatsappHref();
  const sep = (
    <span aria-hidden className="whitespace-pre">
      {' · '}
    </span>
  );
  return (
    <p
      data-testid="about-strip"
      className={cn('flex flex-wrap items-center text-[12px] leading-4 text-muted', className)}
    >
      <span data-testid="about-strip-payment">{t('strip.payment', { method: t('paymentMethod') })}</span>
      {sep}
      <span data-testid="about-strip-delivery">{t('strip.delivery', { days: t('deliveryDays') })}</span>
      {wa && (
        <>
          {sep}
          <a href={wa} target="_blank" rel="noopener noreferrer" className={LINK}>
            {t('strip.whatsapp', { phone })}
          </a>
        </>
      )}
      {sep}
      <a href={INSTAGRAM_URL} target="_blank" rel="noopener noreferrer" className={LINK}>
        {t('strip.instagram', { handle: INSTAGRAM_HANDLE })}
      </a>
      {sep}
      <Link href={ABOUT_PATH} aria-label={t('strip.linkLabel')} className={LINK}>
        {t('strip.link')}
      </Link>
    </p>
  );
}
