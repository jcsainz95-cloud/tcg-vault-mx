'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { getSalesRarities, getSalesRules, updateSalesRules } from '@/lib/api';
import type { SalesRule, SalesRuleMode, Finish } from '@/types/contract';
import { QueryState, useErrorMessage } from '@/components/ui/QueryState';
import {
  pesosToCents,
  sanitizeDecimalInput,
  isSaveableRuleValue,
  FINISH_RULE_KEYS,
} from './shared';
import { RuleAxisEditor, type RuleAxisRarityRow, type RuleAxisFinishRow } from './RuleAxisEditor';

/**
 * Sección 5 — precio de VENTA por RAREZA + ACABADO (v1.13-sales-pricing, dos ejes v1.29). Reusa el
 * `RuleAxisEditor` compartido con buylist. DIFERENCIA de modelo (preservada EXACTA): aquí el valor
 * se guarda como TEXTO CRUDO (edición parcial/decimal/vaciado), se LIMPIA al cambiar de modo, y se
 * valida (S-P1-1) para nunca persistir vacío/NaN como 0 (MX$0 = carta regalada). El pct es MARKUP
 * arriba de mercado (no % de la referencia como buylist) y admite hasta 1000.
 */
export function SalesRulesSection() {
  const t = useTranslations('admin.m2');
  const tRules = useTranslations('admin.m2.salesRules');
  const tFinish = useTranslations('finish');
  const qc = useQueryClient();
  const getError = useErrorMessage();

  const salesRarities = useQuery({ queryKey: ['sales-rarities'], queryFn: getSalesRarities });
  // v1.29 (§4.28d): mismo PriceRuleSet de dos ejes que buylist (rareza canónica + acabado). El
  // parche INV-1 (rescatar la key sintética "Holo" de la tabla cruda) queda RETIRADO: el eje de
  // acabado es ahora explícito. El merge del guardado parte del PriceRuleSet del servidor.
  const salesRules = useQuery({ queryKey: ['sales-rules'], queryFn: getSalesRules });
  // Borrador por rareza / por acabado: el `value` se guarda como TEXTO CRUDO (permite edición
  // parcial/decimal/vaciado "12.50","","12."). Se castea a número (centavos si fixed, pct si pct)
  // SOLO al guardar. Re-derivar un número en cada tecla rompía el punto decimal y el vaciado.
  const [salesRuleDraft, setSalesRuleDraft] = useState<Record<string, { mode: SalesRuleMode; value: string }>>({});
  const [salesFinishRuleDraft, setSalesFinishRuleDraft] = useState<
    Partial<Record<Finish, { mode: SalesRuleMode; value: string }>>
  >({});
  const [salesFallbackDraft, setSalesFallbackDraft] = useState<string | null>(null);
  const salesRulesMutation = useMutation({
    mutationFn: (payload: {
      rarityRules: Record<string, SalesRule>;
      finishRules: Partial<Record<Finish, SalesRule>>;
      fallbackPct: number;
    }) => updateSalesRules(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sales-rarities'] });
      qc.invalidateQueries({ queryKey: ['sales-rules'] });
      setSalesRuleDraft({});
      setSalesFinishRuleDraft({});
      setSalesFallbackDraft(null);
    },
  });

  const salesServerFallback = salesRarities.data?.fallbackPct ?? 15;
  const salesEffectiveFallback = salesFallbackDraft ?? String(salesServerFallback);
  // Texto crudo a mostrar para una regla del servidor: fixed = pesos (centavos/100), pct = tal cual.
  function salesRuleToRaw(rule: SalesRule): string {
    return rule.mode === 'fixed' ? String(rule.value / 100) : String(rule.value);
  }
  // Regla efectiva de una RAREZA (value en TEXTO CRUDO): borrador > regla del servidor > fallback.
  function salesEffectiveRule(
    rarity: string,
    serverRule: SalesRule,
    source: 'rule' | 'fallback',
  ): { mode: SalesRuleMode; value: string } {
    const draft = salesRuleDraft[rarity];
    if (draft) return draft;
    if (source === 'rule') return { mode: serverRule.mode, value: salesRuleToRaw(serverRule) };
    return { mode: 'pct', value: salesEffectiveFallback };
  }
  // Regla efectiva de un ACABADO: borrador > regla del servidor. Sin regla = HEREDA la rareza.
  function salesEffectiveFinishRule(
    finish: Finish,
  ): { mode: SalesRuleMode; value: string; hasRule: boolean } {
    const draft = salesFinishRuleDraft[finish];
    if (draft) return { ...draft, hasRule: true };
    const server = salesRules.data?.finishRules[finish];
    if (server) return { mode: server.mode, value: salesRuleToRaw(server), hasRule: true };
    return { mode: 'fixed', value: '', hasRule: false };
  }
  const salesRulesDirty =
    Object.keys(salesRuleDraft).length > 0 ||
    Object.keys(salesFinishRuleDraft).length > 0 ||
    (salesFallbackDraft != null && salesFallbackDraft !== String(salesServerFallback));
  // S-P1-1 (money-safe): alguna regla TOCADA (rareza o acabado) tiene valor vacío/mal formado → NO
  // es guardable. Bloquea Guardar para que un vacío/NaN nunca se persista como 0 (fixed 0 = MX$0.00
  // → carta regalada; el server acepta 0 y no da 422).
  const salesDraftInvalid =
    Object.values(salesRuleDraft).some((d) => !isSaveableRuleValue(d.value)) ||
    Object.values(salesFinishRuleDraft).some((d) => d != null && !isSaveableRuleValue(d.value));

  // Castea un borrador CRUDO de venta a la regla numérica del contrato (fixed: pesos→centavos;
  // pct: número topado a [0,1000]). Money-safe: omite valores vacíos/mal formados (nunca 0).
  function castSalesDraft(d: { mode: SalesRuleMode; value: string }): SalesRule | null {
    if (!isSaveableRuleValue(d.value)) return null;
    const value =
      d.mode === 'fixed'
        ? Math.max(0, pesosToCents(d.value))
        : Math.min(1000, Math.max(0, Number(d.value) || 0));
    return { mode: d.mode, value };
  }

  function saveSalesRules() {
    // Sin el PriceRuleSet del servidor no guardamos: el merge parte de él (dos ejes) para que el
    // REEMPLAZO TOTAL del PUT preserve lo no editado. (Ya no hay key sintética "Holo" que rescatar.)
    if (!salesRules.data) return;
    const draftRarityRules: Record<string, SalesRule> = {};
    for (const [rarity, d] of Object.entries(salesRuleDraft)) {
      const rule = castSalesDraft(d);
      if (rule) draftRarityRules[rarity] = rule;
    }
    const draftFinishRules: Partial<Record<Finish, SalesRule>> = {};
    for (const [finish, d] of Object.entries(salesFinishRuleDraft)) {
      if (!d) continue;
      const rule = castSalesDraft(d);
      if (rule) draftFinishRules[finish as Finish] = rule;
    }
    salesRulesMutation.mutate({
      rarityRules: { ...salesRules.data.rarityRules, ...draftRarityRules },
      finishRules: { ...salesRules.data.finishRules, ...draftFinishRules },
      fallbackPct: Number(salesEffectiveFallback) || 0,
    });
  }

  const rarityRows: RuleAxisRarityRow[] = (salesRarities.data?.rarities ?? []).map((row) => {
    const rule = salesEffectiveRule(row.canonical, row.rule, row.source);
    const edited = !!salesRuleDraft[row.canonical];
    const effectiveSource: 'rule' | 'fallback' = edited ? 'rule' : row.source;
    return {
      canonical: row.canonical,
      cardCount: row.cardCount,
      premium: row.premium,
      mapped: row.mapped,
      mode: rule.mode,
      valueText: rule.value,
      source: effectiveSource,
      onModeChange: (mode) => {
        // Money-safe: NO arrastrar el valor entre semánticas (centavos fijos ↔ %):
        // un 500¢ fijo no debe volverse 500%, ni un 15% volverse $0.15. Se limpia.
        setSalesRuleDraft((prev) => ({ ...prev, [row.canonical]: { mode, value: '' } }));
      },
      onValueChange: (rawInput) => {
        setSalesRuleDraft((prev) => ({
          ...prev,
          [row.canonical]: { mode: rule.mode, value: sanitizeDecimalInput(rawInput) },
        }));
      },
    };
  });

  const finishRows: RuleAxisFinishRow[] = FINISH_RULE_KEYS.map((finish) => {
    const rule = salesEffectiveFinishRule(finish);
    const finishLabel = tFinish(finish);
    return {
      finish,
      label: finishLabel,
      mode: rule.mode,
      valueText: rule.value,
      hasRule: rule.hasRule,
      onModeChange: (mode) => {
        setSalesFinishRuleDraft((prev) => ({ ...prev, [finish]: { mode, value: '' } }));
      },
      onValueChange: (rawInput) => {
        setSalesFinishRuleDraft((prev) => ({
          ...prev,
          [finish]: { mode: rule.mode, value: sanitizeDecimalInput(rawInput) },
        }));
      },
    };
  });

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-h2 font-semibold">{t('salesRules.title')}</h2>
      <p className="text-sm text-muted">{t('salesRules.subtitle')}</p>
      {/* G3: ejemplo en línea del % — en venta el % es lo que SUBES sobre el mercado
          (semántica opuesta a la de buylist). */}
      <p className="text-xs text-muted">{t('salesRules.example')}</p>
      <QueryState
        isLoading={salesRarities.isLoading}
        isError={salesRarities.isError}
        error={salesRarities.error}
        onRetry={() => salesRarities.refetch()}
      >
        {salesRarities.data && (
          <RuleAxisEditor
            t={tRules}
            fallbackValue={salesEffectiveFallback}
            onFallbackChange={(rawInput) => setSalesFallbackDraft(rawInput.replace(/[^0-9.]/g, ''))}
            rarityRows={rarityRows}
            finishRows={finishRows}
            showPctHint
            showInvalidBanner={salesDraftInvalid}
            dirty={salesRulesDirty}
            // INV-1 robustez: idéntico gate que buylist — sin la tabla CRUDA (salesRules) el
            // guard hace return silencioso; gateamos también con `!salesRules.data`.
            // S-P1-1: además se bloquea si alguna regla tocada tiene valor vacío/mal formado
            // (evita persistir 0 = carta regalada; el server acepta 0 y no da 422).
            saveDisabled={!salesRulesDirty || !salesRules.data || salesDraftInvalid}
            saving={salesRulesMutation.isPending}
            saveSuccess={salesRulesMutation.isSuccess}
            saveErrorMessage={salesRulesMutation.isError ? getError(salesRulesMutation.error) : null}
            rulesUnavailable={salesRules.isError}
            onRetryRules={() => salesRules.refetch()}
            onSave={saveSalesRules}
            onCancel={() => {
              setSalesRuleDraft({});
              setSalesFallbackDraft(null);
            }}
          />
        )}
      </QueryState>
    </section>
  );
}
