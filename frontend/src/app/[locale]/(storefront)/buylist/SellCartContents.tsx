'use client';

import { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { AppLocale } from '@/i18n/routing';
import type { BuylistQuoteResponse } from '@/types/contract';
import type { SellRequirements } from '@/hooks/useSellRequirements';
import { formatMoneyCents } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { CardImage } from '@/components/ui/CardImage';
import { Link } from '@/i18n/navigation';
import { FinishMark } from '@/components/domain/FinishMark';
import { SellRequirementsPanel } from '@/components/domain/SellRequirementsPanel';
import { BuylistShippingNote } from '@/components/domain/BuylistShippingNote';
import { BuylistMinimumShortfall } from '@/components/domain/BuylistMinimumShortfall';
import {
  BuylistPendingLineLabel,
  BuylistPendingLinesNote,
} from '@/components/domain/BuylistPendingLinesNote';
import type { CartLine } from './useSellCart';
import { MAX_LINE_QUANTITY } from './useSellCart';
import { minimumShortfallCents } from './useQuotePolicy';

/**
 * Renglón de detalle: concepto a la izquierda, dato a la derecha.
 * `lang` va en el propio contenedor del dato (los nombres y rarezas de catálogo son EN).
 */
function QuoteRow({
  label,
  lang,
  children,
}: {
  label: string;
  lang?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border py-2.5 text-[12px] text-muted last:border-b-0">
      <span>{label}</span>
      <span lang={lang} className="text-right text-text">
        {children}
      </span>
    </div>
  );
}

export interface SellCartContentsProps {
  cart: CartLine[];
  /** Gating de cuenta (sesión / correo / CLABE / INE) — ver useSellRequirements. */
  sellReq: SellRequirements;
  expandedLines: Record<string, boolean>;
  totalEstimatedCents: number;
  pendingCardCount: number;
  /** Piezas totales (suma de cantidades), para el CTA «Enviar solicitud (N)». */
  cartCount: number;
  /**
   * Mínimo de compra del servidor (`GET /buylist/quote-policy`). `undefined` mientras carga y
   * también si la llamada FALLÓ: los dos casos degradan igual —sin faltante y con el CTA vivo—
   * porque la puerta real es el `422` del servidor (fail-open, contrato §6).
   */
  minimumRequestCents?: number;
  onSetQuantity: (lineId: string, quantity: number) => void;
  onRemoveLine: (lineId: string) => void;
  onToggleLineDetail: (lineId: string) => void;
  onClearCart: () => void;
  /** CTA «Enviar solicitud»: el dueño cierra el drawer y abre el modal de solicitud (§18.4b). */
  onSubmit: () => void;
  /**
   * ¿Le toca a ESTE bloque pintar la nota de servicio del envío? (§23.3g-bis, v2.3.8).
   *
   * ⚠️ **La decisión NO se toma aquí y es deliberado:** la regla es *«exactamente una nota
   * visible por pantalla»*, y eso solo se puede decidir donde se conoce **el layout completo** —
   * si el carrito es panel fijo, si el drawer está abierto, si el modal de crear está encima—.
   * Un componente que decidiera por su cuenta volvería a producir el caso de v2.3.7: dos párrafos
   * idénticos a 600px de distancia, que el vendedor no lee como énfasis sino como *«esta página
   * está rota»*. `BuylistView` es el único que ve la pantalla entera; aquí solo se obedece.
   */
  showShippingNote?: boolean;
}

/**
 * Contenido del drawer del carrito de venta (TL-C3/FE-13: extracción MECÁNICA de BuylistView,
 * sin cambio de comportamiento). Es el bloque que vive ENTRE `<SellCartDrawer>` y
 * `</SellCartDrawer>`: requisitos → líneas → total → CTA → vaciar. No sabe de drawer ni de
 * modal: recibe el carrito y handlers, y delega el submit al dueño.
 */
export function SellCartContents({
  cart,
  sellReq,
  expandedLines,
  totalEstimatedCents,
  pendingCardCount,
  cartCount,
  minimumRequestCents,
  onSetQuantity,
  onRemoveLine,
  onToggleLineDetail,
  onClearCart,
  onSubmit,
  showShippingNote = true,
}: SellCartContentsProps) {
  const t = useTranslations('buylist');
  const tFinish = useTranslations('finish');
  const locale = useLocale() as AppLocale;

  // Faltante del mínimo (criterio 132a). `null` = no hay faltante que pintar: o el mínimo ya se
  // alcanzó (borde INCLUSIVO) o NO se conoce (la política no llegó) — y en ese segundo caso el
  // CTA sigue habilitado a propósito: fail-open, la puerta es el `422` del servidor.
  const shortfallCents =
    cart.length > 0 ? minimumShortfallCents(minimumRequestCents, totalEstimatedCents) : null;
  const belowMinimum = shortfallCents != null;

  // §23.10 · el CRUCE del mínimo se anuncia una vez con `aria-live="polite"`, y el anuncio ya no
  // menciona envío ni neto. Solo la TRANSICIÓN debajo→arriba habla: un carrito que nace por
  // encima del mínimo no dispara nada (sería ruido), y la nota de servicio jamás entra aquí.
  const [minimumAnnounce, setMinimumAnnounce] = useState('');
  const wasBelowRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (minimumRequestCents == null || cart.length === 0) {
      wasBelowRef.current = null;
      setMinimumAnnounce('');
      return;
    }
    const below = totalEstimatedCents < minimumRequestCents;
    if (wasBelowRef.current === true && !below) {
      setMinimumAnnounce(
        t('quote.minimum.reachedAnnounce', { amount: formatMoneyCents(minimumRequestCents, locale) }),
      );
    } else if (below) {
      setMinimumAnnounce('');
    }
    wasBelowRef.current = below;
  }, [minimumRequestCents, totalEstimatedCents, cart.length, locale, t]);

  return (
    <>
      {/* Requisitos de cuenta SIEMPRE visibles (aun con carrito vacío — §18.6: el
          drawer vacío es útil): el usuario sabe QUÉ le falta antes de llenar todo
          (sesión / correo / CLABE / INE). */}
      <SellRequirementsPanel req={sellReq} />

      {cart.length === 0 ? (
        <>
          <p className="mt-5 text-[13px] leading-[1.7] text-muted">{t('cartEmpty')}</p>
          {/* §23.9: el cotizador vacío TAMBIÉN explica el trato del envío. Que se lea antes de
              agregar nada es el punto: cambiar de opinión todavía no cuesta nada. */}
          {showShippingNote && <BuylistShippingNote surface="cart-money" className="mt-4" />}
        </>
      ) : (
        <>
          <ul className="mt-4">
            {cart.map((l) => {
              const pending = l.quote.quote.status === 'precio_pendiente';
              const unitCents = l.quote.quote.quotedPriceCents ?? 0;
              const detailOpen = !!expandedLines[l.id];
              return (
                <li key={l.id} className="border-b border-border py-3">
                  {/* FE-IMG: miniatura de la carta. El dato YA viajaba en la línea del carrito
                      (`useSellCart.CartLine.card.imageSmallUrl`, poblado desde el binder y el
                      picker de BuylistView): este era el único listado de piezas de la app que lo
                      tenía y no lo pintaba. Mismo patrón que el checkout de compra (CheckoutView):
                      columna fija a la izquierda y contenido en `min-w-0 flex-1` para que el nombre
                      siga truncando en el ancho del drawer (400px).
                      La columna se pinta SIEMPRE, también sin miniatura (`QuoterCardRef.
                      imageSmallUrl` es OPCIONAL: el binder de Master Set puede no traerla). Antes se
                      omitía entera, y la razón que lo justificaba —«un `CardImage` sin `src` deja el
                      esqueleto pulsando para siempre»— dejó de ser cierta en `6396edb`: el
                      esqueleto ya solo pulsa mientras hay una imagen EN VUELO, y sin `src` queda el
                      pozo de papel quieto, que ES el placeholder del sistema. Omitirla dejaba dos
                      geometrías de fila distintas en el mismo drawer (y distintas del checkout)
                      según un dato que el usuario no controla. */}
                  <div className="flex gap-3">
                    <div className="w-12 shrink-0">
                      <CardImage src={l.card.imageSmallUrl} alt={l.card.name} className="p-1" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-3">
                        <p lang="en" className="min-w-0 truncate text-sm text-text">
                          {l.card.name}
                        </p>
                        <span className="tabular shrink-0 text-sm font-medium text-text">
                          {/* Honesto: una línea pendiente NO muestra MX$0.00 — cero es un precio y
                              aquí no hay precio (§23.3h). La versalita ocupa el sitio de la cifra. */}
                          {pending ? (
                            <BuylistPendingLineLabel />
                          ) : (
                            formatMoneyCents(unitCents * l.quantity, locale)
                          )}
                        </span>
                      </div>
                      <p className="mt-1 flex flex-wrap items-baseline gap-x-1.5 font-mono text-[10px] text-muted">
                        <span className="text-muted">{t('cartItemEstimate')}:</span>
                        {pending ? (
                          <BuylistPendingLineLabel className="text-[10px]" />
                        ) : (
                          <span className="tabular">{formatMoneyCents(unitCents, locale)}</span>
                        )}
                        <span aria-hidden>·</span>
                        {/* P-14 (§18.5): FinishMark compartido (banda 3px + etiqueta mono)
                            en vez del texto plano del acabado — mismo lenguaje que la teja. */}
                        <FinishMark finish={l.finish} className="translate-y-[1px]" />
                        <span aria-hidden>·</span>
                        <span>
                          ×<span className="tabular">{l.quantity}</span>
                        </span>
                      </p>
                      <div className="mt-2 flex items-center gap-4">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            aria-label={t('decreaseQty')}
                            disabled={l.quantity <= 1}
                            onClick={() => onSetQuantity(l.id, l.quantity - 1)}
                            className="font-mono text-sm text-muted hover:text-text disabled:opacity-40"
                          >
                            −
                          </button>
                          {/* Cantidad con input numérico: vender 20 iguales sin 20 clics. */}
                          <input
                            type="number"
                            min={1}
                            max={MAX_LINE_QUANTITY}
                            inputMode="numeric"
                            aria-label={t('quantityFor', { name: l.card.name })}
                            value={l.quantity}
                            // IMP-A: onSetQuantity clampa a [1, MAX_LINE_QUANTITY]; un valor
                            // gigante ya no llega a `Array.from({ length })` ni revienta la página.
                            onChange={(e) => onSetQuantity(l.id, Number.parseInt(e.target.value, 10))}
                            className="w-14 border-b border-border-strong bg-transparent py-0.5 text-center font-mono text-xs text-text outline-none focus-visible:shadow-focus"
                          />
                          <button
                            type="button"
                            aria-label={t('increaseQty')}
                            onClick={() => onSetQuantity(l.id, l.quantity + 1)}
                            className="font-mono text-sm text-muted hover:text-text"
                          >
                            +
                          </button>
                        </div>
                        {/* Detalle expandible: la transparencia de la cotización vive aquí
                            (valor de referencia / regla aplicada / acabado / pendiente). */}
                        <button
                          type="button"
                          aria-expanded={detailOpen}
                          onClick={() => onToggleLineDetail(l.id)}
                          className="font-mono text-[10px] uppercase tracking-[0.06em] text-muted hover:text-accent"
                        >
                          {detailOpen ? t('lineDetailHide') : t('lineDetailShow')}
                        </button>
                        <button
                          type="button"
                          onClick={() => onRemoveLine(l.id)}
                          className="ml-auto font-mono text-[10px] uppercase tracking-[0.06em] text-muted hover:text-accent"
                        >
                          {t('removeLine')}
                        </button>
                      </div>
                    </div>
                  </div>
                  {detailOpen && (
                    <div className="mt-3 border-l border-border-strong pl-4">
                      {l.quote.rarity && (
                        <QuoteRow label={t('rarityLabel')} lang="en">
                          {l.quote.rarity}
                        </QuoteRow>
                      )}
                      <QuoteRow label={tFinish('label')}>{tFinish(l.quote.finish)}</QuoteRow>
                      {l.quote.referencePrice.status === 'priced' && (
                        <QuoteRow label={t('referencePrice')}>
                          <span className="tabular">
                            {formatMoneyCents(l.quote.referencePrice.priceMxnCents ?? 0, locale)}
                          </span>
                        </QuoteRow>
                      )}
                      {/* v2.0 (P-48): la fila «Regla aplicada» SE RETIRA — no hay reglas por
                          rareza/acabado, hay una curva. El monto lo deriva el backend (SEC-A1) y
                          esta superficie es del cliente: un rótulo interno de `priceBasis` aquí
                          explicaría menos que el propio importe. */}
                      {pending && (
                        <p className="rule-note mt-3 text-[12px] leading-[1.7] text-muted">
                          {t('pricePendingNotice')}
                        </p>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          {/* Bloque de dinero del cotizador (§23.3c, D43): UN SOLO MONTO, rotulado por lo que es
              —«Valor de tus cartas»—, el faltante del mínimo si lo hay, y la nota de servicio del
              envío. ⛔ NO hay línea de envío, NO hay resta, NO hay neto estimado y el bloque NO
              reserva altura para ellos: esas líneas no existen en ningún estado, así que un hueco
              con forma de monto solo prometería una cifra que jamás va a llegar. */}
          <div className="py-5" data-testid="sell-cart-money">
            {/* Artboard 2b: etiqueta mono en versalitas y cifra héroe (26px) del total. */}
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-mono text-[11px] font-medium uppercase tracking-eyebrow text-text">
                {t('quote.money.cardsValue')}
              </span>
              {/* Si TODO el carrito está pendiente, el total NO es MX$0.00: es la versalita
                  (§23.3h) — «un total de cero que significa todavía no lo he calculado no es un
                  cero». El porqué se explica debajo, en `BuylistPendingLinesNote`. */}
              {totalEstimatedCents === 0 && pendingCardCount > 0 ? (
                <BuylistPendingLineLabel className="text-[13px]" />
              ) : (
                <span className="tabular font-mono text-[26px] font-medium leading-none text-text">
                  {formatMoneyCents(totalEstimatedCents, locale)}
                </span>
              )}
            </div>

            {/* Faltante (criterio 132a): cuánto falta, con el número del servidor. Al cruzar el
                mínimo lo ÚNICO que cambia es que este bloque desaparece. */}
            {belowMinimum && minimumRequestCents != null && (
              <BuylistMinimumShortfall
                id="sell-cart-minimum"
                shortfallCents={shortfallCents}
                minimumCents={minimumRequestCents}
                // §23.3f-bis: con líneas sin precio, «Agrega otra carta» es una cinta de correr.
                hasPendingLines={pendingCardCount > 0}
                className="mt-3"
              />
            )}

            {/* §23.3h: la explicación del total va DENTRO del bloque de dinero y UNA sola vez,
                con el conteo interpolado. Antes vivía fuera, en mono muted de 11px, diciendo algo
                distinto («cuando las recibimos») — bajo el ciclo de oferta esas cartas se cotizan
                a mano AL OFERTAR, no al recibirlas. */}
            <BuylistPendingLinesNote count={pendingCardCount} className="mt-3" />

            {/* La nota de servicio: aire, no regla ni caja (§23.3c). Misma frase por encima y por
                debajo del mínimo — al no llevar cifras no depende de ningún estado. */}
            {showShippingNote && <BuylistShippingNote surface="cart-money" className="mt-3" />}

            {/* El cruce del mínimo se anuncia una sola vez; la nota NUNCA entra en la live region. */}
            <p aria-live="polite" className="sr-only">
              {minimumAnnounce}
            </p>
          </div>
          {/* El total es un ESTIMADO — y v2.3.2 corrigió POR QUÉ (§23.14.4a). El texto viejo
              decía que «el monto final lo confirma la plataforma cuando recibimos y verificamos
              tus cartas»: eso implica REPRECIADO, y bajo D2/D9 el precio ofertado es vinculante
              desde que sale el correo y verificar solo tiene dos desenlaces (llega en NM y se
              paga lo ofertado, o no llega en NM y se rechaza). Ahora dice lo que sí es cierto:
              los precios se mueven y puede que no compremos todas las líneas.
              ⚠ No cierra con «antes de que aceptes» a propósito: `shippingNote`, en este mismo
              bloque, ya termina así, y dos frases con la misma cola se leen como plantilla.
              Nota al margen con regla roja (artboard 2b), no un renglón mono suelto. */}
          <p className="rule-note text-[13px] leading-[1.6] text-muted">{t('estimateNote')}</p>

          {sellReq.ready && !sellReq.isAuthenticated ? (
            /* Sin sesión: el envío se sustituye por el CTA de entrar/crear cuenta
               (el guard devolvería 401/403; mejor decirlo aquí). */
            <div className="mt-5 flex flex-col gap-3">
              <Link
                href="/login"
                className="inline-flex min-h-[44px] w-full items-center justify-center bg-primary px-6 text-[11px] font-medium uppercase tracking-label text-primary-fg"
              >
                {t('loginCta')}
              </Link>
              <Link
                href="/register"
                className="inline-flex min-h-[44px] w-full items-center justify-center border border-border-strong px-6 text-[11px] font-medium uppercase tracking-label text-text hover:border-text"
              >
                {t('registerCta')}
              </Link>
            </div>
          ) : (
            <>
              {/* Artboard 2b: «Enviar solicitud» es un bloque de TINTA (negro, 54px);
                  el rojo queda reservado para el compromiso de pago del checkout. */}
              <Button
                variant="primary"
                className="mt-5 min-h-[54px] w-full tracking-eyebrow"
                // El gate del mínimo SOLO existe cuando el mínimo se conoce (`belowMinimum` es
                // false si la política no llegó): apagar el botón por un error de red sería
                // fail-closed y bloquearía a un vendedor legítimo.
                disabled={cart.length === 0 || !sellReq.canSubmit || belowMinimum}
                // §15.9/§23.10: ningún control apagado y mudo — el motivo y su remedio siempre
                // están enlazados (el faltante dice cuánto falta y qué hacer).
                aria-describedby={
                  [
                    sellReq.emailBlocked ? 'sell-blocked-reason' : null,
                    belowMinimum ? 'sell-cart-minimum' : null,
                  ]
                    .filter(Boolean)
                    .join(' ') || undefined
                }
                onClick={onSubmit}
              >
                {t('sendRequestCta', { count: cartCount })}
              </Button>
              {sellReq.emailBlocked && (
                /* Explica POR QUÉ el botón está deshabilitado (el reenvío vive en el panel). */
                <p
                  id="sell-blocked-reason"
                  className="mt-3 font-mono text-[11px] leading-[1.6] text-accent"
                >
                  {t('submitBlockedEmail')}
                </p>
              )}
            </>
          )}
          {/* «Vaciar la lista»: acción terciaria como texto mono centrado (artboard 2b). */}
          <button
            type="button"
            onClick={onClearCart}
            className="mt-4 block min-h-[44px] w-full text-center font-mono text-[10px] uppercase tracking-[0.1em] text-muted hover:text-accent"
          >
            {t('clearCart')}
          </button>

          {/* Pie del carrito: cuándo y cómo se paga (mono en versalitas, artboard 2b). */}
          <p className="mt-6 border-t border-border pt-4 font-mono text-[10px] uppercase leading-[1.7] tracking-[0.12em] text-muted">
            {t('cartFooterNote')}
          </p>
        </>
      )}
    </>
  );
}
