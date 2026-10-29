'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Save } from 'lucide-react';
import { getGradedEstimateBudget, getSettings, updateSettings } from '@/lib/api';
import { asApiError } from '@/lib/api-client';
import type { FeaturedDialRule, GradedEstimateBudgetDTO, SettingsDTO } from '@/types/contract';
import type { AppLocale } from '@/i18n/routing';
import { formatCount } from '@/lib/format';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Banner } from '@/components/ui/Banner';
import { QueryState, useErrorMessage } from '@/components/ui/QueryState';

/**
 * v1.113⟨portada⟩ (API_CONTRACT §DYN.3, DYN-F5) — «Destacadas y PSA»: los SEIS diales nuevos de M10 y el presupuesto de
 * créditos PSA (`GET /admin/pricing/graded-estimates/budget`, §DYN.4.6).
 *
 * Mismo patrón que los demás grupos de M10: borrador propio y `PUT /admin/settings` parcial con SOLO las claves tocadas.
 * Rangos (enteros, del contrato) y reglas de combinación sobre el valor RESULTANTE:
 *   `featuredRandomSlots + featuredNewArrivalSlots ∈ [1, 20]` (`featured_slots_total`) y
 *   `featuredPoolSize ≥ featuredRandomSlots` (`featured_pool_lt_random`).
 * La pantalla NO las valida por su cuenta: la fuente de verdad es el `422` del servidor, que se pinta en los campos que
 * nombra (`details.errors`) o, si es de combinación, con la frase de su `details.rule`.
 *
 * Los cinco `featured*` rigen la SIGUIENTE selección diaria, no la que se está sirviendo (criterio 926): la pantalla lo
 * dice. Textos de cara al dueño: PROVISIONALES (ux-ui pendiente, FRONTEND_NOTES §DYN).
 */
type FeaturedPsaDialKey =
  | 'featuredPoolSize'
  | 'featuredRandomSlots'
  | 'featuredNewArrivalSlots'
  | 'featuredNewArrivalWindowDays'
  | 'featuredRotationHour'
  | 'gradedEstimateDailyCreditCap';

/** Los seis diales, en el orden de §DYN.3. */
const DIALS: readonly FeaturedPsaDialKey[] = [
  'featuredPoolSize',
  'featuredRandomSlots',
  'featuredNewArrivalSlots',
  'featuredNewArrivalWindowDays',
  'featuredRotationHour',
  'gradedEstimateDailyCreditCap',
];

/** Claves que edita esta sección (candado REL-S7 en `M10View.test.tsx`: cada dial en UN solo bloque). */
export const FEATURED_PSA_DIAL_KEYS: readonly FeaturedPsaDialKey[] = DIALS;

/** Qué campos señala cada regla de combinación del `422` (§DYN.3). */
const RULE_FIELDS: Record<FeaturedDialRule, readonly FeaturedPsaDialKey[]> = {
  featured_slots_total: ['featuredRandomSlots', 'featuredNewArrivalSlots'],
  featured_pool_lt_random: ['featuredPoolSize', 'featuredRandomSlots'],
};

function isRule(v: unknown): v is FeaturedDialRule {
  return v === 'featured_slots_total' || v === 'featured_pool_lt_random';
}

function savedText(key: FeaturedPsaDialKey, s: SettingsDTO | undefined): string {
  const v = s?.[key];
  return v == null ? '' : String(v);
}

