'use client';

import { useTranslations } from 'next-intl';
import type { Finish } from '@/types/contract';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { Banner } from '@/components/ui/Banner';
import { RULE_MODES } from './shared';

/** Modo de una regla de precio (idéntico en buylist y venta). */
export type RuleMode = 'fixed' | 'pct';

/** Fila del EJE 1 (rareza canónica) del editor de reglas. */
export interface RuleAxisRarityRow {
  canonical: string;
  cardCount: number;
  premium: boolean;
  mapped: boolean;
  mode: RuleMode;
  /** Texto CRUDO a mostrar en el input de valor (el modelo interno lo computa cada sección). */
  valueText: string;
  /** Origen EFECTIVO de la regla (borrador editado → 'rule'; si no, el del servidor). */
  source: 'rule' | 'fallback';
  onModeChange: (mode: RuleMode) => void;
  /** Recibe el `e.target.value` CRUDO; cada sección aplica su propio saneo/casteo. */
  onValueChange: (rawInput: string) => void;
}

/** Fila del EJE 2 (acabado) del editor de reglas. */
export interface RuleAxisFinishRow {
  finish: Finish;
  label: string;
  mode: RuleMode;
  valueText: string;
  hasRule: boolean;
  onModeChange: (mode: RuleMode) => void;
  onValueChange: (rawInput: string) => void;
}

export interface RuleAxisEditorProps {
  /** `t` con scope `admin.m2.buylistRules` o `admin.m2.salesRules` (comparten las mismas keys). */
  t: ReturnType<typeof useTranslations>;
  fallbackValue: string;
  /** Recibe el `e.target.value` CRUDO; la sección aplica el `.replace(/[^0-9.]/g,'')`. */
  onFallbackChange: (rawInput: string) => void;
  rarityRows: RuleAxisRarityRow[];
  finishRows: RuleAxisFinishRow[];
  /** VENTA: copy del pct (markup arriba de mercado) tras el eje de acabado. Buylist lo omite. */
  showPctHint?: boolean;
  /** VENTA (S-P1-1): banner que explica por qué Guardar está bloqueado por un valor vacío/mal formado. */
  showInvalidBanner?: boolean;
  dirty: boolean;
  saveDisabled: boolean;
  saving: boolean;
  saveSuccess: boolean;
  saveErrorMessage: string | null;
  /** La tabla CRUDA de reglas falló → se explica por qué no se puede guardar (con reintento). */
  rulesUnavailable: boolean;
  onRetryRules: () => void;
  onSave: () => void;
  onCancel: () => void;
}

/**
 * TD-1 dedup: editor de reglas de precio de DOS EJES (rareza canónica + acabado) con
 * borrador/efectivo/fallback. Es el patrón común de buylist (Sección 4) y venta (Sección 5), que
 * eran clones ~1:1. Aquí vive SOLO la ESTRUCTURA visual (idéntica en ambos); la lógica de modelo
 * que difiere (buylist guarda valores numéricos y PRESERVA el valor al cambiar de modo; venta
 * guarda texto crudo, LIMPIA el valor al cambiar de modo y valida antes de persistir) queda en
 * cada sección vía las view-models de fila y sus callbacks → comportamiento EXACTO preservado.
 */
