import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { routeMetadata } from '@/lib/seo';
import { Suspense } from 'react';
import { AccessoriesShopView } from './AccessoriesShopView';
import { RouteMessages } from '@/components/i18n/RouteMessages';

/** C4 (BRIEF_MKT Ola 2): título, descripción y canonical propios (antes heredaba los de la portada, sin canonical). */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const [t, tc] = await Promise.all([
    getTranslations({ locale, namespace: 'seo.pages.accessories' }),
    getTranslations({ locale, namespace: 'common' }),
  ]);
  return routeMetadata({
    locale,
    path: '/accesorios',
    title: `${tc('appName')} — ${t('title')}`,
    description: t('description'),
  });
}

export default function AccessoriesPage() {
  // StoreTabs y el filtro leen la URL con useSearchParams: requiere Suspense en Next 15.
  // §DYN.6.7 (c1): el ámbito `storefront` de esta página (`RouteMessages`; la raíz manda solo `SHELL`).
  return (
    <RouteMessages scope="storefront">
      <Suspense>
        <AccessoriesShopView />
      </Suspense>
    </RouteMessages>
  );
}
