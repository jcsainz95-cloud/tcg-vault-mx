'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Save } from 'lucide-react';
import { getSettings, updateSettings } from '@/lib/api';
import { asApiError } from '@/lib/api-client';
import { useRole } from '@/lib/role';
import type { SettingsDTO } from '@/types/contract';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Banner } from '@/components/ui/Banner';
import { QueryState, useErrorMessage } from '@/components/ui/QueryState';

/** Claves que edita esta sección (candado REL-S7 en `M10View.test.tsx`: cada dial en UN solo bloque de M10). */
export const SPANISH_MARKET_DIAL_KEYS = ['spanishMarketPct'] as const satisfies readonly (keyof SettingsDTO)[];

/** §IDS.7: entero en `[1, 200]`. Lo que no lo es no viaja (el servidor valida igual y su `422` se pinta tal cual). */
export function parseSpanishMarketPct(raw: string): number | null {
  const v = raw.trim();
  if (!/^\d+$/.test(v)) return null;
  const n = Number(v);
  return n >= 1 && n <= 200 ? n : null;
}

/**
 * 💰 IDS-F7 (API_CONTRACT §IDS.7, PROJECT §IDS.2, criterio 517) — el dial `spanishMarketPct` («X»): valor de mercado
 * del español = el del inglés × X %, y después curva, piso, redondeo e IVA como cualquier carta. Sección propia junto
 * a los diales de IVA.
 *  - **Mismo rol que `PUT /admin/pricing/curve`** (`super_admin`, IDS-B10): para otro rol la sección no existe (ni
 *    lee ajustes). Hoy M10 entera ya va en `SuperAdminOnly`; la guarda propia hace que el día que M10 se abra a otro
 *    rol el dial no lo siga.
 *  - `PUT /admin/settings` parcial con SOLO `spanishMarketPct` (entero). El servidor audita antes → después y dispara
 *    `dial_change` (recalcula toda pieza en español); tras guardar se refresca la bitácora de M10.
 *  - Sin la clave en el `GET` (servidor anterior a §IDS) ⇒ «este servidor todavía no tiene este ajuste», sin campo.
 *  - Texto provisional del contrato («Precio del español (% del inglés)») hasta que ux-ui lo afine (IDS.11).
 */
export function SpanishMarketSection() {
  const { isSuperAdmin } = useRole();
  if (!isSuperAdmin) return null;
  return <SpanishMarketSectionBody />;
}

function SpanishMarketSectionBody() {
  const t = useTranslations('admin.m10.spanishMarket');
  const tc = useTranslations('common');
  const qc = useQueryClient();
  const getError = useErrorMessage('operator');
  const settings = useQuery({ queryKey: ['admin-settings'], queryFn: getSettings });
  const [draft, setDraft] = useState<string | null>(null);
  const [serverRejected, setServerRejected] = useState(false);

  const saved = settings.data?.spanishMarketPct;
  const available = typeof saved === 'number';
  const value = draft ?? (available ? String(saved) : '');
  const parsed = parseSpanishMarketPct(value);
  const dirty = draft !== null && draft !== String(saved);
  const localInvalid = dirty && parsed === null;

  const save = useMutation({
    mutationFn: (pct: number) => updateSettings({ spanishMarketPct: pct }),
    onMutate: () => setServerRejected(false),
    onSuccess: () => {
      setDraft(null);
      void qc.invalidateQueries({ queryKey: ['admin-settings'] });
      void qc.invalidateQueries({ queryKey: ['audit-log'] });
    },
    onError: (e) => {
      const err = asApiError(e);
      setServerRejected(err?.status === 422 && err.code === 'VALIDATION_ERROR');
    },
  });

  const serverDiag = (() => {
    const err = asApiError(save.error);
    if (!err || err.status !== 422 || err.code !== 'VALIDATION_ERROR') return null;
    const errors = err.details?.errors as Record<string, unknown> | undefined;
    const diag = errors?.spanishMarketPct;
    return typeof diag === 'string' ? diag : err.message;
  })();

  const bad = localInvalid || serverRejected;

  return (
    <section
      id="precio-espanol"
      className="flex scroll-mt-24 flex-col gap-3"
      aria-labelledby="m10-spanish-market-title"
      data-testid="m10-spanish-market"
    >
      <h2 id="m10-spanish-market-title" className="text-h2 font-semibold">
        {t('title')}
      </h2>
      <p className="max-w-[70ch] text-sm text-muted">{t('subtitle')}</p>
      <QueryState isLoading={settings.isLoading} isError={settings.isError} error={settings.error} onRetry={() => settings.refetch()}>
        {settings.data && !available && <p className="text-sm text-muted">{t('unavailable')}</p>}
        {settings.data && available && (
          <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
            <div className="flex w-48 flex-col gap-1">
              <Input
                label={t('label')}
                type="text"
                inputMode="numeric"
                suffix="%"
                value={value}
                onChange={(e) => {
                  setDraft(e.target.value);
                  setServerRejected(false);
                }}
                aria-invalid={bad || undefined}
              />
              <p className={localInvalid ? 'text-xs text-accent' : 'text-xs text-muted'}>{localInvalid ? t('invalid') : t('help')}</p>
            </div>
            <p className="font-mono text-[11px] text-muted">{t('audit')}</p>
            <div className="flex items-center gap-3">
              <Button
                disabled={!dirty || parsed === null}
                loading={save.isPending}
                onClick={() => {
                  if (parsed !== null) save.mutate(parsed);
                }}
                data-testid="m10-spanish-market-save"
              >
                <Save size={18} /> {t('save')}
              </Button>
              {dirty && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setDraft(null);
                    setServerRejected(false);
                  }}
                >
                  {tc('cancel')}
                </Button>
              )}
            </div>
            {save.isSuccess && !dirty && (
              <Banner variant="success" role="status">
                {t('saved')}
              </Banner>
            )}
            {save.isError && (
              <Banner variant="danger" role="alert">
                {serverDiag !== null ? (
                  <>
                    <p>{t('serverError')}</p>
                    <p className="mt-1 font-mono text-[11px] text-muted">{serverDiag}</p>
                  </>
                ) : (
                  getError(save.error)
                )}
              </Banner>
            )}
          </div>
        )}
      </QueryState>
    </section>
  );
}
