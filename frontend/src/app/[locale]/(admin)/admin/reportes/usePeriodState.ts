'use client';

import { useCallback, useState } from 'react';
import { periodSearch, type ReportPeriod } from '@/lib/reports/period';

/** Periodo de la pantalla + su reflejo en la URL (recargar o compartir deja el mismo periodo). */
export function usePeriodState(initial: ReportPeriod) {
  const [period, setPeriod] = useState<ReportPeriod>(initial);
  const change = useCallback((p: ReportPeriod) => {
    setPeriod(p);
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    url.search = p.preset === 'custom' ? periodSearch(p) : `?preset=${p.preset}`;
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  }, []);
  return [period, change] as const;
}
