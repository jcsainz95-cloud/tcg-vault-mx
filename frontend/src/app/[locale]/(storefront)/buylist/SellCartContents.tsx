'use client';

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
import type { CartLine } from './useSellCart';
import { MAX_LINE_QUANTITY } from './useSellCart';

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
  onSetQuantity: (lineId: string, quantity: number) => void;
  onRemoveLine: (lineId: string) => void;
  onToggleLineDetail: (lineId: string) => void;
  onClearCart: () => void;
  /** CTA «Enviar solicitud»: el dueño cierra el drawer y abre el modal de solicitud (§18.4b). */
  onSubmit: () => void;
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
  onSetQuantity,
  onRemoveLine,
  onToggleLineDetail,
  onClearCart,
  onSubmit,
}: SellCartContentsProps) {
  const t = useTranslations('buylist');
  const tFinish = useTranslations('finish');
  const locale = useLocale() as AppLocale;

  return (
    <>
      {/* Requisitos de cuenta SIEMPRE visibles (aun con carrito vacío — §18.6: el
          drawer vacío es útil): el usuario sabe QUÉ le falta antes de llenar todo
          (sesión / correo / CLABE / INE). */}
      <SellRequirementsPanel req={sellReq} />

      {cart.length === 0 ? (
        <p className="mt-5 text-[13px] leading-[1.7] text-muted">{t('cartEmpty')}</p>
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
                          {/* Honesto: una línea pendiente NO muestra MX$0.00. */}
                          {pending ? (
                            <span className="font-mono text-[11px] text-accent">{t('linePending')}</span>
                          ) : (
                            formatMoneyCents(unitCents * l.quantity, locale)
                          )}
                        </span>
                      </div>
                      <p className="mt-1 flex flex-wrap items-baseline gap-x-1.5 font-mono text-[10px] text-muted">
                        <span className="text-muted">{t('cartItemEstimate')}:</span>
                        {pending ? (
                          <span className="text-accent">{t('linePending')}</span>
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

          {/* Artboard 2b: etiqueta mono en versalitas y cifra héroe (26px) del total. */}
          <div className="flex items-baseline justify-between gap-3 py-5">
            <span className="font-mono text-[11px] font-medium uppercase tracking-eyebrow text-text">
              {t('totalEstimated')}
            </span>
            {/* Si TODO el carrito está pendiente, el total no es MX$0.00: es pendiente. */}
            {totalEstimatedCents === 0 && pendingCardCount > 0 ? (
              <span className="font-mono text-[13px] text-accent">{t('linePending')}</span>
            ) : (
              <span className="tabular font-mono text-[26px] font-medium leading-none text-text">
                {formatMoneyCents(totalEstimatedCents, locale)}
              </span>
            )}
          </div>
          {pendingCardCount > 0 && (
            <p className="mb-3 font-mono text-[11px] leading-[1.6] text-muted">
              {t('totalPendingNote', { count: pendingCardCount })}
            </p>
          )}

          {/* SEC-A1: el total es un ESTIMADO; el backend confirma el monto al recibir.
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
                disabled={cart.length === 0 || !sellReq.canSubmit}
                aria-describedby={sellReq.emailBlocked ? 'sell-blocked-reason' : undefined}
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
