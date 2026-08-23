'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Minus, Plus } from 'lucide-react';
import { batchCreateItems } from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import type {
  BatchCreateInventoryResponse,
  BatchInventoryItemInput,
  Finish,
  SealedCondition,
  SealedSubtype,
  VariantBuySource,
} from '@/types/contract';
import type { AppLocale } from '@/i18n/routing';
import { formatMoneyCents } from '@/lib/format';
import { useRole } from '@/lib/role';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { localUid } from '@/components/master-set/capture';

/**
 * Alta rápida simplificada — P-19 (DESIGN_SYSTEM §16.5). SOLO cantidad + adquisición:
 * «Comprar» (precio prellenado con buy.effectiveCents, editable) o «Aportación» (valor de
 * mercado, NO editable, `acquisitionPct: 100` explícito). SIN dropdown de acabado (viene de la
 * casilla picada), SIN ubicación. Reusa POST /admin/inventory/items/batch (lote tolerante).
 * También la usa la pestaña Sellado (§16.8) con `sealedMarketRef` como referencia de aportación.
 */

export interface QuickAddTarget {
  // v1.39 (P-38): OPCIONAL — requerido para raw/graded y para sealed SIN `sealedProductId`. Con
  // `sealedProductId` el backend DERIVA la Card ancla, así que el alta por identidad NO envía cardId
  // (H-P38-5: nunca reusar el `SealedProduct.id` como relleno de tipo — deja que el backend ancle).
  cardId?: string;
  productType: 'raw' | 'sealed';
  finish: Finish;
  sealedSubtype?: SealedSubtype | null;
  sealedCondition?: SealedCondition;
  // v1.39 (P-38): IDENTIDAD del sellado (FK → SealedProduct). Presente ⇒ la pieza NACE con identidad
  // real (el backend deriva cardId ancla + mapeo + imagen/nombre/subtipo y congela snapshot); se OMITE
  // el cardId ancla del cliente. Sustituye a los 4 campos M-37 sueltos (deprecados).
  sealedProductId?: string;
  // v1.39.1 (P-38): fallback MANUAL money-safe (MXN centavos) — SOLO se envía cuando el mercado vivo es
  // null y el operador lo capturó (`> 0`). Auditado server-side; con mercado vivo → 422.
  manualMarketMxnCents?: number | null;
  // v1.36 (P-35, DEPRECADO si hay sealedProductId): identidad TCGCSV suelta. Se fijan JUNTOS.
  tcgplayerProductId?: number;
  tcgplayerGroupId?: number;
  sealedImageUrl?: string | null;
  sealedProductName?: string | null;
}

export interface QuickAddProps {
  target: QuickAddTarget;
  /** `pricing.buy.effectiveCents` del binder (sugerido/override/bounty vigente) — null sin sugerido. */
  buyEffectiveCents: number | null;
  buySource: VariantBuySource | null;
  /** Referencia de mercado para la APORTACIÓN (raw: variante P-15; sellado: sealedMarketRef). */
  marketRefCents: number | null;
  /** Refresca lista de piezas/agregados; recibe los folios creados (resaltado 3s). */
  onCreated?: (folios: string[]) => void;
  onToast?: (msg: string) => void;
}

type AcqPath = 'compra' | 'aportacion';

