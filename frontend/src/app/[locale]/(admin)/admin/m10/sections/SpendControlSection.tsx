'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { getSettings, updateSettings } from '@/lib/api';
import { asApiError } from '@/lib/api-client';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { QueryState, useErrorMessage } from '@/components/ui/QueryState';
import { SPEND_ALERT_SWITCHABLE_CODES, type EditableSettingsPatch, type SettingsDTO, type SpendAlertCode } from '@/types/contract';
import { pesosToCents } from '../../m4/pesosToCents';
import { useIsOwner, useOwnerOnlyDenied } from '../../_owner/useIsOwner';
import { ALWAYS_ON_CODES } from '../../spend-alerts/filters';

/**
 * **«Configuración › Control del gasto»** (`DESIGN_SYSTEM §43.19.10a` · contrato `§M4-SHIP.19.29.8` + §19.30.2 (1)).
 * Sección propia (gobierna dinero), justo después de «Envíos», `id="control-gasto"` (destino del enlace «Cambiar el
 * tope» de un aviso).
 *
 * - 🔒 Son diales del DUEÑO (`OWNER_ONLY_SETTING_KEYS`): a cualquier otra cuenta se le ven deshabilitados con su frase,
 *   y si el servidor responde `403 OWNER_ONLY_SETTING {keys}` se dice qué campos, por sus `keys`.
 * - Validación de rangos antes del `PUT` (⛔ 0 peticiones con un error); `422` del servidor ⇒ bajo su campo.
 * - **Apagar un aviso pide confirmación** (lo apagado no manda correo, pero se registra: §43.20.5); encender o mover
 *   cifras no pregunta. Lo que se manda es la lista de los DESMARCADOS (`spendAlertsDisabled`), solo de los trece.
 * - AG-21 y AG-22 (OWN-3) van tras los trece, marcados y deshabilitados («Siempre encendido»); ⛔ nunca en el `PUT`.
 */

type Field =
  | 'operatorLabelCap24hCents'
  | 'shippingLabelReissueMaxPerShipment'
  | 'spendAlertLabelCapWarnPct'
  | 'spendAlertShipmentCancelCount'
  | 'spendAlertPersonCancelCount24h'
  | 'spendAlertChargeDriftImmediateCents'
  | 'spendAlertExtraChargeImmediateCents'
  | 'spendAlertCancelRefundDays'
  | 'spendAlertLabelNotShippedDays';

/** Campo ⇒ (clave i18n, tipo, rango). Los rangos son los validadores de §19.29.8. */
const FIELDS: Record<Field, { key: string; kind: 'pesos' | 'int'; min: number; max?: number; suffix?: 'pct' | 'days' }> = {
  operatorLabelCap24hCents: { key: 'cap', kind: 'pesos', min: 100, max: 100_000_000 },
  shippingLabelReissueMaxPerShipment: { key: 'reissue', kind: 'int', min: 0, max: 10 },
  spendAlertLabelCapWarnPct: { key: 'warnPct', kind: 'int', min: 1, max: 99, suffix: 'pct' },
  spendAlertShipmentCancelCount: { key: 'shipmentCancels', kind: 'int', min: 1, max: 10 },
  spendAlertPersonCancelCount24h: { key: 'personCancels', kind: 'int', min: 1, max: 50 },
  spendAlertChargeDriftImmediateCents: { key: 'drift', kind: 'pesos', min: 0 },
  spendAlertExtraChargeImmediateCents: { key: 'extra', kind: 'pesos', min: 0 },
  spendAlertCancelRefundDays: { key: 'refundDays', kind: 'int', min: 1, max: 30, suffix: 'days' },
  spendAlertLabelNotShippedDays: { key: 'notShippedDays', kind: 'int', min: 1, max: 30, suffix: 'days' },
};
const STAFF: Field[] = ['operatorLabelCap24hCents', 'shippingLabelReissueMaxPerShipment'];
const WHEN: Field[] = [
  'spendAlertLabelCapWarnPct',
  'spendAlertShipmentCancelCount',
  'spendAlertPersonCancelCount24h',
  'spendAlertChargeDriftImmediateCents',
  'spendAlertExtraChargeImmediateCents',
  'spendAlertCancelRefundDays',
  'spendAlertLabelNotShippedDays',
];
/** La gravedad de cada aviso para la casilla (§43.19.10a (3) + §43.20.5: una frase por código donde «según el caso»). */
const SEVERITY: Record<string, 'immediate' | 'digest' | 'byAmount' | 'sevAG1' | 'sevAG9' | 'sevAG22'> = {
  'AG-1': 'sevAG1',
  'AG-2': 'digest',
  'AG-3': 'immediate',
  'AG-4': 'immediate',
  'AG-5': 'byAmount',
  'AG-6': 'byAmount',
  'AG-7': 'immediate',
  'AG-8': 'immediate',
  'AG-9': 'sevAG9',
  'AG-10': 'digest',
  'AG-11': 'immediate',
  'AG-12': 'digest',
  'AG-13': 'digest',
  'AG-21': 'immediate',
  'AG-22': 'sevAG22',
};

