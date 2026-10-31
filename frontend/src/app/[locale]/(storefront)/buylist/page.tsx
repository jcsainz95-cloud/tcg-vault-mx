import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { routeMetadata } from '@/lib/seo';
import { BuylistView } from './BuylistView';
import { RouteMessages } from '@/components/i18n/RouteMessages';

/** C4 (BRIEF_MKT Ola 2): título, descripción y canonical propios (antes heredaba los de la portada, sin canonical). */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const [t, tc] = await Promise.all([
    getTranslations({ locale, namespace: 'seo.pages.buylist' }),
    getTranslations({ locale, namespace: 'common' }),
  ]);
  return routeMetadata({
    locale,
    path: '/buylist',
    title: `${tc('appName')} — ${t('title')}`,
    description: t('description'),
  });
}

export default function BuylistPage() {
  // §DYN.6.7 (c1): el ámbito `storefront` de esta página (`RouteMessages`; la raíz manda solo `SHELL`).
  return (
    <RouteMessages scope="storefront">
      <BuylistView />
    </RouteMessages>
  );
}
