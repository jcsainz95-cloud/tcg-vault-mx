'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Save, DownloadCloud } from 'lucide-react';
import { getSettings, updateSettings, triggerSealedPriceIngest } from '@/lib/api';
import type { EditableSettingsPatch, SealedPriceSource, SettingsDTO } from '@/types/contract';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { Banner } from '@/components/ui/Banner';
import { Modal } from '@/components/ui/Modal';
import { QueryState, useErrorMessage } from '@/components/ui/QueryState';
import { SealedSpreadsSection } from './SealedSpreadsSection';

/** Proveedores válidos de la referencia por-carta del sellado (contrato §M10 · `PriceSource`). */
const PRICE_PROVIDER_OPTIONS = ['pokemontcg_io', 'pokemonpricetracker', 'poketrace', 'manual'] as const;
const ON_OFF = ['off', 'on'] as const;

/** Lee un `on|off` del settings tratando la ausencia como `off` (fail-closed, igual que el seed). */
function onOff(value: string | undefined): 'on' | 'off' {
  return value === 'on' ? 'on' : 'off';
}

/**
 * §diseño §1.iv/§3/§9 — panel `super_admin` de los diales de precio del SELLADO, superficie ÚNICA de
 * edición (D-2). Reúne, sin reimplementar lógica de dinero:
 *  - El **interruptor maestro** `sealed_price_source` (`off | tcgcsv`) con **confirmación money-global**
 *    (I-7: apagarlo NO borra los precios manuales/overrides ya fijados).
 *  - El botón **«Traer precios ahora»** (`POST /admin/jobs/sealed-price-ingest`) con sus 3 estados.
 *  - Los diales de settings del sellado (`pricingProviderSealed`, `sealedValueTrend`,
 *    `sealedRestockAlerts`) por `PUT /admin/settings` (body parcial, misma validación/auditoría).
 *  - El editor de **spreads** (`SealedSpreadsSection`), movido de M2.
 *
 * ⛔ No introduce una segunda ruta de escritura: llama exactamente a las mismas puertas auditadas.
 */
