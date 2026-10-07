'use client';

import { useTranslations } from 'next-intl';
import { X } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Banner } from '@/components/ui/Banner';
import { clearAccessoryNotices, useAccessoryNotices, type AccessoryNotice } from './accessory-notice';

/**
 * Los avisos de AC-UX.5 / AC-F18 (`role="status"`, informativos: no es un error del cliente). Con `name`
 * (v1.86.1) el aviso nombra el accesorio; sin él (`not_found`), la variante sin nombre del diseño.
 */
export function AccessoryCartNotices({ className }: { className?: string }) {
  const t = useTranslations('checkout.accessoryNotice');
  const notices = useAccessoryNotices();
  if (notices.length === 0) return null;

  const unnamedGone = notices.filter((n) => n.kind === 'removed' && n.reason !== 'sold_out' && !n.name);
  const lines: { key: string; text: string; deckSlug?: string | null }[] = [];
  if (unnamedGone.length === 1) lines.push({ key: 'gone-1', text: t('inactiveOne') });
  if (unnamedGone.length > 1) lines.push({ key: 'gone-n', text: t('inactiveMany', { n: unnamedGone.length }) });
  notices.forEach((n: AccessoryNotice, i) => {
    const key = `${n.kind}-${i}`;
    if (n.kind === 'removed') {
      if (n.reason === 'sold_out') lines.push({ key, text: n.name ? t('soldOutNamed', { name: n.name }) : t('soldOutOne') });
      else if (n.name) lines.push({ key, text: t('inactiveNamed', { name: n.name }) });
    } else if (n.kind === 'insufficient') {
      lines.push({
        key,
        text: n.name ? t('insufficient', { n: n.availableQty, name: n.name }) : t('insufficientNoName', { n: n.availableQty }),
      });
    } else {
      const deck = n.deckName;
      const pick = (named: string, unnamed: string) => (deck ? t(named, { deck }) : t(unnamed));
      const text =
        n.reason === 'deck_incomplete'
          ? pick('bundleDeckIncomplete', 'bundleDeckIncompleteNoName')
          : n.reason === 'insufficient_stock'
            ? pick('bundleNoStock', 'bundleNoStockNoName')
            : n.reason === 'expired'
              ? pick('bundleExpired', 'bundleExpiredNoName')
              : n.reason === 'invalid_token'
                ? t('bundleInvalid')
                : pick('bundleUnavailable', 'bundleUnavailableNoName');
      const linkable = n.slug && (n.reason === 'insufficient_stock' || n.reason === 'expired');
      lines.push({ key, text, deckSlug: linkable ? n.slug : null });
    }
  });

  return (
    <div data-testid="accessory-notices" className={className}>
      <Banner
        variant="info"
        role="status"
        action={
          <button type="button" onClick={clearAccessoryNotices} aria-label={t('dismiss')} className="ml-1 shrink-0 p-1 text-muted hover:text-text">
            <X size={16} />
          </button>
        }
      >
        <ul className="flex flex-col gap-1">
          {lines.map((l) => (
            <li key={l.key}>
              {l.text}
              {l.deckSlug && (
                <>
                  {' '}
                  <Link href={`/decks-meta/${l.deckSlug}`} className="text-accent underline underline-offset-4 hover:text-text">
                    {t('seeDeck')}
                  </Link>
                </>
              )}
            </li>
          ))}
        </ul>
      </Banner>
    </div>
  );
}
