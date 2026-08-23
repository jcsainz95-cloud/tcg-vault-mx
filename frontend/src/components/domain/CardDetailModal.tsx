'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { AppLocale } from '@/i18n/routing';
import type { Finish, ProductType } from '@/types/contract';
import { formatMoneyCents } from '@/lib/format';
import { Modal } from '@/components/ui/Modal';
import { FinishMark } from '@/components/domain/FinishMark';
import { RarityLabel } from '@/components/domain/RarityLabel';

export interface CardDetailModalCard {
  name: string;
  setName?: string;
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
}: CardDetailModalProps) {
  const t = useTranslations('cardDetail');
  const tFinish = useTranslations('finish');
  const locale = useLocale() as AppLocale;

  if (!card) return null;
  const imageSrc = card.imageLargeUrl || card.imageSmallUrl;
  const showPrice = pricePending || (priceCents != null && priceCents >= 0);

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

        {/* Ficha de datos: nombre (ya en el título), set · #, acabado, rareza, precio. */}
        <dl className="flex flex-col">
          {(card.setName || card.number) && (
            <div className="flex items-baseline justify-between gap-4 border-b border-border py-2.5">
              <dt className="text-[12px] text-muted">{t('setAndNumber')}</dt>
              <dd lang="en" className="text-right text-[13px] text-text">
                {card.setName}
                {card.setName && card.number ? ' · ' : ''}
                {card.number ? `#${card.number}` : ''}
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
          {showPrice && (
            <div className="flex items-baseline justify-between gap-4 border-b border-border py-2.5">
              <dt className="text-[12px] text-muted">{t('estimate')}</dt>
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
