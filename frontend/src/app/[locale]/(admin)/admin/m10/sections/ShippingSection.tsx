'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import {
  getSettings,
  getShippingBalance,
  getShippingCatalogs,
  listShippingPackages,
  putShippingPackages,
  searchConsignmentNotes,
  updateSettings,
} from '@/lib/api';
import { asApiError } from '@/lib/api-client';
import { formatMoneyCents, formatTimeMx } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { AppLocale } from '@/i18n/routing';
import type { EditableSettingsPatch, SettingsDTO, ShippingInsuranceTier, ShippingLabelPurchase, ShippingPackageDTO } from '@/types/contract';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { QueryState, useErrorMessage } from '@/components/ui/QueryState';
import { pesosToCents } from '../../m4/pesosToCents';

/**
 * **«Configuración › Envíos (Skydropx)»** (`DESIGN_SYSTEM §43.10` · contrato `§M4-SHIP.19.19.12`,
 * `§19.13`, `§19.20.3`). Sección propia —gobierna dinero (§39.1)— después de `PremiumFloorSection`.
 *
 * - **La puerta** (`shippingLabelPurchase`) se guarda sola, con su frase por modo; **pasar a `operators`
 *   pide confirmación y ⛔ no manda el `PUT` hasta confirmarla** (UX-SDX-17). Bajar no pregunta.
 * - **Escalones de seguro**: coberturas estrictamente crecientes; con error de fila ⛔ cero `PUT`. La
 *   lectura de abajo es **sin aritmética** (SK3): solo dice qué escalón cubre hasta dónde.
 * - Sin los diales en el DTO (servidor anterior a la fase D) la sección lo dice y no inventa valores.
 */

const PURCHASE: ShippingLabelPurchase[] = ['disabled', 'super_admin_only', 'operators'];
const PURCHASE_KEY: Record<ShippingLabelPurchase, string> = { disabled: 'disabled', super_admin_only: 'superAdminOnly', operators: 'operators' };

interface TierRow {
  coverage: string;
  cost: string;
  measuredAt: string;
}
const centsToPesos = (c: number) => (c / 100).toFixed(2);

export function tierErrors(rows: TierRow[]): Record<number, { coverage?: 'coverageMin' | 'notIncreasing'; cost?: 'costNegative'; measuredAt?: 'dateMissing' }> {
  const out: Record<number, { coverage?: 'coverageMin' | 'notIncreasing'; cost?: 'costNegative'; measuredAt?: 'dateMissing' }> = {};
  let prev: number | null = null;
  rows.forEach((r, i) => {
    const e: (typeof out)[number] = {};
    const cov = pesosToCents(r.coverage);
    const cost = pesosToCents(r.cost);
    if (cov === null || cov < 100) e.coverage = 'coverageMin';
    else if (prev !== null && cov <= prev) e.coverage = 'notIncreasing';
    if (cost === null || cost < 0) e.cost = 'costNegative';
    if (!r.measuredAt.trim()) e.measuredAt = 'dateMissing';
    if (cov !== null) prev = cov;
    if (Object.keys(e).length) out[i] = e;
  });
  return out;
}

