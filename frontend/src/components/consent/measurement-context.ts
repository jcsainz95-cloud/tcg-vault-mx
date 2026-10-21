'use client';

import { createContext, useContext } from 'react';
import type { ConsentChoice } from '@/lib/measurement/consent';

/**
 * Contexto de la Fase 2, aparte del proveedor para que quien solo LEE (el enlace del pie, el hueco del
 * aviso) no arrastre el diálogo ni la navegación de next-intl a su grafo de módulos.
 */
export type PreferencesOrigin = 'banner' | 'link';

export interface MeasurementContextValue {
  active: boolean;
  consent: ConsentChoice | null;
  bannerVisible: boolean;
  accept: () => void;
  necessaryOnly: () => void;
  openPreferences: (origin: PreferencesOrigin, trigger: HTMLElement | null) => void;
}

export const INACTIVE: MeasurementContextValue = {
  active: false,
  consent: null,
  bannerVisible: false,
  accept: () => undefined,
  necessaryOnly: () => undefined,
  openPreferences: () => undefined,
};

export const MeasurementContext = createContext<MeasurementContextValue>(INACTIVE);

export function useMeasurement(): MeasurementContextValue {
  return useContext(MeasurementContext);
}
