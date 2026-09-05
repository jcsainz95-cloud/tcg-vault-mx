'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { deleteGradedEstimate, getGradedEstimateReview } from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import {
  GRADED_REVIEW_DEFAULT_REASONS,
  type GradedEstimateReviewItemDTO,
  type GradedEstimateReviewReason,
} from '@/types/contract';
import type { AppLocale } from '@/i18n/routing';
import { formatMoneyCents, formatDate } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { Banner } from '@/components/ui/Banner';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { QueryState, useErrorMessage } from '@/components/ui/QueryState';

const PAGE_SIZE = 25;

/**
 * Los grados que esta lista sabe leer, y **de qué campo** sale la cifra de cada uno. Es la única
 * forma de saber qué se puede retirar de una fila: el `DELETE` es por `(cardId, gradeValue)` y el
 * DTO trae los montos en campos fijos, no en una colección por grado. Un grado **sin cifra** no
 * ofrece botón — su borrado daría `404` y ofrecerlo sería ofrecer un gesto vacío.
 */
const GRADE_FIELDS: { gradeValue: string; amount: (r: GradedEstimateReviewItemDTO) => number | null }[] =
  [
    { gradeValue: '10', amount: (r) => r.psa10MxnCents },
    { gradeValue: '9', amount: (r) => r.psa9MxnCents },
  ];

interface PendingDelete {
  cardId: string;
  cardName: string;
  gradeValue: string;
  amountCents: number | null;
  capturedDate: string | null;
  isManual: boolean;
}

/** Desenlace de un borrado ya cerrado; `gone` = `404`, que **no es un fallo**. */
type DeleteOutcome =
  | { kind: 'deleted'; cardName: string; gradeValue: string; deletedCount: number }
  | { kind: 'gone'; cardName: string; gradeValue: string };

/**
 * Sección 5e — **LISTA DE REVISIÓN del gancho** (contrato v1.50.3 `GET
 * /admin/pricing/graded-estimates/review` + `DELETE /admin/pricing/graded-estimates/:cardId/:gradeValue`,
 * **criterio 111(e)**).
 *
 * **Por qué existe, y por qué el copy lo dice en voz alta.** Aceptamos **no ocultar** en la ficha
 * una cifra que el sistema considera incoherente —la ficha *informa* lo que hay— **a cambio** de que
 * alguien pudiera revisarla. Esta lista **es** esa contrapartida: sin ella publicaríamos el número
 * malo **y** perderíamos la señal, que es estrictamente peor que ocultarlo.
 *
 * **No duplica el pre-vuelo de la captura.** `preview` exige `cardId` y responde «¿por qué **esta**
 * carta no está destacada?»: solo sirve si **ya sospechabas**. Esto responde **«¿de qué cartas debo
 * sospechar?»**, que es la pregunta que nadie podía hacer.
 *
 * **v1.50.3-c/-d — se cierra el bucle: encontrarla Y poder retirarla.** Una lista que solo *señala*
 * es un museo. Faltaban las dos mitades:
 *  - **`?reason=STALE` (opt-in)** enumera lo **caducado**: una cifra que existió y expiró
 *    desaparece de las tres superficies **en silencio** y sigue en la tabla. `isManual` se pinta
 *    porque los dos remedios son **opuestos** (manual rancia ⇒ recapturar o retirar; automática
 *    rancia ⇒ mirar el ingest, **no** la carta).
 *  - **«Retirar»** (`DELETE`) es el gesto que `PROJECT.md` §O.7 pide —«corregirla con override **o
 *    descartarla**»— y que no existía: el back-office solo podía **pisar** la cifra, y pisar deja
 *    otra afirmación comercial en su lugar. Sin este botón, el operador encontraría la cifra mala en
 *    su propia lista y tendría que retirarla con `curl`.
 *
 * **Reglas del contrato que la UI no puede relajar:**
 *  1. **El default son los TRES motivos de coherencia.** `SLAB_PUBLISHED` y `STALE` son **opt-in** —
 *     son accionables, pero no son datos erróneos, y meterlos por defecto **ahogaría la señal**.
 *  2. **`truncated` se PINTA.** Prohibido truncar en silencio: una lista incompleta presentada como
 *     completa produce la falsa confianza de «no hay nada que revisar».
 *  3. **Funciona con la feature APAGADA** y se dice. Si solo funcionara encendida, obligaría a
 *     publicar las cifras malas para poder descubrirlas.
 *  4. **`409 GRADED_CONFIG_INVALID` no se degrada a lista vacía:** una lista calculada contra un
 *     umbral corrupto es peor que no tener lista, así que se muestra el error y **no** una tabla.
 *  5. **El `409` del borrado NO es un error del sistema: es la guarda INV-D funcionando.** Con un
 *     slab publicado de ese grado la fila **ya no es un estimado** —es la referencia de mercado de
 *     una pieza física— y retirarla dejaría sin sustento de precio a un slab que se está vendiendo.
 *     La UI lo **previene** (botón deshabilitado con el motivo a la vista, como el pre-vuelo de 5d)
 *     y, si el pre-vuelo iba rancio, **explica el 409 y manda al remedio correcto: repreciar con
 *     `intent:"market"`**, nunca a insistir en borrar.
 *  6. **El `404` del borrado significa «no había nada», no un fallo**, y se dice con esas palabras.
 *
 * **Fuera de alcance declarado (v1.50.3, no se cuela «de paso»):** marcar una carta como revisada
 * —exige estado persistido ⇒ tabla nueva ⇒ DDL— y los avisos proactivos.
 */
