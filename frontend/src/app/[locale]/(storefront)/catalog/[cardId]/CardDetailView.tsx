'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Check } from 'lucide-react';
import { getCardDetail } from '@/lib/api';
import type {
  CardDTO,
  GroupedListingDetailResponse,
  GroupedListingDTO,
  ListingDTO,
} from '@/types/contract';
import type { AppLocale } from '@/i18n/routing';
import { formatMoneyCents } from '@/lib/format';
import { useCart } from '@/lib/cart';
import { Link, useRouter } from '@/i18n/navigation';
import { CartAddedToast } from '../CartAddedToast';
import { CardImage } from '@/components/ui/CardImage';
import { IvaLabel } from '@/components/ui/IvaLabel';
import { ListingSpec } from '@/components/domain/ListingSpec';
import { PendingPriceLabel } from '../../_shared/PendingPriceLabel';
import { StockBadge, stockVariantForSingle } from '../../_shared/StockBadge';
import { Fact } from '../../_shared/Fact';
import { GradingEstimateBlock } from '../../_shared/grading/GradingEstimateBlock';
import { blockEstimatesOf } from '../../_shared/grading/estimates';
import { GradingFootnoteBoundary } from '../../_shared/grading/GradingFootnote';
import { CertNumberField } from '@/components/ui/CertNumberField';
import { Button } from '@/components/ui/Button';
import { QueryState } from '@/components/ui/QueryState';
import { useStickyBottomBar } from '@/hooks/useStickyBottomBar';
import { centsToValue, track } from '@/lib/measurement/track';
import { measurementItemOf } from '@/lib/measurement/item';
import { Skeleton } from '@/components/ui/Skeleton';
import { cn } from '@/lib/cn';
import { CardCode } from '@/components/domain/CardCode';
import { WishlistBlock } from './WishlistBlock';
import { RefundPromiseLine, ShippingFeeHint } from '../../_shared/ShippingFeeHint';
import { VaultNote } from '../../_shared/VaultNote';
import { TrustStrip } from '../../_shared/TrustStrip';

/**
 * v1.38-grouped-listings (P-30): ¿la pieza (unit, por-pieza) pertenece a este grupo?
 * Match por la clave del grupo (productType, finish, grado/condición) — el ListingDTO por-pieza
 * no trae `gradeKey`, así que se compara por sus campos equivalentes.
 */
function unitMatchesGroup(u: ListingDTO, g: GroupedListingDTO): boolean {
  if (u.productType !== g.productType || u.finish !== g.finish) return false;
  if (g.productType === 'graded')
    return u.gradingCompany === g.gradingCompany && u.gradeValue === g.gradeValue;
  return (u.rawCondition ?? 'NM') === (g.rawCondition ?? 'NM');
}

// ⛔ §M10-IVA.3: se ordena por el precio EXHIBIDO (`displayPriceCents`), que es la cifra que el
// cliente compara. Bajo `IVA_INCLUSIVE` ordenar por la base limpia daría **otro orden** en cuanto el
// dial de traslación no fuera uniforme, y la pieza «más barata» del bloque «desde» dejaría de serlo.
const byPriceThenId = (a: ListingDTO, b: ListingDTO) =>
  (a.displayPriceCents ?? 0) - (b.displayPriceCents ?? 0) ||
  a.inventoryItemId.localeCompare(b.inventoryItemId);

/**
 * C1 (BRIEF_MKT Ola 2): `initialData` es la MISMA respuesta de `GET /catalog/cards/:cardId` que la página ya
 * leyó en el servidor para el `<head>` (`loadCardDetailForSSR`, `cache()` de React ⇒ una sola petición por
 * render). Con ella, el cuerpo (h1, precio del día, condición) sale en el HTML del servidor y el cliente NO
 * vuelve a pedir la ficha al montar (nace fresca: `staleTime` global de 30 s, `Providers.tsx`). Sin ella
 * (backend caído en SSR) la vista pide sola, como antes. ⛔ El precio es el `displayPriceCents` del DTO, el
 * mismo que se cobra: aquí no se calcula nada.
 */