const toText = (f: Field, v: number | undefined) => (v === undefined ? '' : FIELDS[f].kind === 'pesos' ? (v / 100).toFixed(2) : String(v));
function parse(f: Field, text: string): number | null {
  const spec = FIELDS[f];
  if (spec.kind === 'pesos') return pesosToCents(text);
  const n = Number(text.trim());
  return text.trim() !== '' && Number.isInteger(n) ? n : null;
}
function invalid(f: Field, text: string): boolean {
  const n = parse(f, text);
  const spec = FIELDS[f];
  return n === null || n < spec.min || (spec.max !== undefined && n > spec.max);
}

export function SpendControlSection() {
  const t = useTranslations('admin.m10.spend');
  const settings = useQuery({ queryKey: ['admin-settings'], queryFn: getSettings });
  const available = settings.data?.operatorLabelCap24hCents !== undefined;
  return (
    <section id="control-gasto" className="flex flex-col gap-4" data-testid="spend-control-section">
      <div className="flex flex-col gap-1">
        <h2 className="text-h2 font-semibold">{t('title')}</h2>
        <p className="text-sm text-muted">{t('subtitle')}</p>
      </div>
      <QueryState isLoading={settings.isLoading} isError={settings.isError} error={settings.error} onRetry={() => settings.refetch()}>
        {settings.data &&
          (!available ? (
            <p className="text-sm text-text">{t('notAvailable')}</p>
          ) : (
            <SpendControlForm key={JSON.stringify(settings.data)} settings={settings.data} />
          ))}
      </QueryState>
    </section>
  );
}

