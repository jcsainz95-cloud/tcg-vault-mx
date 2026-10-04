'use client';

import { useTranslations } from 'next-intl';
import { SectionShell } from './SectionShell';

/**
 * ⭐ v1.80.9 (DESIGN_SYSTEM §42.8, criterio 263) · Usuario (`#username`): la sección que sustituye a
 * «Correo» en una cuenta del equipo SIN correo. Solo lectura: el usuario no se edita (P-STF-3).
 * ⛔ Sin pill de verificación, sin `mailto:`, sin botón.
 */
export function UsernameSection({ username }: { username: string }) {
  const t = useTranslations('account.username');
  return (
    <SectionShell id="username" title={t('title')}>
      <p className="break-all font-mono text-base text-text">{username}</p>
      <p className="mt-3 text-xs text-muted">{t('note')}</p>
    </SectionShell>
  );
}