export function SealedDialsPanel({ onChanged }: { onChanged?: () => void }) {
  const t = useTranslations('admin.m11.dialsPanel');
  const tc = useTranslations('common');
  const qc = useQueryClient();
  const getError = useErrorMessage('operator');

  const settings = useQuery({ queryKey: ['admin-settings'], queryFn: getSettings });

  // Borrador de los diales de settings (PUT parcial: solo las keys tocadas).
  const [draft, setDraft] = useState<Partial<Record<keyof SettingsDTO, string>>>({});
  const dirtyKeys = Object.keys(draft) as (keyof SettingsDTO)[];

  const saveMutation = useMutation({
    mutationFn: (patch: EditableSettingsPatch) => updateSettings(patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-settings'] });
      setDraft({});
      onChanged?.();
    },
  });

  // --- Interruptor maestro `sealed_price_source` (acto de dinero global) ---
  const savedSource: SealedPriceSource = settings.data?.sealedPriceSource ?? 'off';
  const masterOn = savedSource === 'tcgcsv';
  // La confirmación pide el SENTIDO del cambio propuesto (encender / apagar).
  const [confirming, setConfirming] = useState<null | 'on' | 'off'>(null);
  const masterMutation = useMutation({
    mutationFn: (next: SealedPriceSource) => updateSettings({ sealedPriceSource: next }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-settings'] });
      setConfirming(null);
      onChanged?.();
    },
  });

  // --- Botón «Traer precios ahora» (§9). Deshabilitado con el dial `off` (fail-closed, I-2). ---
  const [ingestState, setIngestState] = useState<'done' | 'off' | 'inFlight' | null>(null);
  const ingestMutation = useMutation({
    mutationFn: () => triggerSealedPriceIngest(),
    onSuccess: (res) => {
      if (res.enqueued) {
        setIngestState('done');
        // La respuesta (202) NO trae conteos; se refresca la vista de estado (§10) para ver el
        // resultado real (cuántos sets pasaron a «con precio»).
        qc.invalidateQueries({ queryKey: ['sealed-price-status'] });
        onChanged?.();
      } else if (res.reason === 'SEALED_PRICE_SOURCE_OFF') {
        setIngestState('off');
      } else {
        setIngestState('inFlight');
      }
    },
  });

  function currentOnOff(key: 'sealedValueTrend' | 'sealedRestockAlerts'): 'on' | 'off' {
    if (key in draft) return onOff(draft[key]);
    return onOff(settings.data?.[key]);
  }
  function currentProvider(): string {
    return draft.pricingProviderSealed ?? settings.data?.pricingProviderSealed ?? '';
  }

  function buildPatch(): EditableSettingsPatch {
    const patch: Record<string, string> = {};
    for (const key of dirtyKeys) patch[key] = draft[key]!;
    return patch as EditableSettingsPatch;
  }

  return (
    <div className="flex flex-col gap-8">
      <QueryState
        isLoading={settings.isLoading}
        isError={settings.isError}
        error={settings.error}
        onRetry={() => settings.refetch()}
      >
        {settings.data && (
          <>
            {/* ── Interruptor maestro + traer precios ──────────────────────────────────────── */}
            <div className="flex flex-col gap-4 rounded-lg border border-primary/40 bg-surface p-4">
              <div className="flex flex-col gap-1">
                <h3 className="text-sm font-semibold text-text">{t('master.title')}</h3>
                <p className="text-xs text-muted">{t('master.subtitle')}</p>
              </div>

              <Banner variant={masterOn ? 'success' : 'info'} role="status">
                {masterOn ? t('master.stateOn') : t('master.stateOff')}
              </Banner>

              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant={masterOn ? 'secondary' : 'primary'}
                  onClick={() => setConfirming(masterOn ? 'off' : 'on')}
                >
                  {masterOn ? t('master.turnOff') : t('master.turnOn')}
                </Button>

                {/* «Traer precios ahora» (§9): deshabilitado con el dial off; el aviso explica por qué. */}
                <Button
                  variant="secondary"
                  disabled={!masterOn || ingestMutation.isPending}
                  loading={ingestMutation.isPending}
                  onClick={() => {
                    setIngestState(null);
                    ingestMutation.mutate();
                  }}
                >
                  <DownloadCloud size={16} /> {t('ingest.cta')}
                </Button>
              </div>

              {/* Con el dial off, el botón no ingiere (I-2): se dice por qué, no se queda mudo. */}
              {!masterOn && (
                <p className="text-xs text-muted">{t('ingest.offHint')}</p>
              )}
              {ingestState === 'done' && (
                <Banner variant="success" role="status">{t('ingest.done')}</Banner>
              )}
              {ingestState === 'off' && (
                <Banner variant="info" role="status">{t('ingest.offReason')}</Banner>
              )}
              {ingestState === 'inFlight' && (
                <Banner variant="info" role="status">{t('ingest.inFlight')}</Banner>
              )}
              {ingestMutation.isError && (
                <Banner variant="danger" role="alert" title={tc('errorTitle')}>
                  {getError(ingestMutation.error)}
                </Banner>
              )}
            </div>

            {/* ── Diales de settings del sellado (PUT /admin/settings parcial) ─────────────── */}
            <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
              <div className="flex flex-col gap-1">
                <h3 className="text-sm font-semibold text-text">{t('settings.title')}</h3>
                <p className="text-xs text-muted">{t('settings.subtitle')}</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Select
                  label={t('settings.pricingProviderSealed')}
                  options={PRICE_PROVIDER_OPTIONS.map((v) => ({ value: v, label: v }))}
                  value={currentProvider()}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, pricingProviderSealed: e.target.value }))
                  }
                />
                <Select
                  label={t('settings.sealedValueTrend')}
                  options={ON_OFF.map((v) => ({ value: v, label: t(`onOff.${v}`) }))}
                  value={currentOnOff('sealedValueTrend')}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, sealedValueTrend: e.target.value }))
                  }
                />
                <Select
                  label={t('settings.sealedRestockAlerts')}
                  options={ON_OFF.map((v) => ({ value: v, label: t(`onOff.${v}`) }))}
                  value={currentOnOff('sealedRestockAlerts')}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, sealedRestockAlerts: e.target.value }))
                  }
                />
              </div>
              <div className="flex items-center gap-3">
                <Button
                  disabled={dirtyKeys.length === 0}
                  loading={saveMutation.isPending}
                  onClick={() => saveMutation.mutate(buildPatch())}
                >
                  <Save size={18} /> {t('settings.save', { count: dirtyKeys.length })}
                </Button>
                {dirtyKeys.length > 0 && (
                  <Button variant="ghost" onClick={() => setDraft({})}>
                    {tc('cancel')}
                  </Button>
                )}
              </div>
              {saveMutation.isSuccess && (
                <Banner variant="success" role="status">{t('settings.saved')}</Banner>
              )}
              {saveMutation.isError && (
                <Banner variant="danger" role="alert" title={tc('errorTitle')}>
                  {getError(saveMutation.error)}
                </Banner>
              )}
            </div>
          </>
        )}
      </QueryState>

      {/* ── Spreads de venta del sellado (editor MOVIDO de M2) ───────────────────────────── */}
      <SealedSpreadsSection />

      {/* ── Confirmación money-global del interruptor maestro (§3, I-7) ──────────────────── */}
      <Modal
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        title={confirming === 'on' ? t('master.confirmOnTitle') : t('master.confirmOffTitle')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirming(null)}>
              {tc('cancel')}
            </Button>
            <Button
              variant={confirming === 'on' ? 'primary' : 'secondary'}
              loading={masterMutation.isPending}
              onClick={() => masterMutation.mutate(confirming === 'on' ? 'tcgcsv' : 'off')}
            >
              {confirming === 'on' ? t('master.turnOn') : t('master.turnOff')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <p>{confirming === 'on' ? t('master.confirmOnBody') : t('master.confirmOffBody')}</p>
          {/* I-7: el copy de APAGAR dice EXPLÍCITO que los precios manuales/overrides NO se apagan. */}
          {confirming === 'off' && (
            <Banner variant="warning" role="status">{t('master.confirmOffPreserved')}</Banner>
          )}
          <p className="font-mono text-[11px] text-muted">{t('master.audit')}</p>
          {masterMutation.isError && (
            <Banner variant="danger" role="alert" title={tc('errorTitle')}>
              {getError(masterMutation.error)}
            </Banner>
          )}
        </div>
      </Modal>
    </div>
  );
}
