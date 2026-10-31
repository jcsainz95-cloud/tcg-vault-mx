import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { getAccessory } from '@/lib/api';
import { withBudget } from '@/lib/home-ssr';
import { routeMetadata } from '@/lib/seo';
import { AccessoryDetailView } from './AccessoryDetailView';
import { RouteMessages } from '@/components/i18n/RouteMessages';

/**
 * C4 (BRIEF_MKT Ola 2): título con el nombre del accesorio, descripción y canonical propios (antes heredaba los de la
 * portada). El nombre sale de `GET /accessories/:id` (público) con tope de 400 ms; sin él, el título de la sección.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<Metadata> {
  const { locale, id } = await params;
  const [acc, t, tc] = await Promise.all([
    withBudget(getAccessory(id), 400),
    getTranslations({ locale, namespace: 'seo.pages' }),
    getTranslations({ locale, namespace: 'common' }),
  ]);
  return routeMetadata({
    locale,
    path: `/accesorios/${encodeURIComponent(id)}`,
    title: acc ? `${acc.name} | ${tc('appName')}` : `${tc('appName')} — ${t('accessories.title')}`,
    description: acc ? t('accessoryDetail.description', { name: acc.name }) : t('accessories.description'),
  });
}

export default async function AccessoryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // §DYN.6.7 (c1): el ámbito `storefront` de esta página (`RouteMessages`; la raíz manda solo `SHELL`).
  return (
    <RouteMessages scope="storefront">
      <AccessoryDetailView id={id} />
    </RouteMessages>
  );
}
