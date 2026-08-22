'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { getPricingTiers, updatePricingTiers } from '@/lib/api';
import type {
  BuylistRule,
  SalesRule,
  Finish,
  TierId,
  UpdateTiersRequest,
} from '@/types/contract';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { Banner } from '@/components/ui/Banner';
import { QueryState, useErrorMessage } from '@/components/ui/QueryState';
import { pesosToCents, sanitizeDecimalInput, isSaveableRuleValue, FINISH_RULE_KEYS } from './shared';
import { TIER_ORDER, ruleToRaw, premiumFixedOffenders, type TierRuleDraft, type TierRuleMode } from './tier-shared';

/**
 * M2 · Editor de precios por TIER (v1.37-pricing-tiers, P-34). SUPERSEDE el editor de ~30 reglas por
 * rareza: una fila por TIER (5 tiers T0–T4), cada una con su regla de COMPRA (buylist) y de VENTA. El
 * valor se edita como TEXTO CRUDO y se castea SOLO al guardar (money-safe: un vacío/NaN nunca se
 * persiste como MX$0). Invariante visible: los tiers `premium` (T3/T4) solo admiten COMPRA en `%`
 * (un bin fijo regalaría cartas caras) — el modo `fijo` de compra queda bloqueado en esas filas y el
 * backend lo re-valida (422 PREMIUM_RARITY_FIXED_TIER). Consume GET/PUT /admin/pricing/tiers.
 */
