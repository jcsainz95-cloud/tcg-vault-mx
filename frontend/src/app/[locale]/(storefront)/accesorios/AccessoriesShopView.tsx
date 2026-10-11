'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { Search, X } from 'lucide-react';
import { Link, useRouter } from '@/i18n/navigation';
import { StoreTabs } from '@/components/domain/StoreTabs';
import { getAccessories } from '@/lib/api';
import { useCart } from '@/lib/cart';
import { useSession } from '@/lib/session';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { cn } from '@/lib/cn';
import { ACCESSORY_CATEGORIES, type AccessoryCategory } from '@/types/contract';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { SignedInAccessoryNotice } from '@/components/domain/accessories/SignedInNotice';
import { Paginator } from '../_shared/Paginator';
import { CartAddedToast } from '../catalog/CartAddedToast';
import { AccessoryTile } from './AccessoryTile';

const PAGE_SIZE = 24;
const isCategory = (v: string | null | undefined): v is AccessoryCategory =>
  !!v && (ACCESSORY_CATEGORIES as readonly string[]).includes(v);

/** Construye la URL del listado conservando lo que se pase (vacío ⇒ sin parámetro). */
function listHref(category?: AccessoryCategory, q?: string) {
  const sp = new URLSearchParams();
  if (category) sp.set('category', category);
  if (q) sp.set('q', q);
  const qs = sp.toString();
  return qs ? `/accesorios?${qs}` : '/accesorios';
}

/**
 * Pestaña «Accesorios» de la Tienda (`API_CONTRACT §AC.3`, `DESIGN_SYSTEM §AC-UX.1/.2/.4`). El servidor ya ordena
 * (disponibles primero, agotados al final): ⛔ la pantalla no reordena ni calcula precios. Sin cuenta y con cuenta;
 * con cuenta (P-AC-1) el listado es igual pero sin «Agregar» y con el aviso una vez.
 */
