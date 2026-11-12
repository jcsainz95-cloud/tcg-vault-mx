'use client';

import { useCallback, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getCardVersions } from '@/lib/api';
import type { ManualVersionResponse } from '@/lib/api/manual-version';
import type { CardDTO, CardLanguage, CardVersionsResponse, Finish } from '@/types/contract';
import { captureModel, type CaptureModel } from './ids-capture';

/**
 * §IDS.4 / IDS-UX.2 — estado y consulta de «Idioma» y «Versión» de una pieza raw por dar de alta, compartido por la
 * captura por lote (`AddItemModal`) y por el alta rápida del cajón (`QuickAddSection`, opción A del dueño, HECHOS
 * 2026-11-05). Una sola fuente para: la consulta `GET …/cards/:cardId/versions`, el modelo puro (`captureModel`), los
 * campos que viajan en el alta (`language` solo si ≠ 'en'; `cardProductId` solo con liga, IDS-F11) y la vuelta a
 * «Inglés / Sin liga» tras cada alta.
 */
export interface IdsCapturePayload {
  language?: CardLanguage;
  cardProductId?: number;
}

export interface IdsCapture {
  enabled: boolean;
  language: CardLanguage;
  setLanguage: (l: CardLanguage) => void;
  stampProductId: number | null;
  setStampProductId: (id: number | null) => void;
  /** A2 (modo casilla): lo elegido en la fila «Acabado» cuando la liga tiene varios acabados y ninguno es el de la casilla. */
  chosenFinish: Finish | null;
  setChosenFinish: (f: Finish | null) => void;
  model: CaptureModel;
  data: CardVersionsResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
  /** El `GET …/versions` nuevo que devuelve `attach`: sustituye la respuesta en caché sin volver a pedirla. */
  onAttached: (res: CardVersionsResponse) => void;
  /** §ALTA-LIGA-2: tras crear la versión a mano, vuelve a pedir `GET …/versions` y deja elegida la nueva (sello + acabado). */
  onManualCreated: (res: ManualVersionResponse, finish: Finish) => Promise<void>;
  /** ¿La carta tiene algo que elegir? (español con precio, liga o candidatas). Solo inglés sin liga ⇒ `false`. Es `model.hasVersions` (TL-ALTA-5). */
  hasVersions: boolean;
  /** Campos del alta con lo elegido (cuerpo de hoy si inglés sin liga). */
  payload: IdsCapturePayload;
  /** Vuelve a «Inglés / Sin liga» (tras un alta, o al cambiar de carta). */
  reset: () => void;
}

export function useIdsCapture(
  card: Pick<CardDTO, 'id' | 'availableFinishes'> | null,
  finish: Finish,
  options: {
    enabled: boolean;
    /**
     * Modo casilla (A2, I-6 «Acabado del alta»): el acabado lo fija quien llama (la casilla del binder) y el modelo NO
     * pasa el Acabado a burbujas; por versión, el acabado del alta se RESUELVE (`model.altaFinish`): el de la casilla si la
     * liga lo tiene, el único de la liga si es otro, o el elegido en la fila «Acabado» (`chosenFinish`) si tiene varios.
     */
    fixedFinish?: boolean;
  },
): IdsCapture {
  const { enabled, fixedFinish = false } = options;
  const queryClient = useQueryClient();
  const [language, setLanguage] = useState<CardLanguage>('en');
  const [stampProductId, setStampProductIdState] = useState<number | null>(null);
  const [chosenFinish, setChosenFinish] = useState<Finish | null>(null);

  const active = enabled && !!card;
  const query = useQuery({
    queryKey: ['card-versions', card?.id],
    queryFn: () => getCardVersions(card!),
    enabled: active,
  });
  const data = active ? query.data : undefined;
  const raw = captureModel(
    data,
    fixedFinish ? [finish] : card?.availableFinishes ?? [],
    finish,
    language,
    stampProductId,
    fixedFinish ? { chosenFinish } : undefined,
  );
  const model: CaptureModel = fixedFinish ? { ...raw, finishOptions: null } : raw;

  const payload: IdsCapturePayload = active
    ? {
        ...(language !== 'en' ? { language } : {}),
        ...(model.stampProductId != null ? { cardProductId: model.stampProductId } : {}),
      }
    : {};

  // La fila «Acabado» es de la liga elegida: cambiar de versión la deja sin preselección (no se hereda).
  const setStampProductId = useCallback((id: number | null) => {
    setStampProductIdState(id);
    setChosenFinish(null);
  }, []);
  const reset = useCallback(() => {
    setLanguage('en');
    setStampProductIdState(null);
    setChosenFinish(null);
  }, []);
  const onAttached = useCallback(
    (res: CardVersionsResponse) => {
      if (card) queryClient.setQueryData(['card-versions', card.id], res);
    },
    [card, queryClient],
  );

  const onManualCreated = useCallback(
    async (res: ManualVersionResponse, finish: Finish) => {
      if (!card) return;
      // El GET manda: combos, candidatas y precios de la versión nueva salen de ahí (no se reconstruyen en el cliente).
      await queryClient.refetchQueries({ queryKey: ['card-versions', card.id] });
      setStampProductIdState(res.stamp.productId);
      setChosenFinish(finish);
    },
    [card, queryClient],
  );

  return {
    enabled: active,
    language,
    setLanguage,
    stampProductId,
    setStampProductId,
    chosenFinish,
    setChosenFinish,
    model,
    data,
    isLoading: active && query.isLoading,
    isError: active && query.isError,
    refetch: () => void query.refetch(),
    onAttached,
    onManualCreated,
    hasVersions: model.hasVersions,
    payload,
    reset,
  };
}
