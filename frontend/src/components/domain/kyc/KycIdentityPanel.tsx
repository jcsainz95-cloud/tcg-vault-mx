'use client';

import { useTranslations } from 'next-intl';
import { formatDate } from '@/lib/format';
import type { AppLocale } from '@/i18n/routing';
import type { AddressDTO, AdminShipmentRecipientRef, NameSource } from '@/types/contract';

export interface KycIdentityPanelProps {
  name: string;
  nameSource?: NameSource;
  email: string;
  phone?: string;
  clabeMasked?: string;
  createdAt: string;
  addresses: AddressDTO[];
  recentShipmentRecipients: AdminShipmentRecipientRef[];
  locale: AppLocale;
}

/**
 * El panel de cotejo (DESIGN_SYSTEM §34.5): lo que va **al lado** del documento porque es
 * exactamente lo que el dueño pidió cotejar — el nombre, las direcciones y **a nombre de quién han
 * salido sus paquetes**.
 *
 * ⛔⛔ **Lo que este panel NO hace (§34.5 nota, regla 7, H13):** no compara cadenas, no marca
 * coincidencias en verde, no ordena por parecido, no dice «el nombre coincide». El cotejo
 * automático **está retirado por contrato** (`API_CONTRACT:903-919`) y una marca de color aquí
 * sería el cotejo reintroducido por la puerta de atrás. **Pone los datos a la misma altura y la
 * persona decide.**
 *
 * ⛔ Regla 8 (§34.2): lo que no tenemos no se pinta. Sin destinatario se escribe «Sin
 * destinatario» — **nunca** el `User.name` ni el `userId`: derivarlo sería inventar el dato que el
 * cotejo intenta comprobar.
 */
export function KycIdentityPanel({
  name,
  nameSource,
  email,
  phone,
  clabeMasked,
  createdAt,
  addresses,
  recentShipmentRecipients,
  locale,
}: KycIdentityPanelProps) {
  const t = useTranslations('admin.m6.kycReview');

  return (
    <aside className="flex flex-col gap-5 text-sm lg:sticky lg:top-[var(--app-header-h,0px)]">
      <section className="flex flex-col gap-2">
        <h2 className="eyebrow">{t('identityTitle')}</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
          <dt className="text-muted">{t('name')}</dt>
          <dd className="text-base font-medium text-text">{name}</dd>
          <dt className="text-muted">{t('email')}</dt>
          <dd className="tabular break-all">{email}</dd>
          <dt className="text-muted">{t('phone')}</dt>
          <dd className="tabular">{phone ?? '—'}</dd>
          <dt className="text-muted">{t('clabe')}</dt>
          {/* CLABE SIEMPRE enmascarada, también para super_admin (§M6-K.3). En claro solo por
              `reveal-clabe`, que es otra superficie y otro acto auditado. */}
          <dd className="tabular font-mono">{clabeMasked ?? '—'}</dd>
          <dt className="text-muted">{t('createdAt')}</dt>
          <dd className="tabular">{formatDate(createdAt, locale)}</dd>
        </dl>

        {/* ⭐ De dónde sale el nombre. Sin esto, la pantalla invitaría al error exacto que P-73
            documentó: cotejar una INE contra «jcsainz95». */}
        {nameSource === 'derived' && (
          <p className="border-l-2 border-accent pl-3 text-xs text-text" role="note">
            {t('nameDerivedWarn')}
          </p>
        )}
        {nameSource === 'google' && (
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
            {t('nameFromGoogle')}
          </p>
        )}
      </section>

      <section className="flex flex-col gap-2 border-t border-border pt-4">
        <h2 className="eyebrow">{t('addressesTitle', { count: addresses.length })}</h2>
        {addresses.length === 0 ? (
          <p className="text-muted">{t('addressesEmpty')}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {addresses.map((a) => (
              <li key={a.id} className="flex flex-col gap-0.5 border-t border-border pt-2 first:border-t-0 first:pt-0">
                {a.recipientName ? (
                  <span className="font-medium text-text">{t('recipient', { name: a.recipientName })}</span>
                ) : (
                  <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
                    {t('recipientMissing')}
                  </span>
                )}
                <span className="text-muted">
                  {a.line1}
                  {a.line2 ? `, ${a.line2}` : ''}
                </span>
                <span className="text-muted">
                  {a.neighborhood ? `${a.neighborhood} · ` : ''}
                  {a.city} · {a.state} · <span className="tabular">{a.postalCode}</span>
                </span>
                {a.phone && <span className="tabular font-mono text-[11px] text-muted">{a.phone}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2 border-t border-border pt-4">
        <h2 className="eyebrow">{t('shipmentsTitle', { count: recentShipmentRecipients.length })}</h2>
        {recentShipmentRecipients.length === 0 ? (
          <p className="text-muted">{t('shipmentsEmpty')}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {recentShipmentRecipients.map((s) => (
              <li key={s.shipmentId} className="text-muted">
                {s.recipientName ? (
                  <span className="font-medium text-text">{s.recipientName}</span>
                ) : (
                  <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
                    {t('recipientMissing')}
                  </span>
                )}{' '}
                · {s.city}, {s.state} · <span className="tabular">{formatDate(s.createdAt, locale)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  );
}
