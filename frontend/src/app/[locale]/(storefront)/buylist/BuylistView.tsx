'use client';

import { useCallback, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { batchQuote } from '@/lib/api';
import type {
  CardProductDTO,
  Finish,
  BuylistQuoteResponse,
  BuylistBatchQuoteResultDTO,
  MasterSetCardCellDTO,
  MasterSetVariantDTO,
  PublicBountyDTO,
} from '@/types/contract';
import type { AppLocale } from '@/i18n/routing';
import { formatMoneyCents } from '@/lib/format';
import { Modal } from '@/components/ui/Modal';
import { SafeShippingGuide } from '@/components/domain/SafeShippingGuide';
import { BuylistKycForm } from '@/components/domain/BuylistKycForm';
import { useSellRequirements } from '@/hooks/useSellRequirements';
import { useMediaQuery } from '@/hooks/useMediaQuery';
// v1.21-cotizador-master-set: el grid del cotizador es el binder COMPARTIDO de Master Set
// (§4.20f, mode="quoter") — casillas de imagen por acabado real de la carta, nunca un chip
// de texto ni una casilla para un acabado que la carta no tiene. v1.53 (§4.40): es el ÚNICO
// grid del cotizador — el grid plano de graded/sealed se retiró con la superficie que servía.
import { MasterSetPanel } from '@/components/master-set/MasterSetPanel';
// v1.28 (P-22): vitrina «Top Bounties» arriba de la página Vender, antes del selector de set.
import { TopBountiesShelf } from '@/components/domain/TopBountiesShelf';
// v1.29 Stream C (P-16, §18.4): el carrito deja de ser columna lateral — FAB + drawer flotante.
import { SellCartFab } from '@/components/domain/SellCartFab';
import { SellCartDrawer } from '@/components/domain/SellCartDrawer';
// v1.29 Stream C (P-14, §18.5): las líneas del resumen usan el FinishMark compartido.
import { FinishMark } from '@/components/domain/FinishMark';
// TL-C3 (FE-13): el estado del carrito, el contenido del drawer y "Mis solicitudes" viven
// en módulos propios (extracción mecánica, sin cambio de comportamiento).
import { useSellCart } from './useSellCart';
import { SellCartContents } from './SellCartContents';
import { MyRequestsSection } from './MyRequestsSection';
import { EditorialLink } from '../_shared/EditorialLink';

/**
 * Convierte un resultado batch `ok:true` en el `BuylistQuoteResponse` que consume el carrito.
 * (En el batch `rarity` es `string | null`; el carrito lo normaliza a string.)
 */
function batchResultToQuote(r: Extract<BuylistBatchQuoteResultDTO, { ok: true }>): BuylistQuoteResponse {
  return {
    rarity: r.rarity ?? '',
    finish: r.finish,
    priceBasis: r.priceBasis,
    quote: r.quote,
    referencePrice: r.referencePrice,
    paymentNotice: r.paymentNotice,
  };
}

/**
 * Rediseño "grid protagonista" (2026-08-17):
 * - El grid usa TODO el ancho/alto disponible (scroll natural de página, sin scroll interno
 *   artificial) y el carrito de venta vive en un drawer flotante (P-16, §18.4).
 * - Ya NO hay panel "COTIZACIÓN" ni selección intermedia: cada carta lista sus ACABADOS
 *   (`availableFinishes`) con su estimado server-side, y el clic en un acabado la agrega
 *   DIRECTO al carrito. La transparencia vive en el detalle expandible de cada línea
 *   (valor de referencia / acabado / pendiente).
 * - "Mis solicitudes" nunca muestra error sin sesión: sin sesión la sección invita a
 *   iniciar sesión en tono informativo (y no consulta el endpoint) — ver MyRequestsSection.
 *
 * ⚠️ v1.53 (MONEY — contrato §6, ARCHITECTURE §4.40): EL COTIZADOR ES RAW-ONLY.
 * `PRODUCT_TYPES` ofrecía `['raw','graded','sealed']` y el selector de tipo servía esos tres
 * valores, pero NINGÚN DTO de buylist tuvo jamás dónde capturar QUÉ grado es un slab: el backend
 * resolvía la referencia con un default silencioso a `graded:PSA:10` —el grado MÁS CARO— y firmaba
 * el estimado de cualquier graduada a ese precio. `PROJECT.md` §E («compra de **raw**»), §K LOCKED
 * («el cotizador y el pipeline de buylist siguen siendo solo para raw») y el criterio 61 nunca
 * autorizaron esa superficie. Aquí se cierra: un solo valor ⇒ el selector se retira (un control
 * con una sola opción no es una elección, es ruido), y con él se van el grid plano, su barra de
 * filtros y el bulk, que solo existían para graded/sealed. El grid del cotizador queda siendo el
 * binder de Master Set, que ya era el de `raw`.
 * ⛔ NO se "arregla" añadiendo un selector de GRADO: comprar graduadas es una decisión de producto
 * abierta (§4.40.6) que empieza por `product-owner` en `PROJECT.md`, no aquí.
 * La autoridad es el servidor (`422 BUYLIST_RAW_ONLY`); esto es la mitad de UI.
 *
 * TL-C3 (FE-13): esta vista quedó como ORQUESTADOR — el estado del carrito vive en
 * `useSellCart`, el contenido del drawer en `SellCartContents` y "Mis solicitudes" en
 * `MyRequestsSection` (misma carpeta de la ruta; extracción mecánica sin cambio de
 * comportamiento, respaldada por los tests conductuales de BuylistView.test.tsx).
 */
export function BuylistView() {
  const t = useTranslations('buylist');
  const tFinish = useTranslations('finish');
  const locale = useLocale() as AppLocale;
  const queryClient = useQueryClient();

  const [guideOpen, setGuideOpen] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);

  // --- Carrito de venta: varias cartas en UNA sola solicitud. P-16 (§18.4): vive en un
  // DRAWER flotante disparado por el FAB (cerrado por defecto; agregar desde la grilla NO
  // lo abre — solo el CTA de bounty, intención explícita de vender ESA carta). Al cerrar,
  // el foco regresa al FAB (returnFocusRef). Estado y totales: useSellCart (TL-C3). ---
  const {
    cart,
    expandedLines,
    addLine,
    setQuantity,
    removeLine,
    clearCart,
    toggleLineDetail,
    totalEstimatedCents,
    pendingCardCount,
    cartCount,
    isInCart,
    requestItems,
  } = useSellCart();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const fabRef = useRef<HTMLButtonElement>(null);
  const [lastAdded, setLastAdded] = useState<{ name: string; label: string } | null>(null);

  // P-42 · en DESKTOP (≥lg) el carrito es un PANEL FIJO a la par del grid (2 columnas persistentes),
  // no un drawer que abre/cierra: siempre se ve lo que metes y el total. En móvil se conserva el
  // sheet (FAB + drawer). Un solo render (JS-driven, no CSS duplicado) evita DOM/foco duplicado. En
  // jsdom `matchMedia` devuelve `matches:false` → los tests corren la variante MÓVIL por defecto.
  const isDesktopCart = useMediaQuery('(min-width: 1024px)');

  /**
   * Clic en una casilla del binder Master Set (mode="quoter", raw): la variante YA trae su
   * cotización resuelta (`variant.quote`, batch client-side de MasterSetBinder) — se agrega
   * DIRECTO al carrito, sin panel intermedio. Casillas sin cotización resuelta quedan
   * deshabilitadas en el binder (nunca deberían disparar este handler).
   * SC-D3: `useCallback` (los handlers del hook ya son estables) para no regalarle al binder
   * una identidad nueva por render — prepara el `memo` de tiles si algún día hace falta.
   */
  const addFromMasterSet = useCallback(
    (cell: MasterSetCardCellDTO, variant: MasterSetVariantDTO) => {
      if (!variant.quote) return;
      const quote: BuylistQuoteResponse = {
        rarity: variant.quote.rarity ?? '',
        finish: variant.finish,
        priceBasis: variant.quote.priceBasis,
        quote: { status: variant.quote.status, quotedPriceCents: variant.quote.quotedPriceCents, currency: 'MXN' },
        referencePrice: variant.quote.referencePrice,
        paymentNotice: 'PAY_AFTER_RECEIPT',
      };
      addLine({
        card: { id: cell.cardId, name: cell.name, number: cell.number, imageSmallUrl: cell.imageSmallUrl },
        productType: 'raw',
        rawCondition: 'NM',
        finish: variant.finish,
        quote,
      });
      setLastAdded({ name: cell.name, label: tFinish(variant.finish) });
    },
    [addLine, tFinish],
  );

  /**
   * v1.30 (§4.29) · Clic en «Agregar» de un PRODUCTO SEPARADO (deck_exclusive/promo) del binder:
   * lo agrega al carrito como LÍNEA PROPIA por su `productId` (precio propio, cotizado server-side).
   * Dos líneas con el mismo (cardId, finish) y distinto productId son DISTINTAS (dedup por productId
   * en useSellCart). El nombre de la línea es el del PRODUCTO (p. ej. «Charizard (Deck Exclusive)»).
   */
  const addFromMasterSetProduct = useCallback(
    (cell: MasterSetCardCellDTO, product: CardProductDTO, finish: Finish, quote: BuylistQuoteResponse) => {
      addLine({
        card: { id: cell.cardId, name: product.name, number: cell.number, imageSmallUrl: cell.imageSmallUrl },
        productType: 'raw',
        rawCondition: 'NM',
        finish,
        productId: quote.productId ?? product.productId,
        quote,
      });
      setLastAdded({ name: product.name, label: tFinish(finish) });
    },
    [addLine, tFinish],
  );

  /**
   * v1.28 (P-22) · CTA «Cotizar esta carta» de un BountyCard: cotiza ESA (carta, acabado)
   * server-side (SEC-A1 — el monto autoritativo lo deriva el quote, no el card de la vitrina)
   * y la agrega al carrito de venta, abriendo el drawer. Si el quote falla, no agrega nada
   * (el flujo normal del cotizador sigue disponible). v1.53 (§4.40): ya no hace falta forzar
   * el tipo a `raw` antes de agregar — es el único que existe.
   */
  const bountyQuote = useMutation({
    mutationFn: async (b: PublicBountyDTO) => {
      const res = await batchQuote([
        { cardId: b.cardId, productType: 'raw', rawCondition: 'NM', finish: b.finish },
      ]);
      return { bounty: b, result: res.results[0] };
    },
    onSuccess: ({ bounty, result }) => {
      if (!result?.ok) return;
      addLine({
        card: {
          id: bounty.cardId,
          name: bounty.name,
          number: bounty.number,
          imageSmallUrl: bounty.imageSmallUrl,
        },
        productType: 'raw',
        rawCondition: 'NM',
        finish: result.finish,
        quote: batchResultToQuote(result),
      });
      // Excepción de §18.4a: el CTA de bounty SÍ abre el drawer (intención explícita).
      setDrawerOpen(true);
      setLastAdded({ name: bounty.name, label: tFinish(bounty.finish) });
    },
  });

  // Gating de cuenta ANTES de llenar todo (guards del contrato §6): sesión, correo
  // verificado, CLABE registrada e INE esperado por topes. El bloqueo real es server-side;
  // aquí solo se comunica temprano para que el 403 no sea la primera noticia.
  const sellReq = useSellRequirements(totalEstimatedCents);

  return (
    <div className="grid lg:grid-cols-[40px_1fr]">
      {/* Etiqueta vertical al margen: marca la sección sin recurrir a un color de fondo.
          Decorativa (aria-hidden); el uppercase lo pone la clase, no el string (§20.15). */}
      <div className="hidden justify-center border-r border-border py-9 lg:flex">
        <span aria-hidden className="vertical-label text-xs uppercase text-muted">
          {t('verticalLabel')}
        </span>
      </div>

      <div className="min-w-0">
        <div className="gutter border-b border-border pb-7 pt-10 lg:pt-[46px]">
          <h1 className="font-serif text-[30px] leading-[1.1] text-text lg:text-[40px]">{t('title')}</h1>
          <p className="mt-3 max-w-[560px] text-[15px] leading-[1.65] text-muted">{t('subtitle')}</p>
          {/* PAY_AFTER_RECEIPT (PROJECT AC 33, DESIGN §7.5), visible desde el inicio. */}
          <p className="rule-note mt-5 max-w-[640px] text-[13px] leading-[1.7] text-muted">
            {t('payAfterReceipt')}
          </p>
          {/* R3: link editorial canónico (§20.0) — era la variante divergida a mano. */}
          <EditorialLink onClick={() => setGuideOpen(true)} className="mt-5">
            {t('shippingGuideLink')}
          </EditorialLink>
        </div>

        {/* v1.28 (P-22): Top Bounties ARRIBA, antes del binder. Se oculta sola si no hay
            bounties activos o el endpoint falla (vitrina, no bloquea la venta). */}
        <TopBountiesShelf onQuote={(b) => bountyQuote.mutate(b)} />

        {/* v1.53 (§4.40) — SIN barra de filtros propia. Antes vivían aquí (a) el selector «Tipo de
            producto» y (b) un filtro plano set+texto que solo se pintaba con graded/sealed. Cerrada
            la superficie a raw, el selector quedaba con UNA opción (un control que no ofrece
            elección: ruido que además insinuaba que compramos slabs) y el filtro plano, sin grid
            que filtrar. Los dos controles de búsqueda que el cotizador SÍ necesita ya los trae el
            binder de Master Set: «Buscar set» (MasterSetIndex) y «Buscar carta» dentro del set
            elegido (MasterSetBinder). Una sola barra de búsqueda, la del grid que se usa. */}

        {/* P-42 · en DESKTOP el grid y el carrito conviven en 2 columnas persistentes (el carrito
            fijo a la derecha, a la par del grid); en móvil el grid ocupa todo el ancho y el carrito
            vive en el sheet (FAB + drawer, abajo).
            H1 (anti-flash): la ESTRUCTURA de 2 columnas se declara por CSS (`lg:grid` = ≥1024px, el
            MISMO umbral que `isDesktopCart`), NO por JS. Así el track de 360px queda RESERVADO desde
            el first-paint en desktop y la columna del grid (main) nace con su ancho final — se elimina
            el layout shift de main (antes: móvil full-width → salto a 2 columnas tras hidratar).
            Trade-off (documentado en FRONTEND_NOTES): el CONTENIDO del carrito (`<aside>`) sigue siendo
            un ÚNICO render JS-driven (`isDesktopCart`) para no duplicar estado/foco ni el focus-trap;
            por eso, en desktop, el aside aparece al hidratar DENTRO de la columna ya reservada (rellena
            hueco, sin reflujo de main). El FAB móvil es `fixed` (fuera del flujo del grid), así que su
            breve aparición pre-hidratación tampoco desplaza el layout. */}
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
        {/* P-16 (§18.1.4): la grilla es la única columna, a TODO el ancho. `pb-24` para que
            el FAB fijo nunca tape la última fila de tejas. */}
        <main className="gutter min-w-0 pb-24 pt-8">
            {lastAdded && (
              <p role="status" className="mb-3 font-mono text-[11px] text-success">
                {t('addedLine', { name: lastAdded.name, finish: lastAdded.label })}
              </p>
            )}
            {/* v1.21 / v1.53: el binder COMPARTIDO de Master Set es EL grid del cotizador —
                casillas de imagen por acabado real de la carta (nunca chip de texto ni casilla
                vacía), con "Cargar más" propio para sets >20 cartas (fetchQuoterBinder pagina
                internamente). Ya no hay ternario por tipo de producto: el buylist es raw-only
                (§4.40), así que el grid plano de graded/sealed —y su barra de filtros y su bulk—
                se fueron con la superficie que servían. */}
            <MasterSetPanel
              mode="quoter"
              onAddToSellCart={addFromMasterSet}
              onAddProductToSellCart={addFromMasterSetProduct}
              isInCart={isInCart}
            />
        </main>

        {/* P-42 · DESKTOP: carrito de venta como PANEL FIJO a la derecha, pegajoso, a la par del
            grid (siempre visible: lo que metes y el total). Reusa EXACTAMENTE el mismo
            SellCartContents que el drawer móvil. */}
        {isDesktopCart && (
          <aside
            aria-label={t('cartDrawer.ariaLabel', { count: cartCount })}
            className="sticky top-4 max-h-[calc(100vh-2rem)] self-start overflow-y-auto border-l border-border px-5 pb-8"
          >
            <div className="flex items-baseline gap-3 border-b border-border py-3">
              <h2 className="eyebrow">{t('cartTitle')}</h2>
              {cartCount > 0 && <span className="eyebrow">{t('cartCount', { count: cartCount })}</span>}
            </div>
            <div className="pt-4">
              <SellCartContents
                cart={cart}
                sellReq={sellReq}
                expandedLines={expandedLines}
                totalEstimatedCents={totalEstimatedCents}
                pendingCardCount={pendingCardCount}
                cartCount={cartCount}
                onSetQuantity={setQuantity}
                onRemoveLine={removeLine}
                onToggleLineDetail={toggleLineDetail}
                onClearCart={clearCart}
                onSubmit={() => {
                  setCreatedId(null);
                  setRequestOpen(true);
                }}
              />
            </div>
          </aside>
        )}
        </div>

        {/* Carrito de venta = DRAWER flotante (P-16, §18.4b): el contenido (requisitos →
            líneas → total → CTA → vaciar) vive en SellCartContents (TL-C3). El encabezado
            (eyebrow + conteo + cerrar) lo pinta el propio drawer. En DESKTOP el carrito es el
            panel fijo de arriba, así que el drawer (y su FAB) SOLO se montan en móvil. */}
        {!isDesktopCart && (
        <SellCartDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          ariaLabel={t('cartDrawer.ariaLabel', { count: cartCount })}
          title={t('cartTitle')}
          countLabel={cartCount > 0 ? t('cartCount', { count: cartCount }) : null}
          closeLabel={t('cartDrawer.close')}
          returnFocusRef={fabRef}
        >
          <SellCartContents
            cart={cart}
            sellReq={sellReq}
            expandedLines={expandedLines}
            totalEstimatedCents={totalEstimatedCents}
            pendingCardCount={pendingCardCount}
            cartCount={cartCount}
            onSetQuantity={setQuantity}
            onRemoveLine={removeLine}
            onToggleLineDetail={toggleLineDetail}
            onClearCart={clearCart}
            onSubmit={() => {
              setCreatedId(null);
              // Un solo focus trap activo (§18.4b): abrir el modal de solicitud
              // cierra el drawer (el resumen del modal repite las líneas).
              setDrawerOpen(false);
              setRequestOpen(true);
            }}
          />
        </SellCartDrawer>
        )}

        {/* Política NM-only (PROJECT §E/H, AC 3d) + copy de confianza (EDITABLE): quién paga
            el envío, tiempos de verificación/pago SPEI y vigencia (ver FRONTEND_NOTES). */}
        <section className="gutter border-t border-border pb-10 pt-8">
          <p className="rule-note max-w-[640px] text-[13px] leading-[1.7] text-muted">
            <span className="font-medium text-text">{t('nmOnlyTitle')}.</span> {t('nmOnlyBody')}
          </p>
          <div className="mt-6 max-w-[640px] text-[13px] leading-[1.7] text-muted">
            <p>{t('trustShipping')}</p>
            <p className="mt-2">{t('trustPayment')}</p>
            <p className="mt-2">{t('trustValidity')}</p>
          </div>

          {/* Makeover 1a (artboard 2b): la guía de envío seguro también vive INLINE al pie
              de la página (retícula 01–04 a cuatro columnas), además del modal del hero. */}
          <div className="mt-8">
            <h2 className="eyebrow">{t('shippingGuideLink')}</h2>
            <SafeShippingGuide columns={4} className="mt-4" />
          </div>
        </section>

        {createdId && (
          <p className="gutter rule-note py-5 text-sm text-text" role="status">
            {t('created')}
          </p>
        )}

        {/* Mis solicitudes (extraída en TL-C3): sin sesión NUNCA muestra error — invita a
            iniciar sesión en tono informativo (y no consulta el endpoint). */}
        <MyRequestsSection ready={sellReq.ready} isAuthenticated={sellReq.isAuthenticated} />

        {/* FAB del carrito (§18.4a): fijo abajo-derecha, en el flujo de tabulación DESPUÉS
            del contenido principal (§18.8, sin tabindex positivos). Siempre presente (vacío
            da acceso a los requisitos de venta); el badge se omite con carrito vacío. P-42: en
            DESKTOP el carrito es el panel fijo lateral, así que el FAB SOLO se monta en móvil. */}
        {!isDesktopCart && (
          <SellCartFab ref={fabRef} count={cartCount} open={drawerOpen} onClick={() => setDrawerOpen(true)} />
        )}
      </div>

      <Modal open={guideOpen} onClose={() => setGuideOpen(false)} title={t('shippingGuideLink')}>
        <SafeShippingGuide onUnderstood={() => setGuideOpen(false)} />
      </Modal>

      {/* P-43 · el pop-up de detalle de la carta lo pinta cada teja del binder (QuoterTile /
          SeparateProductTile, con su propio CardDetailModal). Aquí vivía el del GRID PLANO de
          graded/sealed, que se retiró con él (v1.53, §4.40). */}

      <Modal open={requestOpen} onClose={() => setRequestOpen(false)} title={t('requestTitle')}>
        {requestItems.length > 0 && (
          <>
            {/* Resumen de la venta ANTES de confirmar: qué cartas, cuánto (estimado) y
                la vigencia del estimado. Evita enviar "a ciegas" desde el modal. */}
            <div className="mb-6">
              <p className="eyebrow">{t('summaryTitle')}</p>
              <ul className="mt-3">
                {cart.map((l) => {
                  const pending = l.quote.quote.status === 'precio_pendiente';
                  const unitCents = l.quote.quote.quotedPriceCents ?? 0;
                  return (
                    <li
                      key={l.id}
                      className="flex items-baseline justify-between gap-3 border-b border-border py-2 text-sm"
                    >
                      <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-text">
                        <span lang="en" className="min-w-0 truncate">
                          {l.card.name}
                        </span>
                        <span className="font-mono text-[10px] text-muted">
                          ×{l.quantity}
                        </span>
                        {/* P-14 (§18.5): mismo FinishMark que en el carrito — la decisión de
                            venta se confirma viendo la variante con el mismo lenguaje. */}
                        <FinishMark finish={l.finish} className="translate-y-[1px]" />
                      </span>
                      <span className="tabular shrink-0">
                        {pending ? (
                          <span className="font-mono text-[11px] text-accent">{t('linePending')}</span>
                        ) : (
                          formatMoneyCents(unitCents * l.quantity, locale)
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <div className="flex items-baseline justify-between gap-3 pt-3">
                <span className="text-[13px] font-medium text-text">{t('totalEstimated')}</span>
                {totalEstimatedCents === 0 && pendingCardCount > 0 ? (
                  <span className="font-mono text-[13px] text-accent">{t('linePending')}</span>
                ) : (
                  <span className="tabular text-[18px] font-medium text-text">
                    {formatMoneyCents(totalEstimatedCents, locale)}
                  </span>
                )}
              </div>
              {pendingCardCount > 0 && (
                <p className="mt-2 font-mono text-[11px] leading-[1.6] text-muted">
                  {t('totalPendingNote', { count: pendingCardCount })}
                </p>
              )}
              {/* Vigencia del estimado (copy editable de confianza). */}
              <p className="mt-3 font-mono text-[11px] leading-[1.6] text-muted">{t('trustValidity')}</p>
            </div>

            <BuylistKycForm
              items={requestItems}
              // Heads-up de topes/CLABE derivado de GET /users/me/kyc; el backend re-decide (SEC-A1).
              ineExpected={sellReq.ineExpected}
              clabeMasked={sellReq.clabeMasked}
              // v1.15: atajo "usar mi CLABE" (omite `clabe`) e INE en archivo (oculta uploaders).
              clabeOnFile={sellReq.clabeOnFile}
              ineOnFile={sellReq.ineOnFile}
              onCreated={(sellRequestId) => {
                setCreatedId(sellRequestId);
                setRequestOpen(false);
                clearCart();
                setLastAdded(null);
                void queryClient.invalidateQueries({ queryKey: ['sell-requests'] });
                // La solicitud pudo registrar la CLABE en KYC → refresca el checklist.
                void queryClient.invalidateQueries({ queryKey: ['kyc'] });
              }}
            />
          </>
        )}
      </Modal>
    </div>
  );
}
