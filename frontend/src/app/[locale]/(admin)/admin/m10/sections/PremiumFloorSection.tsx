'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Save } from 'lucide-react';
import { getPricingCurve, getRarityHealth, getSettings, updateSettings } from '@/lib/api';
import { asApiError } from '@/lib/api-client';
import { formatMoneyCents } from '@/lib/format';
import {
  PREMIUM_FLOOR_MODES,
  type PremiumFloorSalePublish,
  type PremiumFloorSalePublishMode,
  type RarityHealthRowDTO,
} from '@/types/contract';
import type { AppLocale } from '@/i18n/routing';
import { Badge } from '@/components/ui/Badge';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Skeleton } from '@/components/ui/Skeleton';
import { QueryState, useErrorMessage } from '@/components/ui/QueryState';

/** Ancla del enlace «Ver la regla» de «Listas para publicar» (`DESIGN_SYSTEM §39.3 (b)`). */
export const PREMIUM_FLOOR_ANCHOR = 'premium-piso';

/** Más filas que esto ⇒ campo de filtro (`§39.1 (a)`). */
const FILTER_THRESHOLD = 12;

/** Las dos canónicas del seed: son las únicas con pista, la que une «ex y double rare» con el nombre técnico. */
const RARITY_HINT: Record<string, 'hintDoubleRare' | 'hintRareHoloEx'> = {
  'Double Rare': 'hintDoubleRare',
  'Rare Holo EX': 'hintRareHoloEx',
};

const RICH_BOLD = {
  b: (chunks: React.ReactNode) => (
    <strong className="font-medium text-text" lang="en">
      {chunks}
    </strong>
  ),
};

interface RarityRow {
  canonical: string;
  /** `null` = rareza guardada que el catálogo ya no trae (sin cartas hoy): se pinta igual, ⛔ no se descarta. */
  cardCount: number | null;
}

/** Lo que se ENVÍA: con `all`/`none` la lista va vacía (el validador exige `[]`). */
function toPayload(mode: PremiumFloorSalePublishMode, rarities: string[]): PremiumFloorSalePublish {
  return { mode, rarities: mode === 'only' ? rarities : [] };
}

function sameRule(a: PremiumFloorSalePublish, b: PremiumFloorSalePublish): boolean {
  if (a.mode !== b.mode) return false;
  if (a.rarities.length !== b.rarities.length) return false;
  const set = new Set(a.rarities);
  return b.rarities.every((r) => set.has(r));
}

/**
 * 💰 **«Cartas premium en el piso (venta)»** — el dial `premiumFloorSalePublish` (`API_CONTRACT §M2 M2-PF`
 * v1.80.8.5, `DESIGN_SYSTEM §39.1`). Decisión del dueño (`HECHOS.md` 2026-10-04, «solo ex y double rare, lo demás
 * por defecto»): seed `{ mode: 'only', rarities: ['Double Rare', 'Rare Holo EX'] }`.
 *
 * - **Sección propia** (no la retícula de diales): el valor es un objeto cuya validez depende de sus dos mitades
 *   y cada guardado publica o retira cartas al momento ⇒ borrador, confirmación y botón propios.
 * - **Clave ausente en el `GET` ⇒ «este servidor todavía no tiene este ajuste»** y la sección deshabilitada.
 *   ⛔ No se pinta el seed: sería afirmar una regla que el servidor no aplica.
 * - **La cifra del piso** sale de la curva (`sale.floorCents`); si la curva no carga **cede la cifra, nunca el
 *   texto** (variantes `…NoFloor`). ⛔ Nunca «MX$25» a fuego.
 * - **Rarezas**: las `premium && mapped` de `GET /admin/pricing/rarities` + toda rareza guardada que no venga en
 *   la lista (⛔ nunca se descarta en silencio). Las `premium && !mapped` van aparte, de solo lectura.
 * - `PUT /admin/settings` parcial con SOLO `premiumFloorSalePublish`.
 */
