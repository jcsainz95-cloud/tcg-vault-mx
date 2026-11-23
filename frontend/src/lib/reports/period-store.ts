import { useSyncExternalStore } from 'react';
import { periodSearch, type ReportPeriod } from './period';

/**
 * Periodo vigente de Reportes, en memoria: lo escribe cada pantalla de Reportes/Finanzas al abrirse o cambiar y lo lee el
 * menú para que el periodo viaje al navegar (§REPORTES-CEO §2). Solo cliente; sin persistencia (la URL manda al recargar).
 */
let current: ReportPeriod | null = null;
const listeners = new Set<() => void>();

export function setCurrentPeriod(p: ReportPeriod): void {
  if (current && current.preset === p.preset && current.from === p.from && current.to === p.to) return;
  current = p;
  listeners.forEach((l) => l());
}
export function resetCurrentPeriodForTests(): void {
  current = null;
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

/** `?preset=…` del periodo vigente, o '' si aún no se eligió ninguno. */
export function useReportPeriodSearch(): string {
  const p = useSyncExternalStore(subscribe, () => current, () => null);
  return p ? periodSearch(p) : '';
}