export function CardDetailView({
  cardId,
  initialData,
}: {
  cardId: string;
  initialData?: GroupedListingDetailResponse;
}) {
  const cart = useCart();
  const [tab, setTab] = useState<'description' | 'condition'>('description');
  // Señal del toast de confirmación: timestamp del último add (0 = oculto);
  // usar timestamp reinicia el timer de auto-cierre en adds seguidos.
  const [addedSignal, setAddedSignal] = useState(0);
  const dismissToast = useCallback(() => setAddedSignal(0), []);

  const query = useQuery({ queryKey: ['card', cardId], queryFn: () => getCardDetail(cardId), initialData });

  return (
    <QueryState
      isLoading={query.isLoading}
      isError={query.isError}
      error={query.error}
      onRetry={() => query.refetch()}
      loading={
        <div className="gutter grid gap-10 py-14 lg:grid-cols-2">
          <Skeleton className="aspect-[5/7] w-full max-w-sm" />
          <div className="flex flex-col gap-4">
            <Skeleton className="h-10 w-2/3" />
            <Skeleton className="h-5 w-1/3" />
            {/* §21.8e — sin salto de layout: el esqueleto pinta la fila de dinero como UNA celda
                a ancho completo (la parte que NO depende del dato) y la de mercado solo aparece
                cuando llegan los datos. Así nunca se ve aparecer un bloque que después se retira. */}
            <Skeleton className="h-24 w-full" />
            <div className="grid gap-4 sm:grid-cols-2">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          </div>
        </div>
      }
    >
      {query.data && (
        // §22 R3.(3): UN solo booleano gobierna la nota al pie y toda cifra estimada de esta página.
        // La ficha NO está gateada por el ROI (contrato v1.44): se pinta lo que haya dato.
        <GradingFootnoteBoundary active={blockEstimatesOf(query.data) !== null}>
          <Detail
            card={query.data.card}
            groups={query.data.listings}
            units={query.data.units}
            detail={query.data}
            tab={tab}
            setTab={setTab}
            // Sin riesgo de mismatch SSR: useCart inicia `ids=[]` y lo puebla
            // desde localStorage en un useEffect (post-hidratación), así que el
            // estado «en el carrito» solo se pinta tras montar.
            cartIds={cart.ids}
            onAdd={(u) => {
              cart.add(u.inventoryItemId);
              setAddedSignal(Date.now());
              // §MKT.H.4 `add_to_cart` (con el modo `off`, no hace nada).
              const price = centsToValue(u.displayPriceCents ?? 0);
              const c = query.data!.card;
              const id = measurementItemOf({ cardId: c.id, name: c.name, setName: c.setName, productType: 'raw' });
              track('add_to_cart', {
                items: id ? [{ ...id, price }] : [],
                value: price,
                currency: 'MXN',
              });
            }}
          />
          <CartAddedToast signal={addedSignal} onDismiss={dismissToast} />
        </GradingFootnoteBoundary>
      )}
    </QueryState>
  );
}

/**
 * Un HECHO visible de la ficha. §21.8b-1: **primero la lista, después la retícula** — la lista se
 * arma evaluando `priceBasis` y la retícula se pinta SOBRE ESA LISTA YA FILTRADA. Un hecho oculto
 * **no existe**: no hay celda vacía que deje media fila colgando.
 */
interface FactSpec {
  key: string;
  label: string;
  node: React.ReactNode;
  note?: string;
  /** La celda de dinero ocupa la fila completa cuando queda sola (§21.8b-3). */
  fullRow?: boolean;
  /** §MIV.5 — id del rótulo de la celda (lo cita `labelledBy`). */
  labelId?: string;
  /** §MIV.5 — la celda es un grupo nombrado por estos nodos visibles (rótulo, cifra, IVA). */
  labelledBy?: string;
}

// La celda `Fact` ya NO se declara aquí: vive en `_shared/Fact.tsx` (misma marcación, cero cambio
// visual). Se extrajo para que el bloque del gancho de grading (§22.3) reutilice **exactamente la
// misma celda** sin reutilizar `FactGrid`, que es el contenedor de los hechos de PRECIO y fija su
// propia regla superior. `Fact` acepta ahí `label: ReactNode` (ensanchamiento compatible con el
// `FactSpec.label: string` de abajo), más `note` y `className`, que es todo lo que `FactGrid` pasa.

