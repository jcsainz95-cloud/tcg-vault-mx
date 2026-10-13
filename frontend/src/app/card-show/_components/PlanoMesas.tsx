'use client';

import { useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { CARD_SHOW, mesaLabel, tipoNombre, type MesaEstado } from '@/content/card-show';
import { trackClick } from '@/lib/card-show-clicks';

/**
 * Plano del salón (API_CONTRACT §CARDSHOW.2, RONDA_0 §8). SVG SIN COTAS (⛔ sin medidas en el
 * dibujo; las medidas de mesa se muestran en la tabla SOLO cuando el data file traiga valor).
 *
 * Accesibilidad (§13 del encargo):
 *  - Mesas TABULABLES en orden 1→N (botones reales sobre el SVG decorativo).
 *  - Nombre accesible por mesa («Mesa N, tipo, estado»).
 *  - Enter/Espacio seleccionan; Esc deselecciona.
 *  - Zona táctil ≥ 44×44 (min-w/min-h en el botón).
 *  - Estado «Sin apartar / Apartada» NO por color solo: patrón de trama + etiqueta de texto.
 *  - Tabla equivalente debajo (alternativa no visual completa).
 *  - ⛔ Nunca la palabra «disponible»: el estado es «Sin apartar».
 */
const VB_W = 100;
const VB_H = 64;

function estadoTexto(e: MesaEstado): string {
  return e === 'apartada' ? 'Apartada' : 'Sin apartar';
}

export function PlanoMesas() {
  const mesas = [...CARD_SHOW.mesas.plano].sort((a, b) => a.numero - b.numero);
  const [selected, setSelected] = useState<number | null>(null);
  const liveRef = useRef<HTMLParagraphElement>(null);

  const sel = mesas.find((m) => m.numero === selected) ?? null;

  function activate(numero: number) {
    setSelected(numero);
    trackClick({ destino: 'mesa', mesa: numero });
  }

  return (
    <div className="flex flex-col gap-6">
      <div
        className="relative w-full border border-border-strong bg-surface-2"
        style={{ aspectRatio: `${VB_W} / ${VB_H}` }}
      >
        {/* Dibujo decorativo del salón. aria-hidden: la interacción vive en los botones de abajo. */}
        <svg
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          className="absolute inset-0 h-full w-full"
          preserveAspectRatio="none"
          aria-hidden="true"
          focusable="false"
        >
          <defs>
            {/* Trama diagonal para «Apartada»: distingue el estado sin depender del color. */}
            <pattern id="cs-apartada" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="3" stroke="var(--color-border-strong)" strokeWidth="1" />
            </pattern>
          </defs>
          {mesas.map((m) => (
            <rect
              key={m.numero}
              x={m.x}
              y={m.y}
              width={m.w}
              height={m.h}
              fill={m.estado === 'apartada' ? 'url(#cs-apartada)' : 'var(--color-surface)'}
              stroke={selected === m.numero ? 'var(--color-accent)' : 'var(--color-border-strong)'}
              strokeWidth={selected === m.numero ? 1.2 : 0.6}
            />
          ))}
        </svg>

        {/* Capa interactiva: un botón real por mesa (teclado, foco, zona táctil ≥44px). */}
        {mesas.map((m) => (
          <button
            key={m.numero}
            type="button"
            aria-pressed={selected === m.numero}
            aria-label={mesaLabel(m.numero, tipoNombre(m.tipoId), m.estado)}
            onClick={() => activate(m.numero)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                activate(m.numero);
              } else if (e.key === 'Escape') {
                setSelected(null);
              }
            }}
            className={cn(
              'absolute flex min-h-[44px] min-w-[44px] items-center justify-center font-mono text-xs text-text',
              selected === m.numero && 'ring-2 ring-[color:var(--color-accent)]',
            )}
            style={{
              left: `${m.x}%`,
              top: `${(m.y / VB_H) * 100}%`,
              width: `${m.w}%`,
              height: `${(m.h / VB_H) * 100}%`,
            }}
          >
            <span aria-hidden="true">{m.numero}</span>
          </button>
        ))}
      </div>

      {/* Detalle de la mesa seleccionada (región viva para lectores de pantalla). */}
      <p ref={liveRef} role="status" aria-live="polite" className="min-h-[1.5rem] text-[13px] text-muted">
        {sel ? (
          <>
            <strong className="text-text">Mesa {sel.numero}</strong> · {tipoNombre(sel.tipoId)} ·{' '}
            {estadoTexto(sel.estado)}
          </>
        ) : (
          'Elige una mesa del plano para ver su detalle.'
        )}
      </p>

      {/* Tabla equivalente (alternativa accesible completa). Medidas solo si el data file las trae. */}
      <table className="w-full border-collapse text-left text-[13px]">
        <caption className="sr-only">Mesas del Card Show: número, tipo, precio, medida y estado.</caption>
        <thead>
          <tr className="border-b border-border-strong">
            <th scope="col" className="eyebrow py-2 pr-4">Mesa</th>
            <th scope="col" className="eyebrow py-2 pr-4">Tipo</th>
            <th scope="col" className="eyebrow py-2 pr-4">Precio</th>
            <th scope="col" className="eyebrow py-2 pr-4">Medida</th>
            <th scope="col" className="eyebrow py-2">Estado</th>
          </tr>
        </thead>
        <tbody>
          {mesas.map((m) => {
            const tipo = CARD_SHOW.mesas.tipos.find((t) => t.id === m.tipoId);
            return (
              <tr key={m.numero} className="border-b border-border">
                <td className="py-3 pr-4 font-mono tabular">{m.numero}</td>
                <td className="py-3 pr-4">{tipo?.nombre ?? 'Mesa'}</td>
                <td className="py-3 pr-4 font-mono tabular">{tipo?.precio ?? '—'}</td>
                {/* Medida: campo del data file; se muestra solo cuando haya valor (decisión JC). */}
                <td className="py-3 pr-4 font-mono tabular">{tipo?.medida ?? '—'}</td>
                <td className="py-3">{estadoTexto(m.estado)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