export function AccessoriesShopView() {
  const t = useTranslations('accessories');
  const searchParams = useSearchParams();
  const router = useRouter();
  const cart = useCart();
  const { isAuthenticated } = useSession();

  const rawCategory = searchParams?.get('category');
  const category = isCategory(rawCategory) ? rawCategory : undefined;
  const urlQ = (searchParams?.get('q') ?? '').slice(0, 60);
  const [qInput, setQInput] = useState(urlQ);
  const q = useDebouncedValue(qInput.trim(), 300);
  const [page, setPage] = useState(() => Math.max(1, Number(searchParams?.get('page')) || 1));

  // Una categoría inválida en la URL es un enlace viejo o tecleado: se trata como «Todo» y se limpia (§AC-UX.2).
  useEffect(() => {
    if (rawCategory && !isCategory(rawCategory)) router.replace(listHref(undefined, urlQ || undefined));
  }, [rawCategory, urlQ, router]);

  // La búsqueda (debounced) vuelve a la página 1 y se refleja en la URL, que es compartible.
  useEffect(() => {
    if (q === urlQ) return;
    setPage(1);
    router.replace(listHref(category, q || undefined));
  }, [q, urlQ, category, router]);

  const query = useQuery({
    queryKey: ['accessories', category ?? null, q, page],
    queryFn: () => getAccessories({ category, q: q || undefined, page, pageSize: PAGE_SIZE }),
  });

  const [addedSignal, setAddedSignal] = useState(0);
  const dismissToast = useCallback(() => setAddedSignal(0), []);
  const { addAccessory } = cart;
  const onAdd = useCallback(
    (id: string) => {
      addAccessory(id, 1);
      setAddedSignal(Date.now());
    },
    [addAccessory],
  );

  const total = query.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / (query.data?.pageSize ?? PAGE_SIZE)));
  const categoryLinks = useMemo(
    () => [{ key: 'all' as const, value: undefined }, ...ACCESSORY_CATEGORIES.map((c) => ({ key: c, value: c }))],
    [],
  );

  return (
    <div>
      <div className="gutter flex flex-col gap-3 pb-6 pt-9 lg:pt-10">
        <p className="eyebrow">{t('eyebrow')}</p>
        <h1 className="font-serif text-[30px] leading-[1.1] text-text lg:text-[40px]">{t('title')}</h1>
        <p className="max-w-xl text-sm leading-relaxed text-muted">{t('subtitle')}</p>
        {isAuthenticated && <SignedInAccessoryNotice className="max-w-xl" />}
      </div>

      <StoreTabs />

      <nav aria-label={t('categoriesLabel')} className="gutter flex gap-5 overflow-x-auto border-b border-border pt-5 sm:gap-6">
        {categoryLinks.map((c) => {
          const active = c.value === category;
          return (
            <Link
              key={c.key}
              href={listHref(c.value, q || undefined)}
              aria-current={active ? 'true' : undefined}
              onClick={() => setPage(1)}
              className={cn(
                'whitespace-nowrap border-b-2 pb-3 text-sm transition-colors',
                active ? 'border-accent text-text' : 'border-transparent text-muted hover:text-text',
              )}
            >
              {c.value ? t(`category.${c.value}`) : t('all')}
            </Link>
          );
        })}
      </nav>

      <div className="gutter py-5">
        <div className="flex max-w-md items-center gap-2 border-b border-border-strong pb-2 focus-within:border-text focus-within:shadow-focus">
          <Search size={16} aria-hidden className="text-muted" />
          <label htmlFor="accessories-search" className="sr-only">
            {t('searchLabel')}
          </label>
          <input
            id="accessories-search"
            type="search"
            value={qInput}
            maxLength={60}
            placeholder={t('searchPlaceholder')}
            onChange={(e) => setQInput(e.target.value)}
            className="min-h-[44px] flex-1 bg-transparent text-[15px] text-text outline-none placeholder:text-muted"
          />
          {qInput && (
            <button type="button" aria-label={t('clearSearch')} onClick={() => setQInput('')} className="p-2 text-muted hover:text-text">
              <X size={16} aria-hidden />
            </button>
          )}
        </div>
      </div>

      <div className="gutter pb-14">
        {query.isLoading ? (
          <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5" aria-busy="true">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex flex-col gap-3">
                <Skeleton className="aspect-square w-full" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            ))}
          </div>
        ) : query.isError ? (
          <Banner
            variant="danger"
            role="alert"
            action={
              <Button variant="secondary" size="sm" onClick={() => query.refetch()}>
                {t('retry')}
              </Button>
            }
          >
            {t('loadError')}
          </Banner>
        ) : total === 0 ? (
          <EmptyAccessories category={category} q={q} onClearSearch={() => setQInput('')} />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4 lg:gap-[34px] xl:grid-cols-5">
              {query.data!.items.map((item) => (
                <AccessoryTile key={item.id} item={item} canAdd={!isAuthenticated} onAdd={onAdd} />
              ))}
            </div>
            <div className="mt-10">
              <Paginator page={page} totalPages={totalPages} onPage={setPage} />
            </div>
          </>
        )}
      </div>

      <CartAddedToast signal={addedSignal} onDismiss={dismissToast} />
    </div>
  );
}

function EmptyAccessories({
  category,
  q,
  onClearSearch,
}: {
  category?: AccessoryCategory;
  q: string;
  onClearSearch: () => void;
}) {
  const t = useTranslations('accessories');
  return (
    <div className="flex flex-col items-center gap-4 border-y border-border px-6 py-20 text-center">
      {q ? (
        <>
          <h3 className="font-serif text-2xl text-text">{t('emptySearch', { q })}</h3>
          <Button variant="ghost" onClick={onClearSearch}>
            {t('clearSearch')}
          </Button>
        </>
      ) : category ? (
        <>
          <h3 className="font-serif text-2xl text-text">{t('emptyCategory', { category: t(`category.${category}`) })}</h3>
          <Link href="/accesorios" className="text-sm text-accent underline underline-offset-4 hover:text-text">
            {t('seeAll')}
          </Link>
        </>
      ) : (
        <>
          <h3 className="font-serif text-2xl text-text">{t('emptyTitle')}</h3>
          <p className="max-w-md text-sm leading-relaxed text-muted">{t('emptyBody')}</p>
          <Link href="/catalog" className="text-sm text-accent underline underline-offset-4 hover:text-text">
            {t('emptyCta')}
          </Link>
        </>
      )}
    </div>
  );
}
