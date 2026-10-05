'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Save } from 'lucide-react';
import { getSettings, updateSettings } from '@/lib/api';
import { asApiError } from '@/lib/api-client';
import { formatMoneyCents } from '@/lib/format';
import type { AppLocale } from '@/i18n/routing';
import type { SettingsDTO } from '@/types/contract';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Banner } from '@/components/ui/Banner';
import { QueryState, useErrorMessage } from '@/components/ui/QueryState';

type CycleKey =
  | 'buylistOfferIssueDeadlineBusinessDays'
  | 'buylistOfferAcceptDeadlineBusinessDays'
  | 'buylistShipDeadlineBusinessDays'
  | 'buylistMinimumRequestCents'
  | 'buylistShippingFeeCents'
  | 'buylistMinimumOfferNetCents'
  | 'buylistOperatorOfferCapCents'
  | 'buylistShipmentConfirmAlertBusinessDays'
  | 'buylistOfferReissueAlertCount'
  | 'buylistVariantPositionCap';

interface CycleDial {
  key: CycleKey & keyof SettingsDTO;
  kind: 'int' | 'cents';
}

/**
 * Los DIEZ diales del ciclo de venta (DESIGN_SYSTEM §60.7 b · contrato §E2E-ADM.3 / §M10), en el orden del ciclo y
 * en tres subgrupos. ⚠️ La lista es la de la tabla de §M10 — el candado M10-BL-1 la copia de ahí, no de aquí.
 */
export const BUYLIST_CYCLE_GROUPS: { group: 'deadlines' | 'amounts' | 'alerts'; dials: CycleDial[] }[] = [
  {
    group: 'deadlines',
    dials: [
      { key: 'buylistOfferIssueDeadlineBusinessDays', kind: 'int' },
      { key: 'buylistOfferAcceptDeadlineBusinessDays', kind: 'int' },
      { key: 'buylistShipDeadlineBusinessDays', kind: 'int' },
    ],
  },
  {
    group: 'amounts',
    dials: [
      { key: 'buylistMinimumRequestCents', kind: 'cents' },
      { key: 'buylistShippingFeeCents', kind: 'cents' },
      { key: 'buylistMinimumOfferNetCents', kind: 'cents' },
      { key: 'buylistOperatorOfferCapCents', kind: 'cents' },
    ],
  },
  {
    group: 'alerts',
    dials: [
      { key: 'buylistShipmentConfirmAlertBusinessDays', kind: 'int' },
      { key: 'buylistOfferReissueAlertCount', kind: 'int' },
      { key: 'buylistVariantPositionCap', kind: 'int' },
    ],
  },
];
const ALL_DIALS = BUYLIST_CYCLE_GROUPS.flatMap((g) => g.dials);
/** Los tres montos de la regla cruzada (§M10): guía + neto mínimo ≤ mínimo para cotizar. */
const CROSS_KEYS: CycleKey[] = ['buylistShippingFeeCents', 'buylistMinimumOfferNetCents', 'buylistMinimumRequestCents'];
const CROSS_RULE = 'buylist_fee_plus_min_net_le_min_request';

function toText(kind: CycleDial['kind'], v: number | undefined): string {
  if (v == null) return '';
  return kind === 'cents' ? String(v / 100) : String(v);
}
/** Texto → valor del `PUT` (pesos → centavos). ⛔ La pantalla no valida la regla: un valor malo lo rechaza el servidor por clave. */
function fromText(kind: CycleDial['kind'], text: string): number {
  const n = Number(text.trim().replace(/,/g, ''));
  return kind === 'cents' ? Math.round(n * 100) : n;
}

/**
 * **«Ciclo de venta (solicitudes de venta)»** (DESIGN_SYSTEM §60.7 b · F-9). Draft propio y `PUT` parcial con
 * **solo las claves tocadas** (M10-BL-2). El `422`:
 *  - por clave (`details.errors`) ⇒ cada campo marcado pinta **su regla** (⛔ jamás el texto del servidor, S-5) y
 *    arriba «Revisa los campos marcados. No se guardó nada.»;
 *  - cruzado (`details.rule`) ⇒ marca los tres montos y pinta el copy con las tres cifras de `details` (M10-BL-4).
 * La pantalla puede AVISAR antes de la regla cruzada, ⛔ sin bloquear el botón: la regla es del servidor.
 */
