'use client';

import { useId } from 'react';
import { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/Input';
import { cn } from '@/lib/cn';
import type { DiscountKind, DiscountProductScope, FulfillmentMode } from '@/types/contract';

export const ALL_SCOPES: readonly DiscountProductScope[] = ['raw', 'graded', 'sealed', 'accessory'];
export type DestinationChoice = 'both' | FulfillmentMode;

/** Lo que el formulario edita, en texto (pesos y fechas de México); `toConfig` lo convierte al contrato. */
export interface ConfigDraft {
  kind: DiscountKind;
  percentPct: string;
  amountPesos: string;
  maxDiscountPesos: string;
  minSubtotalPesos: string;
  startsAt: string;
  endsAt: string;
  scopes: DiscountProductScope[];
  destination: DestinationChoice;
}

export const EMPTY_CONFIG: ConfigDraft = {
  kind: 'percent',
  percentPct: '',
  amountPesos: '',
  maxDiscountPesos: '',
  minSubtotalPesos: '',
  startsAt: '',
  endsAt: '',
  scopes: [...ALL_SCOPES],
  destination: 'both',
};

export type FieldErrors = Partial<Record<string, string>>;

/**
 * Bloques «Descuento», «Condiciones» (fechas) y «Aplica a» de §DSC-UX.5, compartidos por «Nuevo código», su edición y
 * «Generar lote». `lockedAll` ⇒ todo `aria-disabled` con la razón (tras el primer uso, §DSC.7 912) salvo `endsAt`.
 */
export function DiscountConfigFields({
  draft,
  onChange,
  errors,
  lockedAll = false,
  lockedReasonId,
  children,
}: {
  draft: ConfigDraft;
  onChange: (patch: Partial<ConfigDraft>) => void;
  errors: FieldErrors;
  lockedAll?: boolean;
  lockedReasonId?: string;
  /** Campos de «Condiciones» propios de cada pantalla (usos), entre las fechas y «Aplica a». */
  children?: React.ReactNode;
}) {
  const t = useTranslations('admin.discounts');
  const id = useId();
  const lockProps = lockedAll
    ? { disabled: true, 'aria-disabled': true as const, 'aria-describedby': lockedReasonId }
    : {};
  const sectionCls = 'border-t border-border pt-6';
  return (
    <>
      <fieldset className={sectionCls} disabled={lockedAll}>
        <legend className="eyebrow text-text">{t('form.sectionDiscount')}</legend>
        <div role="radiogroup" aria-label={t('form.kindLabel')} className="mt-4 flex flex-wrap gap-2">
          {(['percent', 'fixed_amount', 'free_shipping'] as const).map((k) => (
            <label
              key={k}
              className={cn(
                'inline-flex min-h-[44px] cursor-pointer items-center gap-2 border px-4 text-sm',
                draft.kind === k ? 'border-text bg-text text-primary-fg' : 'border-border text-text',
                lockedAll && 'cursor-not-allowed bg-surface-2 text-muted',
              )}
            >
              <input
                type="radio"
                name={`${id}-kind`}
                value={k}
                checked={draft.kind === k}
                onChange={() => onChange({ kind: k })}
                className="sr-only"
                {...lockProps}
              />
              {t(`kind.${k}`)}
            </label>
          ))}
        </div>
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          {draft.kind === 'percent' && (
            <>
              <Input
                label={t('form.valuePct')}
                inputMode="numeric"
                value={draft.percentPct}
                onChange={(e) => onChange({ percentPct: e.target.value.replace(/[^\d]/g, '').slice(0, 3) })}
                error={errors.percentPct}
                suffix="%"
                {...lockProps}
              />
              <Input
                label={t('form.maxDiscount')}
                hint={t('form.maxDiscountHint')}
                inputMode="decimal"
                value={draft.maxDiscountPesos}
                onChange={(e) => onChange({ maxDiscountPesos: e.target.value })}
                error={errors.maxDiscountCents}
                prefix="MX$"
                {...lockProps}
              />
            </>
          )}
          {draft.kind === 'fixed_amount' && (
            <Input
              label={t('form.valueAmount')}
              hint={t('form.valueAmountHint')}
              inputMode="decimal"
              value={draft.amountPesos}
              onChange={(e) => onChange({ amountPesos: e.target.value })}
              error={errors.amountCents}
              prefix="MX$"
              {...lockProps}
            />
          )}
        </div>
      </fieldset>

      <fieldset className={sectionCls}>
        <legend className="eyebrow text-text">{t('form.sectionConditions')}</legend>
        <div className="mt-4 grid gap-5 sm:grid-cols-2">
          <Input
            label={t('form.minSubtotal')}
            hint={t('form.minSubtotalHint')}
            inputMode="decimal"
            value={draft.minSubtotalPesos}
            onChange={(e) => onChange({ minSubtotalPesos: e.target.value })}
            error={errors.minSubtotalCents}
            prefix="MX$"
            {...lockProps}
          />
          <span />
          <Input
            type="datetime-local"
            label={t('form.startsAt')}
            value={draft.startsAt}
            onChange={(e) => onChange({ startsAt: e.target.value })}
            error={errors.startsAt}
            {...lockProps}
          />
          <Input
            type="datetime-local"
            label={t('form.endsAt')}
            hint={t('form.timeHint')}
            value={draft.endsAt}
            onChange={(e) => onChange({ endsAt: e.target.value })}
            error={errors.endsAt}
          />
          {children}
        </div>
      </fieldset>

      <fieldset className={sectionCls} disabled={lockedAll}>
        <legend className="eyebrow text-text">{t('form.sectionAppliesTo')}</legend>
        <p className="mt-4 text-sm text-text">{t('form.productScopes')}</p>
        <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
          {ALL_SCOPES.map((s) => (
            <label key={s} className="inline-flex min-h-[44px] items-center gap-2 text-sm text-text">
              <input
                type="checkbox"
                checked={draft.scopes.includes(s)}
                onChange={(e) =>
                  onChange({ scopes: e.target.checked ? [...draft.scopes, s] : draft.scopes.filter((x) => x !== s) })
                }
                className="h-4 w-4"
                {...lockProps}
              />
              {t(`form.scope.${s}`)}
            </label>
          ))}
        </div>
        <p className={cn('mt-1 font-mono text-xs', errors.productScopes ? 'text-accent' : 'text-muted')} role={errors.productScopes ? 'alert' : undefined}>
          {errors.productScopes ?? t('form.scopesHint')}
        </p>
        <p className="mt-5 text-sm text-text">{t('form.destination')}</p>
        <div role="radiogroup" aria-label={t('form.destination')} className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
          {(['both', 'direct_ship', 'vault'] as const).map((d) => (
            <label key={d} className="inline-flex min-h-[44px] items-center gap-2 text-sm text-text">
              <input
                type="radio"
                name={`${id}-dest`}
                checked={draft.destination === d}
                onChange={() => onChange({ destination: d })}
                {...lockProps}
              />
              {t(`form.dest.${d}`)}
            </label>
          ))}
        </div>
        {errors.destinations && (
          <p role="alert" className="mt-1 font-mono text-xs text-accent">
            {errors.destinations}
          </p>
        )}
        <p className="mt-2 font-mono text-xs text-muted">{t('form.withdrawalNote')}</p>
      </fieldset>
    </>
  );
}