export function TierRulesSection() {
  const tc = useTranslations('common');
  const tt = useTranslations('admin.m2.tierRules');
  const tFinish = useTranslations('finish');
  const qc = useQueryClient();
  const getError = useErrorMessage();

  const tiers = useQuery({ queryKey: ['pricing-tiers'], queryFn: getPricingTiers });

  // Borradores CRUDOS por eje. Tier: compra/venta. Acabado: compra/venta. Fallback: compra/venta.
  const [buyDraft, setBuyDraft] = useState<Partial<Record<TierId, TierRuleDraft>>>({});
  const [sellDraft, setSellDraft] = useState<Partial<Record<TierId, TierRuleDraft>>>({});
  const [finishBuyDraft, setFinishBuyDraft] = useState<Partial<Record<Finish, TierRuleDraft>>>({});
  const [finishSellDraft, setFinishSellDraft] = useState<Partial<Record<Finish, TierRuleDraft>>>({});
  const [fallbackBuyDraft, setFallbackBuyDraft] = useState<string | null>(null);
  const [fallbackSellDraft, setFallbackSellDraft] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (payload: UpdateTiersRequest) => updatePricingTiers(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pricing-tiers'] });
      qc.invalidateQueries({ queryKey: ['pricing-tier-map'] });
      resetDrafts();
    },
  });

  function resetDrafts() {
    setBuyDraft({});
    setSellDraft({});
    setFinishBuyDraft({});
    setFinishSellDraft({});
    setFallbackBuyDraft(null);
    setFallbackSellDraft(null);
  }

  const data = tiers.data;
  const serverFallbackBuy = data?.fallbackPct.buy ?? 40;
  const serverFallbackSell = data?.fallbackPct.sell ?? 15;
  const effFallbackBuy = fallbackBuyDraft ?? String(serverFallbackBuy);
  const effFallbackSell = fallbackSellDraft ?? String(serverFallbackSell);

  // Regla efectiva de un tier (value en TEXTO CRUDO): borrador > regla del servidor.
  function effBuy(id: TierId, server: BuylistRule): TierRuleDraft {
    return buyDraft[id] ?? { mode: server.mode, value: ruleToRaw(server) };
  }
  function effSell(id: TierId, server: SalesRule): TierRuleDraft {
    return sellDraft[id] ?? { mode: server.mode, value: ruleToRaw(server) };
  }
  function effFinishBuy(f: Finish): TierRuleDraft {
    const s = data?.finishRules.buy[f];
    return finishBuyDraft[f] ?? { mode: s?.mode ?? 'fixed', value: s ? ruleToRaw(s) : '' };
  }
  function effFinishSell(f: Finish): TierRuleDraft {
    const s = data?.finishRules.sell[f];
    return finishSellDraft[f] ?? { mode: s?.mode ?? 'fixed', value: s ? ruleToRaw(s) : '' };
  }

  const dirty =
    Object.keys(buyDraft).length > 0 ||
    Object.keys(sellDraft).length > 0 ||
    Object.keys(finishBuyDraft).length > 0 ||
    Object.keys(finishSellDraft).length > 0 ||
    (fallbackBuyDraft != null && fallbackBuyDraft !== String(serverFallbackBuy)) ||
    (fallbackSellDraft != null && fallbackSellDraft !== String(serverFallbackSell));

  // Money-safe: alguna regla TOCADA tiene valor vacío/mal formado → NO guardable (nunca MX$0).
  const invalid =
    Object.values(buyDraft).some((d) => d != null && !isSaveableRuleValue(d.value)) ||
    Object.values(sellDraft).some((d) => d != null && !isSaveableRuleValue(d.value)) ||
    Object.values(finishBuyDraft).some((d) => d != null && !isSaveableRuleValue(d.value)) ||
    Object.values(finishSellDraft).some((d) => d != null && !isSaveableRuleValue(d.value)) ||
    !isSaveableRuleValue(effFallbackBuy) ||
    !isSaveableRuleValue(effFallbackSell);

  // Castea un borrador CRUDO a la regla numérica del contrato. `pct` de compra topa en 100; el de
  // venta (markup) en 1000. `fixed` = pesos→centavos. Money-safe: omite vacío/NaN (nunca 0).
  function cast(d: TierRuleDraft, axis: 'buy' | 'sell'): BuylistRule | SalesRule | null {
    if (!isSaveableRuleValue(d.value)) return null;
    if (d.mode === 'fixed') return { mode: 'fixed', value: Math.max(0, pesosToCents(d.value)) };
    const max = axis === 'sell' ? 1000 : 100;
    return { mode: 'pct', value: Math.min(max, Math.max(0, Number(d.value) || 0)) };
  }

  function save() {
    if (!data) return;
    const tierRows = TIER_ORDER.map((id) => {
      const server = data.tiers.find((x) => x.id === id)!;
      const buy = (cast(effBuy(id, server.buy), 'buy') as BuylistRule) ?? server.buy;
      const sell = (cast(effSell(id, server.sell), 'sell') as SalesRule) ?? server.sell;
      return { id, buy, sell };
    });
    const finishBuy: Partial<Record<Finish, BuylistRule>> = { ...data.finishRules.buy };
    const finishSell: Partial<Record<Finish, SalesRule>> = { ...data.finishRules.sell };
    for (const [f, d] of Object.entries(finishBuyDraft)) {
      const r = d && cast(d, 'buy');
      if (r) finishBuy[f as Finish] = r as BuylistRule;
    }
    for (const [f, d] of Object.entries(finishSellDraft)) {
      const r = d && cast(d, 'sell');
      if (r) finishSell[f as Finish] = r as SalesRule;
    }
    mutation.mutate({
      tiers: tierRows,
      finishRules: { buy: finishBuy, sell: finishSell },
      fallbackPct: {
        buy: Math.min(100, Math.max(0, Number(effFallbackBuy) || 0)),
        sell: Math.min(1000, Math.max(0, Number(effFallbackSell) || 0)),
      },
    });
  }

  const offenders = premiumFixedOffenders(mutation.error);

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-h2 font-semibold">{tt('title')}</h2>
      <p className="text-sm text-muted">{tt('subtitle')}</p>
      {/* Invariante money-safe visible: premium → compra en %. */}
      <Banner variant="info" role="note">{tt('invariantNote')}</Banner>

      <QueryState
        isLoading={tiers.isLoading}
        isError={tiers.isError}
        error={tiers.error}
        onRetry={() => tiers.refetch()}
      >
        {data && (
          <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
            {/* ---- 5 filas por TIER (compra + venta) ---- */}
            <ul className="flex flex-col divide-y divide-border">
              <li className="hidden gap-3 py-2 text-xs uppercase tracking-wide text-muted md:grid md:grid-cols-[1fr_1.4fr_1.4fr]">
                <span>{tt('tier')}</span>
                <span>{tt('buyAxis')}</span>
                <span>{tt('sellAxis')}</span>
              </li>
              {TIER_ORDER.map((id) => {
                const server = data.tiers.find((x) => x.id === id)!;
                const buy = effBuy(id, server.buy);
                const sell = effSell(id, server.sell);
                return (
                  <li
                    key={id}
                    className="grid grid-cols-1 items-start gap-3 py-3 md:grid-cols-[1fr_1.4fr_1.4fr]"
                  >
                    <span className="flex flex-col gap-1">
                      <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                        <span className="tabular text-muted">{id}</span>
                        {server.name}
                        {server.premium && (
                          <Badge tone="accent" shape="outline">{tt('premium')}</Badge>
                        )}
                      </span>
                      <span className="text-xs text-muted">
                        {tt('rarityCount', { count: server.rarityCount })}
                      </span>
                    </span>

                    {/* COMPRA: en tiers premium el modo `fijo` está bloqueado (invariante). */}
                    <RuleCell
                      axis="buy"
                      mode={buy.mode}
                      value={buy.value}
                      lockFixed={server.premium}
                      modeAria={tt('modeBuyFor', { tier: server.name })}
                      valueAria={tt('valueBuyFor', { tier: server.name })}
                      t={tt}
                      onModeChange={(mode) =>
                        setBuyDraft((p) => ({ ...p, [id]: { mode, value: '' } }))
                      }
                      onValueChange={(raw) =>
                        setBuyDraft((p) => ({ ...p, [id]: { mode: buy.mode, value: sanitizeDecimalInput(raw) } }))
                      }
                    />
                    {/* VENTA: fijo (piso) o % (markup arriba de mercado, hasta 1000%). */}
                    <RuleCell
                      axis="sell"
                      mode={sell.mode}
                      value={sell.value}
                      modeAria={tt('modeSellFor', { tier: server.name })}
                      valueAria={tt('valueSellFor', { tier: server.name })}
                      t={tt}
                      onModeChange={(mode) =>
                        setSellDraft((p) => ({ ...p, [id]: { mode, value: '' } }))
                      }
                      onValueChange={(raw) =>
                        setSellDraft((p) => ({ ...p, [id]: { mode: sell.mode, value: sanitizeDecimalInput(raw) } }))
                      }
                    />
                  </li>
                );
              })}
            </ul>

            {/* ---- Eje ACABADO (buy + sell) ---- */}
            <p className="mt-2 border-t border-border pt-4 text-xs font-semibold uppercase tracking-wide text-muted">
              {tt('finishTitle')}
            </p>
            <p className="text-xs text-muted">{tt('finishHint')}</p>
            <ul className="flex flex-col divide-y divide-border">
              {FINISH_RULE_KEYS.map((f) => {
                const fb = effFinishBuy(f);
                const fs = effFinishSell(f);
                const label = tFinish(f);
                return (
                  <li
                    key={f}
                    className="grid grid-cols-1 items-start gap-3 py-3 md:grid-cols-[1fr_1.4fr_1.4fr]"
                  >
                    <span className="text-sm font-medium">{label}</span>
                    <RuleCell
                      axis="buy"
                      mode={fb.mode}
                      value={fb.value}
                      modeAria={tt('modeBuyForFinish', { finish: label })}
                      valueAria={tt('valueBuyForFinish', { finish: label })}
                      placeholder={tt('inheritPlaceholder')}
                      t={tt}
                      onModeChange={(mode) =>
                        setFinishBuyDraft((p) => ({ ...p, [f]: { mode, value: '' } }))
                      }
                      onValueChange={(raw) =>
                        setFinishBuyDraft((p) => ({ ...p, [f]: { mode: fb.mode, value: sanitizeDecimalInput(raw) } }))
                      }
                    />
                    <RuleCell
                      axis="sell"
                      mode={fs.mode}
                      value={fs.value}
                      modeAria={tt('modeSellForFinish', { finish: label })}
                      valueAria={tt('valueSellForFinish', { finish: label })}
                      placeholder={tt('inheritPlaceholder')}
                      t={tt}
                      onModeChange={(mode) =>
                        setFinishSellDraft((p) => ({ ...p, [f]: { mode, value: '' } }))
                      }
                      onValueChange={(raw) =>
                        setFinishSellDraft((p) => ({ ...p, [f]: { mode: fs.mode, value: sanitizeDecimalInput(raw) } }))
                      }
                    />
                  </li>
                );
              })}
            </ul>

            {/* ---- Fallbacks por eje (rareza sin tier → % de fallback, money-safe) ---- */}
            <div className="mt-2 flex flex-wrap items-end gap-4 border-t border-border pt-4">
              <Input
                label={tt('fallbackBuyLabel')}
                type="text"
                inputMode="decimal"
                suffix="%"
                className="w-40"
                value={effFallbackBuy}
                onChange={(e) => setFallbackBuyDraft(e.target.value.replace(/[^0-9.]/g, ''))}
              />
              <Input
                label={tt('fallbackSellLabel')}
                type="text"
                inputMode="decimal"
                suffix="%"
                className="w-40"
                value={effFallbackSell}
                onChange={(e) => setFallbackSellDraft(e.target.value.replace(/[^0-9.]/g, ''))}
              />
              <p className="max-w-md text-xs text-muted">{tt('fallbackHint')}</p>
            </div>

            {/* Money-safe: un % sin referencia de mercado → precio PENDIENTE, nunca MX$0. */}
            <p className="text-xs text-muted">{tt('pctPendingHint')}</p>

            {invalid && dirty && (
              <Banner variant="warning" role="alert">{tt('invalidValue')}</Banner>
            )}

            <div className="flex gap-2">
              <Button
                variant="secondary"
                disabled={!dirty || !data || invalid}
                loading={mutation.isPending}
                onClick={save}
              >
                {tc('save')}
              </Button>
              {dirty && (
                <Button variant="ghost" onClick={resetDrafts}>
                  {tc('cancel')}
                </Button>
              )}
            </div>

            {mutation.isSuccess && (
              <Banner variant="success" role="status">{tt('saved')}</Banner>
            )}
            {/* 422 PREMIUM_RARITY_FIXED_TIER: lista los pares (rareza premium, tier de compra fija). */}
            {offenders != null && (
              <Banner variant="danger" role="alert" title={tt('premiumFixedTitle')}>
                <p>{tt('premiumFixedBody')}</p>
                <ul className="mt-2 list-disc pl-5">
                  {offenders.map((o) => (
                    <li key={`${o.rarity}-${o.tierId}`}>
                      <span lang="en" className="font-medium">{o.rarity}</span> → {o.tierId}
                    </li>
                  ))}
                </ul>
              </Banner>
            )}
            {mutation.isError && offenders == null && (
              <Banner variant="danger" role="alert">{getError(mutation.error)}</Banner>
            )}
          </div>
        )}
      </QueryState>
    </section>
  );
}

