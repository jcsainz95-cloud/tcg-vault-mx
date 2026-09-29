'use client';

import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { getPendingPublish } from '@/lib/api';
import type { AppLocale } from '@/i18n/routing';
import { formatDate, formatMoneyCents } from '@/lib/format';
import type { PendingPublishRowDTO, ProductType } from '@/types/contract';
import { EmptyState } from '@/components/ui/EmptyState';
import { QueryState } from '@/components/ui/QueryState';
import { Link } from '@/i18n/navigation';

/**
 * **QUÉ LE FALTA a esta pieza para estar a la venta.**
 *
 * ⚠️ **Una fila sin `missing` legible NO se pinta como «ya está lista».** `missing` es lo único que
 * dice por qué la pieza sigue aquí; si llega vacío o ausente —backend anterior, proyección
 * degradada— **la respuesta segura es «por revisar», nunca «nada le falta»**: si la pintáramos como
 * lista, la pieza **saldría de la única pantalla donde alguien la encontraría**. Es la misma
 * doctrina del conteo ausente de la mesa: *un «no sé» que se ve como un valor bueno es peor que no
 * mostrar nada.*
 */
function MissingCell({ row }: { row: PendingPublishRowDTO }) {
  const t = useTranslations('admin.m1.publishQueue');
  const missing = row.missing ?? [];
  if (missing.length === 0) {
    return (
      <span
        data-testid="publish-missing-unknown"
        className="font-mono text-[10px] uppercase tracking-[0.06em] text-accent"
      >
        {t('missingUnknown')}
      </span>
    );
  }
  return (
    <span className="flex flex-wrap gap-2">
      {missing.map((what) => (
        <span
          key={what}
          className="font-mono text-[10px] uppercase tracking-[0.06em] text-accent"
        >
          {what === 'location' ? t('missingLocation') : t('missingPrice')}
        </span>
      ))}
    </span>
  );
}

/**
 * **QUÉ PIEZA es esta fila.** ⚠️ **El sellado pinta la CAJA, no el single ancla** (P-79c, contrato §M1).
 *
 * El defecto reportado era pintar `card.name` / `card.number` del **ancla** —que el propio diseño declaró
 * que «deja de ser identidad» (`resolveAnchorCardId`, ARCHITECTURE §4.34a)— para una pieza
 * `productType='sealed'`. `productType` es el discriminante (ya viaja en el DTO desde v1.51). Por eso:
 *   - `sealed` **con** `sealedProductName` ⇒ nombre del sellado + marca «SELLADO»; ⛔ NUNCA número ni acabado.
 *   - `sealed` **sin** nombre (legado) ⇒ «Sellado sin identificar» en tinta de atención; ⛔ **JAMÁS `card.name`**
 *     —caer al ancla es *exactamente* el defecto—. Misma doctrina que `MissingCell` y que `total` ausente:
 *     *ante un «no sé» no se pinta un valor que parezca bueno.*
 *   - `raw` / `graded` ⇒ single: `card.name` + `setName · number · finish` (sin cambios).
 *
 * El `folio` (columna 1) identifica la fila de forma única en los tres casos, así que el sellado legado
 * **sigue siendo accionable**: el operador va al folio, no al nombre.
 */
function PieceCell({ row }: { row: PendingPublishRowDTO }) {
  const t = useTranslations('admin.m1.publishQueue');
  const tSub = useTranslations('status.sealedSubtype');
  if (row.productType === 'sealed') {
    return (
      <span className="flex flex-col">
        {row.sealedProductName ? (
          <span lang="en">{row.sealedProductName}</span>
        ) : (
          <span className="text-accent">{t('sealedUnidentified')}</span>
        )}
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted">
          {row.card.setName} · <span className="text-accent">{t('sealedMark')}</span>
          {/* §diseño §2.C/CA-5 · el SUBTIPO (Bundle/Booster Box/…) se pinta cuando el server lo
              proyecta; ausente (backend anterior) ⇒ no se pinta nada (aditivo, retrocompatible). */}
          {row.sealedSubtype ? ` · ${tSub(row.sealedSubtype).toUpperCase()}` : ''}
        </span>
      </span>
    );
  }
  return (
    <span className="flex flex-col">
      <span lang="en">{row.card.name}</span>
      <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted">
        {row.card.setName} · {row.card.number} · {row.finish}
      </span>
    </span>
  );
}

/**
 * **COLA «LISTAS PARA PUBLICAR»** (contrato §M1 · `GET /admin/inventory/pending-publish`, fase 8).
 *
 * > *Comprar bien y dejar la carta en una caja sin precio es comprar mal.*
 *
 * **Es la RED del disparo de auto-publicación.** La publicación se intenta best-effort en los tres
 * momentos en que puede dejar de faltar algo, y eso **solo es aceptable porque un disparo perdido
 * deja la pieza EN ESTA COLA**, no invisible. Por eso la cola no se estrecha ni se «optimiza».
 *
 * ⚠️ **Alcance: SOLO VISIBILIDAD (D10).** No captura precios de venta, no los sugiere y **no los
 * hereda del costo de compra**. La pieza **sale sola** en cuanto no le falta nada —**sin botón**—,
 * *sin depender de que alguien se acuerde de apretarlo.*
 */
