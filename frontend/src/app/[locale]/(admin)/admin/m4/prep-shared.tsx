'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { CardImage } from '@/components/ui/CardImage';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { FinishMark } from '@/components/domain/FinishMark';
import { formatAge, formatDate } from '@/lib/format';
import type { AppLocale } from '@/i18n/routing';
import type { LocationView, PreparationItemDTO, VaultZone } from '@/types/contract';

/**
 * Piezas que comparten la tarjeta de ENVÍO y la de BÓVEDA de «Pedidos a preparar» (§35.3 / §36.2:
 * *misma caja, mismo orden del DOM; lo que cambia es qué hay en cada plano*). Viven aquí para que
 * las dos tarjetas no se separen en silencio: una carta se lee igual se vaya a un domicilio o a un
 * cajón.
 */

/** §32.4: lo desconocido es «—», nunca omitido en silencio. */
export const DASH = '—';

/**
 * Tono del **RÓTULO** (§35.3 regla 1: *el valor pesa más que su etiqueta*). Los rótulos se leen una
 * vez en la vida; los valores, cada vez.
 */
export const LABEL = 'font-mono text-[11px] uppercase tracking-[0.06em] text-muted';

/** Versalita de ESTADO (misma forma que `LABEL`, sin tono: cada uso decide su tinta). */
export const TAG = 'font-mono text-[11px] uppercase tracking-[0.06em]';

type Translator = ReturnType<typeof useTranslations>;

/**
 * **V3 (§36.0) — un cajón o una ubicación se nombra SIEMPRE con su zona**: «Custodia de clientes ·
 * C10-F01-S01». Las etiquetas se repiten entre zonas (`§M4-VAULT.1`), y una sola haría leer
 * `C01-F01-S01 → C01-F01-S01` como «ya está ahí». Las zonas salen de `admin.m1.zone.*`: *un solo
 * nombre para cada zona en todo el back-office* (§36.14).
 */
export function useZonedLabel() {
  const zoneName = useZoneName();
  return (zone: VaultZone, label: string) => `${zoneName(zone)} · ${label}`;
}

/** El nombre de una zona, de `admin.m1.zone.*` (⛔ no se duplica en otro espacio de nombres). */
export function useZoneName() {
  const tZone = useTranslations('admin.m1.zone');
  return (zone: VaultZone) => tZone(zone);
}

/** Antigüedad legible (CA #9) + la fecha absoluta al lado: el «hace N días» nunca la sustituye. */
export function AgeStamp({ iso, locale, t }: { iso: string; locale: AppLocale; t: Translator }) {
  return (
    <p className="flex flex-col items-start gap-0.5 text-sm sm:items-end">
      {/* P-7 / §32.4: `formatAge` devuelve `''` con una fecha ilegible ⇒ «—», nunca una línea en blanco. */}
      <span className="font-medium text-text">{formatAge(iso, locale) || DASH}</span>
      <time dateTime={iso} className="text-xs text-muted">
        {t('requestedAt')} <span>{formatDate(iso, locale) || DASH}</span>
      </time>
    </p>
  );
}

/**
 * La carta (§35.3 plano 2): miniatura, nombre, SET prominente, acabado, condición tal cual viene del
 * back, cantidad solo si no es 1, y el folio detrás (dato de cotejo en mano).
 */
