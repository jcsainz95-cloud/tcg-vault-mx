'use client';

import { forwardRef, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { searchBuylistCards } from '@/lib/api';
import { Link } from '@/i18n/navigation';
import { Input } from '@/components/ui/Input';
import { CardImage } from '@/components/ui/CardImage';
import { CardCode } from '@/components/domain/CardCode';

const MIN_CHARS = 2;
const DEBOUNCE_MS = 300;
const MAX_RESULTS = 8;

/**
 * Buscador para agregar (DESIGN_SYSTEM §WSH-UX.3 e · API_CONTRACT §WSH.4, v1.87.1 Q-WSH-UX-4): reutiliza
 * `GET /buylist/cards` (público, TODO el catálogo) para encontrar cartas que la tienda nunca tuvo. Cada resultado es un
 * ENLACE a la ficha `/catalog/{cardId}`, donde se eligen acabado y % con la carta delante. ⛔ No se agrega desde aquí y
 * ⛔ no se pintan precios (ese DTO no los tiene). Lista de enlaces bajo un campo, ⛔ no `combobox`.
 */
export const WishlistSearch = forwardRef<HTMLInputElement>(function WishlistSearch(_props, ref) {
  const t = useTranslations('wishlist.page');
  const [text, setText] = useState('');
  const [q, setQ] = useState('');

  useEffect(() => {
    const id = setTimeout(() => setQ(text.trim()), DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [text]);

  const active = q.length >= MIN_CHARS;
  const results = useQuery({
    queryKey: ['wishlist-search', q],
    queryFn: () => searchBuylistCards({ q, pageSize: MAX_RESULTS }),
    enabled: active,
  });
  const rows = active ? (results.data?.data ?? []).slice(0, MAX_RESULTS) : [];

  return (
    <div className="flex flex-col gap-3">
      <p className="font-mono text-[11px] uppercase tracking-label text-muted" aria-hidden>
        {t('searchTitle')}
      </p>
      <Input
        ref={ref}
        type="search"
        label={t('searchLabel')}
        placeholder={t('searchPlaceholder')}
        value={text}
        onChange={(e) => setText(e.target.value)}
        autoComplete="off"
      />
      <p aria-live="polite" className="sr-only">
        {active && results.data ? t('searchCount', { n: rows.length }) : ''}
      </p>
      {active && results.data && (
        <div data-testid="wishlist-search-results">
          {rows.length === 0 ? (
            <p className="text-sm text-muted">{t('searchEmpty')}</p>
          ) : (
            <ul className="border-t border-border">
              {rows.map((c) => (
                <li key={c.id} className="border-b border-border">
                  <Link
                    href={`/catalog/${c.id}`}
                    className="flex min-h-[56px] items-center gap-3 py-2 hover:text-accent focus-visible:shadow-focus"
                  >
                    <CardImage src={c.imageSmallUrl} alt="" className="w-10 shrink-0" />
                    <span className="min-w-0">
                      <span lang="en" className="block text-[15px] text-text">
                        {c.name}
                      </span>
                      <span className="block font-mono text-[12px] text-muted">
                        <span lang="en">{c.setName}</span> · <CardCode code={c.setPtcgoCode} number={c.number} />
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
});
