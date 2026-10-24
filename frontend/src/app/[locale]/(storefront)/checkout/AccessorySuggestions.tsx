'use client';

import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Check } from 'lucide-react';
import type { AppLocale } from '@/i18n/routing';
import { getAccessorySuggestions } from '@/lib/api';
import { formatMoneyCents } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { AccessoryPhoto } from '@/components/domain/accessories/AccessoryPhoto';

/**
 * «¿Te falta algo?» (`API_CONTRACT §AC.3`, `DESIGN_SYSTEM §AC-UX.6`, AC-UX-5). ⛔ No es modal ni hoja; vive en la
 * columna de renglones, nunca en el resumen. Sin sugerencias, cargando o con error: nada (⛔ nunca recuadro vacío).
 * «Agregar» suma 1; la fila se queda con «En el carrito» para que la lista no salte bajo el dedo. «No, gracias»
 * oculta el recuadro en ESTA visita (estado del componente).
 */
/** CHK-MOVIL.2.5: tope de tarjetas de sugerencia. */
export const MAX_SUGGESTIONS = 3;

export function AccessorySuggestions({ exclude, onAdd }: { exclude: string[]; onAdd: (id: string) => void }) {
  const t = useTranslations('checkout.suggestions');
  const locale = useLocale() as AppLocale;
  const [hidden, setHidden] = useState(false);
  const [addedHere, setAddedHere] = useState<string[]>([]);
  const sectionRef = useRef<HTMLElement>(null);
  // Lo agregado AQUÍ no entra en `exclude` durante la visita: así la lista no se recarga ni salta.
  const ex = exclude.filter((id) => !addedHere.includes(id));
  const query = useQuery({
    queryKey: ['accessory-suggestions', [...ex].sort()],
    queryFn: () => getAccessorySuggestions(ex),
    staleTime: 60_000,
  });
  // CHK-MOVIL.2.5: máximo 3 tarjetas, una columna.
  const items = (query.data?.items ?? []).slice(0, MAX_SUGGESTIONS);
  if (hidden || items.length === 0) return null;

  return (
    <section ref={sectionRef} aria-labelledby="accessory-suggestions-title" className="mt-8 border-t border-border-strong bg-surface-2 p-5">
      <h2 id="accessory-suggestions-title" className="font-serif text-h3 text-text">
        {t('title')}
      </h2>
      <p className="mt-1 text-sm text-muted">{t('subtitle')}</p>
      <ul className="mt-4">
        {items.map((it) => {
          const added = addedHere.includes(it.id);
          return (
            // CHK-MOVIL.1 (causa medida de los 439 px a 390, mocks): foto + nombre + precio + «Agregar» en UNA fila
            // fijaban un mínimo de 359 px que ensanchaba la pista implícita de la rejilla raíz. Nombre y precio van
            // apilados en un hijo `min-w-0`: a 320 px la fila cabe sin recortar el importe.
            <li key={it.id} className="flex min-w-0 items-center gap-3 border-t border-border py-3 sm:gap-4">
              <AccessoryPhoto src={it.photo.thumbUrl} alt="" fallbackText={it.name} className="h-14 w-14 shrink-0 sm:h-16 sm:w-16" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-[15px] text-text [overflow-wrap:anywhere]">{it.name}</span>
                <span className="tabular text-[15px] font-medium text-text">{formatMoneyCents(it.priceCents, locale)}</span>
              </span>
              <Button
                variant="secondary"
                size="sm"
                disabled={added}
                aria-label={added ? undefined : t('addAria', { name: it.name })}
                onClick={() => {
                  onAdd(it.id);
                  setAddedHere((a) => [...a, it.id]);
                }}
              >
                {added && <Check size={14} aria-hidden />}
                {added ? t('inCart') : t('add')}
              </Button>
            </li>
          );
        })}
      </ul>
      <Button
        variant="ghost"
        className="mt-3"
        onClick={() => {
          // El foco va al primer control siguiente en el orden de tabulación (§AC-UX.6).
          const all = Array.from(document.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input, select, textarea'));
          const next = all.find((el) => sectionRef.current && !sectionRef.current.contains(el) && sectionRef.current.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
          setHidden(true);
          next?.focus();
        }}
      >
        {t('dismiss')}
      </Button>
    </section>
  );
}