export function FeaturedPsaDialsSection() {
  const t = useTranslations('admin.m10.featuredPsa');
  const tc = useTranslations('common');
  const qc = useQueryClient();
  const getError = useErrorMessage('operator');
  const settings = useQuery({ queryKey: ['admin-settings'], queryFn: getSettings });
  const [draft, setDraft] = useState<Partial<Record<FeaturedPsaDialKey, string>>>({});
  const [fieldErrors, setFieldErrors] = useState<Set<FeaturedPsaDialKey>>(new Set());
  const [banner, setBanner] = useState<string | null>(null);

  const s = settings.data;
  // Un servidor anterior a M-93 no trae ninguno: la sección no se pinta como si existieran.
  const present = !!s && DIALS.some((k) => s[k] != null);
  const dirty = (Object.keys(draft) as FeaturedPsaDialKey[]).filter((k) => draft[k] !== savedText(k, s));
  const value = (k: FeaturedPsaDialKey) => draft[k] ?? savedText(k, s);

  function patch(): Partial<SettingsDTO> {
    const out: Record<string, number> = {};
    // Lo tecleado tal cual: un valor no entero llega al servidor y vuelve como `422` en su campo.
    for (const k of dirty) out[k] = Number(draft[k]!.trim().replace(/,/g, ''));
    return out as Partial<SettingsDTO>;
  }

  const save = useMutation({
    mutationFn: (p: Partial<SettingsDTO>) => updateSettings(p),
    onMutate: () => {
      setFieldErrors(new Set());
      setBanner(null);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-settings'] });
      void qc.invalidateQueries({ queryKey: ['graded-estimates-budget'] });
      setDraft({});
    },
    onError: (e) => {
      const err = asApiError(e);
      if (err?.status === 422 && err.code === 'VALIDATION_ERROR') {
        const rule = err.details?.rule;
        if (isRule(rule)) {
          setFieldErrors(new Set(RULE_FIELDS[rule]));
          setBanner(t(`rule.${rule}`));
          return;
        }
        const errors = err.details?.errors;
        if (errors && typeof errors === 'object') {
          const keys = Object.keys(errors as Record<string, unknown>).filter((k): k is FeaturedPsaDialKey =>
            (DIALS as readonly string[]).includes(k),
          );
          if (keys.length) {
            setFieldErrors(new Set(keys));
            setBanner(t('checkFields'));
            return;
          }
        }
      }
      setBanner(getError(e));
    },
  });

  return (
    <section id="destacadas-psa" className="flex scroll-mt-24 flex-col gap-3" data-testid="m10-featured-psa">
      <h2 className="text-h2 font-semibold">{t('title')}</h2>
      <p className="text-sm text-muted">{t('subtitle')}</p>
      <QueryState isLoading={settings.isLoading} isError={settings.isError} error={settings.error} onRetry={() => settings.refetch()}>
        {s && !present && <p className="text-sm text-muted">{t('notAvailable')}</p>}
        {present && (
          <div className="flex flex-col gap-5 rounded-lg border border-border bg-surface p-4">
            {banner && (
              <Banner variant="danger" role="alert">
                {banner}
              </Banner>
            )}
            <p className="text-xs text-muted">{t('nextSelection')}</p>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {DIALS.map((k) => {
                const bad = fieldErrors.has(k);
                return (
                  <div key={k} className="flex flex-col gap-1">
                    <Input
                      label={t(`labels.${k}`)}
                      type="text"
                      inputMode="numeric"
                      value={value(k)}
                      aria-invalid={bad || undefined}
                      onChange={(e) => {
                        const v = e.target.value;
                        setDraft((prev) => ({ ...prev, [k]: v }));
                        setFieldErrors((cur) => {
                          if (!cur.has(k)) return cur;
                          const next = new Set(cur);
                          next.delete(k);
                          return next;
                        });
                      }}
                    />
                    <p className={bad ? 'text-xs text-accent' : 'text-xs text-muted'}>{t(`help.${k}`)}</p>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-3">
              <Button disabled={dirty.length === 0} loading={save.isPending} onClick={() => save.mutate(patch())} data-testid="m10-featured-psa-save">
                <Save size={18} /> {t('save', { count: dirty.length })}
              </Button>
              {dirty.length > 0 && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setDraft({});
                    setFieldErrors(new Set());
                    setBanner(null);
                  }}
                >
                  {tc('cancel')}
                </Button>
              )}
            </div>
            {save.isSuccess && (
              <Banner variant="success" role="status">
                {t('saved')}
              </Banner>
            )}
            <PsaBudgetPanel />
          </div>
        )}
      </QueryState>
    </section>
  );
}

/**
 * §DYN.4.6 / criterio 301 — el presupuesto de créditos PSA. Solo lectura y cifras del servidor TAL CUAL: la pantalla no
 * calcula ninguna (ni el ciclo, ni el tope que alcanzaría). Un error aquí no tapa los diales de arriba.
 */
export function PsaBudgetPanel() {
  const t = useTranslations('admin.m10.featuredPsa.budget');
  const budget = useQuery({ queryKey: ['graded-estimates-budget'], queryFn: getGradedEstimateBudget, retry: false });
  return (
    <div className="flex flex-col gap-2 border-t border-border pt-4" data-testid="psa-budget">
      <h3 className="text-sm font-semibold">{t('title')}</h3>
      <QueryState isLoading={budget.isLoading} isError={budget.isError} error={budget.error} onRetry={() => budget.refetch()}>
        {budget.data && <BudgetFigures b={budget.data} />}
      </QueryState>
    </div>
  );
}

function BudgetFigures({ b }: { b: GradedEstimateBudgetDTO }) {
  const t = useTranslations('admin.m10.featuredPsa.budget');
  const locale = useLocale() as AppLocale;
  const n = (v: number) => formatCount(v, locale);
  const rows: [string, string][] = [
    [t('hook'), b.hookEnabled ? t('hookOn') : t('hookOff')],
    [t('dailyCreditCap'), n(b.dailyCreditCap)],
    [t('creditsToday'), `${n(b.creditsToday)}${b.creditsTodayAllMeasured ? '' : ` · ${t('includesEstimate')}`}`],
    [t('creditsLast7Days'), n(b.creditsLast7Days)],
    [t('providerDailyQuota'), b.providerDailyQuota == null ? t('notSet') : n(b.providerDailyQuota)],
    [t('providerDailyRemaining'), b.providerDailyRemaining == null ? t('notReported') : n(b.providerDailyRemaining)],
    [t('publishedCards'), n(b.publishedCards)],
    [t('cardsScannedLast7Days'), n(b.cardsScannedLast7Days)],
    [t('cardsUnmapped'), n(b.cardsUnmapped)],
    [t('weeklyCreditsNeeded'), n(b.weeklyCreditsNeeded)],
    [t('cycleDays'), b.cycleDays == null ? t('cycleNever') : t('days', { count: b.cycleDays })],
    [t('capToCoverWeek'), n(b.capToCoverWeek)],
  ];
  return (
    <>
      {b.cycleDays !== null && b.cycleDays > 7 && (
        <Banner variant="warning" role="status">
          {t('short', { cycleDays: b.cycleDays, capToCoverWeek: n(b.capToCoverWeek) })}
        </Banner>
      )}
      <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        {rows.map(([label, v]) => (
          <div key={label} className="flex justify-between gap-3 border-b border-border py-1">
            <dt className="text-muted">{label}</dt>
            <dd className="tabular font-mono">{v}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}
