'use client';

import { useEffect, useState } from 'react';

/**
 * Cuenta regresiva al inicio del Card Show (America/Mexico_City, UTC-6). Dato público.
 *
 * SSR-seguro: se pinta una primera vez con el cálculo del servidor y se corrige al hidratar (el
 * reloj del cliente manda). Bajo `prefers-reduced-motion` no hay animación: solo texto que se
 * actualiza cada segundo. Región viva discreta para lectores de pantalla.
 */
function diff(targetMs: number, now: number): { d: number; h: number; m: number; s: number; done: boolean } {
  const delta = Math.max(0, targetMs - now);
  const done = targetMs - now <= 0;
  const total = Math.floor(delta / 1000);
  return {
    d: Math.floor(total / 86400),
    h: Math.floor((total % 86400) / 3600),
    m: Math.floor((total % 3600) / 60),
    s: total % 60,
    done,
  };
}

const UNITS: { key: 'd' | 'h' | 'm' | 's'; label: string }[] = [
  { key: 'd', label: 'días' },
  { key: 'h', label: 'horas' },
  { key: 'm', label: 'min' },
  { key: 's', label: 'seg' },
];

export function Countdown({ targetIso }: { targetIso: string }) {
  const targetMs = new Date(targetIso).getTime();
  // `null` hasta montar: el servidor y la primera pintura del cliente coinciden (sin mismatch de
  // hidratación por `Date.now()`); el reloj arranca en el efecto.
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const t = now === null ? null : diff(targetMs, now);

  // Marcador estable antes de montar (misma salida en SSR e hidratación).
  if (t === null) {
    return (
      <div>
        <p className="eyebrow mb-2">Faltan</p>
        <div className="flex gap-4" aria-hidden="true">
          {UNITS.map((u) => (
            <div key={u.key} className="min-w-[3.5rem]">
              <span className="block font-serif text-h2 tabular leading-none">--</span>
              <span className="eyebrow mt-1 block">{u.label}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (t.done) {
    return (
      <p className="font-mono text-sm text-accent" role="status">
        ¡El Card Show ya comenzó!
      </p>
    );
  }

  const srText = `Faltan ${t.d} días, ${t.h} horas, ${t.m} minutos y ${t.s} segundos para el Card Show.`;

  return (
    <div>
      <p className="eyebrow mb-2">Faltan</p>
      <div className="flex gap-4" aria-hidden="true">
        {UNITS.map((u) => (
          <div key={u.key} className="min-w-[3.5rem]">
            <span className="block font-serif text-h2 tabular leading-none">{String(t[u.key]).padStart(2, '0')}</span>
            <span className="eyebrow mt-1 block">{u.label}</span>
          </div>
        ))}
      </div>
      <p className="sr-only" role="status" aria-live="off">
        {srText}
      </p>
    </div>
  );
}
