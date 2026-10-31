import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { getDeckMeta } from '@/lib/api';
import { withBudget } from '@/lib/home-ssr';
import { routeMetadata } from '@/lib/seo';
import { DeckDetailView } from './DeckDetailView';
import { RouteMessages } from '@/components/i18n/RouteMessages';

/**
 * C4 (BRIEF_MKT Ola 2): título con el nombre del deck, descripción y canonical propios (antes heredaba los de la
 * portada). El nombre sale de `GET /decks-meta/:slug` (público) con tope de 400 ms; sin él, el título de la sección.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  const [deck, t, tc] = await Promise.all([
    withBudget(getDeckMeta(slug), 400),
    getTranslations({ locale, namespace: 'seo.pages' }),
    getTranslations({ locale, namespace: 'common' }),
  ]);
  return routeMetadata({
    locale,
    path: `/decks-meta/${encodeURIComponent(slug)}`,
    title: deck
      ? `${deck.name} · ${t('decksMeta.title')} | ${tc('appName')}`
      : `${tc('appName')} — ${t('decksMeta.title')}`,
    description: deck ? t('deckDetail.description', { name: deck.name }) : t('decksMeta.description'),
  });
}

export default async function DeckDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  // §DYN.6.7 (c1): el ámbito `storefront` de esta página (`RouteMessages`; la raíz manda solo `SHELL`).
  return (
    <RouteMessages scope="storefront">
      <DeckDetailView slug={slug} />
    </RouteMessages>
  );
}
