'use client';

import { useCallback, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getCardVersions } from '@/lib/api';
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
  model: CaptureModel;
  data: CardVersionsResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
  /** El `GET …/versions` nuevo que devuelve `attach`: sustituye la respuesta en caché sin volver a pedirla. */
  onAttached: (res: CardVersionsResponse) => void;
  /** ¿La carta tiene algo que elegir? (español con precio, liga o candidatas). Solo inglés sin liga ⇒ `false`. */
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
     * El acabado lo fija quien llama (la casilla del binder): el modelo NO pasa el Acabado a burbujas aunque la liga
     * traiga otros acabados; la versión que no existe con ese acabado queda apagada (`combo_missing`).
     */
    fixedFinish?: boolean;
  },
): IdsCapture {
  const { enabled, fixedFinish = false } = options;
  const queryClient = useQueryClient();
  const [language, setLanguage] = useState<CardLanguage>('en');
  const [stampProductId, setStampProductId] = useState<number | null>(null);

  const active = enabled && !!card;
  const query = useQuery({
    queryKey: ['card-versions', card?.id],
    queryFn: () => getCardVersions(card!),
    enabled: active,
  });
  const data = active ? query.data : undefined;
  const raw = captureModel(data, fixedFinish ? [finish] : card?.availableFinishes ?? [], finish, language, stampProductId);
  const model: CaptureModel = fixedFinish ? { ...raw, finishOptions: null } : raw;

  // `combos` SIEMPRE trae (acabados × {en, es}) (§IDS.4): el español cuenta solo si se puede crear (con precio); una
  // carta con solo inglés creable y sin liga ni candidatas no tiene nada que elegir ⇒ el panel de siempre.
  const hasVersions =
    !!data &&
    (data.candidates.length > 0 ||
      data.combos.some((c) => c.stamp != null || (c.language !== 'en' && c.unavailableReason == null && c.previewPriceCents != null)));

  const payload: IdsCapturePayload = active
    ? {
        ...(language !== 'en' ? { language } : {}),
        ...(model.stampProductId != null ? { cardProductId: model.stampProductId } : {}),
      }
    : {};

  const reset = useCallback(() => {
    setLanguage('en');
    setStampProductId(null);
  }, []);
  const onAttached = useCallback(
    (res: CardVersionsResponse) => {
      if (card) queryClient.setQueryData(['card-versions', card.id], res);
    },
    [card, queryClient],
  );

  return {
    enabled: active,
    language,
    setLanguage,
    stampProductId,
    setStampProductId,
    model,
    data,
    isLoading: active && query.isLoading,
    isError: active && query.isError,
    refetch: () => void query.refetch(),
    onAttached,
    hasVersions,
    payload,
    reset,
  };
}