/** Celda de una regla: selector de modo (fijo/%) + input de valor. */
function RuleCell({
  axis,
  mode,
  value,
  lockFixed,
  modeAria,
  valueAria,
  placeholder,
  t,
  onModeChange,
  onValueChange,
}: {
  axis: 'buy' | 'sell';
  mode: TierRuleMode;
  value: string;
  lockFixed?: boolean;
  modeAria: string;
  valueAria: string;
  placeholder?: string;
  t: ReturnType<typeof useTranslations>;
  onModeChange: (mode: TierRuleMode) => void;
  onValueChange: (raw: string) => void;
}) {
  // En tiers premium (lockFixed) la COMPRA solo admite `%`: se retira la opción `fijo`.
  const modeOptions = (lockFixed ? (['pct'] as TierRuleMode[]) : (['fixed', 'pct'] as TierRuleMode[])).map(
    (m) => ({ value: m, label: t(`modeLabel.${m}`) }),
  );
  const valueLabel =
    mode === 'fixed'
      ? axis === 'sell'
        ? t('valueFloor')
        : t('valueMxn')
      : axis === 'sell'
        ? t('valueMarkup')
        : t('valuePct');
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Select
        label={t('mode')}
        aria-label={modeAria}
        className="w-32"
        options={modeOptions}
        value={mode}
        onChange={(e) => onModeChange(e.target.value as TierRuleMode)}
      />
      <Input
        label={valueLabel}
        aria-label={valueAria}
        type="text"
        inputMode="decimal"
        prefix={mode === 'fixed' ? 'MX$' : undefined}
        suffix={mode === 'pct' ? '%' : undefined}
        placeholder={placeholder}
        className="w-32"
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
      />
    </div>
  );
}