/**
 * `productType` (opcional, §diseño §iii) — filtra la cola a un tipo de producto reusando el
 * `?productType=` que el endpoint ya acepta (contrato §M1). M1 la monta SIN filtro (cola entera);
 * M11 la monta con `productType="sealed"`. El `queryKey` incluye el filtro para no colisionar el
 * caché entre la vista completa y la filtrada.
 */
export function PendingPublishQueue({ productType }: { productType?: ProductType } = {}) {
  const t = useTranslations('admin.m1.publishQueue');
  const locale = useLocale() as AppLocale;
  const query = useQuery({
    queryKey: ['pending-publish', productType ?? 'all'],
    queryFn: () => getPendingPublish({ productType }),
  });

  /**
   * **EL TAMAÑO DEL TRABAJO PENDIENTE** (deuda D5 del techlead).
   *
   * `total` es el conteo del SERVIDOR sobre la cola entera, no `data.length` — y la distinción es
   * la única razón por la que este número vale algo. La respuesta viene paginada (`pageSize` 20),
   * así que `data.length` responde *«cuántas caben en esta página»*, que no es una pregunta que
   * nadie tenga. **`total` se paga caro**: obtenerlo obliga a barrer el inventario y evaluar la
   * precedencia de precio fila por fila (`BLC-D1`), y hasta ahora **el único consumidor lo tiraba**
   * — se cobraba el barrido y no se pintaba el resultado.
   *
   * ⚠️ **`total` ausente no se degrada a `data.length`.** Un número inventado del tamaño de la
   * página se ve *igual de confiable* que el bueno y **miente hacia abajo** justo cuando la cola es
   * grande — que es cuando el número importa. Es la misma doctrina que `MissingCell` y que el
   * conteo ausente de la mesa (§23.7): *ante «no sé», no se pinta un valor que parezca bueno.*
   * Sin `total` no se pinta contador; las filas se listan igual.
   */
  const total = query.data?.total;

  return (
    <section className="border-t border-border py-6" data-testid="pending-publish-queue">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-serif text-lg text-text">{t('title')}</h2>
        {typeof total === 'number' && (
          <span
            data-testid="publish-queue-total"
            className="tabular font-mono text-[11px] uppercase tracking-[0.06em] text-muted"
          >
            {t('count', { count: total })}
          </span>
        )}
      </div>
      <p className="mt-1 max-w-[70ch] text-sm leading-[1.6] text-muted">{t('subtitle')}</p>

      <QueryState
        isLoading={query.isLoading}
        isError={query.isError}
        error={query.error}
        onRetry={() => query.refetch()}
      >
        {query.data?.data.length === 0 ? (
          <EmptyState title={t('empty')} />
        ) : (
          <table className="mt-4 w-full border-collapse">
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="eyebrow px-3 py-2 text-left font-normal">
                  {t('folio')}
                </th>
                <th scope="col" className="eyebrow px-3 py-2 text-left font-normal">
                  {t('piece')}
                </th>
                <th scope="col" className="eyebrow px-3 py-2 text-left font-normal">
                  {t('missing')}
                </th>
                <th scope="col" className="eyebrow px-3 py-2 text-left font-normal">
                  {t('salePrice')}
                </th>
                <th scope="col" className="eyebrow px-3 py-2 text-left font-normal">
                  {t('origin')}
                </th>
              </tr>
            </thead>
            <tbody>
              {query.data?.data.map((row) => (
                <tr key={row.inventoryItemId} className="border-b border-border last:border-b-0">
                  <td className="tabular px-3 py-3 align-top font-mono text-[13px] text-text">
                    {row.folio}
                  </td>
                  <td className="px-3 py-3 align-top text-sm text-text">
                    <PieceCell row={row} />
                  </td>
                  <td className="px-3 py-3 align-top">
                    <MissingCell row={row} />
                  </td>
                  <td className="px-3 py-3 align-top text-sm">
                    {row.resolvedSalePriceCents != null ? (
                      <span className="tabular font-mono text-text">
                        {formatMoneyCents(row.resolvedSalePriceCents, locale)}
                      </span>
                    ) : (
                      /* ⛔ Nunca MX$0.00 para «no resoluble»: cero es un precio (§7.3). */
                      <span className="flex flex-col gap-1">
                        <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-accent">
                          {t('noSalePrice')}
                        </span>
                        {row.pendingPriceEntryId && (
                          <Link
                            href={{ pathname: '/admin/m2', query: { pendingPrice: row.pendingPriceEntryId } }}
                            className="text-[11px] text-accent underline-offset-2 hover:text-text hover:underline"
                          >
                            {t('pendingPriceLink')}
                          </Link>
                        )}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3 align-top text-sm text-muted">
                    <span className="flex flex-col">
                      <span>{row.acquisitionType === 'buylist' ? t('originBuylist') : row.acquisitionType}</span>
                      <span className="tabular font-mono text-[11px]">
                        {formatDate(row.createdAt, locale)}
                      </span>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </QueryState>

      <p className="mt-4 max-w-[70ch] text-xs leading-[1.6] text-muted">{t('note')}</p>
    </section>
  );
}