/**
 * Pinta la retícula sobre la lista YA FILTRADA de hechos.
 *
 * §21.8b-2: **el divisor es de la POSICIÓN, no del hecho.** `border-l` solo en las celdas que no
 * abren fila (índice par en la lista filtrada, en `≥ sm`). Hardcodear `sm:border-l` en un hecho
 * concreto —como hacía la versión anterior con «Valor de mercado» y «Acabado»— es justo el bug:
 * al desaparecer una celda, el divisor lo heredaba quien no le tocaba y la regla moría a media fila.
 */
function FactGrid({ facts, className }: { facts: FactSpec[]; className?: string }) {
  let column = 0; // columna que ocupa la celda actual dentro de la fila (0 = abre fila)
  return (
    <div className={cn('grid sm:grid-cols-2', className)}>
      {facts.map((f) => {
        const opensRow = column === 0;
        column = f.fullRow ? 0 : (column + 1) % 2;
        return (
          <Fact
            key={f.key}
            label={f.label}
            note={f.note}
            labelId={f.labelId}
            labelledBy={f.labelledBy}
            className={cn(
              f.fullRow && 'sm:col-span-2',
              !f.fullRow && !opensRow && 'sm:border-l sm:pl-7',
            )}
          >
            {f.node}
          </Fact>
        );
      })}
    </div>
  );
}

/**
 * 6b — La carta ocupa media pantalla contra papel; a la derecha, la ficha en dos
 * columnas de datos, la explicación de referencia vs. venta como nota al margen y
 * las variantes disponibles como renglones de catálogo, no como tarjetas.
 *
 * v1.38-grouped-listings (P-30): los renglones «Ejemplares disponibles» son ahora los
 * GRUPOS (`GroupedListingDTO`), una publicación por (variante, condición) con `stockCount`. El
 * add-to-cart resuelve la pieza física más barata del grupo aún NO en el carrito (`units[]`,
 * cheapest-first): clics sucesivos suben hasta `stockCount`. El `certNumber` es POR SLAB → se
 * lee de la pieza representativa del grupo (units), no del grupo.
 */