export function CardInfo({
  card,
  folio,
  quantity,
  nameId,
  t,
}: {
  card: PreparationItemDTO['card'];
  folio: string;
  quantity: number;
  /** Id del nombre de la carta: lo usa el `role="group"` de los controles de palomeo (§36.5). */
  nameId?: string;
  t: Translator;
}) {
  const tp = useTranslations('admin.m4.prep.photo');
  const [viewerOpen, setViewerOpen] = useState(false);
  return (
    <>
      {/* `imageSmallUrl` es nullable: sin foto queda el pozo de papel, nunca un roto — y SIN disparador.
          §60.9 c: 72 px en `< sm` (64 en escritorio) y un toque la amplía para cotejarla en el estante. */}
      {card.imageSmallUrl ? (
        <button
          type="button"
          onClick={() => setViewerOpen(true)}
          aria-label={tp('view', { card: card.name })}
          className="w-[72px] shrink-0 self-start focus-visible:shadow-focus focus-visible:outline-none sm:w-16 print:pointer-events-none"
          data-testid="prep-photo-trigger"
        >
          <CardImage src={card.imageSmallUrl} alt={card.name} />
        </button>
      ) : (
        <CardImage src={card.imageSmallUrl} alt={card.name} className="w-[72px] shrink-0 sm:w-16" />
      )}
      {card.imageSmallUrl && (
        <Modal
          open={viewerOpen}
          onClose={() => setViewerOpen(false)}
          title={card.name}
          footer={
            <Button variant="secondary" className="min-h-[44px] w-full sm:w-auto" onClick={() => setViewerOpen(false)}>
              {tp('close')}
            </Button>
          }
        >
          <div className="flex flex-col items-center gap-3" data-testid="prep-photo-viewer">
            {/* El DTO de preparación solo trae `imageSmallUrl` (§60.12 A-3): se amplía a lo ancho, máx. 320 px. */}
            <CardImage src={card.imageSmallUrl} alt={card.name} className="w-full max-w-[320px]" />
            <p className="self-stretch text-sm text-text" lang="en">
              {card.name} · <span className="font-semibold">{card.setName ?? DASH}</span>
            </p>
            <p className="flex flex-wrap items-center gap-2 self-stretch text-sm">
              <FinishMark finish={card.finish} band={false} />
              <span className="text-text">{card.conditionLabel}</span>
            </p>
            <p className={`self-stretch ${LABEL}`}>
              {t('folio')} <span className="tabular">{folio}</span>
            </p>
          </div>
        </Modal>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p id={nameId} className="font-serif text-lg leading-tight text-text" lang="en">
          {card.name}
        </p>
        {/* Datos de catálogo no se traducen (§9.2) ⇒ lang="en". */}
        <p className="text-sm font-semibold text-text" lang="en">
          {card.setName ?? DASH}
        </p>
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <FinishMark finish={card.finish} band={false} />
          {/* ⛔ La condición NO se recompone aquí: viene compuesta del back (`conditionLabel`). */}
          <span className="text-text">{card.conditionLabel}</span>
          {quantity !== 1 && <span className="tabular text-text">×{quantity}</span>}
        </p>
        <p className={LABEL}>
          {t('folio')} <span className="tabular">{folio}</span>
        </p>
      </div>
    </>
  );
}

/**
 * **La columna de ubicación ACTUAL de una carta, con su zona** (V3 · §35.4: ubicación primero y en
 * columna). Una sola pieza para la tarjeta de bóveda (`prep-location-*`) y la vista «Qué debe haber»
 * (`physical-location-*`): antes eran dos copias idénticas (D6 del techlead).
 *
 * - Asignada y con zona ⇒ rótulo «Ubicación · <zona>» + etiqueta.
 * - Asignada sin zona (dato no conforme) ⇒ rótulo genérico «Ubicación» + etiqueta.
 * - Sin asignar ⇒ «Ubicación» + «Sin ubicación» en acento (la ausencia se dice).
 */
export function ZonedLocationColumn({
  location,
  zone,
  testId,
}: {
  location: LocationView;
  zone: VaultZone | null;
  testId: string;
}) {
  const tp = useTranslations('admin.m4.prep');
  const tv = useTranslations('admin.m4.prep.vault');
  const zoneName = useZoneName();
  return (
    <div data-testid={testId} className="flex shrink-0 flex-col gap-0.5 sm:w-40">
      {location.kind === 'assigned' ? (
        <>
          <span className={LABEL}>{zone ? tv('item.locationLabel', { zone: zoneName(zone) }) : tp('location')}</span>
          <span className="tabular text-sm text-text">{location.label}</span>
        </>
      ) : (
        <>
          <span className={LABEL}>{tp('location')}</span>
          <span className="text-sm text-accent">{tp('unassigned')}</span>
        </>
      )}
    </div>
  );
}