export function PremiumFloorSection() {
  const t = useTranslations('admin.m10.premiumFloor');
  const tc = useTranslations('common');
  const locale = useLocale() as AppLocale;
  const qc = useQueryClient();
  const getError = useErrorMessage('operator');

  const settings = useQuery({ queryKey: ['admin-settings'], queryFn: getSettings });
  const rarityHealth = useQuery({ queryKey: ['rarity-health'], queryFn: getRarityHealth });
  const curve = useQuery({ queryKey: ['pricing-curve'], queryFn: getPricingCurve, retry: false });

  const saved: PremiumFloorSalePublish | undefined = settings.data?.premiumFloorSalePublish;
  const available = saved !== undefined;

  const [mode, setMode] = useState<PremiumFloorSalePublishMode | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [savedOk, setSavedOk] = useState(false);

  // El borrador adopta el valor GUARDADO cada vez que el servidor dice otro (primera carga y tras guardar).
  const savedKey = saved ? `${saved.mode}|${saved.rarities.join('\u0000')}` : null;
  useEffect(() => {
    if (!saved) return;
    setMode(saved.mode);
    // `all`/`none` traen `[]`: la última selección en pantalla se CONSERVA (§39.1 (a)), así que solo se adopta
    // la lista guardada cuando es `only`.
    if (saved.mode === 'only') setSelected(saved.rarities);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey]);

  const floorCents = curve.data?.sale?.floorCents;
  const floor = typeof floorCents === 'number' ? formatMoneyCents(floorCents, locale) : null;

  const rows: RarityRow[] = useMemo(() => {
    const fromCatalog = (rarityHealth.data?.rarities ?? []).filter((r) => r.premium && r.mapped);
    const known = new Set(fromCatalog.map((r) => r.canonical));
    const savedList = saved?.mode === 'only' ? saved.rarities : [];
    // Lo guardado manda el orden: marcadas (en el valor guardado) primero, luego `cardCount` desc (orden del endpoint).
    const savedSet = new Set(savedList);
    const missing: RarityRow[] = [...savedList, ...selected]
      .filter((c, i, arr) => !known.has(c) && arr.indexOf(c) === i)
      .map((canonical) => ({ canonical, cardCount: null }));
    const catalogRows: RarityRow[] = fromCatalog.map((r: RarityHealthRowDTO) => ({ canonical: r.canonical, cardCount: r.cardCount }));
    const all = [...catalogRows, ...missing];
    return [...all.filter((r) => savedSet.has(r.canonical)), ...all.filter((r) => !savedSet.has(r.canonical))];
  }, [rarityHealth.data, saved, selected]);

  const unmapped = useMemo(
    () => (rarityHealth.data?.rarities ?? []).filter((r) => r.premium && !r.mapped),
    [rarityHealth.data],
  );

  const draft: PremiumFloorSalePublish | null = mode ? toPayload(mode, selected) : null;
  const changed = !!draft && !!saved && !sameRule(draft, saved);
  const emptyOnly = mode === 'only' && selected.length === 0;
  // Con la lista de rarezas en error, `only` solo se guarda si la selección guardada no cambió (§39.1 (b)).
  const raritiesBlocked =
    rarityHealth.isError && mode === 'only' && !!saved && !(saved.mode === 'only' && sameRule(toPayload('only', selected), saved));

  const mutation = useMutation({
    mutationFn: (value: PremiumFloorSalePublish) => updateSettings({ premiumFloorSalePublish: value }),
    onMutate: () => setSavedOk(false),
    onSuccess: () => {
      setConfirmOpen(false);
      setSavedOk(true);
      void qc.invalidateQueries({ queryKey: ['admin-settings'] });
      void qc.invalidateQueries({ queryKey: ['audit-log'] });
      void qc.invalidateQueries({ queryKey: ['pending-publish'] });
    },
    onError: () => setConfirmOpen(false),
  });

  const canSave = available && changed && !emptyOnly && !raritiesBlocked && !mutation.isPending;

  function toggle(canonical: string) {
    setSavedOk(false);
    setSelected((prev) => (prev.includes(canonical) ? prev.filter((r) => r !== canonical) : [...prev, canonical]));
  }

  const listFormat = useMemo(() => new Intl.ListFormat(locale === 'es' ? 'es-MX' : 'en-US', { type: 'conjunction' }), [locale]);
  function summary(rule: PremiumFloorSalePublish): string {
    if (rule.mode === 'only') return t('summary.only', { list: listFormat.format(rule.rarities) });
    return rule.mode === 'all' ? t('summary.all') : t('summary.none');
  }
  const removing =
    !!draft &&
    !!saved &&
    (draft.mode === 'none' ||
      (draft.mode === 'only' && saved.mode === 'all') ||
      (draft.mode === 'only' && saved.mode === 'only' && saved.rarities.some((r) => !draft.rarities.includes(r))));

  const serverError = (() => {
    const err = asApiError(mutation.error);
    if (!err || err.status !== 422 || err.code !== 'VALIDATION_ERROR') return null;
    // S-5 (v1.80.8.7): `details.errors.premiumFloorSalePublish` es diagnóstico, ⛔ no token.
    const errors = err.details?.errors as Record<string, unknown> | undefined;
    const diag = errors?.premiumFloorSalePublish;
    return typeof diag === 'string' ? diag : err.message;
  })();

  const filterText = filter.trim().toLowerCase();
  const visibleRows =
    rows.length > FILTER_THRESHOLD && filterText !== ''
      ? rows.filter((r) => selected.includes(r.canonical) || r.canonical.toLowerCase().includes(filterText))
      : rows;
  const raritiesDisabled = !available || mode !== 'only';

  return (
    <section
      id={PREMIUM_FLOOR_ANCHOR}
      className="flex scroll-mt-24 flex-col gap-3"
      aria-labelledby="m10-premium-floor"
      data-testid="m10-premium-floor"
    >
      <h2 id="m10-premium-floor" className="text-h2 font-semibold">
        {t('title')}
      </h2>
      <p className="max-w-[70ch] text-sm text-muted">{floor ? t('intro', { floor }) : t('introNoFloor')}</p>

      <QueryState isLoading={settings.isLoading} isError={settings.isError} error={settings.error} onRetry={() => settings.refetch()}>
        {settings.data && (
          <div className="flex flex-col gap-5 rounded-lg border border-border bg-surface p-4">
            {!available && (
              <Banner variant="info" role="status">
                {t('notAvailable')}
              </Banner>
            )}

            <fieldset className="flex flex-col gap-3" disabled={!available}>
              <legend className="mb-1 text-sm font-medium text-text">{t('legend')}</legend>
              {PREMIUM_FLOOR_MODES.map((m) => (
                <label key={m} className="flex min-h-[44px] items-start gap-3 text-sm text-text">
                  <input
                    type="radio"
                    name="premium-floor-mode"
                    value={m}
                    className="mt-0.5 h-5 w-5 accent-text"
                    checked={available && mode === m}
                    onChange={() => {
                      setMode(m);
                      setSavedOk(false);
                    }}
                  />
                  <span className="flex flex-col gap-0.5">
                    <span className="flex flex-wrap items-center gap-2">
                      {t(`mode.${m}.label`)}
                      {m === 'only' && <Badge tone="neutral">{t('defaultTag')}</Badge>}
                    </span>
                    <span className="text-muted">{floor ? t(`mode.${m}.help`, { floor }) : t(`mode.${m}.helpNoFloor`)}</span>
                  </span>
                </label>
              ))}
            </fieldset>

            <fieldset
              className={raritiesDisabled ? 'flex flex-col gap-2 opacity-50' : 'flex flex-col gap-2'}
              disabled={raritiesDisabled}
              aria-describedby={emptyOnly ? 'premium-floor-empty' : undefined}
              data-testid="premium-floor-rarities"
            >
              <legend className="mb-1 flex flex-wrap items-baseline gap-2 text-sm font-medium text-text">
                {t('rarities.legend')}
                <span className="tabular font-mono text-[11px] text-muted">· {t('rarities.selected', { count: selected.length })}</span>
              </legend>
              {mode !== 'only' && available && <p className="text-xs text-text">{t('rarities.disabledNote')}</p>}
              {rows.length > FILTER_THRESHOLD && (
                <div className="w-64">
                  <Input label={t('rarities.filter')} type="search" value={filter} onChange={(e) => setFilter(e.target.value)} />
                </div>
              )}
              {rarityHealth.isLoading ? (
                <div className="flex flex-col gap-2" aria-hidden>
                  <Skeleton className="h-6 w-full" />
                  <Skeleton className="h-6 w-full" />
                  <Skeleton className="h-6 w-full" />
                </div>
              ) : (
                <>
                  {rarityHealth.isError && (
                    <Banner
                      variant="danger"
                      role="alert"
                      action={
                        <Button size="sm" variant="secondary" onClick={() => rarityHealth.refetch()}>
                          {tc('retry')}
                        </Button>
                      }
                    >
                      {t('rarities.loadError')}
                    </Banner>
                  )}
                  <ul className="flex flex-col divide-y divide-border">
                    {visibleRows.map((r) => {
                      const hint = RARITY_HINT[r.canonical];
                      return (
                        <li key={r.canonical}>
                          <label className="flex min-h-[44px] items-center gap-3 py-1 text-sm text-text">
                            <input
                              type="checkbox"
                              className="h-5 w-5 accent-text"
                              checked={selected.includes(r.canonical)}
                              onChange={() => toggle(r.canonical)}
                              data-testid={`premium-floor-rarity-${r.canonical}`}
                            />
                            <span className="flex flex-1 flex-col">
                              <span lang="en">{r.canonical}</span>
                              {hint && <span className="text-xs text-muted">{t(`rarities.${hint}`)}</span>}
                            </span>
                            <span className="tabular font-mono text-xs text-muted">
                              {r.cardCount === null ? t('rarities.notInCatalog') : t('rarities.cardCount', { count: r.cardCount })}
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </fieldset>
            {emptyOnly && available && (
              <p id="premium-floor-empty" className="text-sm text-accent" role="alert">
                {t('errors.emptyOnly')}
              </p>
            )}

            {unmapped.length > 0 && (
              <details className="text-sm">
                <summary className="cursor-pointer text-text">{t('unmapped.title', { count: unmapped.length })}</summary>
                <ul className="mt-2 flex flex-col gap-1 pl-4">
                  {unmapped.map((r) => (
                    <li key={r.raw ?? r.canonical} lang="en" className="text-text">
                      {r.raw ?? r.canonical}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 max-w-[70ch] text-muted">{t('unmapped.body')}</p>
              </details>
            )}

            {/* «La rareza manda, no el nombre»: SIEMPRE visible, en los tres modos (§39.1 (a)). ⛔ No es warning. */}
            <div role="note" data-testid="premium-floor-ex-warning">
              <Banner variant="info" title={t('exWarning.title')}>
                {t.rich('exWarning.body', RICH_BOLD)}
              </Banner>
            </div>

            <div className="flex flex-col gap-1">
              <p className="max-w-[70ch] text-xs text-muted">{floor ? t('effect', { floor }) : t('effectNoFloor')}</p>
              <p className="max-w-[70ch] text-xs text-muted">{t('buyNote')}</p>
              <p className="font-mono text-[11px] text-muted">{t('audit')}</p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button disabled={!canSave} loading={mutation.isPending} onClick={() => setConfirmOpen(true)}>
                <Save size={18} /> {t('save')}
              </Button>
              {changed && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    if (!saved) return;
                    setMode(saved.mode);
                    if (saved.mode === 'only') setSelected(saved.rarities);
                  }}
                >
                  {tc('cancel')}
                </Button>
              )}
            </div>

            {savedOk && (
              <Banner variant="success" role="status">
                {t('saved')}
              </Banner>
            )}
            {mutation.isError && (
              <Banner variant="danger" role="alert">
                {serverError !== null ? (
                  <>
                    <p>{t('errors.server')}</p>
                    <p className="mt-1 font-mono text-[11px] text-muted">{serverError}</p>
                  </>
                ) : (
                  getError(mutation.error)
                )}
              </Banner>
            )}
          </div>
        )}
      </QueryState>

      {draft && saved && (
        <ConfirmModal
          open={confirmOpen}
          onClose={() => setConfirmOpen(false)}
          title={t('confirm.title')}
          cancelLabel={tc('cancel')}
          confirmLabel={t('confirm.confirm')}
          loading={mutation.isPending}
          onConfirm={() => mutation.mutate(draft)}
        >
          <p className="text-sm text-text">{t('confirm.before', { summary: summary(saved) })}</p>
          <p className="text-sm text-text">{t('confirm.after', { summary: summary(draft) })}</p>
          {draft.mode === 'all' && (
            <Banner variant="warning">{floor ? t('confirm.allWarning', { floor }) : t('confirm.allWarningNoFloor')}</Banner>
          )}
          {removing && <p className="text-sm text-text">{t('confirm.removing')}</p>}
        </ConfirmModal>
      )}
    </section>
  );
}

/** Confirmación (§7.6) con foco inicial en «Cancelar». */
function ConfirmModal({
  open,
  onClose,
  title,
  cancelLabel,
  confirmLabel,
  loading,
  onConfirm,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  cancelLabel: string;
  confirmLabel: string;
  loading: boolean;
  onConfirm: () => void;
  children: React.ReactNode;
}) {
  const [cancelEl, setCancelEl] = useState<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (open && cancelEl) setTimeout(() => cancelEl.focus(), 0);
  }, [open, cancelEl]);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button ref={setCancelEl} variant="secondary" onClick={onClose}>
            {cancelLabel}
          </Button>
          <Button variant="primary" loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">{children}</div>
    </Modal>
  );
}