export function RuleAxisEditor({
  t,
  fallbackValue,
  onFallbackChange,
  rarityRows,
  finishRows,
  showPctHint = false,
  showInvalidBanner = false,
  dirty,
  saveDisabled,
  saving,
  saveSuccess,
  saveErrorMessage,
  rulesUnavailable,
  onRetryRules,
  onSave,
  onCancel,
}: RuleAxisEditorProps) {
  const tc = useTranslations('common');
  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
      {/* Fallback % para rarezas sin regla explícita */}
      <div className="flex flex-wrap items-end gap-3 border-b border-border pb-4">
        <Input
          label={t('fallbackLabel')}
          type="text"
          inputMode="decimal"
          suffix="%"
          className="w-32"
          value={fallbackValue}
          onChange={(e) => onFallbackChange(e.target.value)}
        />
        <p className="text-xs text-muted">{t('fallbackHint')}</p>
      </div>

      {/* EJE 1 — reglas por RAREZA CANÓNICA (empatan 1:1 con las cartas del catálogo). */}
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">
        {t('rarityAxis')}
      </p>
      <ul className="flex flex-col divide-y divide-border">
        <li className="hidden gap-3 py-2 text-xs uppercase tracking-wide text-muted md:grid md:grid-cols-[1fr_auto_auto_auto_auto]">
          <span>{t('rarity')}</span>
          <span className="text-right">{t('cardCount')}</span>
          <span>{t('mode')}</span>
          <span>{t('value')}</span>
          <span>{t('source')}</span>
        </li>
        {rarityRows.map((row) => (
          <li
            key={row.canonical}
            className="grid grid-cols-2 items-end gap-3 py-3 md:grid-cols-[1fr_auto_auto_auto_auto]"
          >
            <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
              <span lang="en">{row.canonical}</span>
              {/* v1.29: atributo `premium` del catálogo canónico (§4.28e). */}
              {row.premium && (
                <Badge tone="accent" shape="outline">{t('premium')}</Badge>
              )}
              {/* v1.29: rareza `unmapped` (aún sin forma canónica) → cae al fallback pct. */}
              {row.mapped === false && (
                <Badge tone="warning" shape="outline">{t('unmapped')}</Badge>
              )}
            </span>
            <span className="tabular text-right text-sm text-muted">{row.cardCount}</span>
            <Select
              label={t('mode')}
              aria-label={t('modeFor', { rarity: row.canonical })}
              className="w-32"
              options={RULE_MODES.map((m) => ({ value: m, label: t(`modeLabel.${m}`) }))}
              value={row.mode}
              onChange={(e) => row.onModeChange(e.target.value as RuleMode)}
            />
            <Input
              label={row.mode === 'fixed' ? t('valueMxn') : t('valuePct')}
              aria-label={t('valueFor', { rarity: row.canonical })}
              type="text"
              inputMode="decimal"
              prefix={row.mode === 'fixed' ? 'MX$' : undefined}
              suffix={row.mode === 'pct' ? '%' : undefined}
              className="w-32"
              value={row.valueText}
              onChange={(e) => row.onValueChange(e.target.value)}
            />
            <Badge tone={row.source === 'rule' ? 'info' : 'neutral'} shape="outline">
              {t(`sourceLabel.${row.source}`)}
            </Badge>
          </li>
        ))}
      </ul>

      {/* EJE 2 — reglas por ACABADO (reverse holo / holofoil / 1st ed). Reemplazan las viejas
          keys sintéticas "Holo"/"Reverse Holo"; sin regla, el acabado HEREDA la de la rareza. */}
      <p className="mt-2 border-t border-border pt-4 text-xs font-semibold uppercase tracking-wide text-muted">
        {t('finishAxis')}
      </p>
      <p className="text-xs text-muted">{t('finishAxisHint')}</p>
      <ul className="flex flex-col divide-y divide-border">
        <li className="hidden gap-3 py-2 text-xs uppercase tracking-wide text-muted md:grid md:grid-cols-[1fr_auto_auto_auto]">
          <span>{t('finish')}</span>
          <span>{t('mode')}</span>
          <span>{t('value')}</span>
          <span>{t('source')}</span>
        </li>
        {finishRows.map((row) => (
          <li
            key={row.finish}
            className="grid grid-cols-2 items-end gap-3 py-3 md:grid-cols-[1fr_auto_auto_auto]"
          >
            <span className="text-sm font-medium">{row.label}</span>
            <Select
              label={t('mode')}
              aria-label={t('modeForFinish', { finish: row.label })}
              className="w-32"
              options={RULE_MODES.map((m) => ({ value: m, label: t(`modeLabel.${m}`) }))}
              value={row.mode}
              onChange={(e) => row.onModeChange(e.target.value as RuleMode)}
            />
            <Input
              label={row.mode === 'fixed' ? t('valueMxn') : t('valuePct')}
              aria-label={t('valueForFinish', { finish: row.label })}
              type="text"
              inputMode="decimal"
              prefix={row.mode === 'fixed' ? 'MX$' : undefined}
              suffix={row.mode === 'pct' ? '%' : undefined}
              placeholder={t('inheritPlaceholder')}
              className="w-32"
              value={row.valueText}
              onChange={(e) => row.onValueChange(e.target.value)}
            />
            <Badge tone={row.hasRule ? 'info' : 'neutral'} shape="outline">
              {row.hasRule ? t('sourceLabel.rule') : t('inherit')}
            </Badge>
          </li>
        ))}
      </ul>

      {/* Copy clave de VENTA: el pct es markup ARRIBA de mercado; fixed es un piso. */}
      {showPctHint && <p className="text-xs text-muted">{t('pctHint')}</p>}

      {/* S-P1-1 money-safe: explica por qué Guardar está deshabilitado cuando hay un valor
          vacío/mal formado (no se persiste como MX$0). */}
      {showInvalidBanner && (
        <Banner variant="warning" role="alert">{t('invalidValue')}</Banner>
      )}

      <div className="flex gap-2">
        <Button
          variant="secondary"
          disabled={saveDisabled}
          loading={saving}
          onClick={onSave}
        >
          {tc('save')}
        </Button>
        {dirty && (
          <Button variant="ghost" onClick={onCancel}>
            {tc('cancel')}
          </Button>
        )}
      </div>
      {/* Si la tabla cruda falló, se explica por qué no se puede guardar (con reintento). */}
      {rulesUnavailable && (
        <Banner
          variant="warning"
          role="alert"
          title={tc('errorTitle')}
          action={
            <Button variant="secondary" size="sm" onClick={onRetryRules}>
              {tc('retry')}
            </Button>
          }
        >
          {t('rulesUnavailable')}
        </Banner>
      )}
      {saveSuccess && (
        <Banner variant="success" role="status">{t('saved')}</Banner>
      )}
      {saveErrorMessage != null && (
        <Banner variant="danger" role="alert" title={tc('errorTitle')}>{saveErrorMessage}</Banner>
      )}
    </div>
  );
}
