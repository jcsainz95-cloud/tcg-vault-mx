'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { getPricingCurve, updatePricingCurve } from '@/lib/api';
import type { PricingCurveDTO } from '@/types/contract';
import type { AppLocale } from '@/i18n/routing';
import { formatMoneyCents } from '@/lib/format';
import { useRole } from '@/lib/role';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { QueryState, useErrorMessage } from '@/components/ui/QueryState';
import { CurvePointsTable } from './CurvePointsTable';
import { CurvePreview } from './CurvePreview';
import { CurveDiffDialog } from './CurveDiffDialog';
import { RoundingLadderTable } from './RoundingLadderTable';
import { useCurvePreview } from './useCurvePreview';
import {
  centsToPesos,
  curveViolationFromError,
  diffCurve,
  draftFromCurve,
  duplicateMarketKeys,
  marketError,
  multiplierError,
  nextKey,
  pctError,
  pesosToCents,
  sanitizeDecimal,
  sortByMarket,
  stepError,
  toPreviewCurve,
  toSaveCurve,
  uptoError,
  violationMarkets,
  type BandRow,
  type CurveAxis,
  type CurveDraft,
  type CurveViolation,
  type FieldErrorCode,
  type PointRow,
} from './curve-draft';

interface RemovedPoint {
  axis: CurveAxis;
  index: number;
  row: PointRow;
}

/**
 * M2 › **Curva de precio** (DESIGN_SYSTEM §21.1–§21.6). Reemplaza, en el mismo lugar, a los cuatro
 * editores retirados (reglas de buylist, reglas de venta, precios por tier y mapa rareza→tier).
 * Consume `GET`/`PUT /admin/pricing/curve` y `POST /admin/pricing/curve/preview`.
 *
 * Cuatro decisiones que vienen del sesgo de error de PROJECT §N.0 (*precio de más = venta perdida,
 * recuperable; precio de menos = carta perdida, irrecuperable*):
 *   (a) **nada se guarda solo** — la pantalla es un borrador con guardado explícito y diff confirmable;
 *   (b) **el previsualizador es obligatorio**, porque una tabla de puntos no dice cuánto sale una carta;
 *   (c) **el error no interrumpe mientras se teclea**, para que nadie aprenda a ignorarlo;
 *   (d) **lo que dejó de aplicar se dice, no se calla**.
 *
 * Y una regla dura de §21.4: el editor **NO reimplementa los invariantes cruzados** para adelantarse
 * al `422`. Si el cliente inventara un rechazo que el servidor no haría, el dueño dejaría de confiar
 * en la pantalla — y la autoridad del dinero es el backend (SEC-A1).
 */
