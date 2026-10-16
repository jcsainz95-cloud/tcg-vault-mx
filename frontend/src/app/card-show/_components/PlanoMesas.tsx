'use client';

import { cn } from '@/lib/cn';
import {
  CARD_SHOW,
  disponibilidadTexto,
  mesaLabel,
  mesasResueltas,
  waApartarMesaUrl,
  type MesaResuelta,
} from '@/content/card-show';
import { trackClick } from '@/lib/card-show-clicks';

/**
 * Plano de mesas del Card Show (API_CONTRACT §CARDSHOW.2, RONDA_0 §8). Modelo NUMERADO (v2, decisión
 * JC): 23 mesas con tipo→precio y disponibilidad. ⛔ SIN medidas.
 *
 *  - Mesa DISPONIBLE ⇒ enlace real a WhatsApp con el número prellenado (#1). Cuenta el clic.
 *  - Mesa APARTADA ⇒ no es clicable; se muestra «Apartada» (texto, no solo color).
 *
 * Accesibilidad (§13): cada mesa disponible es un enlace tabulable con nombre accesible
 * («Mesa N, Tipo, Precio, Disponible»); las apartadas se anuncian por su texto. Zona táctil ≥44px.
 * Tabla equivalente debajo (alternativa no visual completa) con la misma info y los mismos enlaces.
 */
function MesaCell({ m }: { m: MesaResuelta }) {
  const base =
    'flex min-h-[72px] min-w-[44px] flex-col items-center justify-center gap-0.5 border px-2 py-2 text-center';
  if (m.disponibilidad === 'apartada') {
    return (
      <div
        className={cn(base, 'border-border bg-surface-2 text-muted')}
        // Trama diagonal para distinguir «Apartada» sin depender del color.
        style={{
          backgroundImage:
            'repeating-linear-gradient(45deg, transparent, transparent 4px, var(--color-border) 4px, var(--color-border) 5px)',
        }}
      >
        <span className="font-mono text-sm tabular text-text">{m.numero}</span>
        <span className="text-[11px] uppercase tracking-label">Apartada</span>
      </div>
    );
  }
  return (
    <a
      href={waApartarMesaUrl(m.numero)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={mesaLabel(m.numero, m.tipo.nombre, m.tipo.precio, m.disponibilidad)}
      onClick={() => trackClick({ destino: 'mesa', mesa: m.numero })}
      className={cn(
        base,
        'border-border-strong bg-surface text-text transition-colors hover:border-accent hover:bg-surface-2',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--color-accent)]',
      )}
    >
      <span className="font-mono text-sm tabular">{m.numero}</span>
      <span className="text-[10px] uppercase tracking-label text-muted">{m.tipo.nombre}</span>
      <span className="font-mono text-[11px] tabular">{m.tipo.precio}</span>
    </a>
  );
}

export function PlanoMesas() {
  const mesas = mesasResueltas();

  return (
    <div className="flex flex-col gap-8">
      {/* Leyenda de tipos/precios. */}
      <ul className="flex flex-wrap gap-x-8 gap-y-2 font-mono text-sm">
        {CARD_SHOW.mesas.tipos.map((t) => (
          <li key={t.id}>
            <span className="eyebrow">{t.nombre}</span> <span className="tabular">{t.precio}</span>
          </li>
        ))}
      </ul>

      {/* Plano: cuadrícula de mesas numeradas. Disponible ⇒ enlace a WhatsApp; apartada ⇒ no clicable. */}
      <div>
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-6" aria-label="Plano de mesas del Card Show">
          {mesas.map((m) => (
            <li key={m.numero}>
              <MesaCell m={m} />
            </li>
          ))}
        </ul>
        <p className="mt-4 text-[13px] text-muted">
          Toca una mesa <strong className="text-text">disponible</strong> para apartarla por WhatsApp. Al fondo, en la
          esquina lado Av. Revolución, está la zona de activación.
        </p>
      </div>

      {/* Tabla equivalente (alternativa accesible completa). ⛔ SIN columna de medida (decisión JC v2). */}
      <table className="w-full border-collapse text-left text-[13px]">
        <caption className="sr-only">Mesas del Card Show: número, tipo, precio y disponibilidad.</caption>
        <thead>
          <tr className="border-b border-border-strong">
            <th scope="col" className="eyebrow py-2 pr-4">Mesa</th>
            <th scope="col" className="eyebrow py-2 pr-4">Tipo</th>
            <th scope="col" className="eyebrow py-2 pr-4">Precio</th>
            <th scope="col" className="eyebrow py-2">Estado</th>
          </tr>
        </thead>
        <tbody>
          {mesas.map((m) => (
            <tr key={m.numero} className="border-b border-border">
              <td className="py-3 pr-4 font-mono tabular">{m.numero}</td>
              <td className="py-3 pr-4">{m.tipo.nombre}</td>
              <td className="py-3 pr-4 font-mono tabular">{m.tipo.precio}</td>
              <td className="py-3">
                {m.disponibilidad === 'apartada' ? (
                  <span className="text-muted">Apartada</span>
                ) : (
                  <a
                    href={waApartarMesaUrl(m.numero)}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => trackClick({ destino: 'mesa', mesa: m.numero })}
                    className="text-accent underline underline-offset-4"
                  >
                    {disponibilidadTexto(m.disponibilidad)} · apartar
                  </a>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
