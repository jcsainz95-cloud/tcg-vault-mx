'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { getAdminBounties, putVariantControls } from '@/lib/api';
import { formatDate, formatMoneyCents } from '@/lib/format';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { cn } from '@/lib/cn';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Skeleton } from '@/components/ui/Skeleton';
import { Toaster, useToasts } from '@/components/ui/Toast';
import { Modal } from '@/components/ui/Modal';
import { useErrorMessage } from '@/components/ui/QueryState';
import { FinishMark } from '@/components/domain/FinishMark';
import type {
  AdminBountyListResponse,
  AdminBountyRowDTO,
  AdminBountySort,
  BountyState,
  VariantControlsRequest,
} from '@/types/contract';
import type { AppLocale } from '@/i18n/routing';
import { BountyRowEditor } from './BountyRowEditor';
import {
  BOUNTY_CHIP_ORDER,
  BOUNTY_SORTS,
  bountyPremium,
  bountyRowKey,
  hasAttentionRows,
  isKnownBountyState,
  savedToastFor,
  withBlockHeaders,
  zeroStatement,
  type BountyBlock,
} from './bounty-view-model';

/**
 * # M2 › BOUNTIES — la pantalla que ve los que hoy son invisibles
 * `DESIGN_SYSTEM §28` (normativa) · `API_CONTRACT §M2-B` · `PROJECT` criterio **184** (D52).
 *
 * ## Por qué existe, en una frase
 * Un bounty cuya oferta quedó **por debajo —o igual— de la tarifa vigente deja de ser bounty**: no
 * se paga, **no se publica**, y las dos vitrinas públicas que lo enseñaban **desaparecen enteras**
 * cuando no queda ninguno efectivo. Ese bounty es hoy **invisible en todas partes** salvo en la
 * casilla del binder de su set, y el dueño **cree estar pagando un precio que no paga**. Esta
 * pantalla cura esa ceguera; todo lo demás es secundario a eso.
 *
 * ## Las cuatro reglas que no se pueden relajar
 * 1. **El `state` lo deriva el SERVIDOR y aquí solo se pinta.** Son cinco (`activa`, `rebasada`,
 *    `invalida`, `completada`, `apagada`) y **ninguno se funde con otro**. ⛔ No se recalcula
 *    cruzando banderas ni comparando `PAGAMOS` con `TARIFA VIGENTE` (§28.0, §28.13 nº1).
 * 2. **`counts` es sobre el CONJUNTO clasificado, no sobre la página.** ⛔ No se derivan de `data`:
 *    con un `rebasada` en la página 3 los chips dirían «cero» **exactamente donde la pantalla
 *    existe para no decirlo** (§M2-B.1, §28.13 nº8).
 * 3. **El cero tranquilizador solo se enuncia si el conteo es COMPLETO** (`counts.rebasada === 0`
 *    **y** `counts.invalida === 0` **y** `truncated === false`). *Un cero de una lista cortada no
 *    es un cero* (§28.5).
 * 4. **⛔ NADA MASIVO.** Ni multi-selección con acción, ni «aplicar a los filtrados», ni ningún
 *    control cuyo rótulo lleve un contador (`Apagar los {n}…`). **N escrituras disparadas por un
 *    gesto son una acción masiva aunque viajen de una en una: el alcance lo define el gesto del
 *    humano, no el transporte** (§M2-B.2, §28.7). *Y la razón que decide es medible: un `rebasada`
 *    YA NO PAGA —la precedencia de compra se lo salta—, así que un botón de apagado masivo frenaría
 *    un gasto que el sistema ya frenó solo mientras convierte N diagnósticos en N decisiones que
 *    nadie tomó una por una.* Candado: **B-13(b)** de §M2-B.6.
 *
 * ## Lo que esta pantalla NO hace (§28.1, §M2-B.5, criterio 184(f))
 * ⛔ No da de alta bounties (el alta vive en el binder) · ⛔ no hay tablero, KPIs ni gráficas ·
 * ⛔ no hay reportes de avance contra objetivo · ⛔ no manda correo, push ni tarjeta de dashboard ·
 * ⛔ no muestra posición de inventario · ⛔ no muestra ninguna antigüedad del rebasado (el dato no
 * existe y **no se aproxima con `updatedAt`**) · ⛔ no aplica la escalera de redondeo (es del eje de
 * VENTA; el bounty vive en el de COMPRA).
 */