function SpendControlForm({ settings }: { settings: SettingsDTO }) {
  const t = useTranslations('admin.m10.spend');
  const tOwner = useTranslations('admin.m10.ownerOnly');
  const tAlerts = useTranslations('admin.spendAlerts');
  const getError = useErrorMessage('operator');
  const ownerDenied = useOwnerOnlyDenied();
  const { isOwner } = useIsOwner();
  const qc = useQueryClient();
  const [values, setValues] = useState<Record<Field, string>>(
    () => Object.fromEntries((Object.keys(FIELDS) as Field[]).map((f) => [f, toText(f, settings[f])])) as Record<Field, string>,
  );
  const initiallyOff = new Set<SpendAlertCode>(settings.spendAlertsDisabled ?? []);
  const [off, setOff] = useState<Set<SpendAlertCode>>(new Set(initiallyOff));
  const [tried, setTried] = useState(false);
  const [serverField, setServerField] = useState<Field | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const backRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (confirmOpen) backRef.current?.focus();
  }, [confirmOpen]);

  const errors = (Object.keys(FIELDS) as Field[]).filter((f) => invalid(f, values[f]));
  const newlyOff = [...off].filter((c) => !initiallyOff.has(c));

  const save = useMutation({
    mutationFn: () => {
      const patch: EditableSettingsPatch = {};
      for (const f of Object.keys(FIELDS) as Field[]) (patch as Record<string, unknown>)[f] = parse(f, values[f]);
      // Lo que se manda son los DESMARCADOS, en el orden de la lista (⛔ nunca los marcados).
      patch.spendAlertsDisabled = SPEND_ALERT_SWITCHABLE_CODES.filter((c) => off.has(c));
      return updateSettings(patch);
    },
    onSuccess: () => {
      setConfirmOpen(false);
      setServerError(null);
      setServerField(null);
      void qc.invalidateQueries({ queryKey: ['admin-settings'] });
    },
    onError: (e) => {
      setConfirmOpen(false);
      const err = asApiError(e);
      const field = (err?.details as { field?: unknown } | undefined)?.field;
      if ((err?.status === 422 || err?.status === 400) && typeof field === 'string' && field in FIELDS) {
        setServerField(field as Field);
        setServerError(null);
        return;
      }
      setServerError(ownerDenied(e) ?? getError(e));
    },
  });

  function submit() {
    setTried(true);
    setServerField(null);
    if (errors.length > 0) return; // ⛔ 0 PUT con un error de campo
    if (newlyOff.length > 0) {
      setConfirmOpen(true); // apagar pregunta; ⛔ sin PUT hasta confirmar
      return;
    }
    save.mutate();
  }

  const field = (f: Field) => {
    const spec = FIELDS[f];
    const showError = (tried && errors.includes(f)) || serverField === f;
    return (
      <div key={f} className="flex flex-col gap-1">
        <Input
          label={t(`${spec.key}.label`)}
          hint={t(`${spec.key}.hint`)}
          error={showError ? t(`${spec.key}.error`) : undefined}
          inputMode={spec.kind === 'pesos' ? 'decimal' : 'numeric'}
          prefix={spec.kind === 'pesos' ? 'MX$' : undefined}
          value={values[f]}
          disabled={!isOwner}
          aria-invalid={showError || undefined}
          onChange={(e) => setValues((v) => ({ ...v, [f]: e.target.value }))}
        />
        {spec.suffix && <span className="text-xs text-muted">{spec.suffix === 'pct' ? '%' : t('days')}</span>}
      </div>
    );
  };

  const offList = newlyOff.map((c) => tAlerts('filters.kindOption', { code: c, title: tAlerts(`kind.${c}.title`) })).join(', ');

  return (
    <div className="flex flex-col gap-6">
      {!isOwner && (
        <p className="text-sm text-muted" data-testid="spend-control-owner-only">
          {tOwner('note')}
        </p>
      )}
      <div className="flex flex-col gap-3">
        <h3 className="text-lg font-semibold text-text">{t('staff.title')}</h3>
        {STAFF.map(field)}
      </div>
      <div className="flex flex-col gap-3">
        <h3 className="text-lg font-semibold text-text">{t('when.title')}</h3>
        {WHEN.map(field)}
        <p className="text-sm text-muted">
          <a href="#compra-guias" className="underline underline-offset-4 hover:text-accent">
            {t('lowBalanceNote')}
          </a>
        </p>
      </div>
      <fieldset className="flex flex-col gap-2" data-testid="spend-control-alerts">
        <legend className="mb-2 text-lg font-semibold text-text">{t('alerts.legend')}</legend>
        {SPEND_ALERT_SWITCHABLE_CODES.map((c) => (
          <label key={c} className="flex items-start gap-3">
            <input
              type="checkbox"
              className="mt-1"
              checked={!off.has(c)}
              disabled={!isOwner}
              onChange={(e) =>
                setOff((s) => {
                  const n = new Set(s);
                  if (e.target.checked) n.delete(c);
                  else n.add(c);
                  return n;
                })
              }
            />
            <span className="flex flex-col">
              <span className="text-sm text-text">{t('alerts.option', { code: c, title: tAlerts(`kind.${c}.title`) })}</span>
              <span className="text-xs text-muted">{t(`alerts.${SEVERITY[c]}`)}</span>
            </span>
          </label>
        ))}
        {ALWAYS_ON_CODES.map((c) => (
          <label key={c} className="flex items-start gap-3" data-testid={`spend-control-always-${c}`}>
            <input type="checkbox" className="mt-1" checked disabled readOnly aria-describedby="spend-control-always-on" />
            <span className="flex flex-col">
              <span className="text-sm text-text">{t('alerts.option', { code: c, title: tAlerts(`kind.${c}.title`) })}</span>
              <span className="text-xs text-muted">{t(`alerts.${SEVERITY[c]}`)}</span>
            </span>
          </label>
        ))}
        <p id="spend-control-always-on" className="text-xs text-muted">
          {t('alerts.alwaysOn')}
        </p>
        <p className="text-sm text-muted">{t('alerts.note')}</p>
      </fieldset>
      <div className="flex flex-col gap-2">
        <Button className="self-start" disabled={!isOwner} loading={save.isPending && !confirmOpen} onClick={submit}>
          {t('save')}
        </Button>
        {save.isSuccess && (
          <Banner variant="success" role="status">
            {t('saved')}
          </Banner>
        )}
        {serverError && (
          <Banner variant="danger" role="alert">
            {serverError}
          </Banner>
        )}
      </div>
      <Modal
        open={confirmOpen}
        onClose={() => !save.isPending && setConfirmOpen(false)}
        title={t('offTitle', { n: newlyOff.length })}
        footer={
          <>
            <Button ref={backRef} variant="secondary" onClick={() => setConfirmOpen(false)} disabled={save.isPending}>
              {t('back')}
            </Button>
            <Button variant="destructive" loading={save.isPending} onClick={() => save.mutate()}>
              {t('offConfirm')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-text">{t('offBody', { list: offList })}</p>
      </Modal>
    </div>
  );
}