function Detail({
  card,
  groups,
  units,
  detail,
  tab,
  setTab,
  cartIds,
  onAdd,
}: {
  card: CardDTO;
  groups: GroupedListingDTO[];
  units: ListingDTO[];
  /** v1.44: respuesta completa — `gradedEstimates` vive en la RAÍZ, no en los grupos. */
  detail: GroupedListingDetailResponse;
  tab: 'description' | 'condition';
  setTab: (v: 'description' | 'condition') => void;
  cartIds: string[];
  onAdd: (u: ListingDTO) => void;
}) {
  const t = useTranslations('card');
  const tcat = useTranslations('catalog');
  const tFinish = useTranslations('finish');
  const tc = useTranslations('common');
  const tWishlist = useTranslations('wishlist');
  const locale = useLocale() as AppLocale;
  const primary = groups[0];

  // §MKT.H.4 `view_item`: una vez por carta, con el precio «desde» del grupo primario. La ficha ya
  // no pinta el mercado (§A1) ⇒ `market_value_shown: false`. Con el modo `off`, `track` no hace nada.
  const primaryPriceCents = primary?.displayPriceCents ?? null;
  useEffect(() => {
    if (primaryPriceCents == null) return;
    const price = centsToValue(primaryPriceCents);
    const id = measurementItemOf({ cardId: card.id, name: card.name, setName: card.setName, productType: 'raw' });
    track('view_item', {
      items: id ? [{ ...id, price }] : [],
      value: price,
      currency: 'MXN',
      market_value_shown: false,
    });
  }, [card.id, card.name, card.setName, primaryPriceCents]);

  // Índice de piezas por id (para leer el slab/cert de la pieza representativa de un grupo).
  const unitById = useMemo(() => new Map(units.map((u) => [u.inventoryItemId, u])), [units]);
  const primaryUnit = primary ? unitById.get(primary.representativeInventoryItemId) : undefined;
  // Gradeada: certificado verificable (§7.2c) del SLAB representativo — por pieza (units).
  const certNumber = primary?.productType === 'graded' ? primaryUnit?.certNumber ?? undefined : undefined;

  // La ficha ya no tiene pestaña "Fotos" (v1.2): imagen de catálogo remota, sin fotos propias.
  const tabs = [
    { key: 'description' as const, label: t('tabDescription') },
    { key: 'condition' as const, label: t('tabCondition') },
  ];

  // §A1 (MKT-26a, D2=A, dueño 2026-10-16 · HECHOS:65): la ficha PÚBLICA ya NO pinta «Valor de
  // mercado». 39/39 listados lo mostraban por encima de nuestro precio (mediana +26.9 %) y nos hacía
  // ver caros justo bajo el precio. El dato SIGUE llegando en el DTO (`referenceValue`,
  // `referenceDisplayCents`) porque alimenta admin y valuación — pero la ficha de venta no lo
  // renderiza (ni celda, ni rótulo, ni explicador de comparación). Lo que se retiró respecto de §MIV:
  // la celda «Valor de mercado» y su nombre accesible, y el explicador «…para que los compares tal
  // cual». La celda de «Precio de venta» ocupa siempre la fila completa.

  const facts: FactSpec[] = primary
    ? [
        {
          key: 'salePrice',
          label: tcat('salePrice'),
          // ⛔ §M10-IVA.3/criterio 190 — el rótulo lo dice el DATO (`ivaIncluded`), no la pantalla.
          // Antes era el literal `withoutIva`, que bajo `IVA_INCLUSIVE` sería falso.
          note:
            primary.displayPriceCents != null
              ? primary.ivaIncluded
                ? tc('ivaIncluded', { rate: primary.ivaRatePct })
                : tc('withoutIva')
              : undefined,
          // §A1: sin «Valor de mercado» en la ficha pública, la celda de venta ocupa SIEMPRE la fila
          // completa. La cifra CONSERVA su tamaño y su posición: nada crece para compensar (§21.8c).
          fullRow: true,
          node:
            primary.displayPriceCents != null ? (
              <span className="tabular text-3xl font-medium leading-none text-text">
                {formatMoneyCents(primary.displayPriceCents, locale)}
              </span>
            ) : (
              // Sin precio: «precio pendiente» honesto, jamás MX$0.00 (§7.3).
              <PendingPriceLabel className="text-[13px] tracking-[0.06em]" />
            ),
        },
        {
          key: 'condition',
          label: t('condition'),
          node:
            primary.productType === 'graded' ? (
              // Chip de grado (artboard Ficha): borde de tinta, mono «PSA 9».
              <span className="inline-flex items-center border border-text px-2.5 py-1.5 font-mono text-[13px] leading-none tracking-[0.06em] text-text">
                {`${primary.gradingCompany ?? ''} ${primary.gradeValue ?? ''}`.trim()}
              </span>
            ) : (
              <span className="text-base text-text">{tcat('condition.nm.label')}</span>
            ),
        },
        {
          key: 'finish',
          label: tFinish('label'),
          node: <span className="text-base text-text">{tFinish(primary.finish)}</span>,
        },
      ]
    : [];

  // §A2 (MKT-26b): la barra de compra fija en móvil opera sobre el grupo primario (el «desde»,
  // groups[0]), cheapest-first, con el MISMO add-to-cart por-pieza que InstanceCta (units[]).
  const primaryGroupUnits = primary
    ? units.filter((u) => unitMatchesGroup(u, primary)).sort(byPriceThenId)
    : [];

  return (
    // §A2: hueco inferior en móvil para que la barra fija no tape el último contenido.
    <div className="pb-24 lg:pb-0">
      <nav
        aria-label="Breadcrumb"
        className="gutter flex items-center gap-3 border-b border-border py-5 font-mono lg:py-4 text-xs tracking-[0.06em] text-muted"
      >
        <Link href="/catalog" className="hover:text-text">
          {t('backToCatalog')}
        </Link>
        <span aria-hidden>›</span>
        <span className="text-text" aria-current="page" lang="en">
          {card.name}
        </span>
      </nav>

      <div className="grid lg:grid-cols-2">
        {/* El arte contra su pozo de papel, a media pantalla. */}
        <div className="flex items-center justify-center border-b border-border bg-surface-2 px-6 py-10 lg:border-b-0 lg:border-r lg:px-11 lg:py-14">
          {/* imagen de catálogo remota de pokemontcg.io (v1.2, sin fotos propias).
              P-39: la ficha es una vista prominente ⇒ alta resolución; fallback a la chica si null. */}
          <CardImage src={card.imageLargeUrl ?? card.imageSmallUrl} alt={card.name} className="w-full max-w-[420px] bg-transparent p-0" />
        </div>

        {/* MKT-CONV.2: `lg:py-12` (antes 14) es la palanca del diseño para que COMPRAR quede sobre el banner a
            1366×768 (L-3). Medido: no basta (renglón en y 693–733, banner en 711), así que desde lg también se
            compactan la miga (`lg:py-4`), la retícula (`lg:mt-7`), T1a (`lg:mt-2`), el h2 (`lg:mt-6`) y el renglón
            (`lg:py-3`): −32 px (margen justo; lo vigila
            L-3). El banner no se achica. */}
        {/* MKT-CONV.2 (vMKT-CONV-2, L-9): en lg la columna es `flex-col` y el renglón de compra sube por encima de
            la pila de avisos y de Condición/Acabado (`lg:order-*`), así su posición ya no depende de lo variable.
            En < lg el orden es el del DOM (sin cambio). Lo que se mueve (pila y retícula) no tiene nada enfocable;
            el certificado (con su botón «Copiar») se pinta en su sitio del DOM en cada ancho (ver `certField`). */}
        <div className="gutter py-10 lg:flex lg:flex-col lg:py-12" data-testid="card-detail-column">
          {/* C1 (criterio 949): el `<h1>` lleva nombre · set · número. La línea de set va DENTRO del encabezado
              como bloque propio, con la misma letra y el mismo margen que tenía de párrafo: se ve igual. */}
          <h1 className="font-serif text-[32px] leading-[1.05] text-text lg:order-1 lg:text-[46px]" lang="en">
            {/* vMKT-CONV-2: en lg el nombre se recorta a 3 renglones (visual; el texto y el nombre accesible siguen
                completos). La línea de set, debajo, no entra en el recorte. */}
            <span className="lg:line-clamp-3" data-testid="card-name">
              {card.name}
            </span>
            <span className="sr-only"> · </span>
            <span className="mt-3 block font-mono text-xs uppercase tracking-[0.1em] text-muted">
              {/* v1.80 (P-71, §37.3c): «Twilight Masquerade · TWM 130 · rareza»; sin código, `#130`.
                  La línea va en versalitas; el código NO (`normal-case`): §37.3b, «mayúsculas tal
                  como llegan» — la sigla es la impresa en la carta, no la decide el CSS. */}
              {card.setName} · <CardCode code={card.setPtcgoCode} number={card.number} className="normal-case" /> ·{' '}
              {card.rarity}
            </span>
          </h1>

          {primary && (
            <>
              {/* §A1 (MKT-26a): la retícula se arma sobre la lista de hechos VISIBLES. Ya NO incluye
                  «Valor de mercado» en la ficha pública (D2=A, dueño 2026-10-16): solo precio,
                  condición y acabado. El DTO sigue trayendo `referenceValue`/`referenceDisplayCents`
                  porque alimentan admin y valuación — que viaje no autoriza a pintarlo en la tienda. */}
              {/* La retícula se parte en dos (precio | condición y acabado) para que en lg el precio quede con el
                  nombre y la condición baje tras la compra. En < lg se ve igual que la retícula única: la regla de
                  arriba la pone la primera y cada celda trae su regla inferior. */}
              <FactGrid facts={facts.slice(0, 1)} className="mt-9 border-t border-border lg:order-2 lg:mt-7" />
              <FactGrid
                facts={facts.slice(1)}
                className="lg:order-5 lg:mt-6 lg:border-t lg:border-border"
              />
              {/* Pila de avisos (MKT-CONV.2): T1a (envío) → T8 (garantía) → T2 (bóveda, MKT-CONV.3: solo sesión
                  anónima). Bajo el precio y FUERA de la retícula; no en la barra fija de COMPRAR. */}
              {primary.displayPriceCents != null && (
                <>
                  <ShippingFeeHint kind="cards" className="mt-3 lg:order-4 lg:mt-6" />
                  <RefundPromiseLine className="mt-1 lg:order-4" />
                  <VaultNote className="mt-1 lg:order-4" />
                </>
              )}

              {/* Gradeada: certificado (§7.2c). En < lg aquí; en lg, tras la compra (copia de abajo). */}
              {certNumber && (
                <div className="mt-6 lg:hidden">
                  <CertNumberField certNumber={certNumber} />
                </div>
              )}
            </>
          )}

          {/* C3 (criterio 951, MKT-3 (a), HECHOS 2026-10-31): carta sin piezas a la venta ⇒ sigue visible e indexable
              con «Agotada» donde iría el precio (y `OutOfStock` en el JSON-LD de la página). Sin «vuelve pronto»: no
              lo sabemos. */}
          {!primary && (
            <p
              data-testid="sold-out"
              className="mt-9 lg:order-2 border-t border-border pt-5 font-mono text-[13px] uppercase tracking-[0.12em] text-muted"
            >
              {tcat('soldOutCard')}
            </p>
          )}

          {/* MKT-CONV.2 (B6b, D-B = A): ya no hay frase de sistema entre el precio y la compra (se retiró
              «El precio de venta es el precio publicado de esta carta»). «Gancho de grading» (§22.3): junto al
              precio y ANTES de «Ejemplares disponibles»; nunca dentro de la retícula de precio (R2). */}
          <GradingEstimateBlock detail={detail} className="mt-7 lg:order-2" />

          {/* Ejemplares disponibles: renglones de catálogo (grupos), no tarjetas. MKT-CONV.2: `mt-8` (antes 10). */}
          <h2 className="mt-8 font-serif lg:order-3 lg:mt-6 text-[22px] leading-tight text-text">{t('instances')}</h2>
          {/* §WSH-UX.2 (g): ficha de una carta sin piezas a la venta (se llega desde el buscador de «Mi lista» o por URL). */}
          {groups.length === 0 && (
            <p className="mt-4 text-[15px] text-muted lg:order-3">{tWishlist('card.notHere')}</p>
          )}
          <div className="mt-4 border-t border-border lg:order-3">
            {groups.map((g) => {
              // Piezas físicas del grupo, cheapest-first, y el slab representativo para el cert.
              const groupUnits = units.filter((u) => unitMatchesGroup(u, g)).sort(byPriceThenId);
              const repUnit = unitById.get(g.representativeInventoryItemId) ?? groupUnits[0];
              return (
                <div
                  key={g.representativeInventoryItemId}
                  className="flex flex-wrap items-center justify-between gap-4 border-b border-border py-4 lg:py-3"
                >
                  <div className="min-w-0">
                    {/* v1.6-finish: cada variante (acabado/condición) es un grupo separado. El cert
                        del slab representativo viaja por pieza (units), no por grupo. */}
                    <ListingSpec
                      productType={g.productType}
                      rawCondition={g.rawCondition}
                      finish={g.finish}
                      gradingCompany={g.gradingCompany}
                      gradeValue={g.gradeValue}
                      certNumber={repUnit?.certNumber}
                    />
                    <div className="mt-2 flex items-baseline gap-3">
                      {g.displayPriceCents != null ? (
                        <span className="tabular text-[17px] font-medium leading-none text-text">
                          {formatMoneyCents(g.displayPriceCents, locale)}
                        </span>
                      ) : (
                        <PendingPriceLabel hint className="text-[11px] leading-normal tracking-[0.06em]" />
                      )}
                      {/* Stock REAL del grupo (§20.6): Queda 1 / N en stock (agotado no llega del backend). */}
                      <StockBadge variant={stockVariantForSingle(g.stockCount)} count={g.stockCount} />
                    </div>
                  </div>
                  <InstanceCta groupUnits={groupUnits} cartIds={cartIds} onAdd={onAdd} />
                </div>
              );
            })}
          </div>

          {/* MKT-CONV.4 (B2, criterio 945): franja de confianza bajo los renglones de compra, antes de la lista. */}
          <TrustStrip className="mt-4 lg:order-3" />

          {/* vMKT-CONV-2: en lg el certificado va tras la compra, junto a Condición/Acabado. Tiene un botón, así que
              se mueve en el DOM (no solo con `order`) para que el foco siga el orden visual (WCAG 2.4.3): esta copia
              solo existe en lg y la de arriba solo en < lg (`display:none` la saca del foco y del árbol accesible). */}
          {certNumber && (
            <div className="mt-6 hidden lg:order-5 lg:block">
              <CertNumberField certNumber={certNumber} />
            </div>
          )}

          {/* §WSH-UX.2 · «Lista de deseos»: después de «Ejemplares disponibles» (comprar va primero). Solo con el dial
              encendido (`wishlistEnabled`, campo aditivo de la ficha, §WSH.4); ⛔ el sellado no lo lleva (823). */}
          {detail.wishlistEnabled === true && (
            <div className="lg:order-6">
            <WishlistBlock
              cardId={card.id}
              availableFinishes={card.availableFinishes}
              preferredFinish={groups[0]?.finish}
            />
            </div>
          )}
        </div>
      </div>

      {/* Pestañas: subrayado bermellón, sin caja ni relleno. */}
      <div className="gutter border-t border-border pb-16 pt-0">
        <div role="tablist" className="flex gap-8 border-b border-border">
          {tabs.map((tb) => (
            <button
              key={tb.key}
              role="tab"
              aria-selected={tab === tb.key}
              onClick={() => setTab(tb.key)}
              className={cn(
                'py-5 text-xs font-medium uppercase tracking-label',
                tab === tb.key
                  ? 'text-text shadow-[inset_0_-1px_0_var(--color-accent)]'
                  : 'text-muted hover:text-text',
              )}
            >
              {tb.label}
            </button>
          ))}
        </div>
        <div className="max-w-[720px] pt-6 text-[15px] leading-[1.7] text-muted">
          {tab === 'description' && (
            <p lang="en">
              {card.supertype} — {card.subtypes.join(', ')} · {card.setName}
            </p>
          )}
          {tab === 'condition' &&
            (primary?.productType === 'graded' ? (
              // Gradeada: el slab (empresa+grado+cert) es la garantía; sin foto (§7.2c).
              <div className="flex flex-col gap-3">
                <p className="font-medium text-text">
                  {t('gradedGuarantee', {
                    company: primary.gradingCompany ?? '',
                    grade: primary.gradeValue ?? '',
                  })}
                </p>
                {primaryUnit?.certNumber && <CertNumberField certNumber={primaryUnit.certNumber} />}
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <p className="font-medium text-text">
                  {t('condition')}: {tcat('condition.nm.label')}
                </p>
                <p>{tcat('condition.nm.desc')}</p>
              </div>
            ))}
        </div>
      </div>

      {/* §A2 (MKT-26b): en móvil el precio con «IVA incluido» y COMPRAR viven en una barra fija al
          pie — visibles sin scroll en la primera pantalla (la imagen de la carta llena el alto). En
          ≥ lg se oculta: ahí el precio y el CTA ya entran arriba, a la derecha del arte. */}
      {primary && (
        <MobileBuyBar group={primary} groupUnits={primaryGroupUnits} cartIds={cartIds} onAdd={onAdd} />
      )}
    </div>
  );
}

