'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { folioInventoryHref, folioOf, looksLikeFolio } from '@/lib/folio-hint';

/**
 * Pista bajo un buscador de CARTA cuando lo escrito parece un folio: «Para buscar una pieza por su folio usa «Buscar por
 * folio»» + enlace que abre ese folio directo en Inventario (M1 ⇒ «Detalle de pieza» o «No existe esa pieza»).
 */
export function FolioHint({ query }: { query: string }) {
  const t = useTranslations('admin.folioHint');
  if (!looksLikeFolio(query)) return null;
  return (
    <p className="text-xs leading-relaxed text-muted" role="status" data-testid="folio-hint">
      {t('text')}{' '}
      <Link href={folioInventoryHref(query)} className="text-text underline underline-offset-4 hover:text-accent focus-visible:shadow-focus focus-visible:outline-none">
        {t('open', { folio: folioOf(query) })}
      </Link>
    </p>
  );
}
