'use client';

import { useTranslations } from 'next-intl';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { useErrorMessage } from '@/components/ui/QueryState';
import { cn } from '@/lib/cn';

export type AccountSectionId =
  | 'profile'
  | 'email'
  | 'addresses'
  | 'billing'
  | 'kyc'
  | 'password'
  | 'session';

/**
 * Envoltorio de una sección de «Mi cuenta» (DESIGN_SYSTEM §33.6): `<section aria-labelledby>`
 * con `id` ancla, `h2` serif 24px, regla superior y `tabIndex={-1}` para recibir el foco al llegar
 * por `#id` (patrón P-4). El `h1` → `h2` sin saltos lo garantiza que TODA sección pase por aquí.
 */
export function SectionShell({
  id,
  title,
  children,
  className,
}: {
  id: AccountSectionId;
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      tabIndex={-1}
      data-account-section
      className={cn('mt-10 border-t border-border pt-8 outline-none focus-visible:shadow-focus', className)}
    >
      <h2 id={`${id}-title`} className="font-serif text-2xl leading-tight text-text">
        {title}
      </h2>
      <div className="mt-6">{children}</div>
    </section>
  );
}

/**
 * Línea de estado del patrón de edición (§33.6): `GUARDADO` mono verde con `role="status"` (no es
 * toast: persiste hasta el siguiente cambio) o el error del catálogo con `role="alert"`.
 */
export function SaveStatus({ saved, error }: { saved: boolean; error: unknown }) {
  const t = useTranslations('account');
  const getMessage = useErrorMessage();
  if (error) {
    return (
      <p role="alert" className="font-mono text-xs text-accent">
        {getMessage(error)}
      </p>
    );
  }
  if (saved) {
    return (
      <p role="status" className="font-mono text-[11px] uppercase tracking-label text-success">
        {t('saved')}
      </p>
    );
  }
  return null;
}

/** Error de CARGA de una sección: banner `danger` dentro de la sección con «Reintentar» (§33.6). */
export function SectionError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const t = useTranslations('common');
  const getMessage = useErrorMessage();
  return (
    <Banner
      variant="danger"
      role="alert"
      title={t('errorTitle')}
      action={
        <Button size="sm" variant="secondary" onClick={onRetry}>
          {t('retry')}
        </Button>
      }
    >
      {getMessage(error)}
    </Banner>
  );
}
