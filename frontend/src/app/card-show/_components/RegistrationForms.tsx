'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { LeadVisitorForm } from './LeadVisitorForm';
import { TorneoForm } from './TorneoForm';
import { MerchantSponsorForm } from './MerchantSponsorForm';

/**
 * Los tres caminos de captura del Card Show, en pestañas accesibles (API_CONTRACT §CARDSHOW):
 *  1. «Asistente / Jugador» → `POST /card-show/leads` (`type=visitor`).
 *  2. «Preinscríbete al torneo» → `POST /card-show/players` (Pokémon formal / resto ligera).
 *  3. «Vendedor / Patrocinador» → `POST /card-show/leads` (`type=merchant|sponsor`).
 *
 * El CTA secundario del hero («¿Vendes o patrocinas?») apunta a `#vendedores`: al llegar con ese hash
 * se abre la pestaña comercial. Tablist con roles ARIA, flechas ←/→, foco visible y objetivos ≥44px.
 */
type TabKey = 'asistente' | 'torneo' | 'comercial';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'asistente', label: 'Asistente / Jugador' },
  { key: 'torneo', label: 'Preinscríbete al torneo' },
  { key: 'comercial', label: 'Vendedor / Patrocinador' },
];

export function RegistrationForms() {
  const [active, setActive] = useState<TabKey>('asistente');
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // El hash #vendedores (CTA secundario del hero) abre la pestaña comercial.
  useEffect(() => {
    const sync = () => {
      if (window.location.hash === '#vendedores') setActive('comercial');
    };
    sync();
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  function onKeyDown(e: React.KeyboardEvent, i: number) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const next = e.key === 'ArrowRight' ? (i + 1) % TABS.length : (i - 1 + TABS.length) % TABS.length;
    setActive(TABS[next].key);
    tabRefs.current[next]?.focus();
  }

  return (
    <div>
      <span id="vendedores" aria-hidden className="sr-only" />
      <div role="tablist" aria-label="Formularios de registro" className="flex flex-wrap gap-2">
        {TABS.map((t, i) => {
          const selected = active === t.key;
          return (
            <button
              key={t.key}
              ref={(el) => {
                tabRefs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`cs-tab-${t.key}`}
              aria-selected={selected}
              aria-controls={`cs-panel-${t.key}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(t.key)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={cn(
                'min-h-[44px] border px-4 py-2 font-mono text-[11px] uppercase leading-none tracking-label transition-colors',
                selected ? 'border-text bg-text text-primary-fg' : 'border-border-strong text-text hover:border-text',
              )}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {TABS.map((t) => (
        <div
          key={t.key}
          role="tabpanel"
          id={`cs-panel-${t.key}`}
          aria-labelledby={`cs-tab-${t.key}`}
          hidden={active !== t.key}
          className="mt-8 border-t border-border-strong pt-8"
        >
          {t.key === 'asistente' && (
            <>
              <h3 className="font-brand text-h3 font-bold">Asistente y jugador</h3>
              <p className="mb-6 mt-2 max-w-prose text-sm text-muted">
                Para público general: entra a la rifa y entérate primero de todo.
              </p>
              <LeadVisitorForm />
            </>
          )}
          {t.key === 'torneo' && (
            <>
              <h3 className="font-brand text-h3 font-bold">Preinscríbete al torneo</h3>
              <p className="mb-6 mt-2 max-w-prose text-sm text-muted">
                Elige tu juego y tu día. En Pokémon pedimos tu Player ID; en los demás juegos basta con tu interés.
              </p>
              <TorneoForm />
            </>
          )}
          {t.key === 'comercial' && (
            <>
              <h3 className="font-brand text-h3 font-bold">Vendedor o patrocinador</h3>
              <p className="mb-6 mt-2 max-w-prose text-sm text-muted">
                Déjanos tus datos y te contactamos en privado con las opciones de mesa o patrocinio. Sin precios
                públicos aquí.
              </p>
              <MerchantSponsorForm />
            </>
          )}
        </div>
      ))}
    </div>
  );
}
