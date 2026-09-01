'use client';

import { useCallback, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { searchBuylistCards, getBuylistQuote } from '@/lib/api';
import type { CardDTO, Finish } from '@/types/contract';
import type { AppLocale } from '@/i18n/routing';
import { formatMoneyCents } from '@/lib/format';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { EditorialLink } from '../_shared/EditorialLink';
import { BuylistShippingNote } from '@/components/domain/BuylistShippingNote';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/cn';

/**
 * Mini-cotizador del hero (makeover 1a §3). Reutiliza la MISMA maquinaria del buylist:
 * búsqueda con GET /buylist/cards (debounced) y cotización con POST /buylist/quote.
 * SEC-A1: los montos SIEMPRE vienen del server (quotedPriceCents de la respuesta);
 * aquí solo se SUMAN los centavos ya cotizados — jamás se deriva un precio en cliente.
 * Sin precio de referencia ⇒ la línea queda "Pendiente" y NO aporta al total (nunca $0).
 *
 * «Continuar mi cotización» solo NAVEGA a /buylist: llevar las líneas al `useSellCart`
 * de BuylistView exigiría tocar el módulo buylist (fuera del alcance del makeover) —
 * decisión documentada en FRONTEND_NOTES.
 */
export interface QuoterLine {
  /** cardId:finish — identidad de línea (mismo criterio base que useSellCart). */
  key: string;
  card: CardDTO;
  finish: Finish;
  status: 'loading' | 'quoted' | 'pending' | 'error';
  /** SIEMPRE el monto del server; null mientras carga / pendiente / error. */
  quotedPriceCents: number | null;
}

export interface HomeQuoterState {
  term: string;
  setTerm: (v: string) => void;
  searching: boolean;
  results: CardDTO[];
  showResults: boolean;
  lines: QuoterLine[];
  add: (card: CardDTO) => void;
  addFirst: () => void;
  remove: (key: string) => void;
  /** Suma de líneas COTIZADAS (montos del server). null si no hay ninguna cotizada. */
  totalCents: number | null;
  pendingCount: number;
}

/**
 * Estado del mini-cotizador, IZADO a la página: el panel se pinta dos veces (columna
 * del hero en lg, sección propia en móvil) y ambas instancias comparten estas líneas.
 */
export function useHomeQuoter(): HomeQuoterState {
  const [term, setTerm] = useState('');
  const [lines, setLines] = useState<QuoterLine[]>([]);
  // Espejo del estado para el guard de dedupe dentro de handlers async.
  const linesRef = useRef<QuoterLine[]>([]);
  linesRef.current = lines;

  const debounced = useDebouncedValue(term, 300);
  const q = debounced.trim();
  const search = useQuery({
    queryKey: ['home-quoter-search', q],
    // P-41: con `pageSize: 5` un nombre con muchas variantes (p. ej. 6 Tropius) dejaba fuera
    // cartas de forma ARBITRARIA (el corte de 5 desempata por uuid de set), por lo que
    // «Pitch Black» y similares nunca aparecían. Subimos a 20 (misma página que /buylist) para
    // surtir todas las variantes comunes; si aun así se corta, el affordance «ver más» lleva al
    // cotizador completo. Sin cambio de backend/contrato.
    queryFn: () => searchBuylistCards({ q, pageSize: 20 }),
    enabled: q.length >= 2,
    staleTime: 60_000,
    retry: false,
  });

  const results = q.length >= 2 ? (search.data?.data ?? []) : [];
  const showResults = term.trim().length >= 2;

  const add = useCallback((card: CardDTO) => {
    // Acabado por defecto: normal si existe; si no, el primero disponible (v1.6-finish).
    const finish: Finish = card.availableFinishes?.includes('normal')
      ? 'normal'
      : (card.availableFinishes?.[0] ?? 'normal');
    const key = `${card.id}:${finish}`;
    setTerm('');
    if (linesRef.current.some((l) => l.key === key)) return; // dedupe: la mini no maneja cantidades
    setLines((prev) => [...prev, { key, card, finish, status: 'loading', quotedPriceCents: null }]);
    getBuylistQuote({ cardId: card.id, productType: 'raw', finish })
      .then((res) => {
        setLines((prev) =>
          prev.map((l) =>
            l.key === key
              ? {
                  ...l,
                  status: res.quote.status === 'cotizada' ? 'quoted' : 'pending',
                  quotedPriceCents: res.quote.quotedPriceCents,
                }
              : l,
          ),
        );
      })
      .catch(() => {
        setLines((prev) => prev.map((l) => (l.key === key ? { ...l, status: 'error' } : l)));
      });
  }, []);

  const addFirst = useCallback(() => {
    const first = q.length >= 2 ? search.data?.data?.[0] : undefined;
    if (first) add(first);
  }, [add, q, search.data]);

  const remove = useCallback((key: string) => {
    setLines((prev) => prev.filter((l) => l.key !== key));
  }, []);

  const quoted = lines.filter((l) => l.status === 'quoted' && l.quotedPriceCents != null);
  const totalCents = quoted.length > 0 ? quoted.reduce((s, l) => s + (l.quotedPriceCents ?? 0), 0) : null;
  const pendingCount = lines.filter((l) => l.status === 'pending').length;

  return {
    term,
    setTerm,
    searching: search.isLoading && q.length >= 2,
    results,
    showResults,
    lines,
    add,
    addFirst,
    remove,
    totalCents,
    pendingCount,
  };
}

/**
 * Panel visual del cotizador (artboard 1a, columna derecha del hero / sección móvil).
 * `withTrust` pinta los dos renglones de confianza al pie (solo variante del hero).
 *
 * §23.3g fila 0 (v2.3.2): este panel ES el cotizador —se rotula así y cotiza contra
 * POST /buylist/quote—, así que D31 exige que diga la regla del envío. Dos consecuencias
 * que NO son cosméticas:
 * - El total se rotula `buylist.quote.money.cardsValue` («Valor de tus cartas»), la MISMA
 *   clave del carrito y del resumen de crear. Se retiró `home.quoter.wePay` («Te pagamos»):
 *   prometía un depósito por el bruto cuando el envío se descuenta de ese monto (§23.14.2a).
 *   No se crea una clave gemela — un segundo string con el mismo significado es justo el
 *   mecanismo por el que este rótulo se desincronizó.
 * - `BuylistShippingNote` va en el CUERPO del panel y FUERA de `withTrust`: esa banda no se
 *   pinta en móvil (`withTrust={false}`), y una regla de dinero que solo existe en escritorio
 *   no es una regla. Se renderiza siempre, con y sin líneas (§23.3k: no depende de datos).
 */
export function HomeQuoterPanel({
  state,
  withTrust = true,
  className,
}: {
  state: HomeQuoterState;
  withTrust?: boolean;
  className?: string;
}) {
  const t = useTranslations('home');
  const tc = useTranslations('common');
  // Rótulo del total y nota del envío viven en `buylist`: son del cotizador, no del home.
  const tb = useTranslations('buylist');
  const locale = useLocale() as AppLocale;
  const {
    term, setTerm, searching, results, showResults, lines, add, addFirst, remove, totalCents, pendingCount,
  } = state;

  return (
    <div className={cn('flex w-full flex-col', className)}>
      <div className="flex items-center justify-between border-b border-border px-5 py-3.5 lg:px-6">
        <span className="eyebrow">{t('quoter.label')}</span>
        <span className="eyebrow">MXN · {tc('withoutIva')}</span>
      </div>

      <div className="px-5 pb-6 pt-6 lg:px-6 lg:pt-7">
        <h2 className="font-serif text-[23px] leading-[1.2] text-text lg:text-[26px]">
          {t('quoter.title')}
        </h2>
        <p className="mt-3 text-sm leading-[1.65] text-muted">{t('quoter.subtitle')}</p>

        <div className="relative mt-5">
          <div className="flex h-[46px] items-stretch border border-text">
            <input
              type="text"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addFirst();
                }
                if (e.key === 'Escape') setTerm('');
              }}
              aria-label={t('quoter.searchLabel')}
              placeholder={t('quoter.searchPlaceholder')}
              className="min-w-0 flex-1 bg-transparent px-3.5 text-sm text-text placeholder:text-muted focus:outline-none"
            />
            <button
              type="button"
              onClick={addFirst}
              disabled={results.length === 0}
              className="bg-primary px-3.5 text-[10px] font-medium uppercase tracking-label text-primary-fg hover:bg-primary-hover disabled:cursor-default disabled:opacity-60"
            >
              {t('quoter.add')}
            </button>
          </div>

          {showResults && (
            <ul className="absolute inset-x-0 top-full z-20 border border-t-0 border-text bg-bg">
              {searching && (
                <li className="px-3.5 py-2.5 font-mono text-[11px] uppercase tracking-label text-muted">
                  {tc('loading')}
                </li>
              )}
              {!searching && results.length === 0 && (
                <li className="px-3.5 py-2.5 font-mono text-[11px] uppercase tracking-label text-muted">
                  {tc('noResults')}
                </li>
              )}
              {results.map((card) => (
                <li key={card.id} className="border-b border-border last:border-b-0">
                  <button
                    type="button"
                    // onMouseDown para ganarle al blur del input.
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => add(card)}
                    className="flex w-full items-baseline justify-between gap-3 px-3.5 py-2.5 text-left hover:bg-surface-2"
                  >
                    <span lang="en" className="min-w-0 truncate text-[13px] text-text">
                      {card.name}
                    </span>
                    <span lang="en" className="shrink-0 font-mono text-[10px] text-muted">
                      {card.setName} · #{card.number}
                    </span>
                  </button>
                </li>
              ))}
              {/* P-41: affordance «ver más» — el mini-cotizador muestra hasta 20 coincidencias;
                  para nombres con aún más variantes, el cotizador completo (/buylist) las lista
                  todas. onMouseDown preventDefault para no cerrar el desplegable antes de navegar. */}
              {!searching && results.length > 0 && (
                <li className="border-t border-border">
                  <Link
                    href="/buylist"
                    onMouseDown={(e) => e.preventDefault()}
                    className="block px-3.5 py-2.5 font-mono text-[10px] uppercase tracking-label text-muted hover:bg-surface-2 hover:text-text"
                  >
                    {t('quoter.viewMore')}
                  </Link>
                </li>
              )}
            </ul>
          )}
        </div>

        {lines.length === 0 ? (
          <p className="mt-5 text-sm leading-relaxed text-muted">{t('quoter.empty')}</p>
        ) : (
          <div className="mt-4">
            {lines.map((l) => (
              <div
                key={l.key}
                className="flex items-baseline justify-between gap-3 border-b border-border py-[11px]"
              >
                <span lang="en" className="min-w-0 truncate text-[13px] text-text">
                  {l.card.name} · #{l.card.number}
                </span>
                <span className="flex shrink-0 items-baseline gap-2.5">
                  {l.status === 'loading' && (
                    <span className="font-mono text-[10px] uppercase tracking-label text-muted">…</span>
                  )}
                  {l.status === 'pending' && (
                    <span className="font-mono text-[10px] uppercase tracking-label text-muted">
                      {t('quoter.pending')}
                    </span>
                  )}
                  {l.status === 'error' && (
                    <span className="font-mono text-[10px] uppercase tracking-label text-accent">
                      {t('quoter.quoteError')}
                    </span>
                  )}
                  {l.status === 'quoted' && l.quotedPriceCents != null && (
                    <span className="tabular font-mono text-xs text-text">
                      {formatMoneyCents(l.quotedPriceCents, locale)}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => remove(l.key)}
                    aria-label={t('quoter.remove', { name: l.card.name })}
                    className="font-mono text-sm leading-none text-muted hover:text-accent"
                  >
                    ×
                  </button>
                </span>
              </div>
            ))}
            <div className="flex items-baseline justify-between pt-3.5">
              <span className="eyebrow">{tb('quote.money.cardsValue')}</span>
              <span className="tabular font-mono text-[19px] text-text">
                {totalCents != null ? formatMoneyCents(totalCents, locale) : '—'}
              </span>
            </div>
            {pendingCount > 0 && (
              <p className="mt-2 text-xs leading-relaxed text-muted">
                {t('quoter.pendingNote', { count: pendingCount })}
              </p>
            )}
          </div>
        )}

        {/* §23.3g fila 0 · §23.14.2a: la regla del envío, en la PRIMERA pantalla de dinero del
            embudo. Fuera de los dos brazos del ternario ⇒ se pinta con cero líneas y con líneas
            por igual, sin esqueleto y sin moverse; y fuera de `withTrust` ⇒ también en móvil.
            Sin cifras (D43): la tarifa solo aparece con número en la oferta y en `offer.terms`. */}
        <BuylistShippingNote className="mt-3" />

        <EditorialLink href="/buylist" className="mt-6 inline-block">
          {t('quoter.continue')}
        </EditorialLink>
      </div>

      {withTrust && (
        <div className="mt-auto border-t border-border">
          <p className="border-b border-border px-5 py-[15px] text-sm leading-normal text-text lg:px-6">
            {t('trustCustody')}
          </p>
          <p className="px-5 py-[15px] text-sm leading-normal text-text lg:px-6">{t('trustPayout')}</p>
        </div>
      )}
    </div>
  );
}