/**
 * §A2 (MKT-26b) · barra de compra FIJA al pie, solo en móvil (`lg:hidden`). Lleva el precio «desde»
 * del grupo primario con su rótulo «IVA incluido» y el CTA de compra. Misma lógica por-pieza que
 * `InstanceCta`: agrega la pieza más barata del grupo primario aún no en el carrito; cuando todas
 * están, el CTA lleva al carrito. Sin piezas a la venta (criterio A2: «≥ 1 unidad a la venta») o sin
 * precio ⇒ no se pinta la barra. z-40 como el FAB móvil (`SellCartFab`); el header es z-40 arriba.
 */
function MobileBuyBar({
  group,
  groupUnits,
  cartIds,
  onAdd,
}: {
  group: GroupedListingDTO;
  groupUnits: ListingDTO[];
  cartIds: string[];
  onAdd: (u: ListingDTO) => void;
}) {
  const tcat = useTranslations('catalog');
  const locale = useLocale() as AppLocale;
  const router = useRouter();
  // MKT2-UX.5: la barra fija publica su alto (`--sticky-bottom-h`) para que el banner de cookies no la tape.
  const buyBarRef = useStickyBottomBar<HTMLDivElement>();

  const sellableUnits = groupUnits.filter((u) => u.sellable);
  const nextUnit = sellableUnits.find((u) => !cartIds.includes(u.inventoryItemId));
  const allInCart = sellableUnits.length > 0 && !nextUnit;

  if (sellableUnits.length === 0 || group.displayPriceCents == null) return null;

  // MKT-CONV.2 (B6b, D-B = A, criterio 948): la barra y los renglones dicen LO MISMO y hacen lo mismo:
  // «Añadir al carrito» agrega la pieza más barata aún fuera del carrito; «Ver carrito» lleva al carrito.
  return (
    <div
      ref={buyBarRef}
      data-testid="mobile-buy-bar"
      aria-label={tcat('addToCart')}
      className="gutter fixed inset-x-0 bottom-0 z-40 flex items-center justify-between gap-4 border-t border-border bg-bg py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:hidden"
    >
      <div className="min-w-0">
        <div className="tabular text-xl font-medium leading-none text-text">
          {formatMoneyCents(group.displayPriceCents, locale)}
        </div>
        {/* ⛔ §M10-IVA.3: el rótulo lo dice el DATO (`ivaIncluded`), no la pantalla. */}
        <IvaLabel
          ivaIncluded={group.ivaIncluded}
          ivaRatePct={group.ivaRatePct}
          className="mt-1.5 block leading-none"
        />
      </div>
      {allInCart ? (
        <Button variant="secondary" size="sm" onClick={() => router.push('/checkout')}>
          {tcat('viewCart')}
        </Button>
      ) : (
        <Button variant="primary" size="sm" onClick={() => onAdd(nextUnit!)}>
          {tcat('addToCart')}
        </Button>
      )}
    </div>
  );
}

