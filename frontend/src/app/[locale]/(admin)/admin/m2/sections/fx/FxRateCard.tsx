'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { getFx, refreshFx, setFxMode, updateFx } from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import type { AppLocale } from '@/i18n/routing';
import type { FxDTO, FxRateMode, FxRefreshDTO } from '@/types/contract';
import { isKnownFxRefreshReason, isKnownFxSource } from '@/types/contract';
import { formatDate } from '@/lib/format';
import { Badge } from '@/components/ui/Badge';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useErrorMessage } from '@/components/ui/QueryState';
import { FxAckDialog, FxConfirmDialog } from './FxDialogs';
import { computeFxJump, formatBufferPct, formatRate } from './fx-format';

/**
 * ⭐⭐ **M2 › TIPO DE CAMBIO — la tarjeta de `DESIGN_SYSTEM §30`** (contrato `§M2-F`, v1.63.3).
 *
 * *«Quiero conservar el override manual, que sea un toggle para decidir entre automático o
 * manual»* — encargo textual del dueño. El backend lleva construido desde v1.63 y **no había forma
 * de usarlo desde la pantalla**: en todo `src/` no existía una sola llamada a `PUT /admin/fx/mode`.
 * Esto es esa tarjeta.
 *
 * ## Lo que gobierna cada decisión de aquí (§30.0)
 * **Mover este interruptor reprecia el catálogo entero, y al instante**: las referencias en USD se
 * convierten **en cada lectura** con la tasa vigente. **No hay ventana para arrepentirse** ⇒ todo
 * lo que el humano tiene que entender, tiene que entenderlo **antes** de tocar.
 *
 * Las seis reglas duras, tal como se aplican en este archivo:
 *  - **Las dos tasas, o no hay interruptor** (regla **del contrato**, §M2-F.3 regla 2): sin las dos
 *    en la mano el radiogroup **no es pulsable** — y el guardia está **en el handler**, no sólo en
 *    el atributo (§30.4, candado FX-UI-1).
 *  - **El modo lo dice el servidor**: se pinta `mode`; ⛔ jamás se infiere de que haya un número
 *    guardado. *Esa inferencia ERA el defecto.*
 *  - **El manual se conserva, siempre y a la vista**: pasar a automática no borra nada.
 *  - **El salto se enseña ANTES**, en reposo, sin abrir nada.
 *  - **El fallback no se llama manual**: rama propia, palabra propia, acento.
 *  - **Cada acción dice su resultado real**: el refresco tiene tres desenlaces y **un `200` no es
 *    un éxito**.
 *
 * ## ⭐ v1.63.3 y `applied`
 * `manual.applied` **ya no se deriva de `mode`, sino de `source`** ⇒ `mode: "manual"` con
 * `applied: false` **es alcanzable** (estado corrupto de la 4ª fila de §M2-F.1). Este componente
 * **obedece los dos `applied`** para marcar `RIGE` y para elegir el copy de «guardada»; ⛔ no
 * calcula ninguno de los dos, y ⛔ no da por hecho el arreglo pendiente de `FX-23` (se pinta lo que
 * el DTO diga, no lo que vaya a decir).
 *
 * ## ⛔ Lo que esta tarjeta NO hace
 * Editar el colchón (§30.1: se **muestra** y se dice dónde se cambia — el dial vive en **M10 ·
 * Ajustes**), historial, gráfica, cron, correo, aviso proactivo, y **nada de `Deshacer`** (§30.0).
 *
 * ## Rol
 * La tarjeta entera es de **`super_admin`** (§30.1). El gate es del módulo: `M2Page` envuelve todo
 * en `SuperAdminOnly`, así que aquí ⛔ no se re-implementa la comprobación (una segunda copia del
 * criterio de rol es una que puede discrepar).
 */

/** Lo que el `POST /admin/fx/refresh` devuelve de más; la caché guarda `FxStateDTO` a secas. */
function stripRefresh(dto: FxRefreshDTO): FxDTO {
  const { rate, bufferPct, source, effectiveDate, mode, modeResolvedFrom, manual, automatic } = dto;
  return { rate, bufferPct, source, effectiveDate, mode, modeResolvedFrom, manual, automatic };
}