function parsePesos(v: string): number | null {
  const s = v.trim();
  if (s === '') return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

export function QuickAddSection({
  target,
  buyEffectiveCents,
  buySource,
  marketRefCents,
  onCreated,
  onToast,
}: QuickAddProps) {
  const t = useTranslations('admin.quickAdd');
  const tRoot = useTranslations();
  const locale = useLocale() as AppLocale;
  const { isSuperAdmin } = useRole();
  const errorRef = useRef<HTMLDivElement>(null);

  const [qty, setQty] = useState('1');
  const contribBlocked = marketRefCents == null;
  const [path, setPath] = useState<AcqPath>('compra');
  const [price, setPrice] = useState(
    buyEffectiveCents != null ? String(buyEffectiveCents / 100) : '',
  );

  const qtyNum = Math.max(1, Math.floor(Number(qty) || 1));
  const priceCents = parsePesos(price);
  const priceInvalid = path === 'compra' && (priceCents == null || priceCents <= 0);

  // batchKey idempotente POR INTENTO: estable durante reintentos, rota tras un éxito.
  const batchKeyRef = useRef<string | null>(null);
  function ensureBatchKey(): string {
    if (batchKeyRef.current === null) batchKeyRef.current = localUid('qadd');
    return batchKeyRef.current;
  }

  const submit = useMutation({
    mutationFn: () => {
      // v1.39 (P-38): con IDENTIDAD (`sealedProductId`) el backend deriva la Card ancla ⇒ se OMITE
      // el cardId del cliente (la pieza nace «ETB …», no un single). Los 4 campos M-37 sueltos quedan
      // deprecados y solo se envían en el camino legacy (sin sealedProductId).
      const usesSealedIdentity = target.productType === 'sealed' && !!target.sealedProductId;
      const line: BatchInventoryItemInput = {
        ...(usesSealedIdentity ? {} : { cardId: target.cardId }),
        productType: target.productType,
        ...(target.productType === 'raw'
          ? { rawCondition: 'NM' as const, finish: target.finish }
          : {
              ...(target.sealedSubtype ? { sealedSubtype: target.sealedSubtype } : {}),
              ...(target.sealedCondition ? { sealedCondition: target.sealedCondition } : {}),
              ...(usesSealedIdentity
                ? {
                    // Identidad real: FK al SealedProduct + fallback manual money-safe (si aplica).
                    sealedProductId: target.sealedProductId,
                    ...(target.manualMarketMxnCents != null && target.manualMarketMxnCents > 0
                      ? { manualMarketMxnCents: target.manualMarketMxnCents }
                      : {}),
                  }
                : {
                    // Legacy P-35: nace MAPEADA — productId + groupId se envían JUNTOS.
                    ...(target.tcgplayerProductId != null && target.tcgplayerGroupId != null
                      ? {
                          tcgplayerProductId: target.tcgplayerProductId,
                          tcgplayerGroupId: target.tcgplayerGroupId,
                        }
                      : {}),
                    ...(target.sealedImageUrl ? { sealedImageUrl: target.sealedImageUrl } : {}),
                    ...(target.sealedProductName ? { sealedProductName: target.sealedProductName } : {}),
                  }),
            }),
        qty: qtyNum,
        ...(path === 'compra'
          ? { acquisitionType: 'compra' as const, acquisitionCostCents: priceCents ?? 0 }
          : // Aportación P-19: pct 100 EXPLÍCITO (el server valúa costo = referencia × 100%).
            { acquisitionType: 'aportacion_en_especie' as const, acquisitionPct: 100 }),
      };
      return batchCreateItems({ batchKey: ensureBatchKey(), items: [line] });
    },
    onSuccess: (data) => {
      if (data.summary.failedLines === 0) {
        // Éxito → la siguiente alta usa una batchKey nueva (un reintento del MISMO intento
        // fallido reusa la key = replay idempotente).
        batchKeyRef.current = null;
        const folios = data.results.flatMap((r) => (r.ok ? r.folios : []));
        onCreated?.(folios);
        onToast?.(summaryOf(data));
      } else {
        // Fallo por-línea (p. ej. PRICE_PENDING): el banner anclado lo pinta el render.
        batchKeyRef.current = null;
      }
    },
  });

  // P-4: el desenlace negativo se ancla arriba, con foco (jamás silencio ni éxito fingido).
  const failedLine = submit.data?.results.find((r) => !r.ok);
  useEffect(() => {
    if ((submit.isError || failedLine) && errorRef.current) {
      errorRef.current.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
      errorRef.current.focus();
    }
  }, [submit.isError, failedLine]);

  function summaryOf(data: BatchCreateInventoryResponse): string {
    const folios = data.results.flatMap((r) => (r.ok ? r.folios : []));
    if (folios.length === 1) return t('successOne', { folio: folios[0] });
    return t('successSummary', {
      count: folios.length,
      first: folios[0] ?? '',
      last: folios[folios.length - 1] ?? '',
    });
  }

  function lineErrorMessage(code: string, message: string): string {
    if (code === 'PRICE_PENDING') return t('pricePendingError');
    if (tRoot.has(`error.${code}`)) return tRoot(`error.${code}`);
    return message;
  }

  const buyHelper = (() => {
    if (buyEffectiveCents == null) return t('buy.helper.none');
    if (buySource === 'bounty') return t('buy.helper.bounty');
    if (buySource === 'override') return t('buy.helper.manual');
    return t('buy.helper.rule');
  })();

  const succeeded = submit.data && submit.data.summary.failedLines === 0;

  return (
    <section className="flex flex-col gap-4" aria-label={t('title')}>
      {/* Resultado por-ítem (lección P-4/P-5): DENTRO del panel, nunca solo un toast. */}
      {(submit.isError || failedLine) && (
        <div ref={errorRef} tabIndex={-1} className="sticky top-0 z-10 outline-none">
          <Banner variant="danger" role="alert">
            {submit.isError
              ? submit.error instanceof ApiClientError
                ? lineErrorMessage(submit.error.code, submit.error.message)
                : tRoot('common.errorGeneric')
              : failedLine && !failedLine.ok
                ? lineErrorMessage(failedLine.error.code, failedLine.error.message)
                : null}
          </Banner>
        </div>
      )}
      {succeeded && submit.data && (
        <Banner variant="success" role="status">
          {summaryOf(submit.data)}
          {submit.data.idempotentReplay ? ` · ${t('replay')}` : ''}
        </Banner>
      )}

      {/* 1. Cantidad — stepper (botones 44px, mín 1). */}
      <div className="flex flex-col gap-2">
        <span className="eyebrow">{t('qty')}</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label={t('qtyMinus')}
            className="flex h-11 w-11 items-center justify-center border border-border-strong text-text hover:bg-surface-2 focus-visible:shadow-focus focus-visible:outline-none"
            onClick={() => setQty(String(Math.max(1, qtyNum - 1)))}
          >
            <Minus size={16} />
          </button>
          <input
            aria-label={t('qty')}
            inputMode="numeric"
            className="h-11 w-14 border-y border-border-strong bg-transparent text-center font-mono tabular-nums text-base outline-none"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            onBlur={() => setQty(String(qtyNum))}
          />
          <button
            type="button"
            aria-label={t('qtyPlus')}
            className="flex h-11 w-11 items-center justify-center border border-border-strong text-text hover:bg-surface-2 focus-visible:shadow-focus focus-visible:outline-none"
            onClick={() => setQty(String(qtyNum + 1))}
          >
            <Plus size={16} />
          </button>
        </div>
      </div>

      {/* 2. Adquisición — dos tarjetas-radio grandes. */}
      <div
        role="radiogroup"
        aria-label={t('acqLabel')}
        className="grid gap-3 sm:grid-cols-2"
      >
        {/* Comprar */}
        <label
          className={`flex cursor-pointer flex-col gap-2 border p-3 ${
            path === 'compra'
              ? 'border-border-strong bg-surface-2'
              : 'border-border hover:bg-surface-2/50'
          }`}
        >
          <span className="flex items-center gap-2">
            <input
              type="radio"
              name="quickadd-acq"
              checked={path === 'compra'}
              onChange={() => setPath('compra')}
              className="h-5 w-5 accent-[color:var(--color-accent)]"
            />
            <span className="text-sm font-medium text-text">{t('buy.label')}</span>
          </span>
          <span className="text-xs text-muted">{t('buy.sublabel')}</span>
          <Input
            label={t('buy.priceLabel')}
            prefix="MX$"
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            onFocus={() => setPath('compra')}
            error={
              path === 'compra' && price.trim() !== '' && (priceCents == null || priceCents <= 0)
                ? t('buy.priceRequired')
                : undefined
            }
            hint={buyHelper}
          />
        </label>

        {/* Aportación — deshabilitada con pill PRECIO PENDIENTE si no hay referencia. */}
        <label
          aria-disabled={contribBlocked || undefined}
          className={`flex flex-col gap-2 border p-3 ${
            contribBlocked
              ? 'cursor-not-allowed opacity-45'
              : path === 'aportacion'
                ? 'cursor-pointer border-border-strong bg-surface-2'
                : 'cursor-pointer border-border hover:bg-surface-2/50'
          }`}
        >
          <span className="flex items-center gap-2">
            <input
              type="radio"
              name="quickadd-acq"
              checked={path === 'aportacion'}
              disabled={contribBlocked}
              onChange={() => setPath('aportacion')}
              className="h-5 w-5 accent-[color:var(--color-accent)] disabled:cursor-not-allowed"
            />
            <span className="text-sm font-medium text-text">{t('contrib.label')}</span>
            {contribBlocked && (
              <span className="border border-accent px-1 font-mono text-[10px] uppercase tracking-[0.06em] text-accent">
                {t('contrib.pendingPill')}
              </span>
            )}
          </span>
          <span className="text-xs text-muted">{t('contrib.sublabel')}</span>
          {contribBlocked ? (
            <span className="text-xs text-accent">
              {isSuperAdmin ? t('contrib.pendingBlockedAdmin') : t('contrib.pendingBlocked')}
            </span>
          ) : (
            <span className="font-mono tabular-nums text-base text-text">
              {formatMoneyCents(marketRefCents!, locale)}
            </span>
          )}
        </label>
      </div>

      {/* 3. CTA */}
      <Button
        className="w-full"
        onClick={() => submit.mutate()}
        disabled={submit.isPending || (path === 'compra' && priceInvalid)}
        loading={submit.isPending}
      >
        {submit.isPending ? t('loading') : t('cta')}
      </Button>
    </section>
  );
}
