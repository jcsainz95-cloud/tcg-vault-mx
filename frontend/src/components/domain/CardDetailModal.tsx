'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { AppLocale } from '@/i18n/routing';
import type { Finish, ProductType } from '@/types/contract';
import { formatMoneyCents } from '@/lib/format';
import { formatCardCode } from '@/lib/setCode';
import { Modal } from '@/components/ui/Modal';
import { FinishMark } from '@/components/domain/FinishMark';
import { RarityLabel } from '@/components/domain/RarityLabel';

export interface CardDetailModalCard {
  name: string;
  setName?: string;
  /** v1.80 (P-71): código corto del set; con él la ficha pinta «TWM 130» en vez de `#130`. */
  setPtcgoCode?: string | null;
  number?: string;
  rarity?: string | null;
  productType?: ProductType;
  /** Se prioriza la imagen GRANDE (P-43: para que el texto de la carta se lea); fallback a la chica. */
  imageLargeUrl?: string;
  imageSmallUrl?: string;
}

export interface CardDetailModalProps {
  open: boolean;
  onClose: () => void;
  card: CardDetailModalCard | null;
  /** Acabado del contexto (una teja del cotizador es una impresión concreta). Opcional. */
  finish?: Finish;
  /** Estimado ya cotizado server-side (cents). `null`/undefined ⇒ no se pinta precio (nunca $0). */
  priceCents?: number | null;
  /** Si el precio está pendiente, se rotula «Precio pendiente» en vez de la cifra. */
  pricePending?: boolean;
  /**
   * §BMK (API_CONTRACT §BMK.4 · DESIGN_SYSTEM §BMK.3): valor de mercado YA decidido por el llamador
   * con `visibleMarketCents` (el mismo número que la teja que abrió la ventana). Ausente, `null` o no
   * entero `> 0` ⇒ la fila no existe. La ventana no decide nada: solo pinta.
   */
  marketCents?: number | null;
}

/**
 * Pop-up de DETALLE de una carta (P-43). Al hacer click en la teja (imagen), no en «Agregar»,
 * se abre este modal con la IMAGEN GRANDE (imageLargeUrl con fallback a imageSmallUrl) para que
 * el texto de la carta se lea, más los datos (nombre, set, #, acabado, rareza, precio).
 *
 * Reutiliza el `Modal` del sistema (§7.6): cierra con click fuera (backdrop), Esc y botón cerrar,
 * con foco y aria-modal. AGREGAR sigue siendo su propia acción, aparte de este click de detalle.
 *
 * Money-safe: solo DISPLAY. El precio que muestra es el estimado YA cotizado server-side que le
 * pasa el llamador; este componente no deriva montos.
 */
export function CardDetailModal({
  open,
  onClose,
  card,
  finish,
  priceCents,
  pricePending,
  marketCents,
}: CardDetailModalProps) {
  const t = useTranslations('cardDetail');
  // §BMK.8: «Valor de mercado» / «Te pagamos» viven UNA vez, en `buylist.sellPrice` (un dato, un nombre).
  const tSell = useTranslations('buylist.sellPrice');
  const tFinish = useTranslations('finish');
  const locale = useLocale() as AppLocale;

  if (!card) return null;
  const imageSrc = card.imageLargeUrl || card.imageSmallUrl;
  const showPrice = pricePending || (priceCents != null && priceCents >= 0);
  // §BMK.3: la fila de mercado NO hereda el `>= 0` de arriba (desviación (f)4): su condición es `> 0`.
  const showMarket = typeof marketCents === 'number' && Number.isInteger(marketCents) && marketCents > 0;

  return (
    <Modal open={open} onClose={onClose} title={card.name}>
      <div className="flex flex-col gap-5">
        {/* Imagen grande sobre pozo de papel: el arte es el protagonista y su texto se lee. */}
        <div className="mx-auto w-full max-w-[300px]">
          <div className="relative flex aspect-[5/7] items-center justify-center bg-surface-2 p-3">
            {imageSrc ? (
              // datos de catálogo en inglés → lang="en" (DESIGN_SYSTEM §9.2)
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={imageSrc}
                alt={card.name}
                lang="en"
                className="h-full w-full object-contain"
              />
            ) : (
              <span className="font-mono text-[10px] uppercase tracking-label text-muted">
                {t('noImage')}
              </span>
            )}
          </div>
        </div>

        {/* Ficha de datos: nombre (ya en el título), set · #, acabado, rareza, mercado (§BMK), te pagamos. */}
        <dl className="flex flex-col">
          {(card.setName || card.number) && (
            <div className="flex items-baseline justify-between gap-4 border-b border-border py-2.5">
              <dt className="text-[12px] text-muted">{t('setAndNumber')}</dt>
              <dd lang="en" className="text-right text-[13px] text-text">
                {card.setName}
                {card.setName && card.number ? ' · ' : ''}
                {/* v1.80 (P-71, §37.3c): «Set · TWM 130»; sin código, `#130` como siempre. */}
                {formatCardCode(card.setPtcgoCode, card.number ?? '')}
              </dd>
            </div>
          )}
          {finish && card.productType !== 'sealed' && (
            <div className="flex items-center justify-between gap-4 border-b border-border py-2.5">
              <dt className="text-[12px] text-muted">{tFinish('label')}</dt>
              <dd className="text-right">
                <FinishMark finish={finish} className="translate-y-[1px]" />
              </dd>
            </div>
          )}
          {card.rarity && card.productType !== 'sealed' && (
            <div className="flex items-center justify-between gap-4 border-b border-border py-2.5">
              <dt className="text-[12px] text-muted">{t('rarity')}</dt>
              <dd className="text-right">
                <RarityLabel rarity={card.rarity} productType={card.productType} />
              </dd>
            </div>
          )}
          {/* §BMK.3 (DESIGN_SYSTEM): «Valor de mercado» va ANTES de «Te pagamos», secundaria (13 px,
              muted). ⛔ Sin tachado ni estilo que dependa de cuál cifra es mayor (§BMK.1 punto 2). */}
          {showMarket && (
            <div className="flex items-baseline justify-between gap-4 border-b border-border py-2.5">
              <dt className="text-[12px] text-muted">{tSell('market')}</dt>
              <dd className="text-right">
                <span className="tabular font-mono text-[13px] text-muted">
                  {formatMoneyCents(marketCents, locale)}
                </span>
              </dd>
            </div>
          )}
          {showPrice && (
            <div className="flex items-baseline justify-between gap-4 border-b border-border py-2.5">
              {/* §BMK.3: la fila «Estimado» se renombra en pantalla a «Te pagamos» (único llamador: el
                  cotizador, `MasterSetBinder`). El tono lo sostiene `masterSet.quoterPriceNote` (§BMK.7). */}
              <dt className="text-[12px] text-muted">{tSell('wePay')}</dt>
              <dd className="text-right">
                {pricePending ? (
                  <span className="font-mono text-[12px] text-accent">{t('pending')}</span>
                ) : (
                  <span className="tabular font-mono text-[14px] text-text">
                    {formatMoneyCents(priceCents ?? 0, locale)}
                  </span>
                )}
              </dd>
            </div>
          )}
        </dl>
      </div>
    </Modal>
  );
}