/**
 * §30.4 caso 3 (**defensivo**; el contrato dice que estos dos bloques viajan SIEMPRE). Se
 * comprueba **en runtime** y no con el tipo: *una precondición que se desactiva sola cuando falta
 * el dato no es una precondición*. Si el DTO llega manco, la cifra grande sí se pinta (`rate` y
 * `source` son verdad) pero **el interruptor queda bloqueado y lo dice**.
 */
function hasBothRates(dto: FxDTO | undefined): boolean {
  if (!dto) return false;
  const manual = dto.manual as FxDTO['manual'] | undefined;
  const automatic = dto.automatic as FxDTO['automatic'] | undefined;
  return (
    !!manual &&
    typeof manual === 'object' &&
    'rate' in manual &&
    !!automatic &&
    typeof automatic === 'object' &&
    'rate' in automatic &&
    'status' in automatic
  );
}

/** El otro modo. Se usa para nombrar el destino del salto y el modo al que se puede volver. */
function otherMode(mode: FxRateMode): FxRateMode {
  return mode === 'manual' ? 'auto' : 'manual';
}

export function FxRateCard() {
  const t = useTranslations('admin.m2.fx');
  const tc = useTranslations('common');
  const locale = useLocale() as AppLocale;
  const qc = useQueryClient();
  const getError = useErrorMessage('operator');

  const fx = useQuery({ queryKey: ['admin-fx'], queryFn: getFx });
  const dto = fx.data;

  /** El editor inline de la tasa manual (§30.9c). En reposo la tarjeta ⛔ NO tiene formularios. */
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  /** Diálogo normal (§30.9a): cambio de modo, o cambio de la tasa manual **que rige**. */
  const [confirming, setConfirming] = useState<
    { kind: 'mode'; target: FxRateMode } | { kind: 'manualRate'; rate: number } | null
  >(null);
  /** Acuse (§30.8). `fallbackRate` lo NOMBRA el servidor: ⛔ nunca se escribe a mano. */
  const [ack, setAck] = useState<{ fallbackRate: number } | null>(null);
  /** El aviso persistente de §30.9b/§30.9c: vive hasta la siguiente acción, ⛔ no es un toast. */
  const [notice, setNotice] = useState<
    { kind: 'switched'; rate: number; source: string; previousMode: FxRateMode } | { kind: 'saved'; text: string } | null
  >(null);
  /** El foco vuelve al segmento que abrió el diálogo (§30.13). */
  const segmentRefs = useRef<Partial<Record<FxRateMode, HTMLButtonElement | null>>>({});

  function applyState(next: FxDTO) {
    // ⭐ La tarjeta se repinta con el `FxStateDTO` de LA RESPUESTA (§30.4): nada de pintar el
    // estado nuevo y corregirlo después con un segundo `GET`.
    qc.setQueryData(['admin-fx'], next);
  }

  const modeMutation = useMutation({
    mutationFn: setFxMode,
    /**
     * ⭐⭐ **El `422 FX_NO_AUTOMATIC_RATE` de la consulta SIN acuse no es un error que se le
     * enseñe al humano: es la precondición diciendo A QUÉ NÚMERO se saltaría.** Se consume aquí y
     * se convierte en el diálogo de §30.8 —⛔ sin la palabra «error», sin el código y sin el
     * `422`— con `details.fallbackRate` **tal cual lo nombró el servidor**.
     *
     * Si el acuse **ya viajaba** (la carrera real de §30.10: la fila de Banxico desaparece entre
     * el `GET` y el `PUT`), el error **sí** se pinta, traducido y en una línea.
     */
    onError: (error, variables) => {
      if (variables.acknowledgeNoAutomaticRate === true) return;
      if (!(error instanceof ApiClientError) || error.code !== 'FX_NO_AUTOMATIC_RATE') return;
      const fallbackRate = error.details?.fallbackRate;
      if (typeof fallbackRate !== 'number') return;
      setAck({ fallbackRate });
      modeMutation.reset();
    },
    onSuccess: (next, variables) => {
      applyState(next);
      setConfirming(null);
      setAck(null);
      setNotice({
        kind: 'switched',
        rate: next.rate,
        source: next.source,
        previousMode: otherMode(variables.mode),
      });
      segmentRefs.current[variables.mode]?.focus();
    },
  });

  const updateMutation = useMutation({
    mutationFn: (rate: number) => updateFx({ rate }),
    onSuccess: (next) => {
      applyState(next);
      setConfirming(null);
      setEditing(false);
      setDraft('');
      setNotice(savedNotice(next));
    },
  });

  const refreshMutation = useMutation({
    mutationFn: refreshFx,
    onSuccess: (next) => {
      applyState(stripRefresh(next));
      // §30.8: si el refresco trae tasa, el acuse **sobra** — el humano vuelve a decidir con dos
      // números reales delante. El diálogo se cierra solo.
      if (next.automatic?.status !== 'missing') setAck(null);
    },
  });

  /**
   * ⭐ El copy de «guardada» sale de **`applied`**, no del `mode` (v1.63.3) y no de «hubo un `200`».
   * *Ésta es la deuda que arrastraba el panel viejo:* decía «Tipo de cambio actualizado» **también
   * en modo `auto`**, donde el número guardado **no rige** (I-FX2/I-FX5).
   *
   * ⚠️ **Y hay un tercer estado sin copy, así que se calla en vez de inventarlo**: guardar una tasa
   * cuando **ni el manual ni Banxico rigen** (`source: "fallback"`). `manual.savedNotRuling` dice
   * *«seguimos en automática ({rate} de Banxico)»* y ahí **no hay ninguna tasa de Banxico que
   * nombrar**. La mitad visual del mensaje sí se da (la columna MANUAL se repinta con el número
   * nuevo, **sin** `RIGE`). Variante pedida a ux-ui; ⛔ no se sustituye por el respaldo, que es un
   * número de otra procedencia.
   */
  function savedNotice(next: FxDTO): { kind: 'saved'; text: string } | null {
    if (next.manual?.applied) return { kind: 'saved', text: t('manual.savedRuling', { rate: formatRate(next.rate) }) };
    if (next.automatic?.applied && next.automatic.rate != null) {
      return { kind: 'saved', text: t('manual.savedNotRuling', { rate: formatRate(next.automatic.rate) }) };
    }
    return null;
  }

  // ── Estados de la tarjeta (§30.11) ─────────────────────────────────────────────────────────
  const loading = fx.isPending;
  const loadFailed = fx.isError || (!loading && !dto);
  const dtoIncomplete = !!dto && !hasBothRates(dto);
  /** ⛔ El interruptor NO es pulsable en cuatro casos, y el primero es la regla del contrato. */
  const toggleBlock: 'loading' | 'error' | 'incomplete' | null = loading
    ? 'loading'
    : loadFailed
      ? 'error'
      : dtoIncomplete
        ? 'incomplete'
        : null;
  const toggleDisabled = toggleBlock !== null;

  // ── Fuente de la cifra grande (§30.5). Es un MAPA, no una derivación ───────────────────────
  const sourceKnown = dto ? isKnownFxSource(dto.source) : false;
  const sourceLabel = dto ? (sourceKnown ? t(`source.${dto.source}`) : t('source.unknown')) : '';
  const sourceBody = dto
    ? sourceKnown
      ? dto.source === 'fallback'
        ? t('source.fallbackBody')
        : dto.source === 'banxico'
          ? t('source.banxicoBody', { date: formatDate(dto.effectiveDate, locale) })
          : t('source.manualBody')
      : t('source.unknownBody')
    : '';

  // ── El salto, en reposo (§30.3c) ───────────────────────────────────────────────────────────
  // `destino` = la tasa que regiría tras el cambio de MODO. ⛔ Si no existe, no se calcula ningún
  // salto: **prohibido componerlo contra el valor de respaldo** en la tarjeta en reposo.
  const jumpTarget = dto ? (dto.mode === 'manual' ? dto.automatic?.rate ?? null : dto.manual?.rate ?? null) : null;
  const targetIsMissingBanxico = !!dto && dto.mode === 'manual' && dto.automatic?.status === 'missing';
  const jump = dto && !dtoIncomplete && !targetIsMissingBanxico ? computeFxJump(dto.rate, jumpTarget) : null;

  // ── El refresco: TRES desenlaces, y un `200` no es un éxito (§30.7) ─────────────────────────
  const refreshed = refreshMutation.data;
  const refresh = refreshed?.refresh;
  /**
   * ⚠️ **Un desenlace bueno tiene que traer SU cifra.** Si `outcome` es `updated`/`unchanged` pero
   * `fetchedRate` no es un número, la pantalla **no puede decir qué devolvió Banxico** — y ⛔ no
   * sustituye ese hueco por la tasa que rige, que en modo manual es **un número de otra
   * magnitud**. Sin cifra que afirmar, se pinta el fallo con el motivo neutro.
   */
  const refreshSucceeded =
    (refresh?.outcome === 'updated' || refresh?.outcome === 'unchanged') && typeof refresh.fetchedRate === 'number';
  const refreshFailed = refreshMutation.isSuccess && !refreshSucceeded;
  const refreshReasonKey =
    refresh?.reason != null && isKnownFxRefreshReason(refresh.reason)
      ? `refresh.reason.${refresh.reason}`
      : 'refresh.reason.unknown';

  // ── Acciones ───────────────────────────────────────────────────────────────────────────────

  /**
   * ⭐⭐ El clic del interruptor. **El guardia vive aquí**, no sólo en el atributo `disabled`: un
   * `aria-disabled` sobre un botón que sigue disparando su `onClick` es exactamente la mutación
   * que el candado FX-UI-1 caza contando peticiones.
   */
  function chooseMode(next: FxRateMode) {
    if (toggleDisabled || !dto) return;
    // Pulsar el segmento ya activo no hace nada: no hay acto que confirmar.
    if (next === dto.mode) return;
    // §30.4 caso 4: sin tasa manual guardada, ese segmento no se ofrece (evita el viaje al 422).
    if (next === 'manual' && dto.manual?.rate == null) return;
    setNotice(null);
    if (next === 'auto' && dto.automatic?.status === 'missing') {
      // §30.8: el acuse necesita NOMBRAR el número al que se saltaría, y ese número **lo pone el
      // servidor** (`details.fallbackRate` del `422`). Se pide **sin** el acuse: por contrato esa
      // llamada **no cambia el modo** —es la precondición contestando, no un cambio a medias— y
      // ⛔ es la única forma de no hornear el `18` en una cadena.
      modeMutation.mutate({ mode: 'auto' });
      return;
    }
    setConfirming({ kind: 'mode', target: next });
  }

  function saveManualRate() {
    const rate = Number(draft);
    if (draft.trim() === '' || !Number.isFinite(rate) || rate <= 0 || !dto) return;
    setNotice(null);
    // §30.9c: si el número que se guarda **rige**, mueve el catálogo igual que el interruptor ⇒
    // confirma. Si no rige, se guarda sin diálogo y se dice que **todavía no rige**.
    if (dto.manual?.applied) setConfirming({ kind: 'manualRate', rate });
    else updateMutation.mutate(rate);
  }

  function cancelDialogs() {
    // ⛔ Nada se movió y no salió ninguna petición. El foco vuelve a donde estaba.
    const target = confirming?.kind === 'mode' ? confirming.target : null;
    setConfirming(null);
    setAck(null);
    if (target) segmentRefs.current[target]?.focus();
  }

  // ── Render ─────────────────────────────────────────────────────────────────────────────────

  const bigRate = dto && !loadFailed ? formatRate(dto.rate) : '—';
  const manualRate = dto?.manual?.rate ?? null;
  const automatic = dto?.automatic;
  const freshnessKey = automatic
    ? automatic.status === 'fresh'
      ? 'auto.fresh'
      : automatic.status === 'stale'
        ? 'auto.stale'
        : 'auto.missing'
    : null;

  return (
    <section className="flex flex-col gap-3" aria-labelledby="fx-card-title">
      <p className="eyebrow">{t('eyebrow')}</p>
      <h2 id="fx-card-title" className="font-serif text-h2">
        {t('title')}
      </h2>
      <p className="max-w-2xl text-sm text-muted">{t('lead')}</p>
      <hr className="border-border" />

      {/* ── Error de carga (§30.11): ⛔ la tarjeta NO pinta ninguna cifra. Media tarjeta de tipo
          de cambio es peor que ninguna, porque parece autoritativa. ─────────────────────────── */}
      {loadFailed && (
        <div id="fx-load-error">
        <Banner
          variant="danger"
          role="alert"
          title={tc('errorTitle')}
          action={
            <Button size="sm" variant="secondary" onClick={() => fx.refetch()}>
              {tc('retry')}
            </Button>
          }
        >
          {fx.error ? getError(fx.error) : t('error.load')}
        </Banner>
        </div>
      )}

      {!loadFailed && (
        <>
          {/* ── 1 · RIGE AHORA + la cifra grande + su FUENTE (§30.2 pieza 1) ───────────────── */}
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div>
              <p className="eyebrow">{t('current.label')}</p>
              <p
                data-testid="fx-current"
                className="tabular font-mono text-[22px] leading-tight sm:text-[26px]"
                aria-label={
                  dto ? t('current.aria', { rate: bigRate, source: sourceLabel }) : undefined
                }
              >
                {bigRate}
              </p>
              <p className="text-xs text-muted">{t('current.unit')}</p>
              {dto && (
                <p className="mt-2 flex items-center gap-2">
                  <span className="eyebrow">{t('source.label')}</span>
                  <Badge
                    data-testid="fx-source"
                    tone={dto.source === 'fallback' ? 'accent' : sourceKnown ? 'primary' : 'neutral'}
                    shape="soft"
                  >
                    {sourceLabel}
                  </Badge>
                </p>
              )}
            </div>
            {/* El colchón: contexto obligatorio y de SOLO LECTURA (§30.3d). ⛔ Sin campo y sin
                botón de guardar: el dial se edita en Ajustes (M10). */}
            <div className="max-w-xs">
              <p className="eyebrow">{t('buffer.label')}</p>
              <p className="tabular font-mono text-sm">{dto ? formatBufferPct(dto.bufferPct) : '—'}</p>
              <p className="mt-1 text-xs text-muted">{t('buffer.hint')}</p>
            </div>
          </div>

          {/* La fuente se EXPLICA, no se etiqueta y ya (§30.5). `fallback` va en acento y no lleva
              botón de «Entendido»: no es un aviso que se descarta, es un estado que se arregla —
              y las dos palancas que lo arreglan (`manual.create` y `refresh.cta`) están justo
              debajo, en sus columnas. ⛔ No se duplican aquí. */}
          {dto && (
            <p className={dto.source === 'fallback' ? 'max-w-3xl text-sm text-accent' : 'max-w-3xl text-sm text-muted'}>
              {sourceBody}
            </p>
          )}

          <hr className="border-border-strong" />

          {/* ── 2 · LAS DOS TASAS LADO A LADO (§30.3) ─────────────────────────────────────────
              Van en una `<dl>` para que la pareja EXISTA para el lector de pantalla, no sólo para
              el ojo. En móvil se apilan en orden FIJO —MANUAL, luego AUTOMÁTICA—: ⛔ la que rige
              NO se sube arriba, o la posición sería un canal más que contradice a los otros. */}
          <dl className="grid gap-6 sm:grid-cols-2">
            {/* Columna MANUAL */}
            <div data-testid="fx-manual" className={dto?.manual?.applied ? 'border-l-2 border-text pl-4' : 'pl-4'}>
              <dt className="eyebrow">{t('manual.label')}</dt>
              <dd className="mt-1 flex flex-col gap-1">
                <span className="flex flex-wrap items-baseline gap-3">
                  {loading ? (
                    <span className="inline-block h-5 w-24 animate-pulse bg-surface-2" aria-hidden />
                  ) : (
                    <span className="tabular font-mono text-xl">
                      {manualRate != null ? formatRate(manualRate) : t('manual.none')}
                    </span>
                  )}
                  {/* `RIGE` va en TINTA + regla de 2px: palabra y forma, ⛔ nunca el color como
                      canal portador. Y se OBEDECE `applied`: ⛔ no se calcula desde `mode`. */}
                  {dto?.manual?.applied && (
                    <Badge tone="primary" shape="soft" title={t('ruling.markAria')}>
                      {t('ruling.mark')}
                    </Badge>
                  )}
                </span>
                {/* La segunda línea sólo afirma lo que es cierto: con el número guardado pero SIN
                    regir, §30.15 no tiene cadena («La guardaste tú.» no existe como clave suelta)
                    ⇒ se calla en vez de decir que rige. Pedida a ux-ui. */}
                {dto && manualRate == null && <span className="text-xs text-muted">{t('manual.noneBody')}</span>}
                {dto?.manual?.applied && <span className="text-xs text-muted">{t('source.manualBody')}</span>}
                {dto && !editing && (
                  <span>
                    <Button size="sm" variant="secondary" onClick={() => {
                      setNotice(null);
                      // ⛔ NO se prellena con la de Banxico ni con «Banxico + algo»: la tasa manual
                      // es SIEMPRE explícita. Con el valor guardado si lo hay; vacío si no.
                      setDraft(manualRate != null ? formatRate(manualRate) : '');
                      setEditing(true);
                    }}>
                      {manualRate != null ? t('manual.edit') : t('manual.create')}
                    </Button>
                  </span>
                )}
              </dd>
            </div>

            {/* Columna AUTOMÁTICA · BANXICO */}
            <div data-testid="fx-automatic" className={dto?.automatic?.applied ? 'border-l-2 border-text pl-4' : 'pl-4'}>
              <dt className="eyebrow">{t('auto.label')}</dt>
              <dd className="mt-1 flex flex-col gap-1">
                <span className="flex flex-wrap items-baseline gap-3">
                  {loading ? (
                    <span className="inline-block h-5 w-24 animate-pulse bg-surface-2" aria-hidden />
                  ) : (
                    <span className="tabular font-mono text-xl">
                      {automatic?.rate != null ? formatRate(automatic.rate) : t('auto.missing')}
                    </span>
                  )}
                  {/* La frescura la DERIVA EL SERVIDOR y la pantalla la obedece: se pinta `status`.
                      ⛔ Nada de `ageDays > 5` en el navegador, y el umbral ⛔ no se escribe en
                      ninguna cadena. `AL DÍA` va en TINTA: el caso normal no grita. */}
                  {freshnessKey && (
                    <Badge tone={automatic?.status === 'fresh' ? 'primary' : 'accent'} shape="soft">
                      {t(freshnessKey)}
                    </Badge>
                  )}
                  {dto?.automatic?.applied && (
                    <Badge tone="primary" shape="soft" title={t('ruling.markAria')}>
                      {t('ruling.mark')}
                    </Badge>
                  )}
                </span>
                {automatic?.rate != null && automatic.effectiveDate && automatic.ageDays != null && (
                  <span className="text-xs text-muted">
                    {t('auto.dated', { date: formatDate(automatic.effectiveDate, locale), n: automatic.ageDays })}
                  </span>
                )}
                {automatic?.status === 'stale' && <span className="text-xs text-accent">{t('auto.staleBody')}</span>}
                {automatic?.status === 'missing' && <span className="text-xs text-accent">{t('auto.missingBody')}</span>}
                {dto && (
                  <span className="flex flex-col gap-1">
                    <span>
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={refreshMutation.isPending}
                        onClick={() => {
                          setNotice(null);
                          refreshMutation.mutate();
                        }}
                      >
                        {refreshMutation.isPending ? t('refresh.loading') : t('refresh.cta')}
                      </Button>
                    </span>
                    <span className="text-xs text-muted">{t('refresh.ctaHint')}</span>
                  </span>
                )}
              </dd>
            </div>
          </dl>

          {/* ── El editor inline de la tasa manual (§30.9c) ───────────────────────────────────
              Se entra por un acto explícito: en reposo la tarjeta NO tiene formularios. */}
          {editing && (
            <div className="flex flex-wrap items-end gap-3 border-l border-border-strong pl-4">
              <Input
                label={t('manual.field')}
                hint={t('manual.fieldHint')}
                type="text"
                inputMode="decimal"
                className="w-40"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
              <Button variant="primary" loading={updateMutation.isPending} onClick={saveManualRate}>
                {tc('save')}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setEditing(false);
                  setDraft('');
                }}
              >
                {tc('cancel')}
              </Button>
            </div>
          )}

          <hr className="border-border" />

          {/* ── 3 · EL SALTO (§30.3c) ────────────────────────────────────────────────────────── */}
          <div data-testid="fx-jump">
            <p className="eyebrow">{dto?.mode === 'manual' ? t('jump.toAuto') : t('jump.toManual')}</p>
            {jump ? (
              jump.isZero ? (
                <p className="text-sm">{t('jump.none')}</p>
              ) : (
                <>
                  <p className="tabular font-mono text-sm">
                    {t('jump.value', { delta: jump.deltaText, pct: jump.pctText })}
                  </p>
                  <p className="max-w-3xl text-xs text-muted">{t('jump.body')}</p>
                </>
              )
            ) : (
              <p className="max-w-3xl text-sm text-muted">{t('jump.unavailable')}</p>
            )}
          </div>

        </>
      )}

      {/* ── 4 · EL INTERRUPTOR (§30.4). Va el ÚLTIMO a propósito: se toca DESPUÉS de haber
          leído las dos tasas y el salto. El orden de lectura es el orden de la decisión. ── */}
      <div>
        <p className="eyebrow" id="fx-toggle-label">
          {t('toggle.label')}
        </p>
        <div
          role="radiogroup"
          aria-label={t('toggle.label')}
          aria-busy={loading || undefined}
          aria-describedby={
            toggleBlock === 'loading'
              ? 'fx-toggle-reason'
              : toggleBlock === 'incomplete'
                ? 'fx-toggle-reason'
                : toggleBlock === 'error'
                  ? 'fx-load-error'
                  : 'fx-toggle-consequence'
          }
          className="mt-2 flex w-full max-w-sm"
        >
          {(['manual', 'auto'] as const).map((option) => {
            const checked = dto?.mode === option;
            const noManual = option === 'manual' && dto?.manual?.rate == null;
            const disabled = toggleDisabled || noManual;
            return (
              <button
                key={option}
                ref={(el) => {
                  segmentRefs.current[option] = el;
                }}
                type="button"
                role="radio"
                aria-checked={!!checked}
                disabled={disabled}
                onClick={() => chooseMode(option)}
                className={`min-h-[44px] flex-1 border px-4 font-mono text-[11px] uppercase tracking-[0.06em] transition-colors ${
                  checked ? 'border-text bg-text text-primary-fg' : 'border-border text-text hover:border-text'
                } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
              >
                {t(`toggle.${option}`)}
              </button>
            );
          })}
        </div>
        {/* ⛔ Ningún deshabilitado es mudo: cada uno lleva SU frase visible. Un control apagado
            sin motivo se lee como una avería y produce un tique. */}
        {toggleBlock === 'loading' && (
          <p id="fx-toggle-reason" className="mt-2 text-xs text-muted">
            {t('toggle.loadingReason')}
          </p>
        )}
        {toggleBlock === 'incomplete' && (
          <p id="fx-toggle-reason" className="mt-2 text-xs text-accent">
            {t('toggle.blockedReason')}
          </p>
        )}
        {!toggleDisabled && dto?.manual?.rate == null && (
          <p className="mt-2 text-xs text-muted">{t('toggle.noManualReason')}</p>
        )}
        <p id="fx-toggle-consequence" className="mt-2 max-w-3xl text-xs text-muted">
          {t('toggle.consequence')}
        </p>
        {/* `modeResolvedFrom: "legacy"` se DICE, y se dice en muted: en un entorno recién
            desplegado es el estado normal. Pero se dice SIEMPRE, porque es la única traza
            visible de que el modo no está fijado por nadie. ⛔ Ni acento ni `role="alert"`. */}
        {dto?.modeResolvedFrom === 'legacy' && (
          <p className="mt-3 max-w-3xl text-xs text-muted">
            <span className="eyebrow">{t('mode.legacyLabel')}</span> {t('mode.legacyBody')}
          </p>
        )}
      </div>

      {!loadFailed && (
        <>
          {/* ── Avisos de resultado ──────────────────────────────────────────────────────────── */}

          {/* §30.9b — «ahora rige X». ⛔ NADA de `Deshacer`: volver es un SEGUNDO repreciado, no
              una anulación, y lo que se vendió en medio ya está sellado. */}
          {notice?.kind === 'switched' && (
            <p role="status" className="text-sm">
              {t('switched', {
                rate: formatRate(notice.rate),
                source: isKnownFxSource(notice.source) ? t(`source.${notice.source}`) : t('source.unknown'),
                previousMode: notice.previousMode === 'manual' ? t('mode.manualWord') : t('mode.autoWord'),
              })}
            </p>
          )}
          {notice?.kind === 'saved' && (
            <p role="status" className="text-sm">
              {notice.text}
            </p>
          )}

          {/* El refresco (§30.7): `updated` y `unchanged` avisan lo que pasó DE VERDAD. ⛔ Ningún
              mensaje de éxito antes de leer `refresh.outcome`, y ⛔ sin el verde de éxito (§30.14:
              no aparece en esta tarjeta). */}
          {refreshed && refreshSucceeded && refresh?.outcome === 'updated' && (
            <Banner variant="info" role="status">
              {t('refresh.updated', { rate: formatRate(refresh.fetchedRate as number) })}
              {/* En modo manual el refresco NO cambia cuál rige: sólo la cifra de comparación. */}
              {refreshed.manual?.applied && refreshed.manual.rate != null && (
                <> {t('refresh.updatedWhileManual', { rate: formatRate(refreshed.manual.rate) })}</>
              )}
            </Banner>
          )}
          {refreshed && refreshSucceeded && refresh?.outcome === 'unchanged' && (
            <Banner variant="info" role="status">
              {t('refresh.unchanged', { rate: formatRate(refresh.fetchedRate as number) })}
            </Banner>
          )}
          {/* `failed` (o desenlace ilegible) ⇒ `Banner danger` PERSISTENTE con `role="alert"`, su
              motivo traducido y `Reintentar`. Es el resultado inmediato de un botón que el humano
              acaba de pulsar y que NO hizo lo que decía. El resto de la tarjeta sigue viva. */}
          {refreshFailed && refreshed && (
            <Banner
              variant="danger"
              role="alert"
              title={t('refresh.failedTitle')}
              action={
                <Button
                  size="sm"
                  variant="secondary"
                  loading={refreshMutation.isPending}
                  onClick={() => refreshMutation.mutate()}
                >
                  {tc('retry')}
                </Button>
              }
            >
              <p>
                {t('refresh.failedBody', {
                  rate: formatRate(refreshed.rate),
                  source: isKnownFxSource(refreshed.source) ? t(`source.${refreshed.source}`) : t('source.unknown'),
                })}
              </p>
              <p>{t(refreshReasonKey)}</p>
            </Banner>
          )}

          {/* Los errores del contrato, traducidos y **inline** (§30.10 · §7.5: nunca en toast para
              errores de dinero). El código crudo y el `422` ⛔ no se enseñan. */}
          {modeMutation.isError && (
            <Banner variant="danger" role="alert" title={tc('errorTitle')}>
              {getError(modeMutation.error)}
            </Banner>
          )}
          {updateMutation.isError && (
            <Banner variant="danger" role="alert" title={tc('errorTitle')}>
              {getError(updateMutation.error)}
            </Banner>
          )}
          {refreshMutation.isError && (
            <Banner variant="danger" role="alert" title={tc('errorTitle')}>
              {getError(refreshMutation.error)}
            </Banner>
          )}
        </>
      )}

      <p className="text-xs text-muted">{t('footer')}</p>

      {/* ── Los dos diálogos ──────────────────────────────────────────────────────────────── */}
      {dto && confirming?.kind === 'mode' && (
        <FxConfirmDialog
          open
          before={dto.rate}
          sourceBefore={sourceLabel}
          after={confirming.target === 'manual' ? (dto.manual.rate as number) : (dto.automatic.rate as number)}
          sourceAfter={confirming.target === 'manual' ? t('source.manual') : t('source.banxico')}
          pct={
            computeFxJump(
              dto.rate,
              confirming.target === 'manual' ? dto.manual.rate : dto.automatic.rate,
            )?.pct ?? 0
          }
          stale={
            confirming.target === 'auto' &&
            dto.automatic.status === 'stale' &&
            dto.automatic.effectiveDate != null &&
            dto.automatic.ageDays != null
              ? { date: formatDate(dto.automatic.effectiveDate, locale), ageDays: dto.automatic.ageDays }
              : null
          }
          loading={modeMutation.isPending}
          onCancel={cancelDialogs}
          onConfirm={() => modeMutation.mutate({ mode: confirming.target })}
        />
      )}
      {dto && confirming?.kind === 'manualRate' && (
        <FxConfirmDialog
          open
          before={dto.rate}
          sourceBefore={sourceLabel}
          after={confirming.rate}
          sourceAfter={t('source.manual')}
          pct={computeFxJump(dto.rate, confirming.rate)?.pct ?? 0}
          loading={updateMutation.isPending}
          onCancel={() => setConfirming(null)}
          onConfirm={() => updateMutation.mutate(confirming.rate)}
        />
      )}
      {dto && ack && (
        <FxAckDialog
          open
          currentRate={dto.rate}
          fallbackRate={ack.fallbackRate}
          pct={computeFxJump(dto.rate, ack.fallbackRate)?.pct ?? 0}
          loading={modeMutation.isPending && modeMutation.variables?.acknowledgeNoAutomaticRate === true}
          refreshing={refreshMutation.isPending}
          onRefresh={() => refreshMutation.mutate()}
          onCancel={cancelDialogs}
          onConfirm={() => modeMutation.mutate({ mode: 'auto', acknowledgeNoAutomaticRate: true })}
        />
      )}
    </section>
  );
}
