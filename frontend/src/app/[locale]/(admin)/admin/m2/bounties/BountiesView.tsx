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
  hasIdentityFilter,
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
  /**
   * ¿La fila abierta tiene cambios sin guardar? Lo reporta el bloque de edición (§28.6b: *«`Esc` y
   * `Cancelar` cierran; **si hay cambios sucios, confirman antes de descartar**»*). Se pregunta
   * SOLO cuando hay algo que perder: confirmar un formulario intacto enseña a confirmar sin leer,
   * que es justo lo que la asimetría de §28.6c intenta evitar.
   */
  const [editorDirty, setEditorDirty] = useState(false);
  const [discardAsk, setDiscardAsk] = useState<{ card: string; next: EditingState | null } | null>(null);
  const [mutatingKey, setMutatingKey] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ key: string; error: unknown } | null>(null);
  const editButtons = useRef(new Map<string, HTMLButtonElement | null>());

  const query = useQuery<AdminBountyListResponse>({
    queryKey: ['admin-bounties', states, sort, q, page],
    // ⚠️ `q.trim()`: §28.5 v3.5 declara que **una `q` de solo espacios no acota nada**. Si la
    // pantalla lo declara y luego la manda igual, el servidor **sí** filtra por esos espacios y la
    // pantalla creería estar sin filtro sobre un conjunto acotado — el defecto exacto que v3.5 cierra,
    // reintroducido por el transporte. Lo que no acota, no viaja.
    queryFn: () => getAdminBounties({ states, sort, q: q.trim() || undefined, page, pageSize: PAGE_SIZE }),
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

  /**
   * Con `truncated` los conteos son MÍNIMOS: el `≥` es lo único verdadero (§28.2b).
   *
   * ⚠️ **El `≥` sale del CATÁLOGO** (`counts.atLeast`, §28.12), no se teclea aquí. §28.10 mete esta
   * pantalla en el **barrido de homoglifos** y un carácter compuesto en código **no entra en ese
   * barrido**: `⩾` (U+2A7E) se ve igual que `≥` (U+2265) y cruzaría el candado sin despeinarse. El
   * `{label}` de la clave va vacío a propósito — **lo aporta la cadena que envuelve al número**
   * (`counts.{state}` en los chips, `group.*` en los encabezados), que es lo que compone el
   * `REBASADOS ≥ 3` que §28.12 escribe de una pieza.
   */
  function countText(n: number): string {
    return truncated ? t('counts.atLeast', { label: '', count: n }).trim() : String(n);
  }

  function toggleState(s: BountyState) {
    setStates((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  }

  function focusEditButton(key: string) {
    // Al cerrar (guardar o cancelar) el foco vuelve al botón de ESA fila, nunca al principio de la
    // tabla (§28.10).
    window.setTimeout(() => editButtons.current.get(key)?.focus(), 0);
  }

  /**
   * ### ⚠️ EL ÚNICO SITIO QUE MUEVE LA FILA ABIERTA (§28.6b)
   *
   * §28.6b declara **equivalentes** los cuatro caminos que cierran o cambian la fila en edición:
   * `Cancelar`, `Esc`, **abrir otra fila** y **confirmar el descarte**. Cuando cada uno tecleaba su
   * propia secuencia de `setState`, esa equivalencia la sostenía la *disciplina*: el próximo cambio
   * se habría aplicado en un camino y no en los otros tres, y los cuatro tienen que hacer lo mismo.
   * Aquí lo son **por construcción** — esta función es la única que **mueve la fila abierta**, y por
   * tanto la única que toca `editing`, `editorDirty`, `rowError` y el foco. (El `Cancelar` del
   * diálogo no es un camino más: **retira la pregunta y no transiciona**, `setDiscardAsk(null)`.)
   *
   * - `force` — el humano YA contestó la pregunta (botón `Confirmar` del diálogo), o no hay nada que
   *   perder (cierre tras un guardado con éxito). Sin él, la suciedad **pregunta antes de descartar**.
   * - `focusKey` — a qué botón vuelve el foco al cerrar. Por defecto, el de la fila que se cierra;
   *   explícito cuando el cierre lo dispara una fila que **no estaba abierta** (apagar desde reposo).
   * - `error` — el `422`/`409` de ESA fila. La deja abierta y anclada, ⛔ nunca en un toast (§28.6e).
   *
   * ⚠️ **`editorDirty` solo se limpia si la fila abierta CAMBIA de identidad**, y no es un detalle:
   * si `next` es la misma fila, `BountyRowEditor` **no se vuelve a montar** y conserva lo tecleado,
   * mientras que su `useEffect` de suciedad solo reporta **cuando `dirty` cambia**. Ponerlo a `false`
   * ahí dejaría a la vista creyendo que no hay nada que perder sobre un formulario que sí lo tiene, y
   * el siguiente `Cancelar` **descartaría sin preguntar** — que es el defecto que §28.6b prohíbe.
   */
  function transitionTo(
    next: EditingState | null,
    opts: { force?: boolean; focusKey?: string; error?: unknown } = {},
  ) {
    if (!opts.force && editorDirty && editing !== null && editing.key !== next?.key) {
      const open = rows.find((r) => bountyRowKey(r) === editing.key);
      setDiscardAsk({ card: open?.name ?? '', next });
      return;
    }
    const closing = editing?.key;
    const sameRow = editing !== null && editing.key === next?.key;
    setDiscardAsk(null);
    if (!sameRow) setEditorDirty(false);
    setRowError(opts.error !== undefined && next !== null ? { key: next.key, error: opts.error } : null);
    setEditing(next);
    const focusKey = opts.focusKey ?? closing;
    if (next === null && focusKey) focusEditButton(focusKey);
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
      // Guardado con éxito: no hay nada que descartar, así que **no se pregunta** (`force`), y el
      // foco vuelve al botón de ESA fila aunque el guardado saliera de una fila en reposo (`Apagar`).
      //
      // ⚠️ **Salvo que la fila guardada NO sea la abierta.** `Apagar` se pulsa desde una fila en
      // reposo, y puede haber OTRA fila en edición con cambios sin guardar: cerrarla aquí sería un
      // **quinto camino de descarte** —uno que §28.6b no nombra y que además no pregunta—. *El
      // borrador de otra fila no es nuestro para tirarlo.* Se cierra solo lo que se guardó.
      if (editing === null || editing.key === key) transitionTo(null, { force: true, focusKey: key });
      else focusEditButton(key);
    },
    onError: (error, vars) => {
      // El error se queda EN LA FILA, abierta y anclada; el resto de la tabla no se toca (§28.8). Y
      // se re-lee la fila, porque un `BOUNTY_BELOW_RULE` significa que la curva se movió bajo los
      // pies. ⚠️ Lo tecleado NO se pierde: si la fila ya estaba abierta, `transitionTo` respeta su
      // suciedad (misma identidad ⇒ el editor no se remonta).
      const key = bountyRowKey(vars.row);
      transitionTo({ key, turnOnIntent: false }, { force: true, error });
      void query.refetch();
    },
  });

  // §28.5 v3.5: mientras haya un filtro de IDENTIDAD puesto, esta pantalla **no puede saber** si hay
  // rebasados fuera de él (`counts` respeta la identidad y no llega ningún conteo sin filtrar).
  const identityFiltered = hasIdentityFilter({ q });
  const zero = counts ? zeroStatement(counts, truncated, identityFiltered) : null;
  const grouped = sort === 'attention_first';
  const withHeaders = withBlockHeaders(rows, grouped);
  const showZeroLine = !query.isLoading && !query.isError && zero !== null && !hasAttentionRows(rows);
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const filtersActive = states.length > 0 || identityFiltered;

  /*
   * §28.5b (v3.6, cierra **BNT-D14**) — la intersección §28.5 × §28.8: **una acción, un control.**
   *
   * Cuando el bloque ① pinta `VISTA FILTRADA` ya nombra el recorte (`zero.filtered`) **y ya ofrece
   * la palanca**. Si además la tabla queda sin filas, el vacío por filtro de §28.8 traía su propia
   * `Limpiar filtros`, y salían **dos controles idénticos y consecutivos**: eso no es cosmética,
   * es un fallo de accesibilidad (un lector de pantalla anuncia dos veces la misma acción sin poder
   * distinguirlas, §8.2/§28.10). Cede el vacío y **se suprime ENTERO** —título, icono y palanca—,
   * no a medias: el portador es la versalita, que se lee primero, y `zero.filtered` ya CONTIENE lo
   * que decía el vacío («ningún bounty coincide») y añade lo único que aquí hace daño —que la
   * pantalla **no puede contestar** mientras haya filtro—.
   *
   * ⚠️ La condición se ancla en **lo que de verdad se está pintando** (`showZeroLine && filtered`),
   * NO en `identityFiltered` a secas, y la diferencia no es teórica: con la lista truncada
   * `zeroStatement` devuelve `null` (manda `LISTA INCOMPLETA`, §28.5b fila 3), así que el bloque ①
   * **no ofrece palanca** aunque haya filtro puesto. Suprimir ahí el vacío dejaría la vista sin
   * ninguna salida — que es el otro caso que §28.14 caso 20 marca en rojo.
   */
  const clearFiltersLiveInZeroLine = showZeroLine && zero === 'filtered';

  /** La palanca de §28.5/§28.8: **un** sitio, dos consumidores (el vacío por filtro y `VISTA FILTRADA`). */
  function clearFilters() {
    setStates([]);
    setQInput('');
  }

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
              // ⚠️ Con la lista cortada **no se deshabilita ninguno**: ahí un `0` no es un cero, es
              // un «no lo sé» (§28.2b), y filtrar es justo la palanca que el banner recomienda —
              // apagar el chip cerraría la única puerta para averiguarlo.
              disabled={!truncated && n === 0 && !selected}
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
          una felicitación, es un hecho verificado hoy que mañana puede no serlo.

          ⚠️ **v3.5 · y cuando NO se puede enunciar, se dice por qué.** Con un filtro de identidad
          puesto, la versalita es `VISTA FILTRADA` y la frase **nombra el recorte** en vez de afirmar
          sobre «todos»: `counts` respeta ese filtro, así que un `rebasada: 0` ahí **no es un cero, es
          un «no lo sé»** — el mismo caso que la lista cortada, con otra mano recortando. ⛔ Y no se
          acota la frase: el portador es la VERSALITA, que se lee primero y no la desarma ninguna
          subordinada (§28.5 v3.5, §28.3 canal 2). Se ofrece la palanca en su lugar. */}
      {showZeroLine && (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2 border-l-2 border-border-strong pl-4 text-sm text-text">
          <p>
            <span className="mr-2 font-mono text-[11px] uppercase tracking-[0.06em] text-muted">
              {zero === 'filtered' ? t('zero.filteredLabel') : t('zero.outbidLabel')}
            </span>
            {zero === 'filtered'
              ? t('zero.filtered')
              : zero === 'outbid'
                ? t('zero.outbid')
                : t('zero.outbidButNoPrice', { count: counts?.invalida ?? 0 })}
          </p>
          {zero === 'filtered' && (
            <Button size="sm" variant="secondary" onClick={clearFilters}>
              {tRoot('common.clearFilters')}
            </Button>
          )}
        </div>
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

      {/* §28.5b: con `VISTA FILTRADA` arriba, este bloque NO se pinta (ni título, ni icono, ni
          palanca). El recorte se nombra una vez y la salida se ofrece una vez, arriba. */}
      {!query.isLoading && !query.isError && rows.length === 0 && !clearFiltersLiveInZeroLine && (
        <EmptyState
          title={filtersActive ? t('empty.filteredTitle') : t('empty.title')}
          body={filtersActive ? undefined : t('empty.body')}
          action={
            filtersActive ? (
              <Button size="sm" variant="secondary" onClick={clearFilters}>
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
        // ── §28.9 · MÓVIL (390px): la MISMA tabla se desploma en tarjetas por CSS ──────────────
        // ⛔ **No hay dos árboles de DOM.** El patrón de `DataTable` (`hidden md:table` + un bloque
        // `md:hidden`) pinta cada valor **dos veces**, y en una pantalla de dinero eso es dos sitios
        // donde el importe puede divergir —justo la clase de defecto que este pase vino a cerrar—
        // además de duplicar cada nombre accesible y cada botón (dos `Editar` por fila, dos destinos
        // para el foco de §28.10). Aquí la tabla es **una**: bajo `md` el `display` pasa a bloque y
        // cada fila se convierte en una rejilla de dos columnas.
        // ⚠️ **Y por eso los roles van explícitos** — con la cuenta MEDIDA, no supuesta (árbol de
        // accesibilidad de Chromium por CDP, a 390px, con y sin ellos):
        //   · `rowgroup` **NO es redundante en ningún motor**: Blink **ignora el `<tbody>`** si no
        //     lleva rol, así que al colapsar la cuenta cae de **6 a 0** y con ella **el agrupamiento
        //     entero** —lo único innegociable de §28.9— porque aquí la cabecera está en `display:none`.
        //   · `table`/`row`/`cell`/`rowheader` **sí** los deriva Chromium aunque el `display` deje de
        //     ser `table` (medido: idénticos con y sin). Se quedan como defensa para los motores
        //     donde **no** se derivan —WebKit/VoiceOver es el caso documentado—, que este proyecto
        //     **no puede correr** (Playwright solo tiene Chromium). ⛔ *Que sean redundantes en un
        //     motor no los hace redundantes.*
        // Candados: `e2e/admin-bounties.spec.ts` §28.9 (el `rowgroup`, donde de verdad se pierde) y
        // `BountiesView.test.tsx` §28.10 (los cinco atributos, para que un borrado de UNA línea no
        // pase en verde).
        <table role="table" className="w-full border-collapse text-sm max-md:block">
          <caption className="sr-only">{t('table.caption')}</caption>
          {/* La cabecera desaparece en móvil: su trabajo lo hace el rótulo dentro de cada celda. */}
          <thead role="rowgroup" className="max-md:hidden">
            <tr role="row" className="border-b border-border-strong text-left font-mono text-[10px] uppercase tracking-[0.06em] text-muted">
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
              <tbody role="rowgroup" key={key} className="max-md:block">
                {startsBlock && (
                  <BlockHeader block={startsBlock} counts={counts} countText={countText} />
                )}
                <BountyTableRow
                  row={row}
                  editing={isEditing}
                  busy={mutatingKey === key}
                  registerButton={(el) => editButtons.current.set(key, el)}
                  onEdit={() => transitionTo({ key, turnOnIntent: false })}
                  onTurnOn={() => transitionTo({ key, turnOnIntent: true })}
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
                  <tr role="row" className="max-md:block">
                    <BountyRowEditor
                      row={row}
                      turnOnIntent={editing.turnOnIntent}
                      saving={mutatingKey === key}
                      error={rowError?.key === key ? rowError.error : undefined}
                      onDirtyChange={setEditorDirty}
                      onCancel={() => transitionTo(null)}
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
              // El humano ya contestó: el descarte se ejecuta por LA MISMA puerta que los otros tres
              // caminos, con `force`. ⛔ Nada de re-teclear aquí el cuerpo de la transición: era el
              // quinto sitio que tenía que acordarse de limpiar la suciedad y devolver el foco.
              onClick={() => transitionTo(discardAsk?.next ?? null, { force: true })}
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
    // §28.9: en móvil el encabezado de grupo es el **título de sección** de las tarjetas que siguen.
    // *«El eje sobrevive al colapso, que es lo único innegociable»* — por eso el bloque no se pliega
    // ni se esconde cuando la tabla deja de ser tabla.
    <tr role="row" className={cn('max-md:block', attention && 'border-l-2 border-accent')}>
      <th
        role="rowheader"
        scope="rowgroup"
        colSpan={7}
        className={cn('py-3 text-left max-md:block', attention ? 'pl-3' : '')}
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
 * Las cuatro celdas de CIFRAS (§28.9): a la derecha en la tabla, y bajo `md` una línea a lo ancho de
 * la tarjeta con el rótulo a la izquierda y el valor a la derecha.
 */
const CELL_STACKED =
  'py-3 pr-3 text-right font-mono tabular-nums ' +
  'max-md:col-span-2 max-md:flex max-md:items-baseline max-md:justify-between max-md:gap-3 max-md:py-1 max-md:pr-0';

/**
 * El rótulo de la columna, repetido DENTRO de la celda y visible **solo en móvil** (§28.9): cuando la
 * tabla se desploma, `PAGAMOS` y `TARIFA VIGENTE` se quedan sin cabecera que las nombre, y en esta
 * pantalla confundir esas dos cifras es confundir *lo que pagamos* con *lo que paga la tarifa*.
 *
 * `aria-hidden` porque **no es información nueva**: los roles explícitos conservan la semántica de
 * tabla también en móvil, así que el lector ya recibe el encabezado de columna. Sin esto, cada celda
 * se anunciaría dos veces.
 */
function CellLabel({ children }: { children: React.ReactNode }) {
  return (
    <span
      aria-hidden
      className="hidden font-mono text-[10px] uppercase tracking-[0.06em] text-muted max-md:inline"
    >
      {children}
    </span>
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
      role="row"
      className={cn(
        'border-b border-border align-top',
        'max-md:grid max-md:grid-cols-[minmax(0,1fr)_auto] max-md:gap-x-3 max-md:py-2',
        // §28.9 · la fila se vuelve una TARJETA: rejilla de dos columnas (carta | estado) y el resto
        // de los campos a lo ancho, cada uno con su rótulo. Prioridad de §28.9 respetada: no cae
        // ninguno —ni la tarifa ni el avance—, se apilan.
        attention && 'border-l-2 border-l-accent',
        row.state === 'apagada' && 'text-muted',
      )}
    >
      <td role="cell" className={cn('py-3 pr-3 max-md:py-1 max-md:pr-0', attention && 'pl-3')}>
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

      <td role="cell" className="py-3 pr-3 max-md:justify-self-end max-md:py-1 max-md:pr-0 max-md:text-right">
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
          decirlo con palabras: un guion no se lee (§28.10). ⚠️ §28.9: en móvil el hueco se pinta
          IGUAL, con su rótulo y su `—`; ⛔ jamás se omite la línea entera —esconderla convertiría
          «le falta el precio» en «no aplica». */}
      <td role="cell" className={CELL_STACKED}>
        <CellLabel>{t('col.pay')}</CellLabel>
        {priceCents != null ? (
          <span>{money(priceCents)}</span>
        ) : (
          <span {...(row.state === 'invalida' ? { 'aria-label': t('row.noPriceAria') } : {})}>
            {t('row.noPrice')}
          </span>
        )}
      </td>

      {/* TARIFA VIGENTE — `—` significa una cosa y solo una: **la curva no resuelve**. Nunca «está
          apagado»: una fila apagada trae su tarifa igual que una viva. */}
      <td role="cell" className={CELL_STACKED}>
        <CellLabel>{t('col.rate')}</CellLabel>
        {curveQuoteCents != null ? (
          <span>{money(curveQuoteCents)}</span>
        ) : (
          <span aria-label={t('premium.noRateAria')}>—</span>
        )}
      </td>

      <td role="cell" className={cn(CELL_STACKED, premium.kind === 'below' && 'text-accent')}>
        <CellLabel>{t('col.premium')}</CellLabel>
        {premium.kind === 'above' || premium.kind === 'below' ? (
          <span>
            {t(premium.kind === 'above' ? 'premium.above' : 'premium.below', {
              amount: money(premium.amountCents),
              pct: premium.pct.toFixed(1),
            })}
          </span>
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
      <td role="cell" className={CELL_STACKED}>
        <CellLabel>{t('col.progress')}</CellLabel>
        {targetQty == null ? (
          <span className="text-accent" aria-label={t('progress.noTargetAria')}>
            {t('progress.noTarget')}
          </span>
        ) : (
          <span className="max-md:text-right">
            {t('progress.value', { acquired: acquiredQty, target: targetQty })}
            <span className="block text-xs font-normal text-muted">
              {remainingQty === 0 ? t('progress.done') : t('progress.remaining', { n: remainingQty ?? 0 })}
            </span>
          </span>
        )}
      </td>

      <td role="cell" className="py-3 text-right max-md:col-span-2 max-md:py-2">
        <div className="flex flex-wrap justify-end gap-2 max-md:justify-between">
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

          {/* ⛔⛔ Un `state` DESCONOCIDO se queda en `Editar` + el enlace al binder, y **nada más**
              (§28.3): no se le ofrece ni `Apagar` ni `Encender`. *No sabemos qué significa ese
              estado, así que no sabemos qué hace apagarlo* — y el botón de apagar manda un `PUT` que
              mueve dinero. Es el mismo fallback neutro que ya rige su rótulo y su premium: cuando
              falta el dato, **no se afirma de más y tampoco se actúa de más**. */}
          {!known ? null : row.state === 'apagada' || row.state === 'completada' ? (
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
