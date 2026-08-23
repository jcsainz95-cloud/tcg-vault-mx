'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Minus, Plus } from 'lucide-react';
import { bulkRemoveInventory } from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import type {
  BulkRemoveInventoryResponse,
  Finish,
  RemoveReason,
  SealedCondition,
} from '@/types/contract';
import { localUid } from '@/components/master-set/capture';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';

/**
 * Baja rápida de inventario — P-29 (DESIGN_SYSTEM §16.5, simétrico al alta rápida P-19). Da de baja
 * N piezas de la MISMA variante (carta + acabado, o carta + sellado) de un golpe: cantidad + motivo
 * de merma (`reason`, enum OBLIGATORIO) + nota de texto libre (`note`, OBLIGATORIA no-vacía) +
 * confirmación simple. La operación es ATÓMICA (backend): baja las N o ninguna
 * (422 INSUFFICIENT_STOCK). MONEY-SAFE: el stepper se capa contra el conteo VISIBLE de piezas
 * ajustables (`removableCount`) y el CTA se deshabilita cuando no hay ninguna o la nota está vacía
 * — barrera de UI; el backend es la barrera dura. `batchKey` (v1.35, idempotency key por intento,
 * mismo patrón que QuickAdd/adjustFound) cierra el «encogimiento fantasma» de un reintento tras un
 * timeout ambiguo: se genera una vez por operación y se reusa en el reintento del mismo submit.
 */

const REMOVE_REASONS: RemoveReason[] = ['perdida', 'danada', 'error_captura'];

export interface QuickRemoveTarget {
  cardId: string;
  productType: 'raw' | 'sealed';
  finish: Finish;
  sealedCondition?: SealedCondition;
}

export interface QuickRemoveProps {
  target: QuickRemoveTarget;
  /** Conteo VISIBLE de piezas ajustables de esta variante (platform, in_stock|listed). */
  removableCount: number;
  /** Refresca lista de piezas/agregados tras la baja. */
  onRemoved?: (res: BulkRemoveInventoryResponse) => void;
  onToast?: (msg: string) => void;
}

