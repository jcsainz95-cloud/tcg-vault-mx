'use client';

import { useEffect, useState } from 'react';
import { getTournamentCount, type TournamentCount, type TournamentCountDay } from '@/lib/card-show-api';

/**
 * Contador en vivo del torneo Pokémon por día (API_CONTRACT §CARDSHOW.12-bis, M-90).
 *
 * SSR-seguro: el servidor y la primera pintura no traen nada (`null`); se pide al montar y se refresca
 * cada `REFRESH_MS` (≥ 30 s: el backend cachea 30 s). Ante cualquier no-200 / forma rara se OCULTA
 * (no se pinta un número inventado) y la landing sigue funcionando.
 */
export const REFRESH_MS = 60_000;

const DAY_LABEL: Record<TournamentCountDay['day'], string> = { sat: 'Sábado', sun: 'Domingo' };

/** Texto de un día según el contrato: «N/cap», «N preinscritos» (cap null) o «Cupo lleno — lista de espera». */
export function formatCountDay(d: TournamentCountDay): string {
  const label = DAY_LABEL[d.day];
  if (d.cap === null) return `${label} ${d.confirmed} preinscritos`;
  if (d.full) return `${label}: Cupo lleno — lista de espera`;
  return `${label} ${d.confirmed}/${d.cap}`;
}

export function TournamentCounter() {
  const [data, setData] = useState<TournamentCount | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => {
      void getTournamentCount().then((r) => {
        if (alive) setData(r);
      });
    };
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  if (!data) return null;
  const days = (['sat', 'sun'] as const)
    .map((k) => data.days.find((d) => d.day === k))
    .filter((d): d is TournamentCountDay => Boolean(d));
  if (days.length === 0) return null;

  return (
    <p
      className="mt-3 font-mono text-xs uppercase tracking-label text-on-ink"
      aria-live="polite"
      data-testid="tournament-counter"
    >
      <span className="text-on-ink-nav">Preinscritos · </span>
      {days.map(formatCountDay).join(' · ')}
    </p>
  );
}
