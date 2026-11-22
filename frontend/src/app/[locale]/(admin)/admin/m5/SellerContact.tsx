'use client';

import { useTranslations } from 'next-intl';
import { safeHttpUrl, mailtoHref } from '@/lib/safe-href';

/**
 * Normaliza un teléfono móvil mexicano al formato de `wa.me` (52 + 10 dígitos, sin «+», sin «1»).
 * Acepta 10 dígitos, `52…`, `+52…` y el viejo `521…`; sin lada ni dígitos suficientes ⇒ `null`
 * (no se ofrece WhatsApp antes que un enlace a un número equivocado).
 */
export function normalizeWhatsappMx(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = raw.replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 13 && d.startsWith('521')) d = d.slice(3);
  else if (d.length === 12 && d.startsWith('52')) d = d.slice(2);
  if (!/^\d{10}$/.test(d)) return null;
  return `52${d}`;
}

interface Props {
  seller?: { name: string; email: string; phone?: string | null } | null;
  /** Teléfono del domicilio de recolección, solo si el DTO lo trae. */
  pickupPhone?: string | null;
}

const LINK =
  'underline underline-offset-2 hover:text-text focus-visible:shadow-focus focus-visible:outline-none';

/** Contacto del vendedor (back-office, tras el guard de rol): `tel:` + WhatsApp, o correo si no hay teléfono. */
export function SellerContact({ seller, pickupPhone }: Props) {
  const t = useTranslations('admin.m5.sellerContact');
  if (!seller) return null;
  const own = seller.phone?.trim() || null;
  const phone = own ?? (pickupPhone?.trim() || null);
  const wa = normalizeWhatsappMx(phone);
  if (!phone) {
    return (
      <span data-testid="seller-contact" className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
        <span>{t('none')}</span>
        {seller.email && (
          <a href={mailtoHref(seller.email)} className={LINK}>
            {t('email')}
          </a>
        )}
      </span>
    );
  }
  return (
    <span data-testid="seller-contact" className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
      <a
        href={`tel:${phone.replace(/[^\d+]/g, '')}`}
        aria-label={t('callLabel', { name: seller.name })}
        className={`tabular font-mono ${LINK}`}
      >
        {phone}
      </a>
      {own == null && <span>{t('fromAddress')}</span>}
      {wa && (
        <a
          href={`https://wa.me/${wa}`}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t('whatsappLabel', { name: seller.name })}
          className={`border border-border px-1.5 py-0.5 uppercase tracking-wide ${LINK}`}
        >
          {t('whatsapp')}
        </a>
      )}
    </span>
  );
}