export function QuickRemoveSection({ target, removableCount, onRemoved, onToast }: QuickRemoveProps) {
  const t = useTranslations('admin.quickRemove');
  const tReason = useTranslations('masterSet.adjust.reason');
  const tRoot = useTranslations();
  const errorRef = useRef<HTMLDivElement>(null);

  const [qty, setQty] = useState('1');
  const [reason, setReason] = useState<RemoveReason>('perdida');
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);

  const noneRemovable = removableCount < 1;
  // qty válido: entero ≥1 y ≤ conteo visible (money-safe: nunca ofrecer bajar de más).
  const qtyNum = Math.min(
    Math.max(1, Math.floor(Number(qty) || 1)),
    Math.max(1, removableCount),
  );
  // `note` es OBLIGATORIA (backend `@IsString() note!` no-vacío): sin ella toda baja real cae en
  // 400 VALIDATION_ERROR. Barrera de UI: no se puede confirmar/enviar con la nota vacía.
  const noteTrimmed = note.trim();
  const noteInvalid = noteTrimmed === '';

  // batchKey idempotente POR INTENTO (mismo patrón que QuickAdd/adjustFound): estable durante los
  // reintentos del MISMO submit, rota tras un éxito. Cierra el «encogimiento fantasma».
  const batchKeyRef = useRef<string | null>(null);
  function ensureBatchKey(): string {
    if (batchKeyRef.current === null) batchKeyRef.current = localUid('qrem');
    return batchKeyRef.current;
  }

  const submit = useMutation({
    mutationFn: () =>
      bulkRemoveInventory({
        cardId: target.cardId,
        finish: target.finish,
        quantity: qtyNum,
        reason, // enum OBLIGATORIO (motivo elegido antes de confirmar).
        note: noteTrimmed, // texto libre OBLIGATORIO no-vacío (paridad con la baja por-pieza).
        batchKey: ensureBatchKey(),
        productType: target.productType,
        ...(target.productType === 'sealed' && target.sealedCondition !== undefined
          ? { sealedCondition: target.sealedCondition }
          : {}),
      }),
    onSuccess: (res) => {
      // Éxito → la siguiente baja usa una batchKey nueva (un reintento del MISMO intento fallido
      // reusa la key = replay idempotente en backend). `idempotentReplay` se consume sin romper el
      // tipado; no hace falta pintarlo.
      batchKeyRef.current = null;
      setConfirming(false);
      setQty('1');
      setNote('');
      onRemoved?.(res);
      onToast?.(t('success', { count: res.removed }));
    },
    onError: () => {
      // La confirmación y la batchKey se mantienen: el reintento del mismo submit reusa la key
      // para que el backend lo trate idempotente (no re-baja otras N piezas).
    },
  });

  useEffect(() => {
    if (submit.isError && errorRef.current) {
      errorRef.current.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
      errorRef.current.focus();
    }
  }, [submit.isError]);

  function errorMessage(e: unknown): string {
    if (e instanceof ApiClientError) {
      // INSUFFICIENT_STOCK trae `{ available, requested }`: carrera (otra baja/venta vació el stock).
      if (e.code === 'INSUFFICIENT_STOCK') {
        const available =
          typeof e.details?.available === 'number' ? (e.details.available as number) : 0;
        return t('insufficientStock', { available });
      }
      if (tRoot.has(`error.${e.code}`)) return tRoot(`error.${e.code}`);
      return e.message;
    }
    return tRoot('common.errorGeneric');
  }

  return (
    <section className="flex flex-col gap-4" aria-label={t('title')}>
      {submit.isError && (
        <div ref={errorRef} tabIndex={-1} className="outline-none">
          <Banner variant="danger" role="alert">
            {errorMessage(submit.error)}
          </Banner>
        </div>
      )}
      {submit.data && !submit.isError && (
        <Banner variant="success" role="status">
          {t('success', { count: submit.data.removed })}
        </Banner>
      )}

      {noneRemovable ? (
        <p className="text-sm text-muted">{t('noneRemovable')}</p>
      ) : (
        <>
          <p className="text-xs text-muted">{t('available', { count: removableCount })}</p>

          {/* 1. Cantidad — stepper capado al conteo visible. */}
          <div className="flex flex-col gap-2">
            <span className="eyebrow">{t('qty')}</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label={t('qtyMinus')}
                disabled={qtyNum <= 1}
                aria-disabled={qtyNum <= 1}
                className="flex h-11 w-11 items-center justify-center border border-border-strong text-text enabled:hover:bg-surface-2 focus-visible:shadow-focus focus-visible:outline-none disabled:cursor-not-allowed disabled:border-border disabled:bg-surface-2 disabled:text-muted disabled:opacity-45"
                onClick={() => {
                  setConfirming(false);
                  setQty(String(Math.max(1, qtyNum - 1)));
                }}
              >
                <Minus size={16} />
              </button>
              <input
                aria-label={t('qty')}
                inputMode="numeric"
                className="h-11 w-14 border-y border-border-strong bg-transparent text-center font-mono tabular-nums text-base outline-none"
                value={qty}
                onChange={(e) => {
                  setConfirming(false);
                  setQty(e.target.value);
                }}
                onBlur={() => setQty(String(qtyNum))}
              />
              <button
                type="button"
                aria-label={t('qtyPlus')}
                disabled={qtyNum >= removableCount}
                aria-disabled={qtyNum >= removableCount}
                className="flex h-11 w-11 items-center justify-center border border-border-strong text-text enabled:hover:bg-surface-2 focus-visible:shadow-focus focus-visible:outline-none disabled:cursor-not-allowed disabled:border-border disabled:bg-surface-2 disabled:text-muted disabled:opacity-45"
                onClick={() => {
                  setConfirming(false);
                  setQty(String(Math.min(removableCount, qtyNum + 1)));
                }}
              >
                <Plus size={16} />
              </button>
            </div>
          </div>

          {/* 2. Motivo de la baja (merma) — enum OBLIGATORIO. */}
          <Select
            label={t('reasonLabel')}
            options={REMOVE_REASONS.map((r) => ({ value: r, label: tReason(r) }))}
            value={reason}
            onChange={(e) => {
              setConfirming(false);
              setReason(e.target.value as RemoveReason);
            }}
          />

          {/* 3. Nota de la baja — texto libre OBLIGATORIO (backend la exige no-vacía). */}
          <Input
            label={t('noteLabel')}
            value={note}
            onChange={(e) => {
              setConfirming(false);
              setNote(e.target.value);
            }}
            error={note !== '' && noteInvalid ? t('noteRequired') : undefined}
            hint={t('noteHint')}
          />

          {/* 4. CTA con confirmación simple (dos pasos, sin modal). */}
          {confirming ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-text">{t('confirmBody', { count: qtyNum })}</p>
              <div className="flex gap-2">
                <Button
                  variant="destructive"
                  className="flex-1"
                  onClick={() => submit.mutate()}
                  disabled={submit.isPending}
                  loading={submit.isPending}
                >
                  {submit.isPending ? t('loading') : t('confirmCta', { count: qtyNum })}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => setConfirming(false)}
                  disabled={submit.isPending}
                >
                  {t('cancel')}
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="destructive"
              className="w-full"
              disabled={noteInvalid}
              onClick={() => setConfirming(true)}
            >
              {t('cta', { count: qtyNum })}
            </Button>
          )}
        </>
      )}
    </section>
  );
}
