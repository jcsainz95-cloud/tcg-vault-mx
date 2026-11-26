'use client';

import { useTranslations } from 'next-intl';
import type { Finish } from '@/types/contract';

/** Etiqueta traducida del acabado (`finish.<clave>`: Normal, Reverse Holo, Holofoil…). ⛔ Nunca la clave cruda (`reverse_holo`). */
export function useFinishLabel(): (f: string | null | undefined) => string | null {
  const t = useTranslations('finish');
  return (f) => (f ? (t.has(f as Finish) ? t(f as Finish) : null) : null);
}