const PAGE_SIZE = 25;

interface EditingState {
  key: string;
  /** Se abrió con `Encender` (§28.6c: encender NO es un clic directo). */
  turnOnIntent: boolean;
}

export function BountiesView() {
  const t = useTranslations('admin.m2.bounties');
  const tRoot = useTranslations();
  const locale = useLocale() as AppLocale;
  const getError = useErrorMessage('operator');
  const { toasts, push: pushToast, dismiss: dismissToast } = useToasts();

  const [states, setStates] = useState<BountyState[]>([]);
  const [sort, setSort] = useState<AdminBountySort>('attention_first');
  const [qInput, setQInput] = useState('');
  const q = useDebouncedValue(qInput, 300);
  const [page, setPage] = useState(1);

  const [editing, setEditing] = useState<EditingState | null>(null);
  const [discardAsk, setDiscardAsk] = useState<{ card: string; next: EditingState | null } | null>(null);
  const [mutatingKey, setMutatingKey] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ key: string; error: unknown } | null>(null);
  const editButtons = useRef(new Map<string, HTMLButtonElement | null>());

  const query = useQuery<AdminBountyListResponse>({
    queryKey: ['admin-bounties', states, sort, q, page],
    queryFn: () => getAdminBounties({ states, sort, q: q || undefined, page, pageSize: PAGE_SIZE }),
  });

  // Cualquier cambio de filtro devuelve a la página 1: un filtro nuevo sobre la página 7 deja al
  // operador mirando un hueco y creyendo que no hay nada.
  useEffect(() => {
    setPage(1);
  }, [states, sort, q]);

  const data = query.data;
  const rows = data?.data ?? [];
  const counts = data?.counts ?? null;
  const truncated = data?.truncated ?? false;
  const money = (cents: number) => formatMoneyCents(cents, locale);

  /** Con `truncated` los conteos son MÍNIMOS: el `≥` es lo único verdadero (§28.2b). */
  function countText(n: number): string {
    return truncated ? `≥ ${n}` : String(n);
  }

  function toggleState(s: BountyState) {
    setStates((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  }

  function focusEditButton(key: string) {
    // Al cerrar (guardar o cancelar) el foco vuelve al botón de ESA fila, nunca al principio de la
    // tabla (§28.10).
    window.setTimeout(() => editButtons.current.get(key)?.focus(), 0);
  }

  function closeEditor(key: string | undefined) {
    setEditing(null);
    setRowError(null);
    if (key) focusEditButton(key);
  }

  /**
   * Guardado de UNA fila (§M2-B.2: fila a fila, reusando el endpoint que ya existe). Tras el write
   * se **RE-LEE la lista** y la fila se repinta con el `state` que devuelva la relectura: ⛔ nunca
   * en optimista, porque quien decide si un bounty es efectivo es el servidor contra la curva
   * (§28.6d).
   */
  const save = useMutation({
    mutationFn: async (vars: {
      row: AdminBountyRowDTO;
      req: VariantControlsRequest;
      intent: 'edit' | 'turnOff' | 'undoTurnOff';
    }) => {
      await putVariantControls(vars.row.cardId, vars.row.finish, vars.req);
      const fresh = await query.refetch();
      return { fresh: fresh.data ?? null, vars };
    },
    onMutate: (vars) => {
      setMutatingKey(bountyRowKey(vars.row));
      setRowError(null);
    },
    onSettled: () => setMutatingKey(null),
    onSuccess: ({ fresh, vars }) => {
      const key = bountyRowKey(vars.row);
      const after = fresh?.data.find((r) => bountyRowKey(r) === key) ?? null;
      // ⚠️ El toast se elige por el `state` NUEVO, no por lo que se tecleó.
      const kind = savedToastFor(vars.row.state, after ? after.state : null);
      const rate = after?.pricing.bounty?.curveQuoteCents ?? vars.row.pricing.bounty?.curveQuoteCents ?? null;

      if (kind === 'turnedOff' || (after === null && vars.intent === 'turnOff')) {
        pushToast({
          variant: 'info',
          message: t('row.turnOffToast', { card: vars.row.name }),
          // `Deshacer` re-enciende **esa** fila y nada más. Es la contrapartida de no abrir ventana
          // en la dirección que BAJA el gasto (§28.6c). El servidor vuelve a validar entera la
          // guarda (`BOUNTY_BELOW_RULE` incluida): apagar es barato, encender no.
          undo: {
            label: tRoot('common.undo'),
            onUndo: () =>
              save.mutate({
                row: after ?? vars.row,
                req: { productType: 'raw', gradeKey: 'raw:NM', bounty: { enabled: true } },
                intent: 'undoTurnOff',
              }),
          },
        });
      } else {
        const message =
          kind === 'savedNowActive'
            ? t('savedNowActive')
            : kind === 'savedStillOutbid'
              ? t('savedStillOutbid', { rate: rate != null ? money(rate) : '—' })
              : kind === 'savedStillNoPrice'
                ? t('savedStillNoPrice')
                : t('saved');
        // Tono neutro y `polite`: un guardado que no arregla nada **no es un error** —el guardado
        // ocurrió— pero tampoco puede decir «listo» (§28.6d).
        pushToast({ variant: 'info', message });
      }
      closeEditor(key);
    },
    onError: (error, vars) => {
      const key = bountyRowKey(vars.row);
      setRowError({ key, error });
      // El error se queda EN LA FILA, abierta; el resto de la tabla no se toca (§28.8). Y se re-lee
      // la fila, porque un `BOUNTY_BELOW_RULE` significa que la curva se movió bajo los pies.
      setEditing({ key, turnOnIntent: false });
      void query.refetch();
    },
  });

  function requestEdit(next: EditingState | null, row?: AdminBountyRowDTO) {
    // Solo hay UNA fila abierta a la vez; abrir otra cierra ésta con la misma confirmación (§28.6b).
    if (editing && editing.key !== next?.key) {
      const open = rows.find((r) => bountyRowKey(r) === editing.key);
      setDiscardAsk({ card: open?.name ?? '', next });
      return;
    }
    setRowError(null);
    setEditing(next);
    if (next === null && row) focusEditButton(bountyRowKey(row));
  }

  const zero = counts ? zeroStatement(counts, truncated) : null;
  const grouped = sort === 'attention_first';
  const withHeaders = withBlockHeaders(rows, grouped);
  const showZeroLine = !query.isLoading && !query.isError && zero !== null && !hasAttentionRows(rows);
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const filtersActive = states.length > 0 || q.trim() !== '';

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <p className="eyebrow">{t('eyebrow')}</p>
        <h1 className="font-serif text-h1">{t('title')}</h1>
        <p className="max-w-3xl text-sm leading-relaxed text-muted">{t('lead')}</p>
      </header>

      {/* ── Los CINCO chips (§28.2a). Son el filtro `state` (repetible) y su número viene de
          `counts`, que IGNORA el filtro de estado y RESPETA los de identidad ⇒ el número NO cambia
          al seleccionarlos, y eso es correcto: así siguen sirviendo de mapa mientras se usan.
          ⛔ Ninguno se esconde al llegar a cero. ── */}
      <div
        className="flex flex-wrap gap-2 overflow-x-auto"
        role="group"
        aria-label={query.isLoading ? t('counts.loadingAria') : t('col.state')}
        aria-busy={query.isLoading || undefined}
      >
        {BOUNTY_CHIP_ORDER.map((s) => {
          const n = counts?.[s] ?? null;
          const selected = states.includes(s);
          return (
            <button
              key={s}
              type="button"
              aria-pressed={selected}
              // Un chip en cero se deshabilita, pero NO desaparece: un chip que se esfuma convierte
              // «no hay» en «no se está mirando» (§28.5).
              disabled={n === 0 && !selected}
              onClick={() => toggleState(s)}
              {...(truncated && n != null ? { 'aria-description': t('counts.atLeastAria', { count: n }) } : {})}
              className={cn(
                'min-h-[44px] whitespace-nowrap border px-3 font-mono text-[11px] uppercase tracking-[0.06em]',
                selected ? 'border-text bg-text text-primary-fg' : 'border-border-strong text-text',
                'disabled:border-border disabled:text-muted',
              )}
            >
              {/* Mientras carga, `—` — jamás un `0` provisional sobre el único número que importa. */}
              {t(`counts.${s}`, { count: n == null ? '—' : countText(n) })}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-end gap-6">
        <div className="min-w-[16rem] flex-1">
          <Input
            label={t('filters.searchLabel')}
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
          />
        </div>
        <div className="min-w-[14rem]">
          <Select
            label={t('sort.label')}
            value={sort}
            onChange={(e) => setSort(e.target.value as AdminBountySort)}
            // ⛔ Solo las TRES del endpoint: ordenar en el cliente sobre una página rompería el eje.
            options={BOUNTY_SORTS.map((s) => ({ value: s, label: t(`sort.${s}`) }))}
          />
        </div>
      </div>

      {/* La lista incompleta SE DICE. No es una avería (`status`, no `alert`) y no bloquea la tabla:
          una lista de dinero que miente por omisión es peor que una que se declara incompleta. */}
      {truncated && (
        <Banner variant="warning" role="status">
          {t('list.truncated')}
        </Banner>
      )}

      {/* El bloque ① nunca desaparece: cuando no tiene filas, se ENUNCIA el cero. Inversión
          deliberada de la vitrina, que calla cuando no hay nada. Va en tinta y sin adorno: no es
          una felicitación, es un hecho verificado hoy que mañana puede no serlo. */}
      {showZeroLine && (
        <p className="border-l-2 border-border-strong pl-4 text-sm text-text">
          <span className="mr-2 font-mono text-[11px] uppercase tracking-[0.06em] text-muted">
            {t('zero.outbidLabel')}
          </span>
          {zero === 'outbid'
            ? t('zero.outbid')
            : t('zero.outbidButNoPrice', { count: counts?.invalida ?? 0 })}
        </p>
      )}

      {query.isError && (
        <Banner
          variant="danger"
          role="alert"
          title={t('error.load')}
          action={
            <Button size="sm" variant="secondary" onClick={() => void query.refetch()}>
              {tRoot('common.retry')}
            </Button>
          }
        >
          {getError(query.error)}
        </Banner>
      )}

      {query.isLoading && (
        <div className="flex flex-col gap-2" aria-busy>
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      )}

      {!query.isLoading && !query.isError && rows.length === 0 && (
        <EmptyState
          title={filtersActive ? t('empty.filteredTitle') : t('empty.title')}
          body={filtersActive ? undefined : t('empty.body')}
          action={
            filtersActive ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setStates([]);
                  setQInput('');
                }}
              >
                {tRoot('common.clearFilters')}
              </Button>
            ) : (
              // El estado vacío manda al binder con todas las letras: el ALTA no vive aquí.
              <Link href="/admin/m1" className="border-b border-accent pb-1 text-sm text-accent">
                {t('empty.cta')}
              </Link>
            )
          }
        />
      )}

      {!query.isLoading && !query.isError && rows.length > 0 && (
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">{t('table.caption')}</caption>
          <thead>
            <tr className="border-b border-border-strong text-left font-mono text-[10px] uppercase tracking-[0.06em] text-muted">
              <th scope="col" className="py-2 pr-3">{t('col.card')}</th>
              <th scope="col" className="py-2 pr-3">{t('col.state')}</th>
              <th scope="col" className="py-2 pr-3 text-right">{t('col.pay')}</th>
              <th scope="col" className="py-2 pr-3 text-right">{t('col.rate')}</th>
              <th scope="col" className="py-2 pr-3 text-right">{t('col.premium')}</th>
              <th scope="col" className="py-2 pr-3 text-right">{t('col.progress')}</th>
              <th scope="col" className="py-2 text-right">
                <span className="sr-only">{t('col.actions')}</span>
              </th>
            </tr>
          </thead>
          {withHeaders.map(({ row, startsBlock }) => {
            const key = bountyRowKey(row);
            const isEditing = editing?.key === key;
            return (
              <tbody key={key}>
                {startsBlock && (
                  <BlockHeader block={startsBlock} counts={counts} countText={countText} />
                )}
                <BountyTableRow
                  row={row}
                  editing={isEditing}
                  busy={mutatingKey === key}
                  registerButton={(el) => editButtons.current.set(key, el)}
                  onEdit={() => requestEdit({ key, turnOnIntent: false })}
                  onTurnOn={() => requestEdit({ key, turnOnIntent: true })}
                  onTurnOff={() =>
                    save.mutate({
                      row,
                      // Apagar manda SOLO el interruptor: el precio, el objetivo y el contador se
                      // conservan porque el campo omitido no se toca (§M2-B.3).
                      req: { productType: 'raw', gradeKey: 'raw:NM', bounty: { enabled: false } },
                      intent: 'turnOff',
                    })
                  }
                />
                {isEditing && (
                  <tr>
                    <BountyRowEditor
                      row={row}
                      turnOnIntent={editing.turnOnIntent}
                      saving={mutatingKey === key}
                      error={rowError?.key === key ? rowError.error : undefined}
                      onCancel={() => closeEditor(key)}
                      onSubmit={(req) => save.mutate({ row, req, intent: 'edit' })}
                    />
                  </tr>
                )}
              </tbody>
            );
          })}
        </table>
      )}

      {!query.isLoading && !query.isError && rows.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-xs text-muted">{t('progress.hint')}</p>
          {totalPages > 1 && (
            <div className="flex items-center gap-3">
              <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                {t('page.prev')}
              </Button>
              <span className="font-mono text-xs tabular-nums text-muted">
                {t('page.info', { page: data?.page ?? page, totalPages })}
              </span>
              <Button size="sm" variant="secondary" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                {t('page.next')}
              </Button>
            </div>
          )}
        </div>
      )}

      {!query.isLoading && !query.isError && rows.length > 0 && (
        <p className="text-xs text-muted">{tRoot('admin.pricing.console.pisaNota')}</p>
      )}

      <Modal
        open={discardAsk !== null}
        onClose={() => setDiscardAsk(null)}
        title={t('edit.oneAtATime')}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setDiscardAsk(null)}>
              {tRoot('common.cancel')}
            </Button>
            <Button
              size="sm"
              onClick={() => {
                const next = discardAsk?.next ?? null;
                setDiscardAsk(null);
                setRowError(null);
                setEditing(next);
              }}
            >
              {tRoot('common.confirm')}
            </Button>
          </>
        }
      >
        {t('edit.discardConfirm', { card: discardAsk?.card ?? '' })}
      </Modal>

      <Toaster toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

