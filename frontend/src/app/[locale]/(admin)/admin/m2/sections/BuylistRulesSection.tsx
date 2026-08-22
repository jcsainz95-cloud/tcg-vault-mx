'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Wand2 } from 'lucide-react';
import {
  unifyRarities,
  getBuylistRarities,
  getBuylistRules,
  updateBuylistRules,
} from '@/lib/api';
import type { BuylistRule, Finish } from '@/types/contract';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Banner } from '@/components/ui/Banner';
import { Badge } from '@/components/ui/Badge';
import { QueryState, useErrorMessage } from '@/components/ui/QueryState';
import { pesosToCents, FINISH_RULE_KEYS } from './shared';
import { RuleAxisEditor, type RuleAxisRarityRow, type RuleAxisFinishRow } from './RuleAxisEditor';

/**
 * Sección 4 — precio de buylist en DOS EJES (rareza canónica + acabado, v1.29 §4.28d). El editor
 * de dos ejes es el `RuleAxisEditor` compartido con venta; aquí vive la lógica de modelo NUMÉRICA
 * (valor en centavos/pct, PRESERVA el valor al cambiar de modo) y el botón «Unificar rarezas»
 * anclado a este editor (§19.5) con su confirmación money-safe.
 */
export function BuylistRulesSection() {
  const t = useTranslations('admin.m2');
  const tc = useTranslations('common');
  const tRules = useTranslations('admin.m2.buylistRules');
  const tFinish = useTranslations('finish');
  const qc = useQueryClient();
  const getError = useErrorMessage();

  // --- §19.5: «Unificar rarezas» — anclado al editor de reglas por rareza ---
  // Backfill LOCAL de `Card.rarityCanonical` (money-safe, sin fuentes externas): colapsa duplicados y
  // variantes de escritura para que el editor muestre UNA fila por rareza real. Al éxito invalida las
  // queries del editor (rarezas + reglas de compra y venta) para recomponer la lista sin duplicados.
  const [unifyConfirmOpen, setUnifyConfirmOpen] = useState(false);
  const unifyMutation = useMutation({
    mutationFn: () => unifyRarities(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['buylist-rarities'] });
      qc.invalidateQueries({ queryKey: ['sales-rarities'] });
      qc.invalidateQueries({ queryKey: ['buylist-rules'] });
      qc.invalidateQueries({ queryKey: ['sales-rules'] });
    },
  });

  const rarities = useQuery({ queryKey: ['buylist-rarities'], queryFn: getBuylistRarities });
  const buylistRules = useQuery({ queryKey: ['buylist-rules'], queryFn: getBuylistRules });
  // Borradores por EJE: reglas por rareza canónica + reglas por acabado + fallback.
  const [ruleDraft, setRuleDraft] = useState<Record<string, BuylistRule>>({});
  const [finishRuleDraft, setFinishRuleDraft] = useState<Partial<Record<Finish, BuylistRule>>>({});
  const [fallbackDraft, setFallbackDraft] = useState<string | null>(null);
  const rulesMutation = useMutation({
    mutationFn: (payload: {
      rarityRules: Record<string, BuylistRule>;
      finishRules: Partial<Record<Finish, BuylistRule>>;
      fallbackPct: number;
    }) => updateBuylistRules(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['buylist-rarities'] });
      qc.invalidateQueries({ queryKey: ['buylist-rules'] });
      setRuleDraft({});
      setFinishRuleDraft({});
      setFallbackDraft(null);
    },
  });

  const serverFallback = rarities.data?.fallbackPct ?? 40;
  const effectiveFallback = fallbackDraft ?? String(serverFallback);
  // Regla efectiva de una RAREZA: borrador > regla explícita del servidor > fallback.
  function effectiveRule(rarity: string, serverRule: BuylistRule, source: 'rule' | 'fallback'): BuylistRule {
    if (ruleDraft[rarity]) return ruleDraft[rarity];
    if (source === 'rule') return serverRule;
    return { mode: 'pct', value: Number(effectiveFallback) || 0 };
  }
  // Regla efectiva de un ACABADO: borrador > regla explícita del servidor. Sin regla = HEREDA la
  // rareza (no hay finish-rule): la fila lo indica y su valor de edición arranca vacío.
  function effectiveFinishRule(finish: Finish): { rule: BuylistRule | null; hasRule: boolean } {
    if (finishRuleDraft[finish]) return { rule: finishRuleDraft[finish]!, hasRule: true };
    const server = buylistRules.data?.finishRules[finish];
    if (server) return { rule: server, hasRule: true };
    return { rule: null, hasRule: false };
  }
  const rulesDirty =
    Object.keys(ruleDraft).length > 0 ||
    Object.keys(finishRuleDraft).length > 0 ||
    (fallbackDraft != null && fallbackDraft !== String(serverFallback));

  function saveRules() {
    // Sin el PriceRuleSet del servidor no guardamos: el merge parte de él (dos ejes) para que el
    // REEMPLAZO TOTAL del PUT preserve lo no editado. (Ya no hay keys sintéticas que rescatar.)
    if (!buylistRules.data) return;
    rulesMutation.mutate({
      rarityRules: { ...buylistRules.data.rarityRules, ...ruleDraft },
      finishRules: { ...buylistRules.data.finishRules, ...finishRuleDraft },
      fallbackPct: Number(effectiveFallback) || 0,
    });
  }

  const rarityRows: RuleAxisRarityRow[] = (rarities.data?.rarities ?? []).map((row) => {
    const rule = effectiveRule(row.canonical, row.rule, row.source);
    const edited = !!ruleDraft[row.canonical];
    const effectiveSource: 'rule' | 'fallback' = edited ? 'rule' : row.source;
    return {
      canonical: row.canonical,
      cardCount: row.cardCount,
      premium: row.premium,
      mapped: row.mapped,
      mode: rule.mode,
      valueText: rule.mode === 'fixed' ? String(rule.value / 100) : String(rule.value),
      source: effectiveSource,
      onModeChange: (mode) => {
        setRuleDraft((prev) => ({ ...prev, [row.canonical]: { mode, value: rule.value } }));
      },
      onValueChange: (rawInput) => {
        const raw = rawInput.replace(/[^0-9.]/g, '');
        const value = rule.mode === 'fixed' ? pesosToCents(raw) : Number(raw) || 0;
        setRuleDraft((prev) => ({ ...prev, [row.canonical]: { mode: rule.mode, value } }));
      },
    };
  });

  const finishRows: RuleAxisFinishRow[] = FINISH_RULE_KEYS.map((finish) => {
    const { rule, hasRule } = effectiveFinishRule(finish);
    const mode = rule?.mode ?? 'fixed';
    const finishLabel = tFinish(finish);
    return {
      finish,
      label: finishLabel,
      mode,
      valueText: rule ? (mode === 'fixed' ? String(rule.value / 100) : String(rule.value)) : '',
      hasRule,
      onModeChange: (newMode) => {
        setFinishRuleDraft((prev) => ({
          ...prev,
          [finish]: { mode: newMode, value: rule?.value ?? 0 },
        }));
      },
      onValueChange: (rawInput) => {
        const raw = rawInput.replace(/[^0-9.]/g, '');
        const value = mode === 'fixed' ? pesosToCents(raw) : Number(raw) || 0;
        setFinishRuleDraft((prev) => ({ ...prev, [finish]: { mode, value } }));
      },
    };
  });

  return (
    <>
      <section className="flex flex-col gap-3">
        {/* §19.5: «Unificar rarezas» se ancla AQUÍ (junto al editor por rareza), no en Datos: el
            «por qué» solo se entiende mirando la lista fragmentada de rarezas que este botón limpia. */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 className="text-h2 font-semibold">{t('buylistRules.title')}</h2>
          <div className="flex flex-col items-end gap-1">
            <Button
              variant="secondary"
              size="sm"
              loading={unifyMutation.isPending}
              onClick={() => setUnifyConfirmOpen(true)}
            >
              <Wand2 size={14} aria-hidden /> {t('unifyRarities.button')}
            </Button>
            <p className="max-w-xs text-right text-xs text-muted">{t('unifyRarities.hint')}</p>
          </div>
        </div>
        <p className="text-sm text-muted">{t('buylistRules.subtitle')}</p>
        {/* Resumen HONESTO de la unificación: cuántas actualizó + rarezas `unmapped` accionables. */}
        {unifyMutation.isSuccess && (
          <Banner variant="success" role="status">
            <span className="font-medium">{t('unifyRarities.done')}</span>{' '}
            {t('unifyRarities.summary', {
              updated: unifyMutation.data.cardsUpdated,
              processed: unifyMutation.data.cardsProcessed,
              distinct: unifyMutation.data.distinctCanonical,
            })}
            {unifyMutation.data.unmapped.length > 0 && (
              <div className="mt-2 flex flex-col gap-1">
                <p className="font-medium">
                  {t('unifyRarities.unmappedTitle', { count: unifyMutation.data.unmapped.length })}
                </p>
                <ul className="list-disc pl-5">
                  {unifyMutation.data.unmapped.map((u) => (
                    <li key={u.raw}>
                      <span lang="en" className="font-medium">{u.raw}</span>{' '}
                      <span className="tabular text-muted">({u.count})</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Banner>
        )}
        {unifyMutation.isError && (
          <Banner variant="danger" role="alert" title={tc('errorTitle')}>{getError(unifyMutation.error)}</Banner>
        )}
        {/* G3: ejemplo en línea del % — en buylist el % es lo que PAGAS de la referencia
            (semántica OPUESTA a la de venta, por eso el ejemplo textual). */}
        <p className="text-xs text-muted">{t('buylistRules.example')}</p>
        <QueryState
          isLoading={rarities.isLoading}
          isError={rarities.isError}
          error={rarities.error}
          onRetry={() => rarities.refetch()}
        >
          {rarities.data && (
            <RuleAxisEditor
              t={tRules}
              fallbackValue={effectiveFallback}
              onFallbackChange={(rawInput) => setFallbackDraft(rawInput.replace(/[^0-9.]/g, ''))}
              rarityRows={rarityRows}
              finishRows={finishRows}
              dirty={rulesDirty}
              // INV-1 robustez: Guardar merge-ea sobre la tabla CRUDA (buylistRules). Sin ella el
              // guard hace return silencioso → gateamos el botón también con `!buylistRules.data`
              // para que el clic NUNCA sea un no-op mudo (cargando o en error).
              saveDisabled={!rulesDirty || !buylistRules.data}
              saving={rulesMutation.isPending}
              saveSuccess={rulesMutation.isSuccess}
              saveErrorMessage={rulesMutation.isError ? getError(rulesMutation.error) : null}
              rulesUnavailable={buylistRules.isError}
              onRetryRules={() => buylistRules.refetch()}
              onSave={saveRules}
              onCancel={() => {
                setRuleDraft({});
                setFallbackDraft(null);
              }}
            />
          )}
        </QueryState>
      </section>

      {/* §19.5: confirmación one-shot money-safe de «Unificar rarezas» (muta rarityCanonical de TODO
          el catálogo, aunque no toca precios ni reglas → se confirma para dejar claro el alcance). */}
      <Modal
        open={unifyConfirmOpen}
        onClose={() => setUnifyConfirmOpen(false)}
        title={t('unifyRarities.confirmTitle')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setUnifyConfirmOpen(false)}>
              {tc('cancel')}
            </Button>
            <Button
              loading={unifyMutation.isPending}
              onClick={() => {
                setUnifyConfirmOpen(false);
                unifyMutation.mutate();
              }}
            >
              {t('unifyRarities.confirmCta')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">{t('unifyRarities.confirmBody')}</p>
      </Modal>
    </>
  );
}
