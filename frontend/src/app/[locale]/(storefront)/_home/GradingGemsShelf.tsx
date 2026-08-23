'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { getCatalog } from '@/lib/api';
import type { GroupedListingDTO } from '@/types/contract';
import { useCart } from '@/lib/cart';
import { cn } from '@/lib/cn';
import { Shelf } from '../_shared/Shelf';
import { CatalogTile } from '../catalog/CatalogTile';

/** Cap de la vitrina (§N.3(3)); es también el `pageSize` que se le pide al servidor. */
const GEMS_PAGE_SIZE = 8;

/** `id` de la sección: destino del enlace de regreso de la nota al pie del home (§21.4a). */
export const GRADING_GEMS_ID = 'joyas-para-gradear';

/**
 * Fuente de la vitrina «Joyas para gradear» (§21.6). La comparten la vitrina y la página del home
 * —que decide si hospeda la nota al pie— para que ambas se rijan por el MISMO dato (R3.3); TanStack
 * dedupe por `queryKey`, así que es una sola petición.
 *
 * No es un endpoint nuevo: es `GET /catalog/cards` filtrado (contrato v1.44), así que la vitrina usa
 * el MISMO `GroupedListingDTO` y la MISMA teja que Compra — cero drift entre superficies. El
 * servidor entrega la lista **ya curada y ordenada**; el cliente no ve ni un número del cálculo.
 */
export function useGradingGems() {
  return useQuery({
    queryKey: ['catalog', { home: true, gradingHighlight: true }],
    queryFn: () =>
      getCatalog({ gradingHighlight: true, sort: 'grading_showcase', pageSize: GEMS_PAGE_SIZE }),
    staleTime: 60_000,
    retry: false,
  });
}

/** Los grupos que la vitrina pinta (cap 8). `[]` ⇒ la vitrina completa NO existe. */
export function gemsOf(data: { data: GroupedListingDTO[] } | undefined): GroupedListingDTO[] {
  return (data?.data ?? []).slice(0, GEMS_PAGE_SIZE);
}

/**
 * `GradingGemsShelf` — vitrina del home (§21.6). Patrón `Shelf` tal cual, con las tejas de Compra.
 *
 *  - El **kicker se gasta en la salvedad** («ILUSTRATIVO · NO EVALUAMOS LA PIEZA»): la advertencia
 *    viaja en el encabezado, a la misma altura que el título comercial.
 *  - El **subtítulo no nombra el criterio de selección** (nada de «margen», «ROI» ni «vale la pena»):
 *    sería contar el cálculo con palabras (R5).
 *  - **Sin numeración mono roja**: implicaría un *ranking de oportunidades*, justo la afirmación que
 *    §N prohíbe (y sería un segundo rojo).
 *  - **Sin «Ver todas»** mientras el contrato no exponga una vista de Compra filtrada por elegibles
 *    (§21.6 / §21.12 nº6): no se enlaza a una vista que no filtra lo que promete.
 *  - **Excepción ratificada a §8.1: esta vitrina NO pinta skeleton.** Aparece ya resuelta o no
 *    aparece; un skeleton reservaría espacio para una promesa comercial que puede no existir.
 *  - Vacío o error ⇒ la sección no se renderiza (ni encabezado, ni kicker, ni regla superior).
 */
export function GradingGemsShelf() {
  const t = useTranslations('home.gradingGems');
  const cart = useCart();
  const gems = useGradingGems();

  const listings = gemsOf(gems.data);
  // Carga, error o cero elegibles ⇒ NADA (§21.6). No hay estado intermedio visible.
  if (listings.length === 0) return null;

  return (
    <Shelf
      title={t('title')}
      kicker={t('kicker')}
      subtitle={t('lead')}
      subtitleClassName="mt-3 max-w-[540px]"
      className="scroll-mt-[calc(var(--app-header-h,0px)+16px)] border-t border-border"
      headerClassName="pt-10 lg:pt-11"
    >
      <div
        id={GRADING_GEMS_ID}
        className="gutter mt-6 grid grid-cols-2 gap-x-4 gap-y-8 pb-12 sm:grid-cols-3 lg:mt-7 lg:grid-cols-4 lg:gap-x-7 lg:pb-14"
      >
        {listings.map((l, i) => (
          // Móvil: 4 tejas visibles (§21.8). `contents` deja que la teja siga siendo el ítem de la
          // retícula, así que su altura y su `mt-auto` se comportan igual que en Compra.
          <div key={l.representativeInventoryItemId} className={cn(i >= 4 ? 'hidden sm:contents' : 'contents')}>
            <CatalogTile
              listing={l}
              inCart={cart.ids.includes(l.representativeInventoryItemId)}
              onAdd={(g) => cart.add(g.representativeInventoryItemId)}
            />
          </div>
        ))}
      </div>
    </Shelf>
  );
}
