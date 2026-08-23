'use client';

import { useTranslations } from 'next-intl';
import { ShieldAlert } from 'lucide-react';
import { Input } from '@/components/ui/Input';

/**
 * Precio de mercado MANUAL money-safe (DESIGN_SYSTEM §16.8a, P-38 · `SealedManualMarketField`). Aparece
 * en el paso 2 SOLO cuando `marketRef` del producto es null/pending (sin mercado vivo ni cacheado) Y el
 * usuario es `vault_operator+` (decisión del humano v1.39.1). Input de dinero ABIERTO VACÍO — jamás
 * prellenado con 0 ni un sugerido inventado (§7.5). Mapea a `manualMarketMxnCents` de la línea del batch;
 * valida `> 0`. Aviso de override AUDITADO. Sin llenar ⇒ la aportación queda PRICE_PENDING (helper honesto).
 * Cuando SÍ hay mercado vivo este campo NO se renderiza (el override solo llena el hueco null, nunca pisa
 * un mercado ya resuelto → el backend responde 422 MANUAL_MARKET_NOT_ALLOWED).
 */

export interface SealedManualMarketFieldProps {
  /** Valor en pesos (string abierto). '' = vacío (no capturado). */
  value: string;
  onChange: (v: string) => void;
  /** true si el valor capturado es inválido (≤ 0 o no numérico) — muestra el error. */
  invalid: boolean;
}

export function SealedManualMarketField({ value, onChange, invalid }: SealedManualMarketFieldProps) {
  const t = useTranslations('admin.sealedAdd.manualMarket');

  return (
    <div className="flex flex-col gap-2 border border-warning/60 bg-surface-2 p-3">
      <span className="eyebrow text-warning">{t('eyebrow')}</span>
      <p className="text-xs text-muted">{t('body')}</p>
      <Input
        label={t('label')}
        prefix="MX$"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        error={invalid ? t('mustBePositive') : undefined}
      />
      <p className="flex items-start gap-1.5 text-xs text-muted">
        <ShieldAlert size={14} className="mt-0.5 shrink-0" aria-hidden />
        <span>{t('auditNotice')}</span>
      </p>
    </div>
  );
}
