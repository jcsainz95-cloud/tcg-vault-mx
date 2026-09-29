'use client';

import { useCallback, useId, useRef, useState } from 'react';
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
import { BuylistShippingNote } from '@/components/domain/BuylistShippingNote';
import {
  BuylistPendingLineLabel,
  BuylistPendingLinesNote,
} from '@/components/domain/BuylistPendingLinesNote';
import { useSellRequirements } from '@/hooks/useSellRequirements';
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
// §37.1 (P-61): en escritorio el carrito vuelve a ser el cajón; la barra inferior conserva a la
// vista cuánto llevas. La requisitos de cuenta suben a la cabecera con el cajón cerrado.
import { SellCartBar } from './SellCartBar';
import { CartTotalFigure } from './CartTotalFigure';
import { SellRequirementsPanel } from '@/components/domain/SellRequirementsPanel';
// v1.51.4 (D43): el mínimo de compra del cotizador. Se pide AL MONTAR esta vista (el cotizador),
// no se guarda en un store de vida larga: el contrato lo norma por la caché pública de 5 minutos.
import { useQuotePolicy } from './useQuotePolicy';
import { Link } from '@/i18n/navigation';
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
  // el foco regresa al disparador que lo abrió (§37.1d). Estado y totales: useSellCart (TL-C3). ---
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
    restore,
    requoting,
    requoteFailed,
    retryRequote,
  } = useSellCart();
  const tSellCart = useTranslations('sellCart');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const fabRef = useRef<HTMLButtonElement>(null);
  const barButtonRef = useRef<HTMLButtonElement>(null);
  const [lastAdded, setLastAdded] = useState<{ name: string; label: string } | null>(null);
  const drawerId = useId();

  /**
   * §37.1 (P-61) · UN solo cajón para todos los tamaños. P-42 decidía el CONTENEDOR con
   * `useMediaQuery` (panel fijo en `≥ lg`, cajón en `< lg`) y la columna fija de 360 px le quitaba
   * al binder un tercio del ancho (tejas de ≈144 px a 1280). Ahora el `SellCartDrawer` se monta
   * igual en todos los tamaños (su forma cambia por CSS en `lg:`) y los DOS disparadores —FAB
   * `lg:hidden`, `SellCartBar` `hidden lg:flex`— se montan siempre y se esconden por CSS: sin
   * destello al hidratar, sin DOM de carrito duplicado, sin dos focus traps.
   *
   * §37.1d · Retorno de foco: `openerRef` apunta al disparador que ABRIÓ el cajón (barra, FAB o el
   * CTA del bounty) y se fija ANTES de abrir, porque el cajón lo lee al montarse.
   */
  const openerRef = useRef<HTMLElement | null>(null);
  const openDrawerFrom = useCallback((opener: HTMLElement | null) => {
    openerRef.current = opener;
    setDrawerOpen(true);
  }, []);
  /**
   * Respaldo del retorno de foco cuando el disparador no tiene el foco (p. ej. Safari no enfoca
   * los botones al clic): el disparador VISIBLE de este tamaño. Solo decide a dónde vuelve el
   * foco, nunca qué contenedor se monta (§37.1a).
   */
  const visibleTrigger = (): HTMLElement | null => {
    const desktop =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(min-width: 1024px)').matches;
    return desktop ? barButtonRef.current : fabRef.current;
  };

  /**
   * **§23.3g-bis (v2.3.8) — EXACTAMENTE UNA nota de servicio del envío visible por pantalla.**
   *
   * La tabla de §23.3g dice **dónde puede** ir la nota; le faltaba decir **cuántas se ven a la
   * vez**. A 1280px `/buylist` acabó mostrando **dos párrafos idénticos de cuatro líneas**
   * —cabecera y panel fijo del carrito— porque cada instancia se autorizó en una sección
   * distinta y **nadie miró las dos juntas**.
   *
   * **Por qué dos copias idénticas SÍ son un defecto**, aunque el texto sea correcto: dos
   * párrafos iguales a 600px de distancia y con el mismo peso visual son **la firma de un error
   * de render**. El vendedor no concluye «esto es importante», concluye «esta página está rota»
   * — y repetir no refuerza, es la misma ceguera por la que §23.3c rechazó el banner.
   *
   * **El desempate sale de POR QUÉ existe cada instancia: gana la más cercana a la decisión.**
   * La cabecera existe **únicamente** para cubrir el caso en que el carrito no se ve (móvil,
   * drawer cerrado); donde el carrito sí se ve, su razón de ser desaparece y **no se monta**.
   *
   * | Situación | Quién pinta |
   * |---|---|
   * | Cajón cerrado (cualquier tamaño) | la **cabecera** |
   * | Cajón abierto (cualquier tamaño) | el **bloque de dinero** del cajón |
   * | Paso de crear abierto | **el suyo** (`BuylistKycForm`) |
   *
   * §37.1c (P-61): la fila «Panel fijo lateral (escritorio)» desapareció con el panel, y con ella
   * `isDesktopCart` de la fórmula. ⛔ Nada de versión corta en la barra: sería una segunda
   * instancia visible (y la regla de D16 en letra chica, §23.3c).
   *
   * ⚠️ **La decisión vive AQUÍ y en un solo sitio**, porque es la única capa que ve la pantalla
   * entera. Repartirla entre los componentes es exactamente cómo se llegó a las dos copias.
   *
   * ⚠️ **Esto NO contradice §23.3c** («no aparece, no desaparece, no se mueve»): esa prohibición
   * es sobre el **estado del carrito** —vacío/lleno, bajo/sobre el mínimo—, no sobre el
   * **layout**. La invariante nueva es **más fuerte y más fácil de comprobar**: *siempre
   * exactamente una*, en vez de *al menos una*.
   */
  const shippingNoteHost: 'header' | 'cart' | 'createStep' = requestOpen
    ? 'createStep'
    : drawerOpen
      ? 'cart'
      : 'header';

  /**
   * §37.1c (P-61) · la llamada a iniciar sesión / requisitos de cuenta (`SellRequirementsPanel`),
   * con la MISMA regla de «exactamente un anfitrión». Cajón abierto ⇒ la pinta el cajón
   * (`SellCartContents`); cerrado ⇒ la cabecera, que la lleva `hidden lg:block`: en `< lg` el
   * cajón cerrado no monta nada y la de cabecera está oculta por CSS (comportamiento móvil
   * previo, sin duplicados).
   */
  const requirementsHost: 'header' | 'cart' = drawerOpen ? 'cart' : 'header';

  /**
   * Clic en una casilla del binder Master Set (mode="quoter", raw): la variante YA trae su
   * cotización resuelta (`variant.quote`, batch client-side de MasterSetBinder) — se agrega
   * DIRECTO al carrito, sin panel intermedio. Casillas sin cotización resuelta quedan
   * deshabilitadas en el binder (nunca deberían disparar este handler).
   * SC-D3: `useCallback` (los handlers del hook ya son estables) para no regalarle al binder
   * una identidad nueva por render — prepara el `memo` de tiles si algún día hace falta.
   */
  const addFromMasterSet = useCallback(
    (cell: MasterSetCardCellDTO, variant: MasterSetVariantDTO, setPtcgoCode: string | null) => {
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
        card: { id: cell.cardId, name: cell.name, number: cell.number, imageSmallUrl: cell.imageSmallUrl, setPtcgoCode },
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
    (
      cell: MasterSetCardCellDTO,
      product: CardProductDTO,
      finish: Finish,
      quote: BuylistQuoteResponse,
      setPtcgoCode: string | null,
    ) => {
      addLine({
        card: { id: cell.cardId, name: product.name, number: cell.number, imageSmallUrl: cell.imageSmallUrl, setPtcgoCode },
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
    mutationFn: async ({ bounty: b }: { bounty: PublicBountyDTO; opener: HTMLElement | null }) => {
      const res = await batchQuote([
        { cardId: b.cardId, productType: 'raw', rawCondition: 'NM', finish: b.finish },
      ]);
      return { bounty: b, result: res.results[0] };
    },
    onSuccess: ({ bounty, result }, { opener }) => {
      if (!result?.ok) return;
      addLine({
        card: {
          id: bounty.cardId,
          name: bounty.name,
          number: bounty.number,
          imageSmallUrl: bounty.imageSmallUrl,
          // v1.80 (P-71): la vitrina ya trae el código del set de la carta.
          setPtcgoCode: bounty.setPtcgoCode,
        },
        productType: 'raw',
        rawCondition: 'NM',
        finish: result.finish,
        quote: batchResultToQuote(result),
      });
      // Excepción de §18.4a: el CTA de bounty SÍ abre el drawer (intención explícita).
      // §37.1d: al cerrar, el foco vuelve a ESE CTA (capturado al pulsarlo, antes del await).
      openDrawerFrom(opener);
      setLastAdded({ name: bounty.name, label: tFinish(bounty.finish) });
    },
  });

  // Gating de cuenta ANTES de llenar todo (guards del contrato §6): sesión, correo
  // verificado, CLABE registrada e INE esperado por topes. El bloqueo real es server-side;
  // aquí solo se comunica temprano para que el 403 no sea la primera noticia.
  const sellReq = useSellRequirements(totalEstimatedCents);
  // `minimumRequestCents` queda undefined mientras carga Y si la llamada falla: la degradación es
  // fail-OPEN (sin faltante y con el CTA vivo), porque la puerta real es el 422 del servidor.
  const { minimumRequestCents } = useQuotePolicy();

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
          {/* PAY_AFTER_RECEIPT (PROJECT AC 33, DESIGN §7.5), visible desde el inicio. Sigue
              siendo cierto bajo D2/D9: el pago ocurre tras verificar; lo que no ocurre es
              repreciar (§23.14.5). */}
          <p className="rule-note mt-5 max-w-[640px] text-[13px] leading-[1.7] text-muted">
            {t('payAfterReceipt')}
          </p>
          {/* §23.3g fila 1-bis (v2.3.2): la regla del envío en la CABECERA, en tinta `text-sm`
              —ni `muted` ni `rule-note` ni caja: D31 la quiere al mismo nivel visual que los
              montos—. Motivo decisivo: en móvil el carrito es un drawer cerrado, así que sin
              esta instancia se puede recorrer /buylist entera sin leerla nunca. Sustituye al
              retirado `trustShipping`, que la decía en gris de 13px al pie (§23.14.2b). */}
          {shippingNoteHost === 'header' && (
            <BuylistShippingNote surface="buylist-header" className="mt-4 max-w-[640px]" />
          )}
          {/* §37.1c (P-61): requisitos de cuenta en la cabecera SOLO en `≥ lg` y con el cajón
              cerrado (el banner «Inicia sesión o crea cuenta para vender» ya no vive en un panel
              fijo). Mismo componente, sin cambios. */}
          {requirementsHost === 'header' && (
            <div className="mt-5 hidden max-w-[640px] lg:block" data-testid="buylist-header-requirements">
              <SellRequirementsPanel req={sellReq} />
            </div>
          )}
          {/* R3: link editorial canónico (§20.0) — era la variante divergida a mano. */}
          <EditorialLink onClick={() => setGuideOpen(true)} className="mt-5">
            {t('shippingGuideLink')}
          </EditorialLink>
        </div>

        {/* v1.28 (P-22): Top Bounties ARRIBA, antes del binder. Se oculta sola si no hay
            bounties activos o el endpoint falla (vitrina, no bloquea la venta). */}
        <TopBountiesShelf
          onQuote={(b) => {
            // §37.1d: el disparador es el CTA que tiene el foco AHORA; si el clic no lo enfocó
            // (Safari no enfoca botones al clic), el disparador visible de su tamaño.
            const active = typeof document !== 'undefined' ? document.activeElement : null;
            const opener =
              active instanceof HTMLElement && active !== document.body ? active : visibleTrigger();
            bountyQuote.mutate({ bounty: b, opener });
          }}
        />

        {/* v1.53 (§4.40) — SIN barra de filtros propia. Antes vivían aquí (a) el selector «Tipo de
            producto» y (b) un filtro plano set+texto que solo se pintaba con graded/sealed. Cerrada
            la superficie a raw, el selector quedaba con UNA opción (un control que no ofrece
            elección: ruido que además insinuaba que compramos slabs) y el filtro plano, sin grid
            que filtrar. Los dos controles de búsqueda que el cotizador SÍ necesita ya los trae el
            binder de Master Set: «Buscar set» (MasterSetIndex) y «Buscar carta» dentro del set
            elegido (MasterSetBinder). Una sola barra de búsqueda, la del grid que se usa. */}

        {/* §37.1a (P-61): el catálogo es UNA sola columna a todo el ancho, en todos los tamaños
            (vuelve §18.1 punto 4). Se retiró el `lg:grid` de dos columnas y el `<aside>` del panel
            fijo de P-42: le quitaba 360 px al binder. `pb-24` (96 px) cubre la barra de 64 px en
            `≥ lg` y el FAB en `< lg`: nunca tapan la última fila de tejas. */}
        <main className="gutter min-w-0 pb-24 pt-8">
            {lastAdded && (
              <p role="status" className="mb-3 font-mono text-[11px] text-success">
                {t('addedLine', { name: lastAdded.name, finish: lastAdded.label })}
              </p>
            )}
            {/* §33.11 (P-55): qué pasó con la lista guardada al volver (caducó / se conservó /
                precios de hoy / líneas que ya no cotizamos). UN status por hecho, sin rojo por línea:
                `trustValidity` ya explica que el estimado es de hoy. */}
            {restore.kind === 'expired' && (
              <p role="status" className="mb-3 font-mono text-[11px] text-accent">
                {tSellCart('expired')}
              </p>
            )}
            {restore.kind === 'restored' && (
              <div className="mb-3 flex flex-col gap-1 font-mono text-[11px] text-muted" data-testid="sell-cart-restored">
                <p role="status">{tSellCart('restored', { count: restore.count })}</p>
                {restore.repriced && (
                  <p role="status">
                    {tSellCart('repriced', {
                      before: formatMoneyCents(restore.repriced.beforeCents, locale),
                      after: formatMoneyCents(restore.repriced.afterCents, locale),
                    })}
                  </p>
                )}
                {restore.droppedCount > 0 && (
                  <p role="status">{tSellCart('linesDropped', { count: restore.droppedCount })}</p>
                )}
              </div>
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

        {/* Carrito de venta = DRAWER flotante (P-16, §18.4b): el contenido (requisitos →
            líneas → total → CTA → vaciar) vive en SellCartContents (TL-C3). El encabezado
            (eyebrow + conteo + cerrar) lo pinta el propio drawer. §37.1a (P-61): UN solo cajón
            para todos los tamaños — lateral de 400 px en `≥ lg`, bottom sheet en `< lg`, por CSS. */}
        <SellCartDrawer
          id={drawerId}
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          ariaLabel={t('cartDrawer.ariaLabel', { count: cartCount })}
          title={t('cartTitle')}
          countLabel={cartCount > 0 ? t('cartCount', { count: cartCount }) : null}
          closeLabel={t('cartDrawer.close')}
          returnFocusRef={openerRef}
        >
          <SellCartContents
            cart={cart}
            sellReq={sellReq}
            expandedLines={expandedLines}
            totalEstimatedCents={totalEstimatedCents}
            pendingCardCount={pendingCardCount}
            cartCount={cartCount}
            minimumRequestCents={minimumRequestCents}
            onSetQuantity={setQuantity}
            onRemoveLine={removeLine}
            onToggleLineDetail={toggleLineDetail}
            onClearCart={clearCart}
            showShippingNote={shippingNoteHost === 'cart'}
            requoting={requoting}
            requoteFailed={requoteFailed}
            onRetryRequote={retryRequote}
            onSubmit={() => {
              setCreatedId(null);
              // Un solo focus trap activo (§18.4b): abrir el modal de solicitud
              // cierra el drawer (el resumen del modal repite las líneas).
              setDrawerOpen(false);
              setRequestOpen(true);
            }}
          />
        </SellCartDrawer>

        {/* Política NM-only (PROJECT §E/H, AC 3d) + copy de confianza. El bloque baja a DOS
            párrafos: `trustShipping` se retiró (§23.14.2b) por ser un eco degradado de
            `nmOnlyBody` —que está justo arriba y lo dice con más detalle—, y su hueco original
            (quién pone el envío) no podía llenarse aquí: este bloque es `text-muted` de 13px y
            §23.3c prohíbe contar la regla de D16 en letra chica. Subió a la cabecera. */}
        <section className="gutter border-t border-border pb-10 pt-8">
          <p className="rule-note max-w-[640px] text-[13px] leading-[1.7] text-muted">
            <span className="font-medium text-text">{t('nmOnlyTitle')}.</span> {t('nmOnlyBody')}
          </p>
          <div className="mt-6 max-w-[640px] text-[13px] leading-[1.7] text-muted">
            <p>{t('trustPayment')}</p>
            <p className="mt-2">{t('trustValidity')}</p>
          </div>

          {/* Makeover 1a (artboard 2b): la guía de envío seguro también vive INLINE al pie
              de la página (retícula 01–04 a cuatro columnas), además del modal del hero. */}
          <div className="mt-8">
            <h2 className="eyebrow">{t('shippingGuideLink')}</h2>
            <SafeShippingGuide columns={4} className="mt-4" />
          </div>
        </section>

        {/* Aviso de solicitud creada (§23.14.4c). El texto viejo —«te avisaremos cuando
            recibamos tu carta»— se leía como permiso para ENVIAR y se saltaba el ciclo entero
            (oferta → aceptación → etiqueta); PROJECT es tajante: lo que llega por cuenta propia
            NO está comprado. El nuevo dice explícitamente que no mande nada todavía. Sin plazos
            (ese reloj es nuestro, §23.4.3) y sin la resta: es una secuencia, no una afirmación
            de coste, y §23.14.3 muerde sobre las afirmaciones de coste, no sobre la logística. */}
        {createdId && (
          <p className="gutter rule-note py-5 text-sm text-text" role="status">
            {t('created')}
          </p>
        )}

        {/* §33.3 (Stream A): «Mis solicitudes» vive ahora en la pestaña Ventas de «Compras y
            ventas» (`/orders?tab=ventas`). Aquí queda UNA línea con sesión; sin sesión, la
            invitación de siempre — y el enlace lleva `?next=/buylist` para volver al cotizador
            con el carrito de venta ya rehidratado (§33.11). Nunca consulta el endpoint. */}
        <section className="gutter border-t border-border pb-14 pt-10">
          {!sellReq.ready ? null : sellReq.isAuthenticated ? (
            <EditorialLink href="/orders?tab=ventas">{t('viewMyRequests')} →</EditorialLink>
          ) : (
            <div className="max-w-[560px]">
              <p className="text-[13px] leading-[1.7] text-muted">{t('requestsLoginInvite')}</p>
              <Link
                href="/login?next=/buylist"
                className="mt-4 inline-block border-b border-accent pb-1.5 text-xs font-medium text-accent hover:border-text hover:text-text"
              >
                {t('loginCta')}
              </Link>
            </div>
          )}
        </section>

        {/* FAB del carrito (§18.4a): fijo abajo-derecha, en el flujo de tabulación DESPUÉS
            del contenido principal (§18.8, sin tabindex positivos). Siempre presente (vacío
            da acceso a los requisitos de venta); el badge se omite con carrito vacío.
            §37.1a (P-61): FAB (`lg:hidden`) y barra (`hidden lg:flex`) se montan SIEMPRE y los
            esconde el CSS; los dos van al final del orden de tabulación (§37.1d). */}
        <SellCartFab
          ref={fabRef}
          count={cartCount}
          open={drawerOpen}
          onClick={() => openDrawerFrom(fabRef.current)}
        />
        <SellCartBar
          ref={barButtonRef}
          cartCount={cartCount}
          hasLines={cart.length > 0}
          totalEstimatedCents={totalEstimatedCents}
          pendingCardCount={pendingCardCount}
          noFreshPrice={requoting || requoteFailed}
          showLoginHint={sellReq.ready && !sellReq.isAuthenticated}
          drawerOpen={drawerOpen}
          dialogId={drawerId}
          onOpen={() => openDrawerFrom(barButtonRef.current)}
        />
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
                          <BuylistPendingLineLabel />
                        ) : (
                          formatMoneyCents(unitCents * l.quantity, locale)
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <div className="flex items-baseline justify-between gap-3 pt-3">
                <span className="text-[13px] font-medium text-text">{t('quote.money.cardsValue')}</span>
                {/* §37.1b: la MISMA función que el cajón y la barra (antes este bloque copiaba dos de
                    las tres ramas y omitía la del «—»). El CTA que abre este modal está apagado
                    mientras se recotiza, así que esa rama es hoy inalcanzable aquí — pero la cifra
                    sale de un solo sitio, no de una copia que diverja a la próxima. */}
                <CartTotalFigure
                  noFreshPrice={requoting || requoteFailed}
                  totalEstimatedCents={totalEstimatedCents}
                  pendingCardCount={pendingCardCount}
                  size="summary"
                  testIdScope="sell-request"
                />
              </div>
              {/* §23.3h: el paso de crear también es un bloque de dinero, así que explica su
                  propia aritmética — mismo texto, misma vez, con el conteo interpolado. */}
              <BuylistPendingLinesNote count={pendingCardCount} className="mt-2" />
              {/* Vigencia del estimado (copy editable de confianza). */}
              <p className="mt-3 font-mono text-[11px] leading-[1.6] text-muted">{t('trustValidity')}</p>
            </div>

            <BuylistKycForm
              items={requestItems}
              // El mismo mínimo del cotizador: el paso de crear no vuelve a pedirlo (una sola
              // llamada por montaje) y el `422` del servidor manda sobre él si difieren.
              minimumRequestCents={minimumRequestCents}
              totalEstimatedCents={totalEstimatedCents}
              // §23.3f-bis: el consejo del faltante cambia con líneas sin precio (la cifra no).
              pendingCardCount={pendingCardCount}
              // Heads-up derivado de GET /users/me/kyc (⭐ v1.69: el VEREDICTO del servidor, no una
              // comparación nuestra); el backend re-decide igualmente (SEC-A1).
              ineExpected={sellReq.ineExpected}
              clabeMasked={sellReq.clabeMasked}
              // v1.15: atajo "usar mi CLABE" (omite `clabe`) e INE en archivo (oculta uploaders).
              clabeOnFile={sellReq.clabeOnFile}
              ineOnFile={sellReq.ineOnFile}
              // P-78 (§34.8.4): si la INE anterior fue rechazada, el motivo se lee AQUÍ también.
              kycStatus={sellReq.kyc?.kycStatus}
              rejectionReason={sellReq.kyc?.rejectionReason}
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