export function BuylistCycleSection() {
  const t = useTranslations('admin.m10.buylistCycle');
  const tc = useTranslations('common');
  const locale = useLocale() as AppLocale;
  const qc = useQueryClient();
  const getError = useErrorMessage('operator');
  const settings = useQuery({ queryKey: ['admin-settings'], queryFn: getSettings });
  const [draft, setDraft] = useState<Partial<Record<CycleKey, string>>>({});
  const [fieldErrors, setFieldErrors] = useState<Set<CycleKey>>(new Set());
  const [banner, setBanner] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (patch: Partial<SettingsDTO>) => updateSettings(patch),
    onMutate: () => {
      setFieldErrors(new Set());
      setBanner(null);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-settings'] });
      setDraft({});
    },
    onError: (e) => {
      const err = asApiError(e);
      const d = err?.details;
      if (err?.status === 422 && err.code === 'VALIDATION_ERROR' && d) {
        if (d.rule === CROSS_RULE) {
          setFieldErrors(new Set(CROSS_KEYS));
          setBanner(
            t('cross', {
              fee: formatMoneyCents(Number(d.shippingFeeCents ?? 0), locale),
              net: formatMoneyCents(Number(d.minimumOfferNetCents ?? 0), locale),
              min: formatMoneyCents(Number(d.minimumRequestCents ?? 0), locale),
            }),
          );
          return;
        }
        if (d.errors && typeof d.errors === 'object') {
          const keys = Object.keys(d.errors as Record<string, unknown>).filter((k): k is CycleKey =>
            ALL_DIALS.some((dial) => dial.key === k),
          );
          setFieldErrors(new Set(keys));
          setBanner(t('checkFields'));
          return;
        }
      }
      setBanner(getError(e));
    },
  });

  const s = settings.data;
  const value = (dial: CycleDial) => draft[dial.key] ?? toText(dial.kind, s?.[dial.key] as number | undefined);
  const dirty = Object.keys(draft) as CycleKey[];

  // Aviso PREVENTIVO de la regla cruzada sobre el estado resultante (⛔ no bloquea: el servidor decide).
  const resulting = (k: CycleKey) => {
    const dial = ALL_DIALS.find((x) => x.key === k)!;
    return k in draft ? fromText(dial.kind, draft[k]!) : (s?.[k] as number | undefined);
  };
  const fee = resulting('buylistShippingFeeCents');
  const net = resulting('buylistMinimumOfferNetCents');
  const min = resulting('buylistMinimumRequestCents');
  const crossWarn =
    dirty.some((k) => CROSS_KEYS.includes(k)) &&
    [fee, net, min].every((v) => typeof v === 'number' && Number.isFinite(v)) &&
    fee! + net! > min!;

  function patch(): Partial<SettingsDTO> {
    const out: Record<string, number> = {};
    for (const k of dirty) out[k] = fromText(ALL_DIALS.find((d) => d.key === k)!.kind, draft[k]!);
    return out as Partial<SettingsDTO>;
  }

  return (
    <section className="flex flex-col gap-3" data-testid="m10-buylist-cycle">
      <h2 className="text-h2 font-semibold">{t('title')}</h2>
      <p className="text-sm text-muted">{t('subtitle')}</p>
      <QueryState isLoading={settings.isLoading} isError={settings.isError} error={settings.error} onRetry={() => settings.refetch()}>
        {s && (
          <div className="flex flex-col gap-5 rounded-lg border border-border bg-surface p-4">
            {banner && (
              <Banner variant="danger" role="alert">
                <span data-testid="m10-cycle-error">{banner}</span>
              </Banner>
            )}
            {BUYLIST_CYCLE_GROUPS.map((g) => (
              <div key={g.group} className="flex flex-col gap-3">
                <h3 className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">{t(`groups.${g.group}`)}</h3>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {g.dials.map((dial) => {
                    const bad = fieldErrors.has(dial.key);
                    return (
                      <Input
                        key={dial.key}
                        label={t(`labels.${dial.key}`)}
                        hint={bad ? undefined : t(`help.${dial.key}`)}
                        error={bad ? t(`rule.${dial.key}`) : undefined}
                        type="text"
                        inputMode={dial.kind === 'cents' ? 'decimal' : 'numeric'}
                        prefix={dial.kind === 'cents' ? 'MX$' : undefined}
                        value={value(dial)}
                        onChange={(e) => {
                          setDraft((prev) => ({ ...prev, [dial.key]: e.target.value }));
                          setFieldErrors((cur) => {
                            if (!cur.has(dial.key)) return cur;
                            const next = new Set(cur);
                            next.delete(dial.key);
                            return next;
                          });
                        }}
                        data-testid={`m10-cycle-${dial.key}`}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
            {crossWarn && (
              <Banner variant="warning" role="status">
                {t('cross', {
                  fee: formatMoneyCents(fee!, locale),
                  net: formatMoneyCents(net!, locale),
                  min: formatMoneyCents(min!, locale),
                })}
              </Banner>
            )}
            <div className="flex items-center gap-3">
              <Button disabled={dirty.length === 0} loading={save.isPending} onClick={() => save.mutate(patch())} data-testid="m10-cycle-save">
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
          </div>
        )}
      </QueryState>
    </section>
  );
}
