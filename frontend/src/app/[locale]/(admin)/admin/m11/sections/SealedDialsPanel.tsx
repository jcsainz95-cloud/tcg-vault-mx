'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Save } from 'lucide-react';
import { getSettings, updateSettings } from '@/lib/api';
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

/** Una subsección de «Ajustes avanzados» con rótulo llano y una línea de «para qué sirve». */
function AdvancedSubsection({
  title,
  purpose,
  children,
}: {
  title: string;
  purpose: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold text-text">{title}</h3>
        <p className="text-xs text-muted">{purpose}</p>
      </div>
      {children}
    </div>
  );
}

/**
 * §diseño §5 — contenido de «Ajustes avanzados (precios de mercado)» (`super_admin`, plegado por
 * defecto en la vista). TRES subsecciones, cada una con rótulo llano y una línea de propósito —
 * resuelve «hay dos apartados de diales y no sé qué hace cada uno»:
 *
 *  - **5.1 Fuente automática de mercado:** el interruptor `sealed_price_source` (encender/APAGAR)
 *    con su confirmación money-global (I-7: apagar NO borra los precios manuales/overrides). El
 *    botón «Traer precios» ya NO vive aquí: subió a la capa 2 («Actualizar precios de la colección»).
 *  - **5.2 Cómo se calculan los precios:** los tres selects de settings (`pricingProviderSealed`,
 *    `sealedValueTrend`, `sealedRestockAlerts`) por `PUT /admin/settings` parcial.
 *  - **5.3 Márgenes de venta:** `SealedSpreadsSection` tal cual (su lógica money-safe no se toca).
 *
 * ⛔ No introduce una segunda ruta de escritura: llama a las mismas puertas auditadas de siempre.
 */
export function SealedDialsPanel({ onChanged }: { onChanged?: () => void }) {
  const t = useTranslations('admin.m11.dialsPanel');
  const tAdvanced = useTranslations('admin.m11.advanced');
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
            {/* ── 5.1 Fuente automática de mercado (encender/apagar) ───────────────────────── */}
            <AdvancedSubsection
              title={tAdvanced('source.title')}
              purpose={tAdvanced('source.purpose')}
            >
              <Banner variant={masterOn ? 'success' : 'info'} role="status">
                {masterOn ? t('master.stateOn') : t('master.stateOff')}
              </Banner>
              <div>
                <Button
                  variant={masterOn ? 'secondary' : 'primary'}
                  onClick={() => setConfirming(masterOn ? 'off' : 'on')}
                >
                  {masterOn ? t('master.turnOff') : t('master.turnOn')}
                </Button>
              </div>
            </AdvancedSubsection>

            {/* ── 5.2 Cómo se calculan los precios (diales de settings, PUT parcial) ───────── */}
            <AdvancedSubsection
              title={tAdvanced('calc.title')}
              purpose={tAdvanced('calc.purpose')}
            >
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
            </AdvancedSubsection>
          </>
        )}
      </QueryState>

      {/* ── 5.3 Márgenes de venta del sellado (spreads, lógica intacta) ──────────────────── */}
      <AdvancedSubsection
        title={tAdvanced('margins.title')}
        purpose={tAdvanced('margins.purpose')}
      >
        <SealedSpreadsSection />
      </AdvancedSubsection>

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