/** MKT-CONV.2: el botón del renglón mide 44 px en < lg y 40 px desde lg (`md` del diseño). */
const ROW_CTA_LG = 'lg:h-10 lg:min-h-10 lg:py-0';

/**
 * CTA por GRUPO con estado «Ver carrito».
 *
 * v1.38-grouped-listings (P-30): el add-to-cart es por-pieza (units[]) aunque la fila sea un
 * grupo. «Añadir al carrito» agrega la pieza más barata del grupo aún NO en el carrito; clics sucesivos
 * suben hasta `stockCount`. Cuando TODAS las piezas del grupo están en el carrito, el CTA cambia
 * a «Ver carrito» y el clic no re-agrega: lleva al carrito (/checkout). MKT-CONV.2 (B6b, D-B = A, HECHOS
 * 2026-10-31): una sola etiqueta en ficha y barra (se retiraron «Comprar» y «En el carrito» de la ficha); `primary`
 * `md` (44 px), el botón de más peso de la ficha.
 *
 * Vive aquí (y no en `ListingCard`) a propósito: `frontend/src/components/` es zona compartida de
 * otro stream y las props actuales de `ListingCard` no expresan este estado.
 */
function InstanceCta({
  groupUnits,
  cartIds,
  onAdd,
}: {
  groupUnits: ListingDTO[];
  cartIds: string[];
  onAdd: (u: ListingDTO) => void;
}) {
  const tcat = useTranslations('catalog');
  const router = useRouter();

  const sellableUnits = groupUnits.filter((u) => u.sellable);
  const nextUnit = sellableUnits.find((u) => !cartIds.includes(u.inventoryItemId));
  const allInCart = sellableUnits.length > 0 && !nextUnit;

  if (sellableUnits.length === 0) {
    return (
      <Button variant="secondary" size="md" disabled data-testid="instance-cta" className={ROW_CTA_LG}>
        {tcat('notForSale')}
      </Button>
    );
  }

  if (allInCart) {
    return (
      <Button
        variant="secondary"
        size="md"
        data-testid="instance-cta"
        className={ROW_CTA_LG}
        onClick={() => router.push('/checkout')}
      >
        {/* Check decorativo (§7.4): el texto es el portador del estado. */}
        <Check size={14} aria-hidden />
        {tcat('viewCart')}
      </Button>
    );
  }

  return (
    <Button variant="primary" size="md" data-testid="instance-cta" className={ROW_CTA_LG} onClick={() => onAdd(nextUnit!)}>
      {tcat('addToCart')}
    </Button>
  );
}