export function GradedEstimateReviewSection() {
  const t = useTranslations('admin.m2.gradedEstimateReview');
  const tReason = useTranslations('admin.m2.gradedEstimateCapture.diagnosis.reason');
  const locale = useLocale() as AppLocale;
  const qc = useQueryClient();
  const getError = useErrorMessage();

  /** `false` = default del contrato (solo coherencia). `true` = además INV-D. */
  const [includeSlabPublished, setIncludeSlabPublished] = useState(false);
  /** Opt-in de lo CADUCADO: el dato que existió, expiró y ya no se ve en ninguna superficie. */
  const [includeStale, setIncludeStale] = useState(false);
  const [page, setPage] = useState(1);
  const [pending, setPending] = useState<PendingDelete | null>(null);
  const [outcome, setOutcome] = useState<DeleteOutcome | null>(null);

  const reason: GradedEstimateReviewReason[] = [
    ...GRADED_REVIEW_DEFAULT_REASONS,
    ...(includeSlabPublished ? (['SLAB_PUBLISHED'] as const) : []),
    ...(includeStale ? (['STALE'] as const) : []),
  ];

  const query = useQuery({
    queryKey: ['graded-estimate-review', includeSlabPublished, includeStale, page],
    queryFn: () => getGradedEstimateReview({ reason, page, pageSize: PAGE_SIZE }),
  });

  const remove = useMutation({
    mutationFn: (target: PendingDelete) =>
      deleteGradedEstimate(target.cardId, target.gradeValue),
    onSuccess: (res, target) => {
      setOutcome({
        kind: 'deleted',
        cardName: target.cardName,
        gradeValue: target.gradeValue,
        // `deletedCount` se PINTA tal cual: el borrado se lleva todas las filas de la clave
        // (cualquier `capturedDate`), así que puede ser > 1 y el operador tiene que enterarse de
        // cuánto historial se fue con ella.
        deletedCount: res.deletedCount,
      });
      setPending(null);
      afterDelete();
    },
    onError: (error, target) => {
      // `404` = «no había nada que borrar». NO es un fallo: el dato ya no estaba (otro operador lo
      // retiró, o este listado venía rancio). Se cierra el diálogo, se dice con esas palabras y se
      // refresca la lista, que es justo lo que está desactualizado.
      if (error instanceof ApiClientError && error.status === 404) {
        setOutcome({ kind: 'gone', cardName: target.cardName, gradeValue: target.gradeValue });
        setPending(null);
        afterDelete();
      }
      // Cualquier otro error (incluido el `409` de INV-D) deja el diálogo ABIERTO con el mensaje:
      // el operador tiene que leer por qué no se hizo, y en el caso del 409 adónde ir en su lugar.
    },
  });

  /**
   * Tras retirar (o descubrir que ya no estaba) se invalida **la lista** —todas sus páginas y
   * filtros, no solo la vista actual— y el **pre-vuelo** de la sección de captura, que muestra las
   * mismas cifras. Sin recargar la página: la fila desaparece sola.
   */
  function afterDelete() {
    void qc.invalidateQueries({ queryKey: ['graded-estimate-review'] });
    void qc.invalidateQueries({ queryKey: ['graded-estimate-preview'] });
  }

  function openConfirm(row: GradedEstimateReviewItemDTO, gradeValue: string, amount: number | null) {
    remove.reset();
    setOutcome(null);
    setPending({
      cardId: row.cardId,
      cardName: row.cardName,
      gradeValue,
      amountCents: amount,
      capturedDate: row.capturedDate,
      isManual: row.isManual,
    });
  }

  const totalPages =
    query.data && query.data.pageSize > 0
      ? Math.max(1, Math.ceil(query.data.total / query.data.pageSize))
      : 1;

  /** ¿alguna fila listada tiene un grado bloqueado por INV-D? Explica el «no se puede» UNA vez. */
  const hasBlockedGrade = (query.data?.data ?? []).some((r) =>
    GRADE_FIELDS.some((g) => g.amount(r) !== null && r.publishedSlabGrades.includes(g.gradeValue)),
  );

  const columns: Column<GradedEstimateReviewItemDTO>[] = [
    {
      key: 'card',
      header: t('colCard'),
      render: (r) => (
        <span className="flex min-w-0 flex-col">
          <span lang="en" className="font-medium">
            {r.cardName}
          </span>
          <span className="font-mono text-xs text-muted">
            <span lang="en">{r.setName}</span> · <span className="tabular">#{r.number}</span> ·{' '}
            {r.finish}
          </span>
        </span>
      ),
    },
    {
      key: 'reason',
      header: t('colReason'),
      render: (r) => (
        <span className="flex flex-col gap-1">
          <Badge tone="warning" shape="outline">
            {r.reason ? t(`reasonShort.${r.reason}`) : '—'}
          </Badge>
          {/* El motivo largo dice QUÉ ERROR suele haber detrás: es lo que convierte la fila en una
              acción («esto huele a dólares capturados como pesos») y no en una etiqueta. */}
          <span className="text-xs text-muted">{r.reason ? tReason(r.reason) : ''}</span>
        </span>
      ),
    },
    {
      key: 'raw',
      header: t('colRaw'),
      align: 'right',
      render: (r) => <span className="tabular">{formatMoneyCents(r.salePriceCents, locale)}</span>,
    },
    {
      key: 'psa10',
      header: 'PSA 10',
      align: 'right',
      render: (r) => (
        // Money-safe: un monto no resoluble llega `null` y se pinta «sin dato», NUNCA MX$0.00.
        <span className="tabular">
          {r.psa10MxnCents != null ? formatMoneyCents(r.psa10MxnCents, locale) : t('noData')}
        </span>
      ),
    },
    {
      key: 'psa9',
      header: 'PSA 9',
      align: 'right',
      render: (r) => (
        <span className="tabular">
          {r.psa9MxnCents != null ? formatMoneyCents(r.psa9MxnCents, locale) : t('noData')}
        </span>
      ),
    },
    {
      key: 'maxAllowed',
      header: t('colMaxAllowed'),
      align: 'right',
      render: (r) => (
        <span className="tabular text-muted">
          {r.maxAllowedPsa10MxnCents != null
            ? formatMoneyCents(r.maxAllowedPsa10MxnCents, locale)
            : t('noData')}
        </span>
      ),
    },
    {
      key: 'captured',
      header: t('colCaptured'),
      align: 'right',
      render: (r) => (
        <span className="flex flex-col items-end gap-0.5">
          <span className="tabular text-muted">
            {r.capturedDate ? formatDate(r.capturedDate, locale) : t('noData')}
          </span>
          {/* El ORIGEN va pegado a la fecha porque describe la MISMA fila, y porque con una cifra
              caducada decide el remedio: recapturar/retirar (manual) vs. mirar el ingest (auto). */}
          <span className="text-xs text-muted">
            {r.isManual ? t('originManual') : t('originIngest')}
          </span>
        </span>
      ),
    },
    {
      key: 'actions',
      header: t('colAction'),
      align: 'right',
      render: (r) => {
        const options = GRADE_FIELDS.map((g) => ({ ...g, value: g.amount(r) })).filter(
          (g) => g.value !== null,
        );
        // Sin ninguna cifra no hay nada que retirar: no se pinta un botón que solo daría 404.
        if (options.length === 0) return <span className="text-xs text-muted">{t('noData')}</span>;
        return (
          <span className="flex flex-col items-end gap-1">
            {options.map((g) => {
              const blocked = r.publishedSlabGrades.includes(g.gradeValue);
              return (
                <span key={g.gradeValue} className="flex flex-col items-end gap-0.5">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={blocked}
                    aria-label={t('deleteCtaLabel', { grade: g.gradeValue, card: r.cardName })}
                    onClick={() => openConfirm(r, g.gradeValue, g.value)}
                  >
                    {t('deleteCta', { grade: g.gradeValue })}
                  </Button>
                  {blocked && (
                    <span className="text-xs text-muted">{t('deleteBlockedShort')}</span>
                  )}
                </span>
              );
            })}
          </span>
        );
      },
    },
  ];

  const confirmError = remove.isError ? remove.error : null;
  const confirmErrorIsSlab =
    confirmError instanceof ApiClientError &&
    confirmError.code === 'GRADED_ESTIMATE_SLAB_PUBLISHED';

  return (
    // `id` + `scroll-mt`: es el DESTINO del enlace del aviso de apagado del dial de M10
    // (DESIGN_SYSTEM §22.13e/§22.12 nº13.e). El `scroll-margin-top` se deriva de `--app-header-h`
    // (§4.5) para no aterrizar debajo del header sticky — el fallo clásico de este patrón, y el que
    // convertiría la escalera de remedios en un enlace que no lleva a ningún sitio.
    <section
      id="gancho-revision"
      className="flex flex-col gap-3 scroll-mt-[calc(var(--app-header-h,0px)+16px)]"
    >
      <h2 className="text-h2 font-semibold">{t('title')}</h2>
      <p className="text-sm text-muted">{t('subtitle')}</p>

      <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeSlabPublished}
            onChange={(e) => {
              setIncludeSlabPublished(e.target.checked);
              setPage(1);
            }}
          />
          {t('includeSlabPublished')}
        </label>
        <p className="text-xs text-muted">{t('includeSlabPublishedHint')}</p>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeStale}
            onChange={(e) => {
              setIncludeStale(e.target.checked);
              setPage(1);
            }}
          />
          {t('includeStale')}
        </label>
        <p className="text-xs text-muted">{t('includeStaleHint')}</p>

        {/* Desenlace del último borrado. Persistente (no un toast): es una acción sobre una tabla
            de dinero y su resultado no puede evaporarse a los 5 s. */}
        {outcome?.kind === 'deleted' && (
          <Banner variant="success" role="status">
            {t('deleteOk', {
              grade: outcome.gradeValue,
              card: outcome.cardName,
              count: outcome.deletedCount,
            })}
          </Banner>
        )}
        {outcome?.kind === 'gone' && (
          // `404`: NO es un fallo. Se dice literalmente «no había nada que borrar».
          <Banner variant="info" role="status" title={t('deleteNothingTitle')}>
            {t('deleteNothingBody', { grade: outcome.gradeValue, card: outcome.cardName })}
          </Banner>
        )}

        <QueryState
          isLoading={query.isLoading}
          isError={query.isError}
          error={query.error}
          onRetry={() => query.refetch()}
        >
          {query.data && (
            <div className="flex flex-col gap-3">
              {/* La lista evalúa aunque el dial esté apagado: se dice, para que nadie lea la lista
                  como «lo que se está publicando ahora mismo». */}
              {!query.data.enabled && <Banner variant="info">{t('featureOffBanner')}</Banner>}
              {/* Prohibido truncar en silencio (contrato). */}
              {query.data.truncated && (
                <Banner variant="warning" role="alert" title={t('truncatedTitle')}>
                  {t('truncatedBody', { scanned: query.data.scannedCards })}
                </Banner>
              )}

              <p className="text-xs text-muted">
                {t('summary', { total: query.data.total, scanned: query.data.scannedCards })}
              </p>

              {/* `data: []` NO es un logro que celebrar con un placeholder: es una lista vacía. */}
              <div className="rounded-lg border border-border p-2">
                <DataTable
                  columns={columns}
                  rows={query.data.data}
                  rowKey={(r) => `${r.cardId}|${r.representativeInventoryItemId}|${r.finish}`}
                />
              </div>

              {/* El «no se puede retirar» se explica UNA vez y con el remedio correcto, en lugar de
                  repetir un párrafo por fila o dejar botones apagados sin motivo. */}
              {hasBlockedGrade && (
                <Banner variant="warning" title={t('deleteBlockedTitle')}>
                  {t('deleteBlockedBody')}
                </Banner>
              )}

              <p className="text-xs text-muted">{t('howToFix')}</p>

              {totalPages > 1 && (
                <div className="flex items-center gap-3">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    {t('prev')}
                  </Button>
                  <span className="tabular text-xs text-muted">
                    {t('pageInfo', { page: query.data.page, totalPages })}
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    {t('next')}
                  </Button>
                </div>
              )}
            </div>
          )}
        </QueryState>
      </div>

      {/* ── Confirmación destructiva (DESIGN_SYSTEM §7.6): verbo explícito, consecuencia e importe ── */}
      <Modal
        open={pending !== null}
        onClose={() => {
          if (remove.isPending) return; // no se cierra a media escritura en una tabla de dinero
          setPending(null);
          remove.reset();
        }}
        title={pending ? t('deleteConfirmTitle', { grade: pending.gradeValue }) : ''}
        footer={
          pending && (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="destructive"
                loading={remove.isPending}
                disabled={remove.isPending}
                onClick={() => remove.mutate(pending)}
              >
                {t('deleteConfirmCta', { grade: pending.gradeValue })}
              </Button>
              <Button
                variant="secondary"
                disabled={remove.isPending}
                onClick={() => {
                  setPending(null);
                  remove.reset();
                }}
              >
                {t('cancel')}
              </Button>
            </div>
          )
        }
      >
        {pending && (
          <div className="flex flex-col gap-3 text-sm">
            <p>
              {t('deleteConfirmBody', {
                grade: pending.gradeValue,
                card: pending.cardName,
                amount:
                  pending.amountCents != null
                    ? formatMoneyCents(pending.amountCents, locale)
                    : t('noData'),
              })}
            </p>
            {/* La regla que el copy NO puede suavizar: no se retira «la última», se retira TODO lo
                capturado de ese grado. Si solo se quitara la vigente, afloraría una más vieja y la
                cifra reaparecería sola en la ficha. */}
            <p className="text-muted">{t('deleteConfirmAllRows')}</p>
            <p className="text-muted">{t('deleteConfirmScope')}</p>
            <p className="text-muted">{t('deleteConfirmAudit')}</p>
            {confirmError && (
              <Banner variant="danger" role="alert" title={t('deleteFailedTitle')}>
                <span className="flex flex-col gap-2">
                  <span>{getError(confirmError)}</span>
                  {/* El 409 es un resultado ESPERADO y su remedio es el opuesto a insistir. */}
                  {confirmErrorIsSlab && <span>{t('deleteSlabPublishedNote')}</span>}
                </span>
              </Banner>
            )}
          </div>
        )}
      </Modal>
    </section>
  );
}
