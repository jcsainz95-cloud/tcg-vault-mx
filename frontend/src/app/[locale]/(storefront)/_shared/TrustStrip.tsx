'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { ABOUT_PATH } from '@/lib/about';
import { cn } from '@/lib/cn';

/**
 * DESIGN_SYSTEM MKT-CONV.4 (B2, criterio 945) — franja de confianza de UNA línea, en la ficha (bajo los renglones de
 * compra, antes de la lista de deseos) y en el carrito (bajo «Tu carrito»; nunca dentro de la barra de PAGAR).
 * Sans 12 px muted, sin versalitas, iconos ni caja; separadores `aria-hidden`; el enlace en tinta subrayada a
 * `/nosotros`, con nombre accesible «Quiénes somos y contacto» (contiene el texto visible, WCAG 2.5.3) y 44 px de
 * toque por padding vertical. «Pago con tarjeta» en lugar de «Pago seguro»: D-E no está decidida (FRONTEND_NOTES
 * §MKT-CONV2).
 */
export function TrustStrip({ className }: { className?: string }) {
  const t = useTranslations('about.strip');
  return (
    <p data-testid="about-strip" className={cn('text-[12px] leading-4 text-muted', className)}>
      {t('payment')}
      <span aria-hidden> · </span>
      {t('shipping')}
      <span aria-hidden> · </span>
      <Link
        href={ABOUT_PATH}
        aria-label={t('linkLabel')}
        className="inline-block py-[14px] text-text underline underline-offset-4 hover:text-accent"
      >
        {t('link')}
      </Link>
    </p>
  );
}