export function ShippingSection() {
  const t = useTranslations('admin.m10.shipping');
  const tc = useTranslations('common');
  const locale = useLocale() as AppLocale;
  const getError = useErrorMessage('operator');
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ['admin-settings'], queryFn: getSettings });
  const available = settings.data?.shippingProvider !== undefined;
  const balance = useQuery({ queryKey: ['shipping-balance'], queryFn: getShippingBalance, enabled: available, retry: false });
  const catalogs = useQuery({ queryKey: ['shipping-catalogs'], queryFn: getShippingCatalogs, enabled: available, retry: false });

  return (
    <section className="flex flex-col gap-4" data-testid="shipping-section">
      <div className="flex flex-col gap-1">
        <h2 className="text-h2 font-semibold">{t('title')}</h2>
        <p className="text-sm text-muted">{t('subtitle')}</p>
      </div>
      <QueryState isLoading={settings.isLoading} isError={settings.isError} error={settings.error} onRetry={() => settings.refetch()}>
        {settings.data &&
          (!available ? (
            <p className="text-sm text-text">{t('notAvailable')}</p>
          ) : (
            <>
              {balance.isError ? (
                <Banner variant="warning" role="status">
                  {t('balanceError')}
                </Banner>
              ) : balance.data ? (
                <Banner variant="info" role="status">
                  {t('balance', { balance: formatMoneyCents(balance.data.balanceCents, locale), time: formatTimeMx(balance.data.fetchedAt, locale) })}
                  {balance.data.lowBalance && <span className="ml-2 text-accent">{t('lowBalance')}</span>}
                </Banner>
              ) : null}
              <PurchaseDial value={settings.data.shippingLabelPurchase ?? 'disabled'} onSaved={() => void qc.invalidateQueries({ queryKey: ['admin-settings'] })} />
              <ShippingForm
                key={JSON.stringify(settings.data)}
                settings={settings.data}
                catalogs={catalogs.data ?? null}
                onSaved={() => void qc.invalidateQueries({ queryKey: ['admin-settings'] })}
                getError={getError}
                tc={tc}
              />
              <PackagesEditor boxMin={settings.data.shippingPackageRuleBoxMinCards} packagings={catalogs.data?.packagings ?? []} />
            </>
          ))}
      </QueryState>
    </section>
  );
}