export function PricingCurveSection() {
  const t = useTranslations('admin.m2.curve');
  const tc = useTranslations('common');
  const locale = useLocale() as AppLocale;
  const qc = useQueryClient();
  const getError = useErrorMessage();
  const { isSuperAdmin } = useRole();

  const curve = useQuery({ queryKey: ['pricing-curve'], queryFn: getPricingCurve });

  const [draft, setDraft] = useState<CurveDraft | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, FieldErrorCode | undefined>>({});
  const [violation, setViolation] = useState<CurveViolation | null>(null);
  const [removed, setRemoved] = useState<RemovedPoint[]>([]);
  const [highlightKey, setHighlightKey] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [announce, setAnnounce] = useState('');
  const [probeRaw, setProbeRaw] = useState('50.00');
  const [diffOpen, setDiffOpen] = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  const [fieldWarning, setFieldWarning] = useState(false);
  const [prefill, setPrefill] = useState<{ axis: CurveAxis; key: string; marketCents: number } | null>(
    null,
  );
  const summaryRef = useRef<HTMLDivElement>(null);

  const saved = curve.data;

  // Semilla del borrador con la respuesta del servidor. Tras un `PUT 200` el editor se RE-SIEMBRA
  // con lo que devolvió el servidor, nunca con su propio borrador (§21.5d-2).
  useEffect(() => {
    if (saved) setDraft(draftFromCurve(saved));
  }, [saved]);

  const previewCurve = useMemo(() => (draft ? toPreviewCurve(draft) : null), [draft]);
  const saveCurve = useMemo(() => (draft ? toSaveCurve(draft) : null), [draft]);

  const probeCents = pesosToCents(probeRaw);
  const extraMarkets = useMemo(() => {
    const list: number[] = [];
    for (const row of draft?.sale ?? []) {
      const c = pesosToCents(row.marketRaw);
      if (c != null) list.push(c);
    }
    for (const row of draft?.buy ?? []) {
      const c = pesosToCents(row.marketRaw);
      if (c != null) list.push(c);
    }
    if (probeCents != null) list.push(probeCents);
    return list;
  }, [draft, probeCents]);

  const preview = useCurvePreview(previewCurve, extraMarkets);

  // Prerrelleno neutro (§21.2b): el valor del punto nuevo sale del dry-run — es la interpolación
  // que el SERVIDOR hace de la curva actual en ese mercado, no una cuenta del cliente. Un punto
  // colocado sobre la curva vigente no cambia NINGÚN precio.
  useEffect(() => {
    if (!prefill) return;
    const row = preview.byMarket.get(prefill.marketCents);
    if (!row) return;
    const leg = row.draft[prefill.axis];
    if (leg.appliedBp == null) return;
    const value =
      prefill.axis === 'sale'
        ? (leg.appliedBp / 10000).toFixed(2)
        : String(Math.round(leg.appliedBp) / 100);
    setDraft((d) => {
      if (!d) return d;
      const rows = d[prefill.axis].map((r) =>
        r.key === prefill.key && r.valueRaw.trim() === ''
          ? { ...r, valueRaw: value, prefilledNeutral: true }
          : r,
      );
      return { ...d, [prefill.axis]: sortByMarket(rows) };
    });
    setPrefill(null);
  }, [prefill, preview.byMarket]);

  const diff = useMemo(
    () => (saved && saveCurve ? diffCurve(saved, saveCurve) : []),
    [saved, saveCurve],
  );
  const hasFieldErrors = Object.values(fieldErrors).some(Boolean);
  const dupeSale = useMemo(() => duplicateMarketKeys(draft?.sale ?? []), [draft]);
  const dupeBuy = useMemo(() => duplicateMarketKeys(draft?.buy ?? []), [draft]);
  const incomplete = draft != null && saveCurve == null;
  const dirty = diff.length > 0 || incomplete || dupeSale.size > 0 || dupeBuy.size > 0;

  const savedSaleByMarket = useMemo(
    () => new Map((saved?.sale.points ?? []).map((p) => [p.marketCents, p.multiplierBp])),
    [saved],
  );
  const savedBuyByMarket = useMemo(
    () => new Map((saved?.buy.points ?? []).map((p) => [p.marketCents, p.pctBp])),
    [saved],
  );

  const offendingMarkets = useMemo(
    () => new Set(violation ? violationMarkets(violation) : []),
    [violation],
  );
  const offendingKeys = useCallback(
    (rows: PointRow[], axis: CurveAxis) => {
      const set = new Set<string>();
      if (!violation) return set;
      if (violation.details.axis && violation.details.axis !== axis) return set;
      for (const row of rows) {
        const c = pesosToCents(row.marketRaw);
        if (c != null && offendingMarkets.has(c)) set.add(row.key);
      }
      return set;
    },
    [violation, offendingMarkets],
  );

  const mutation = useMutation({
    mutationFn: (payload: PricingCurveDTO) => updatePricingCurve(payload),
    onSuccess: (res) => {
      setDiffOpen(false);
      setViolation(null);
      setRemoved([]);
      setFieldErrors({});
      setSavedOk(true);
      setDraft(draftFromCurve(res));
      qc.setQueryData(['pricing-curve'], res);
      // El efecto se ve sin recargar: el precio se resuelve en LECTURA, no está persistido.
      qc.invalidateQueries({ queryKey: ['pending-prices'] });
      qc.invalidateQueries({ queryKey: ['master-set-binder'] });
      qc.invalidateQueries({ queryKey: ['master-sets'] });
    },
    onError: (err) => {
      setDiffOpen(false);
      setSavedOk(false);
      setViolation(curveViolationFromError(err));
    },
  });

  // Salir con cambios sin guardar dispara confirmación: es dinero, el descarte silencioso no es
  // una opción (§21.6a).
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  useEffect(() => {
    if (violation) summaryRef.current?.focus();
  }, [violation]);

  useEffect(() => {
    if (!highlightKey) return;
    const id = setTimeout(() => setHighlightKey(null), 1200);
    return () => clearTimeout(id);
  }, [highlightKey]);

  if (!isSuperAdmin) return null;

  // --- mutadores del borrador -------------------------------------------------

  function patchRow(axis: CurveAxis, key: string, field: 'market' | 'value', raw: string) {
    setSavedOk(false);
    setFieldWarning(false);
    setFieldErrors((e) => ({ ...e, [`${key}:${field}`]: undefined }));
    // Editar una fila marcada BORRA su marca (optimismo local, §21.4d). El resumen permanece
    // hasta el siguiente intento de guardar.
    setDraft((d) =>
      d
        ? {
            ...d,
            [axis]: d[axis].map((r) =>
              r.key === key
                ? {
                    ...r,
                    prefilledNeutral: false,
                    [field === 'market' ? 'marketRaw' : 'valueRaw']: raw,
                  }
                : r,
            ),
          }
        : d,
    );
  }

  function blurRow(axis: CurveAxis, key: string, field: 'market' | 'value') {
    setDraft((d) => {
      if (!d) return d;
      const rows = d[axis];
      const row = rows.find((r) => r.key === key);
      if (!row) return d;
      const err =
        field === 'market'
          ? marketError(row.marketRaw)
          : axis === 'sale'
            ? multiplierError(row.valueRaw)
            : pctError(row.valueRaw);
      setFieldErrors((e) => ({ ...e, [`${key}:${field}`]: err ?? undefined }));

      if (field !== 'market') return d;
      const marketCents = pesosToCents(row.marketRaw);
      // Un punto nuevo con el mercado confirmado y sin valor se prerrellena con la interpolación
      // vigente: agregar un punto es NEUTRO por construcción.
      if (marketCents != null && row.valueRaw.trim() === '') {
        setPrefill({ axis, key, marketCents });
      }
      // La tabla reordena AL BLUR, nunca mientras se teclea (§21.2a).
      const sorted = sortByMarket(rows);
      const before = rows.findIndex((r) => r.key === key);
      const after = sorted.findIndex((r) => r.key === key);
      if (before !== after) {
        setHighlightKey(key);
        setAnnounce(
          t('point.reorderAnnounce', {
            market: marketCents != null ? formatMoneyCents(marketCents, locale) : '',
            position: after + 1,
            total: sorted.length,
          }),
        );
      }
      return { ...d, [axis]: sorted };
    });
  }

  function addPoint(axis: CurveAxis) {
    setSavedOk(false);
    const key = nextKey(axis);
    setDraft((d) =>
      d ? { ...d, [axis]: [...d[axis], { key, marketRaw: '', valueRaw: '', isNew: true }] } : d,
    );
    setFocusKey(key);
  }

  function removePoint(axis: CurveAxis, key: string) {
    setSavedOk(false);
    setDraft((d) => {
      if (!d) return d;
      const index = d[axis].findIndex((r) => r.key === key);
      if (index < 0 || d[axis].length <= 1) return d;
      const row = d[axis][index];
      setRemoved((list) => [...list, { axis, index, row }].slice(-3));
      return { ...d, [axis]: d[axis].filter((r) => r.key !== key) };
    });
  }

  function undoRemove() {
    setDraft((d) => {
      if (!d) return d;
      const last = removed[removed.length - 1];
      if (!last) return d;
      const rows = [...d[last.axis]];
      rows.splice(Math.min(last.index, rows.length), 0, last.row);
      setRemoved((list) => list.slice(0, -1));
      return { ...d, [last.axis]: sortByMarket(rows) };
    });
  }

  function patchBand(key: string, field: 'upto' | 'step', raw: string) {
    setSavedOk(false);
    setFieldWarning(false);
    setFieldErrors((e) => ({ ...e, [`${key}:${field}`]: undefined }));
    setDraft((d) =>
      d
        ? {
            ...d,
            rounding: d.rounding.map((b) =>
              b.key === key ? { ...b, [field === 'upto' ? 'uptoRaw' : 'stepRaw']: raw } : b,
            ),
          }
        : d,
    );
  }

  function blurBand(key: string, field: 'upto' | 'step') {
    setDraft((d) => {
      if (!d) return d;
      const index = d.rounding.findIndex((b) => b.key === key);
      if (index < 0) return d;
      const err =
        field === 'step' ? stepError(d.rounding[index].stepRaw) : uptoError(d.rounding, index);
      setFieldErrors((e) => ({ ...e, [`${key}:${field}`]: err ?? undefined }));
      return d;
    });
  }

  function addBand() {
    setSavedOk(false);
    setDraft((d) => {
      if (!d) return d;
      // La banda abierta (`EN ADELANTE`) es SIEMPRE la última: la nueva se inserta antes de ella,
      // así el estado «dos bandas abiertas» no se puede expresar desde la UI.
      const rows = [...d.rounding];
      const openIndex = rows.findIndex((b) => b.uptoRaw === null);
      const band: BandRow = { key: nextKey('band'), uptoRaw: '', stepRaw: '' };
      rows.splice(openIndex >= 0 ? openIndex : rows.length, 0, band);
      return { ...d, rounding: rows };
    });
  }

  function removeBand(key: string) {
    setSavedOk(false);
    setDraft((d) =>
      d && d.rounding.length > 1
        ? { ...d, rounding: d.rounding.filter((b) => b.key !== key || b.uptoRaw === null) }
        : d,
    );
  }

  function discard() {
    if (!saved) return;
    if (dirty && !window.confirm(t('save.discardConfirm'))) return;
    setDraft(draftFromCurve(saved));
    setFieldErrors({});
    setViolation(null);
    setRemoved([]);
    setFieldWarning(false);
    setSavedOk(false);
  }

  function attemptSave() {
    if (!draft) return;
    if (hasFieldErrors || saveCurve == null || dupeSale.size > 0 || dupeBuy.size > 0) {
      setFieldWarning(true);
      const badKey =
        Object.entries(fieldErrors).find(([, v]) => v)?.[0]?.split(':')[0] ??
        [...dupeSale, ...dupeBuy][0] ??
        firstIncompleteKey(draft);
      if (badKey) setFocusKey(badKey);
      return;
    }
    setDiffOpen(true);
  }

  const saleOffending = offendingKeys(draft?.sale ?? [], 'sale');
  const buyOffending = offendingKeys(draft?.buy ?? [], 'buy');
  const previewRows = preview.data?.rows ?? [];
  const probeRow = probeCents != null ? preview.byMarket.get(probeCents) : undefined;
  const shapeWarning = useMemo(() => shapeLooksInverted(saveCurve), [saveCurve]);

  const statusLabel = violation
    ? t('save.notSaved')
    : fieldWarning || hasFieldErrors || dupeSale.size > 0 || dupeBuy.size > 0
      ? t('save.fieldErrors')
      : dirty
        ? t('save.dirty', { count: diff.length })
        : t('save.noChanges');

  return (
    <section className="flex flex-col gap-4" aria-labelledby="pricing-curve-title">
      <h2 id="pricing-curve-title" className="text-h2 font-semibold">
        {t('title')}
      </h2>
      <p className="max-w-3xl text-sm text-muted">{t('lead')}</p>

      <QueryState
        isLoading={curve.isLoading}
        isError={curve.isError}
        error={curve.error}
        onRetry={() => curve.refetch()}
      >
        {draft && saved && (
          <>
            {/* Resumen anclado del 422 (§21.4b-1): título fijo «No se guardó nada», recibe foco. */}
            {violation && (
              <div ref={summaryRef} tabIndex={-1} className="outline-none">
                <Banner variant="danger" role="alert" title={t('errors.summaryTitle')}>
                  <p>{violationMessage(t, violation, locale)}</p>
                  {violationMarkets(violation).length > 0 && (
                    <ul className="mt-2 flex flex-wrap gap-3">
                      {violationMarkets(violation).map((m) => (
                        <li key={m}>
                          <button
                            type="button"
                            className="border-b border-accent pb-0.5 text-xs text-accent hover:border-text hover:text-text"
                            onClick={() => {
                              const axis = violation.details.axis ?? 'sale';
                              const row = draft[axis].find((r) => pesosToCents(r.marketRaw) === m);
                              if (row) setFocusKey(row.key);
                            }}
                          >
                            {t('errors.goToPoint', { market: formatMoneyCents(m, locale) })}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </Banner>
              </div>
            )}
            {mutation.isError && !violation && (
              <Banner variant="danger" role="alert" title={tc('errorTitle')}>
                {getError(mutation.error)}
              </Banner>
            )}
            {savedOk && (
              <Banner variant="success" role="status">
                {t('save.saved')}
              </Banner>
            )}

            <div className="grid gap-8 xl:grid-cols-[2fr_1fr]">
              <div className="flex flex-col gap-8">
                {/* ---- CONSTANTES ---- */}
                <section role="group" aria-labelledby="curve-constants" className="border-t border-border pt-4">
                  <h3 id="curve-constants" className="eyebrow">
                    {t('constants.title')}
                  </h3>
                  <div className="mt-3 grid gap-6 sm:grid-cols-2">
                    <ConstantField
                      id="curve-floor"
                      label={t('constants.floorLabel')}
                      value={draft.floorRaw}
                      onChange={(raw) => {
                        setSavedOk(false);
                        setDraft((d) => (d ? { ...d, floorRaw: raw } : d));
                      }}
                      invalid={
                        violation?.code === 'BIN_ABOVE_FLOOR' || marketError(draft.floorRaw) != null
                      }
                      hints={[t('constants.floorHint'), t('constants.floorGuardrailHint')]}
                    />
                    <ConstantField
                      id="curve-bin"
                      label={t('constants.binLabel')}
                      value={draft.binRaw}
                      onChange={(raw) => {
                        setSavedOk(false);
                        setDraft((d) => (d ? { ...d, binRaw: raw } : d));
                      }}
                      invalid={
                        violation?.code === 'BIN_ABOVE_FLOOR' || marketError(draft.binRaw) != null
                      }
                      hints={[t('constants.binHint')]}
                    />
                  </div>
                </section>

                {/* ---- VENTA (con su escalera de redondeo anidada) ---- */}
                <section role="group" aria-labelledby="curve-sale" className="border-t border-border pt-4">
                  <h3 id="curve-sale" className="eyebrow">
                    {t('sale.title')}
                  </h3>
                  <CurvePointsTable
                    axis="sale"
                    rows={draft.sale}
                    previewByMarket={preview.byMarket}
                    savedByMarket={savedSaleByMarket}
                    fieldErrors={fieldErrors}
                    duplicateKeys={dupeSale}
                    offendingKeys={saleOffending}
                    highlightKey={highlightKey}
                    focusKey={focusKey}
                    onChange={(k, f, raw) => patchRow('sale', k, f, raw)}
                    onBlur={(k, f) => blurRow('sale', k, f)}
                    onRemove={(k) => removePoint('sale', k)}
                    onAdd={() => addPoint('sale')}
                  />
                  <UndoLine axis="sale" removed={removed} onUndo={undoRemove} locale={locale} />

                  <div className="mt-6 border-t border-border pt-4">
                    <h4 className="eyebrow">{t('rounding.title')}</h4>
                    <RoundingLadderTable
                      rows={draft.rounding}
                      fieldErrors={fieldErrors}
                      offending={violation?.code === 'ROUNDING_LADDER_INVALID'}
                      onChange={patchBand}
                      onBlur={blurBand}
                      onRemove={removeBand}
                      onAdd={addBand}
                    />
                  </div>
                </section>

                {/* ---- COMPRA ---- */}
                <section role="group" aria-labelledby="curve-buy" className="border-t border-border pt-4">
                  <h3 id="curve-buy" className="eyebrow">
                    {t('buy.title')}
                  </h3>
                  <CurvePointsTable
                    axis="buy"
                    rows={draft.buy}
                    previewByMarket={preview.byMarket}
                    savedByMarket={savedBuyByMarket}
                    fieldErrors={fieldErrors}
                    duplicateKeys={dupeBuy}
                    offendingKeys={buyOffending}
                    highlightKey={highlightKey}
                    focusKey={focusKey}
                    onChange={(k, f, raw) => patchRow('buy', k, f, raw)}
                    onBlur={(k, f) => blurRow('buy', k, f)}
                    onRemove={(k) => removePoint('buy', k)}
                    onAdd={() => addPoint('buy')}
                  />
                  <UndoLine axis="buy" removed={removed} onUndo={undoRemove} locale={locale} />
                </section>
              </div>

              {/* El previsualizador queda ENTRE las curvas y la barra de guardado en una columna;
                  sticky a la derecha en ≥ xl (§21.1). */}
              <div className="xl:sticky xl:top-[var(--app-header-h,0px)] xl:self-start">
                <CurvePreview
                  probeRaw={probeRaw}
                  onProbeChange={(raw) => setProbeRaw(raw)}
                  probeRow={probeRow}
                  rows={previewRows}
                  isLoading={preview.isLoading}
                  isError={preview.isError}
                  error={preview.error}
                  onRetry={preview.refetch}
                  offendingMarkets={offendingMarkets}
                  shapeWarning={shapeWarning}
                />
              </div>
            </div>

            {/* ---- Barra de guardado ---- */}
            <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-bg py-3">
              <span
                className={`font-mono text-[11px] uppercase tracking-[0.06em] ${
                  dirty || violation || fieldWarning ? 'text-accent' : 'text-muted'
                }`}
              >
                {statusLabel}
              </span>
              <div className="flex items-center gap-3">
                <Button variant="ghost" onClick={discard} disabled={!dirty || mutation.isPending}>
                  {t('save.discard')}
                </Button>
                <Button
                  onClick={attemptSave}
                  disabled={!dirty || mutation.isPending}
                  aria-describedby={dirty ? undefined : 'curve-save-why'}
                  loading={mutation.isPending}
                >
                  {t('save.submit')}
                </Button>
                {!dirty && (
                  <span id="curve-save-why" className="sr-only">
                    {t('save.noChanges')}
                  </span>
                )}
              </div>
            </div>

            <p className="text-xs text-muted">{t('footerNote')}</p>
            <span aria-live="polite" className="sr-only">
              {announce}
            </span>

            <CurveDiffDialog
              open={diffOpen}
              onClose={() => setDiffOpen(false)}
              onConfirm={() => saveCurve && mutation.mutate(saveCurve)}
              saving={mutation.isPending}
              diff={diff}
              rows={previewRows}
            />
          </>
        )}
      </QueryState>
    </section>
  );
}

/** Piso de venta / Mínimo de compra (§21.3a). Las ayudas describen el COMPORTAMIENTO, no el rol. */
function ConstantField({
  id,
  label,
  value,
  onChange,
  invalid,
  hints,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (raw: string) => void;
  invalid: boolean;
  hints: string[];
}) {
  return (
    <div className="flex flex-col">
      <label htmlFor={id} className="eyebrow">
        {label}
      </label>
      <span
        className={`mt-2 flex items-baseline gap-1.5 border-b pb-1 focus-within:shadow-focus ${
          invalid ? 'border-accent' : 'border-border-strong'
        }`}
      >
        <span className="shrink-0 font-mono text-[11px] text-muted">MX$</span>
        <input
          id={id}
          className="tabular-nums w-28 bg-transparent font-mono text-[13px] text-text outline-none"
          inputMode="decimal"
          value={value}
          aria-invalid={invalid ? true : undefined}
          aria-describedby={`${id}-hint`}
          onChange={(e) => onChange(sanitizeDecimal(e.target.value))}
        />
      </span>
      <span id={`${id}-hint`} className="mt-2 flex flex-col gap-1">
        {hints.map((h) => (
          <span key={h} className="text-xs text-muted">
            {h}
          </span>
        ))}
      </span>
    </div>
  );
}

/** Borrado inmediato y reversible dentro del borrador (§21.2c): nada toca dinero hasta guardar. */
function UndoLine({
  axis,
  removed,
  onUndo,
  locale,
}: {
  axis: CurveAxis;
  removed: RemovedPoint[];
  onUndo: () => void;
  locale: AppLocale;
}) {
  const t = useTranslations('admin.m2.curve');
  const mine = removed.filter((r) => r.axis === axis);
  if (mine.length === 0) return null;
  const last = mine[mine.length - 1];
  const marketCents = pesosToCents(last.row.marketRaw);
  return (
    <p className="mt-2 font-mono text-[11px] text-muted" role="status">
      {mine.length > 1
        ? t('point.undoRemovedMany', { count: mine.length })
        : t('point.undoRemoved', {
            market: marketCents != null ? formatMoneyCents(marketCents, locale) : '',
          })}{' '}
      <button
        type="button"
        onClick={onUndo}
        className="border-b border-accent pb-0.5 text-accent hover:border-text hover:text-text"
      >
        {t('point.undo')}
      </button>
    </p>
  );
}

function firstIncompleteKey(draft: CurveDraft): string | null {
  for (const axis of ['sale', 'buy'] as const) {
    for (const row of draft[axis]) {
      if (pesosToCents(row.marketRaw) == null || row.valueRaw.trim() === '') return row.key;
    }
  }
  return null;
}

/**
 * Lectura de la curva (§21.5b): aviso de INTENCIÓN de negocio (margen grueso abajo y delgado
 * arriba en venta; pago mayor arriba en compra). **Nunca un error**: no se pinta en rojo y no
 * bloquea nada — no es un invariante, y los invariantes los valida el servidor.
 */
function shapeLooksInverted(curve: PricingCurveDTO | null): boolean {
  if (!curve) return false;
  const sale = curve.sale.points;
  const buy = curve.buy.points;
  const saleRises = sale.some((p, i) => i > 0 && p.multiplierBp > sale[i - 1].multiplierBp);
  const buyFalls = buy.some((p, i) => i > 0 && p.pctBp < buy[i - 1].pctBp);
  return saleRises || buyFalls;
}

type Translator = ReturnType<typeof useTranslations<'admin.m2.curve'>>;

/**
 * Copy por código (§21.4c): frases, no álgebra — el dueño no lee `multiplierBp`. Las cifras del
 * `details` se traducen a las unidades de PANTALLA (pesos, `×`, `%`).
 */
function violationMessage(t: Translator, v: CurveViolation, locale: AppLocale): string {
  const money = (c: number | undefined) => (c != null ? formatMoneyCents(c, locale) : '');
  const d = v.details;
  switch (v.code) {
    case 'CURVE_EMPTY':
      return t('errors.CURVE_EMPTY', { axis: t(`diffAxis.${d.axis ?? 'sale'}`) });
    case 'DUPLICATE_BREAKPOINT':
      return t('errors.DUPLICATE_BREAKPOINT', { market: money(d.marketCents) });
    case 'SALE_BELOW_MARKET':
      return t('errors.SALE_BELOW_MARKET', { market: money(d.marketCents) });
    case 'SALE_CURVE_NOT_MONOTONIC':
      return t('errors.SALE_CURVE_NOT_MONOTONIC', {
        from: money(d.marketCents),
        to: money(d.toMarketCents),
      });
    case 'BUY_ABOVE_SALE':
      return t('errors.BUY_ABOVE_SALE', {
        market: money(d.marketCents),
        pct: d.pctBp != null ? String(d.pctBp / 100) : '',
        mult: d.multiplierBp != null ? (d.multiplierBp / 10000).toFixed(2) : '',
      });
    case 'BIN_ABOVE_FLOOR':
      return t('errors.BIN_ABOVE_FLOOR', { bin: money(d.binCents), floor: money(d.floorCents) });
    case 'ROUNDING_LADDER_INVALID':
      return t('errors.ROUNDING_LADDER_INVALID');
    default:
      return t('errors.summaryTitle');
  }
}