/**
 * Encabezado de grupo. Es un `<tr><th scope="rowgroup">` real para que el grupo **exista para el
 * lector de pantalla**, no solo para el ojo (§28.10). Su conteo sale de `counts` —el del conjunto,
 * no el de la página— y de ahí que pueda no coincidir con las filas visibles: es correcto.
 */
function BlockHeader({
  block,
  counts,
  countText,
}: {
  block: BountyBlock;
  counts: Record<BountyState, number> | null;
  countText: (n: number) => string;
}) {
  const t = useTranslations('admin.m2.bounties');
  const attention = block === 'attention';
  return (
    <tr className={cn(attention && 'border-l-2 border-accent')}>
      <th
        scope="rowgroup"
        colSpan={7}
        className={cn('py-3 text-left', attention ? 'pl-3' : '')}
      >
        <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-text">
          {attention
            ? `${t('group.attention')} · ${t('group.attentionCounts', {
                outbid: counts ? countText(counts.rebasada) : '—',
                noPrice: counts ? countText(counts.invalida) : '—',
              })}`
            : t(`group.${block}`, { count: counts ? countText(counts[block]) : '—' })}
        </span>
        {attention && (
          <span className="ml-3 text-xs font-normal normal-case tracking-normal text-muted">
            {t('group.attentionHint')}
          </span>
        )}
      </th>
    </tr>
  );
}

