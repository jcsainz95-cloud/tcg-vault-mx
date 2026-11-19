'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Save } from 'lucide-react';
import { getSettings, updateSettings } from '@/lib/api';
import { asApiError } from '@/lib/api-client';
import type { SettingsDTO } from '@/types/contract';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Banner } from '@/components/ui/Banner';
import { QueryState, useErrorMessage } from '@/components/ui/QueryState';

type V3NumKey = 'shipSkydropxMaxPerMin' | 'shipCacheTtlS';

/** Rangos del servidor (`settings.constants.ts`: `validateIntRange`). La pantalla solo adelanta el error; el servidor manda. */
const NUM_DIALS: ReadonlyArray<{ key: V3NumKey; min: number; max: number }> = [
  { key: 'shipSkydropxMaxPerMin', min: 1, max: 600 },
  { key: 'shipCacheTtlS', min: 60, max: 86_400 },
];

/** Claves que edita esta sección (candado REL-S7: cada dial en UN solo bloque de M10). */
export const SHIP_V3_DIAL_KEYS = ['shipV3Enabled', 'shipSkydropxMaxPerMin', 'shipCacheTtlS'] as const;

function parseInt10(text: string, min: number, max: number): number | null {
  const s = text.trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n >= min && n <= max ? n : null;
}

/**
 * §ENV3 — «Envío calculado por código postal»: interruptor `shipV3Enabled` (encender pide confirmación; apagar vuelve a
 * la regla fija de «Envío a domicilio» sin preguntar) y los dos diales de Skydropx. Solo `super_admin` (la página entera va
 * en `SuperAdminOnly`, igual que sus vecinos). `PUT` parcial; `422` por campo.
 */
export function ShipV3Section() {
  const t = useTranslations('admin.m10.shipV3');
  const tc = useTranslations('common');
  const qc = useQueryClient();
  const getError = useErrorMessage('operator');
  const settings = useQuery({ queryKey: ['admin-settings'], queryFn: getSettings });
  const [draft, setDraft] = useState<Partial<Record<V3NumKey, string>>>({});
  const [fieldErrors, setFieldErrors] = useState<Set<V3NumKey>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);

  const s = settings.data;
  const available = !!s && (s.shipV3Enabled === 'on' || s.shipV3Enabled === 'off');
  const on = s?.shipV3Enabled === 'on';
  const saved = (k: V3NumKey) => (s?.[k] == null ? '' : String(s[k]));
  const dirty = (Object.keys(draft) as V3NumKey[]).filter((k) => draft[k] !== saved(k));
  const localInvalid = new Set(
    dirty.filter((k) => {
      const d = NUM_DIALS.find((x) => x.key === k)!;
      return parseInt10(draft[k]!, d.min, d.max) === null;
    }),
  );

  const save = useMutation({
    mutationFn: (p: Partial<SettingsDTO>) => updateSettings(p),
    onMutate: () => {
      setFieldErrors(new Set());
      setBanner(null);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-settings'] });
      setDraft({});
      setConfirming(false);
    },
    onError: (e) => {
      setConfirming(false);
      const err = asApiError(e);
      const errors = err?.details?.errors;
      if (err?.status === 422 && err.code === 'VALIDATION_ERROR' && errors && typeof errors === 'object') {
        setFieldErrors(new Set(Object.keys(errors as Record<string, unknown>).filter((k): k is V3NumKey => NUM_DIALS.some((d) => d.key === k))));
        setBanner(t('checkFields'));
        return;
      }
      setBanner(getError(e));
    },
  });

  function numbersPatch(): Partial<SettingsDTO> {
    const out: Partial<Record<V3NumKey, number>> = {};
    for (const k of dirty) {
      const d = NUM_DIALS.find((x) => x.key === k)!;
      const n = parseInt10(draft[k]!, d.min, d.max);
      if (n !== null) out[k] = n;
    }
    return out;
  }

  return (
    <section id="envio-cp" className="flex scroll-mt-24 flex-col gap-3" data-testid="m10-ship-v3">
      <h2 className="text-h2 font-semibold">{t('title')}</h2>
      <QueryState isLoading={settings.isLoading} isError={settings.isError} error={settings.error} onRetry={() => settings.refetch()}>
        {s && !available && <p className="text-sm text-muted">{t('unavailable')}</p>}
        {s && available && (
          <div className="flex flex-col gap-5 rounded-lg border border-border bg-surface p-4">
            {banner && (
              <Banner variant="danger" role="alert">
                {banner}
              </Banner>
            )}
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-col gap-1">
                  <p id="ship-v3-label" className="text-sm font-medium">
                    {t('switchLabel')}
                  </p>
                  <p className="text-xs text-muted">{t('switchHelp')}</p>
                  <p className="text-xs" data-testid="ship-v3-state">
                    {on ? t('stateOn') : t('stateOff')}
                  </p>
                </div>
                <Button
                  role="switch"
                  aria-checked={on}
                  aria-labelledby="ship-v3-label"
                  variant={on ? 'secondary' : 'primary'}
                  loading={save.isPending && !confirming && dirty.length === 0}
                  onClick={() => (on ? save.mutate({ shipV3Enabled: 'off' }) : setConfirming(true))}
                  data-testid="ship-v3-toggle"
                >
                  {on ? t('turnOff') : t('turnOn')}
                </Button>
              </div>
              {confirming && (
                <Banner variant="warning" role="alert" aria-label={t('confirmTitle')}>
                  <div data-testid="ship-v3-confirm">
                  <p className="mb-3 text-sm">{t('confirmBody')}</p>
                  <div className="flex gap-3">
                    <Button loading={save.isPending} onClick={() => save.mutate({ shipV3Enabled: 'on' })} data-testid="ship-v3-confirm-yes">
                      {t('confirmYes')}
                    </Button>
                    <Button variant="ghost" onClick={() => setConfirming(false)}>
                      {tc('cancel')}
                    </Button>
                  </div>
                  </div>
                </Banner>
              )}
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              {NUM_DIALS.map(({ key, min, max }) => {
                const bad = fieldErrors.has(key) || localInvalid.has(key);
                return (
                  <div key={key} className="flex flex-col gap-1">
                    <Input
                      label={t(`labels.${key}`)}
                      type="text"
                      inputMode="numeric"
                      value={draft[key] ?? saved(key)}
                      onChange={(e) => {
                        const v = e.target.value;
                        setDraft((p) => ({ ...p, [key]: v }));
                        setFieldErrors((cur) => {
                          if (!cur.has(key)) return cur;
                          const next = new Set(cur);
                          next.delete(key);
                          return next;
                        });
                      }}
                      aria-invalid={bad || undefined}
                    />
                    <p className={bad ? 'text-xs text-accent' : 'text-xs text-muted'}>
                      {bad ? t('invalid', { min, max }) : t(`help.${key}`, { min, max })}
                    </p>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-3">
              <Button
                disabled={dirty.length === 0 || localInvalid.size > 0}
                loading={save.isPending && dirty.length > 0}
                onClick={() => {
                  if (localInvalid.size === 0) save.mutate(numbersPatch());
                }}
                data-testid="m10-ship-v3-save"
              >
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