function PurchaseDial({ value, onSaved }: { value: ShippingLabelPurchase; onSaved: () => void }) {
  const t = useTranslations('admin.m10.shipping.purchase');
  const tc = useTranslations('common');
  const getError = useErrorMessage('operator');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const backRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (confirmOpen) backRef.current?.focus();
  }, [confirmOpen]);
  const m = useMutation({
    mutationFn: (v: ShippingLabelPurchase) => updateSettings({ shippingLabelPurchase: v }),
    onSuccess: () => {
      setConfirmOpen(false);
      onSaved();
    },
    onError: () => setConfirmOpen(false),
  });
  const choose = (v: ShippingLabelPurchase) => {
    if (v === value) return;
    if (v === 'operators') setConfirmOpen(true); // ⛔ sin PUT hasta confirmar
    else m.mutate(v); // cerrar la puerta no pregunta
  };
  return (
    <fieldset className="flex flex-col gap-2" data-testid="shipping-purchase">
      <legend className="mb-2 text-base font-medium text-text">{t('legend')}</legend>
      {PURCHASE.map((v) => (
        <label key={v} className="flex items-start gap-3">
          <input type="radio" name="shipping-purchase" className="mt-1" checked={value === v} disabled={m.isPending} onChange={() => choose(v)} />
          <span className="flex flex-col">
            <span className="text-sm text-text">{t(PURCHASE_KEY[v])}</span>
            <span className="text-sm text-muted">{t(`${PURCHASE_KEY[v]}Note`)}</span>
          </span>
        </label>
      ))}
      <p className="text-sm text-muted">{t('serverKey')}</p>
      {m.isError && (
        <Banner variant="danger" role="alert">
          {getError(m.error)}
        </Banner>
      )}
      <Modal
        open={confirmOpen}
        onClose={() => !m.isPending && setConfirmOpen(false)}
        title={t('confirmTitle')}
        footer={
          <>
            <Button ref={backRef} variant="secondary" onClick={() => setConfirmOpen(false)} disabled={m.isPending}>
              {tc('cancel')}
            </Button>
            <Button loading={m.isPending} onClick={() => m.mutate('operators')}>
              {t('confirm')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-text">{t('confirmBody')}</p>
      </Modal>
    </fieldset>
  );
}

function ShippingForm({
  settings,
  catalogs,
  onSaved,
  getError,
  tc,
}: {
  settings: SettingsDTO;
  catalogs: { consignmentNote: { code: string; description: string } | null; addressTemplates: { id: string; alias: string; postalCode: string }[] } | null;
  onSaved: () => void;
  getError: (e: unknown) => string;
  tc: ReturnType<typeof useTranslations>;
}) {
  const t = useTranslations('admin.m10.shipping');
  const locale = useLocale() as AppLocale;
  const [tiers, setTiers] = useState<TierRow[]>(
    (settings.shippingInsuranceTiers ?? []).map((x) => ({ coverage: centsToPesos(x.coverageCents), cost: centsToPesos(x.costCents), measuredAt: x.measuredAt.slice(0, 10) })),
  );
  const [note, setNote] = useState(settings.shippingConsignmentNote ?? '');
  const [carriers, setCarriers] = useState<string[]>(settings.shippingPreferredCarriers ?? []);
  const [newCarrier, setNewCarrier] = useState('');
  const [dropoffs, setDropoffs] = useState<Record<string, { name: string; address: string }>>(settings.shippingDropoffPoints ?? {});
  const [origin, setOrigin] = useState(settings.skydropxOriginAddressTemplateId ?? '');
  const [format, setFormat] = useState(settings.shippingLabelFormat ?? 'standard');
  const [lowBalance, setLowBalance] = useState(settings.skydropxLowBalanceCents !== undefined ? centsToPesos(settings.skydropxLowBalanceCents) : '');
  const [poll, setPoll] = useState(String(settings.shippingTrackingPollMinutes ?? ''));
  const [provider, setProvider] = useState(settings.shippingProvider ?? 'off');
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [found, setFound] = useState<{ code: string; description: string }[] | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);

  const rowErrors = tierErrors(tiers);
  const noteInvalid = !/^\d{8}$/.test(note);
  const invalid = Object.keys(rowErrors).length > 0 || noteInvalid;

  const save = useMutation({
    mutationFn: () => {
      const patch: EditableSettingsPatch = {
        shippingProvider: provider,
        shippingInsuranceTiers: tiers.map((r): ShippingInsuranceTier => ({
          coverageCents: pesosToCents(r.coverage) ?? 0,
          costCents: pesosToCents(r.cost) ?? 0,
          measuredAt: r.measuredAt,
        })),
        shippingConsignmentNote: note,
        shippingPreferredCarriers: carriers,
        shippingDropoffPoints: dropoffs,
        skydropxOriginAddressTemplateId: origin || null,
        shippingLabelFormat: format,
        skydropxLowBalanceCents: pesosToCents(lowBalance) ?? 0,
        shippingTrackingPollMinutes: Number(poll),
      };
      return updateSettings(patch);
    },
    onSuccess: () => {
      setServerError(null);
      onSaved();
    },
    onError: (e) => {
      const err = asApiError(e);
      setServerError(err?.status === 422 || err?.status === 400 ? `${t('saveError')} ${err.message}` : getError(e));
    },
  });

  const move = (i: number, d: -1 | 1) =>
    setCarriers((c) => {
      const n = [...c];
      const j = i + d;
      if (j < 0 || j >= n.length) return c;
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });

  return (
    <div className="flex flex-col gap-6">
      {/* 43.10b — escalones de seguro */}
      <div className="flex flex-col gap-3" data-testid="shipping-tiers">
        <h3 className="text-lg font-semibold text-text">{t('tiers.title')}</h3>
        <p className="text-sm text-text">{t('tiers.intro')}</p>
        {tiers.map((r, i) => {
          const e = tried ? rowErrors[i] ?? {} : {};
          return (
            <div key={i} className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto]" data-testid={`tier-row-${i}`}>
              <Input label={t('tiers.coverage')} prefix="MX$" inputMode="decimal" value={r.coverage} error={e.coverage ? t(`tiers.${e.coverage}`) : undefined} onChange={(ev) => setTiers((x) => x.map((y, k) => (k === i ? { ...y, coverage: ev.target.value } : y)))} />
              <Input label={t('tiers.cost')} prefix="MX$" inputMode="decimal" value={r.cost} error={e.cost ? t(`tiers.${e.cost}`) : undefined} onChange={(ev) => setTiers((x) => x.map((y, k) => (k === i ? { ...y, cost: ev.target.value } : y)))} />
              <Input label={t('tiers.measuredAt')} type="date" value={r.measuredAt} error={e.measuredAt ? t(`tiers.${e.measuredAt}`) : undefined} onChange={(ev) => setTiers((x) => x.map((y, k) => (k === i ? { ...y, measuredAt: ev.target.value } : y)))} />
              {tiers.length > 1 && (
                <Button size="sm" variant="ghost" className="self-end" onClick={() => setTiers((x) => x.filter((_, k) => k !== i))}>
                  {t('tiers.remove')}
                </Button>
              )}
            </div>
          );
        })}
        {tiers.length <= 1 && <p className="text-xs text-muted">{t('tiers.atLeastOne')}</p>}
        {tiers.length < 20 ? (
          <Button size="sm" variant="secondary" className="self-start" onClick={() => setTiers((x) => [...x, { coverage: '', cost: '', measuredAt: '' }])}>
            {t('tiers.add')}
          </Button>
        ) : (
          <p className="text-xs text-muted">{t('tiers.max')}</p>
        )}
        {/* Lectura sin aritmética (SK3): cada escalón dice hasta dónde cubre y cuánto cuesta. */}
        {Object.keys(rowErrors).length === 0 && tiers.length > 0 && (
          <ul className="flex flex-col gap-1 text-sm text-text" data-testid="tier-reading">
            {tiers.map((r, i) => (
              <li key={i}>{t('tiers.reading', { coverage: formatMoneyCents(pesosToCents(r.coverage) ?? 0, locale), cost: formatMoneyCents(pesosToCents(r.cost) ?? 0, locale) })}</li>
            ))}
            <li>{t('tiers.readingOver', { coverage: formatMoneyCents(pesosToCents(tiers[tiers.length - 1].coverage) ?? 0, locale) })}</li>
          </ul>
        )}
      </div>

      {/* 43.10c — Carta Porte */}
      <div className="flex flex-col gap-2">
        <Input label={t('consignment.label')} inputMode="numeric" hint={t('consignment.hint')} value={note} error={tried && noteInvalid ? t('consignment.invalid') : undefined} onChange={(e) => setNote(e.target.value)} />
        {catalogs && (
          <p className="text-sm text-text">
            {catalogs.consignmentNote && catalogs.consignmentNote.code === note
              ? t('consignment.found', { code: catalogs.consignmentNote.code, description: catalogs.consignmentNote.description })
              : t('consignment.notFound')}
          </p>
        )}
        <Button size="sm" variant="link" className="self-start" aria-expanded={searchOpen} onClick={() => setSearchOpen((v) => !v)}>
          {t('consignment.search')}
        </Button>
        {searchOpen && (
          <div className="flex flex-wrap items-end gap-2">
            <Input label={t('consignment.searchLabel')} value={search} onChange={(e) => setSearch(e.target.value)} />
            <Button size="sm" variant="secondary" onClick={() => searchConsignmentNotes(search).then(setFound).catch(() => setFound([]))}>
              {t('consignment.searchCta')}
            </Button>
            {found && (
              <ul className="w-full text-sm text-text">
                {found.map((f) => (
                  <li key={f.code}>
                    <button type="button" className="underline underline-offset-4 hover:text-accent" onClick={() => setNote(f.code)}>
                      {t('consignment.found', { code: f.code, description: f.description })}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* 43.10e — paquetería preferida y sucursal */}
      <div className="flex flex-col gap-2">
        <p className="eyebrow">{t('carriers.label')}</p>
        <p className="font-mono text-xs text-muted">{t('carriers.hint')}</p>
        <ol className="flex flex-col gap-1">
          {carriers.map((c, i) => (
            <li key={c} className="flex items-center gap-2 text-sm text-text">
              <span className="tabular w-6">{i + 1}.</span>
              <span className="font-mono">{c}</span>
              <Button size="sm" variant="ghost" aria-label={t('carriers.up', { code: c })} disabled={i === 0} onClick={() => move(i, -1)}>
                ↑
              </Button>
              <Button size="sm" variant="ghost" aria-label={t('carriers.down', { code: c })} disabled={i === carriers.length - 1} onClick={() => move(i, 1)}>
                ↓
              </Button>
              <Button size="sm" variant="ghost" aria-label={t('carriers.remove', { code: c })} onClick={() => setCarriers((x) => x.filter((y) => y !== c))}>
                ×
              </Button>
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap items-end gap-2">
          <Input label={t('carriers.newCode')} value={newCarrier} onChange={(e) => setNewCarrier(e.target.value)} />
          <Button
            size="sm"
            variant="secondary"
            disabled={!newCarrier.trim() || carriers.includes(newCarrier.trim()) || carriers.length >= 10}
            onClick={() => {
              setCarriers((x) => [...x, newCarrier.trim()]);
              setNewCarrier('');
            }}
          >
            {t('carriers.add')}
          </Button>
        </div>
        <p className="mt-2 text-base font-medium text-text">{t('dropoff.title')}</p>
        <p className="text-sm text-muted">{t('dropoff.note')}</p>
        {carriers.map((c) => (
          <div key={c} className="grid gap-3 sm:grid-cols-2">
            <Input label={t('dropoff.name', { code: c })} value={dropoffs[c]?.name ?? ''} onChange={(e) => setDropoffs((d) => ({ ...d, [c]: { name: e.target.value, address: d[c]?.address ?? '' } }))} />
            <Input label={t('dropoff.address', { code: c })} value={dropoffs[c]?.address ?? ''} onChange={(e) => setDropoffs((d) => ({ ...d, [c]: { name: d[c]?.name ?? '', address: e.target.value } }))} />
          </div>
        ))}
      </div>

      {/* 43.10e — el resto de los diales con la forma de §6 */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          label={t('origin')}
          placeholder={t('originNone')}
          options={(catalogs?.addressTemplates ?? []).map((a) => ({ value: a.id, label: t('originOption', { alias: a.alias, postalCode: a.postalCode }) }))}
          value={origin}
          onChange={(e) => setOrigin(e.target.value)}
        />
        <Select
          label={t('labelFormat')}
          options={[
            { value: 'standard', label: t('labelFormatStandard') },
            { value: 'thermal', label: t('labelFormatThermal') },
          ]}
          value={format}
          onChange={(e) => setFormat(e.target.value as 'standard' | 'thermal')}
        />
        <Input label={t('lowBalanceThreshold')} prefix="MX$" inputMode="decimal" value={lowBalance} onChange={(e) => setLowBalance(e.target.value)} />
        <Input label={t('pollMinutes')} inputMode="numeric" value={poll} onChange={(e) => setPoll(e.target.value)} />
        <div className="flex flex-col gap-1">
          <Select
            label={t('provider')}
            options={[
              { value: 'off', label: t('providerOff') },
              { value: 'skydropx', label: t('providerOn') },
            ]}
            value={provider}
            onChange={(e) => setProvider(e.target.value as 'off' | 'skydropx')}
          />
          <p className="font-mono text-xs text-muted">{t('providerNote')}</p>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Button
          className="self-start"
          loading={save.isPending}
          onClick={() => {
            setTried(true);
            if (invalid) return; // ⛔ cero PUT con un error de fila (UX-SDX-17)
            save.mutate();
          }}
        >
          {t('save')}
        </Button>
        {save.isSuccess && (
          <Banner variant="success" role="status">
            {t('saved')}
          </Banner>
        )}
        {serverError && (
          <Banner variant="danger" role="alert" title={tc('errorTitle')}>
            {serverError}
          </Banner>
        )}
      </div>
    </div>
  );
}

function PackagesEditor({ boxMin, packagings }: { boxMin: number | undefined; packagings: { code: string; name: string }[] }) {
  const t = useTranslations('admin.m10.shipping.packages');
  const getError = useErrorMessage('operator');
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['shipping-packages'], queryFn: listShippingPackages, retry: false });
  const [rows, setRows] = useState<ShippingPackageDTO[] | null>(null);
  const [boxMinValue, setBoxMinValue] = useState(boxMin !== undefined ? String(boxMin) : '');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (list.data && rows === null) setRows(list.data);
  }, [list.data, rows]);
  const weightInvalid = (rows ?? []).some((p) => !Number.isInteger(p.weightKg) || p.weightKg < 1);
  const noActive = rows !== null && !rows.some((p) => p.active && p.providerPackageType);
  const save = useMutation({
    mutationFn: async () => {
      const saved = await putShippingPackages(rows ?? []);
      if (boxMinValue.trim() && Number(boxMinValue) !== boxMin) await updateSettings({ shippingPackageRuleBoxMinCards: Number(boxMinValue) });
      return saved;
    },
    onSuccess: (saved) => {
      setRows(saved);
      setError(null);
      void qc.invalidateQueries({ queryKey: ['shipping-packages'] });
      void qc.invalidateQueries({ queryKey: ['admin-settings'] });
    },
    onError: (e) => setError(getError(e)),
  });
  const patch = (i: number, p: Partial<ShippingPackageDTO>) => setRows((r) => (r ? r.map((x, k) => (k === i ? { ...x, ...p } : x)) : r));
  return (
    <div className="flex flex-col gap-3" data-testid="shipping-packages">
      <h3 className="text-lg font-semibold text-text">{t('title')}</h3>
      <p className="text-sm text-muted">{t('note')}</p>
      <QueryState isLoading={list.isLoading} isError={list.isError} error={list.error} onRetry={() => list.refetch()}>
        {(rows ?? []).map((p, i) => (
          <div key={p.code} className="grid gap-3 border-t border-border pt-3 sm:grid-cols-3" data-testid={`package-row-${p.code}`}>
            <p className="text-sm text-text">
              <span className="eyebrow block">{t('code')}</span>
              <span className="font-mono">{p.code}</span>
            </p>
            <Input label={t('name')} value={p.label} onChange={(e) => patch(i, { label: e.target.value })} />
            <Select
              label={t('provider')}
              placeholder="—"
              options={packagings.map((x) => ({ value: x.code, label: t('providerOption', { code: x.code, name: x.name }) }))}
              value={p.providerPackageType ?? ''}
              onChange={(e) => patch(i, { providerPackageType: e.target.value || null })}
            />
            <Input label={`${t('dims')} · ${t('length')}`} inputMode="numeric" value={String(p.lengthCm)} onChange={(e) => patch(i, { lengthCm: Number(e.target.value) })} />
            <Input label={`${t('dims')} · ${t('width')}`} inputMode="numeric" value={String(p.widthCm)} onChange={(e) => patch(i, { widthCm: Number(e.target.value) })} />
            <Input label={`${t('dims')} · ${t('height')}`} inputMode="numeric" value={String(p.heightCm)} onChange={(e) => patch(i, { heightCm: Number(e.target.value) })} />
            <Input
              label={t('weight')}
              inputMode="numeric"
              value={String(p.weightKg)}
              error={!Number.isInteger(p.weightKg) || p.weightKg < 1 ? t('weightInvalid') : undefined}
              onChange={(e) => patch(i, { weightKg: Number(e.target.value) })}
            />
            <label className="flex items-center gap-2 text-sm text-text">
              <input type="checkbox" checked={p.active} onChange={(e) => patch(i, { active: e.target.checked })} />
              {t('active')}
            </label>
          </div>
        ))}
      </QueryState>
      {noActive && <p className={cn('text-sm text-accent')}>{t('needActive')}</p>}
      <Input label={t('boxMin')} inputMode="numeric" value={boxMinValue} onChange={(e) => setBoxMinValue(e.target.value)} />
      <Button className="self-start" disabled={rows === null || weightInvalid || noActive} loading={save.isPending} onClick={() => save.mutate()}>
        {t('save')}
      </Button>
      {save.isSuccess && (
        <Banner variant="success" role="status">
          {t('saved')}
        </Banner>
      )}
      {error && (
        <Banner variant="danger" role="alert">
          {error}
        </Banner>
      )}
    </div>
  );
}