/**
 * Una fila **en reposo**: es TEXTO. Ni un `input`, ni un `switch`, ni una celda editable al clic
 * (§28.0 regla «la tabla en reposo no tiene formularios»). *Un precio que se cambia tocándolo es un
 * precio que se cambia sin querer, y aquí cada celda es dinero que sale.*
 *
 * ⛔ Y **no hay casilla de selección**: no existe ninguna acción cuyo alcance sea un conjunto.
 */
function BountyTableRow({
  row,
  editing,
  busy,
  registerButton,
  onEdit,
  onTurnOn,
  onTurnOff,
}: {
  row: AdminBountyRowDTO;
  editing: boolean;
  busy: boolean;
  registerButton: (el: HTMLButtonElement | null) => void;
  onEdit: () => void;
  onTurnOn: () => void;
  onTurnOff: () => void;
}) {
  const t = useTranslations('admin.m2.bounties');
  const locale = useLocale() as AppLocale;
  const money = (cents: number) => formatMoneyCents(cents, locale);

  const bounty = row.pricing.bounty ?? null;
  const priceCents = bounty?.priceCents ?? null;
  const curveQuoteCents = bounty?.curveQuoteCents ?? null;
  const known = isKnownBountyState(row.state);
  const attention = row.state === 'rebasada' || row.state === 'invalida';
  const premium = bountyPremium(row.state, priceCents, curveQuoteCents);
  const { targetQty, acquiredQty, remainingQty } = row.progress;

  // ⛔ Un `state` que esta pantalla no conozca se pinta NEUTRO, **nunca `ACTIVO`**: en esta tabla el
  // rótulo que afirma de más es `ACTIVO`, porque significa «se está pagando» (§28.3).
  const stateLabel = known ? t(`state.${row.state}`) : t('state.unknown');
  const stateAria = known
    ? row.state === 'completada'
      ? t('state.completadaAria', { date: formatDate(bounty?.completedAt ?? undefined, locale) })
      : t(`state.${row.state}Aria`)
    : t('state.unknownAria');

  return (
    <tr
      className={cn(
        'border-b border-border align-top',
        attention && 'border-l-2 border-l-accent',
        row.state === 'apagada' && 'text-muted',
      )}
    >
      <td className={cn('py-3 pr-3', attention && 'pl-3')}>
        {/* ⛔ Los nombres de carta y de set NO se traducen; van marcados `lang="en"`. */}
        <Link href="/admin/m1" lang="en" className="font-serif text-base text-text underline-offset-4 hover:underline">
          {row.name}
        </Link>
        <span className="sr-only"> — {t('row.openInBinder')}</span>
        <p className="text-xs text-muted">
          <span lang="en">{row.setName}</span> · {row.number}
        </p>
        <FinishMark finish={row.finish} band={false} className="mt-1" />
      </td>

      <td className="py-3 pr-3">
        <span
          aria-label={stateAria}
          className={cn(
            'font-mono text-[11px] uppercase tracking-[0.06em]',
            attention ? 'text-accent' : known ? 'text-text' : 'text-muted',
            row.state === 'apagada' && 'text-muted',
          )}
        >
          {stateLabel}
        </span>
      </td>

      {/* PAGAMOS — el hueco ES la señal en una fila `invalida`, y para el lector de pantalla hay que
          decirlo con palabras: un guion no se lee (§28.10). */}
      <td className="py-3 pr-3 text-right font-mono tabular-nums">
        {priceCents != null ? (
          money(priceCents)
        ) : (
          <span {...(row.state === 'invalida' ? { 'aria-label': t('row.noPriceAria') } : {})}>
            {t('row.noPrice')}
          </span>
        )}
      </td>

      {/* TARIFA VIGENTE — `—` significa una cosa y solo una: **la curva no resuelve**. Nunca «está
          apagado»: una fila apagada trae su tarifa igual que una viva. */}
      <td className="py-3 pr-3 text-right font-mono tabular-nums">
        {curveQuoteCents != null ? money(curveQuoteCents) : <span aria-label={t('premium.noRateAria')}>—</span>}
      </td>

      <td className={cn('py-3 pr-3 text-right font-mono tabular-nums', premium.kind === 'below' && 'text-accent')}>
        {premium.kind === 'above' || premium.kind === 'below' ? (
          t(premium.kind === 'above' ? 'premium.above' : 'premium.below', {
            amount: money(premium.amountCents),
            pct: premium.pct.toFixed(1),
          })
        ) : premium.kind === 'noRate' ? (
          <span className="text-accent" aria-label={t('premium.noRateAria')}>
            {t('premium.noRate')}
          </span>
        ) : (
          <span
            {...(premium.kind === 'noPrice'
              ? { 'aria-label': t('premium.noPriceAria') }
              : premium.kind === 'off'
                ? { 'aria-label': t('premium.noneAria') }
                : {})}
          >
            {t('premium.none')}
          </span>
        )}
      </td>

      {/* AVANCE — ⛔ nada de aritmética con `null`: sin objetivo se pinta la palabra y su remedio. */}
      <td className="py-3 pr-3 text-right font-mono tabular-nums">
        {targetQty == null ? (
          <span className="text-accent" aria-label={t('progress.noTargetAria')}>
            {t('progress.noTarget')}
          </span>
        ) : (
          <>
            {t('progress.value', { acquired: acquiredQty, target: targetQty })}
            <span className="block text-xs font-normal text-muted">
              {remainingQty === 0 ? t('progress.done') : t('progress.remaining', { n: remainingQty ?? 0 })}
            </span>
          </>
        )}
      </td>

      <td className="py-3 text-right">
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            ref={registerButton}
            size="sm"
            variant="secondary"
            onClick={onEdit}
            aria-expanded={editing}
            aria-label={
              row.state === 'invalida'
                ? t('row.setPriceAria', { card: row.name })
                : t('row.editAria', { card: row.name })
            }
            disabled={busy}
          >
            {/* Es el único estado cuyo botón principal cambia de rótulo, y es a propósito: `Editar`
                no dice qué hay que hacer; `Poner precio` sí (§28.6g). */}
            {row.state === 'invalida' ? t('row.setPrice') : t('row.edit')}
          </Button>

          {row.state === 'apagada' || row.state === 'completada' ? (
            // ⛔ `Encender` NO se hace de un clic: abre la fila en edición con el interruptor puesto
            // y el aviso de revisar el precio. Encender a ciegas un precio de hace tres meses es
            // exactamente cómo nace un rebasado (§28.6c).
            <Button size="sm" variant="ghost" onClick={onTurnOn} disabled={busy}>
              {t('row.turnOn')}
            </Button>
          ) : (
            // `Apagar` desde la fila en reposo SÍ es un clic: baja el gasto, es reversible y el
            // toast ofrece `Deshacer`. La fricción va en la dirección del dinero.
            <Button
              size="sm"
              variant="ghost"
              onClick={onTurnOff}
              aria-label={t('row.turnOffAria', { card: row.name })}
              loading={busy}
            >
              {t('row.turnOff')}
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}
