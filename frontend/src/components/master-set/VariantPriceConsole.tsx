'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { putVariantControls, overridePrice } from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import type {
  Finish,
  VariantControlsRequest,
  VariantControlsResponse,
  VariantPricingDTO,
} from '@/types/contract';
import type { AppLocale } from '@/i18n/routing';
import { formatDate, formatMoneyCents } from '@/lib/format';
import { useRole } from '@/lib/role';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

/**
 * Consola de TRES precios por (carta, variante) — P-18 (DESIGN_SYSTEM §16.3, ARCHITECTURE §4.26b).
 * Dos piezas: el bloque COMPACTO de solo-lectura para la teja del binder (a) y la consola COMPLETA
 * de edición para el panel drill-down (b). El WRITE es `super_admin` (el front esconde la edición;
 * el guard del backend lo impone). Dinero honesto: sin precio = «—», nunca $0.
 */

// ---------------------------------------------------------------------------
// (a) Bloque compacto en la teja — MERCADO / COMPRA / VENTA con marcador de origen.
// ---------------------------------------------------------------------------

function CompactRow({
  label,
  cents,
  suffix,
  suffixTitle,
  suffixClass,
  aria,
  pendingTitle,
}: {
  label: string;
  cents: number | null;
  suffix?: string;
  suffixTitle?: string;
  suffixClass?: string;
  aria: string;
  pendingTitle: string;
}) {
  const locale = useLocale() as AppLocale;
  return (
    <span
      className="flex items-baseline justify-between gap-2 font-mono text-[11px]"
      aria-label={aria}
      {...(cents == null ? { title: pendingTitle } : {})}
    >
      <span className="uppercase tracking-[0.06em] text-muted">{label}</span>
      <span className="tabular-nums text-text">
        {cents != null ? (
          <>
            {formatMoneyCents(cents, locale)}
            {suffix && (
              <span className={suffixClass} title={suffixTitle} aria-hidden>
                {' '}
                {suffix}
              </span>
            )}
          </>
        ) : (
          <span className="text-muted" aria-hidden>
            —
          </span>
        )}
      </span>
    </span>
  );
}

/**
 * Bloque compacto (§16.3a): tres renglones bajo el conteo de la casilla. Solo lectura; el write
 * vive en el panel. Marcadores: `·M` (tinta) = override manual; `·B` (bermellón) = bounty (COMPRA).
 */
export function VariantPricingCompact({
  pricing,
  marketRefCents,
}: {
  pricing: VariantPricingDTO;
  marketRefCents: number | null | undefined;
}) {
  const t = useTranslations('admin.pricing.console');
  const locale = useLocale() as AppLocale;
  const money = (c: number | null) => (c != null ? formatMoneyCents(c, locale) : t('pendingShort'));

  const buySuffix =
    pricing.buy.source === 'override' ? '·M' : pricing.buy.source === 'bounty' ? '·B' : undefined;
  const sellSuffix = pricing.sell.source === 'override' ? '·M' : undefined;

  return (
    <span className="mt-1.5 flex flex-col gap-0.5" data-testid="variant-price-compact">
      <CompactRow
        label={t('market')}
        cents={marketRefCents ?? null}
        aria={t('rowAria', { label: t('market'), value: money(marketRefCents ?? null) })}
        pendingTitle={t('pendingTitle')}
      />
      <CompactRow
        label={t('buy')}
        cents={pricing.buy.effectiveCents}
        suffix={buySuffix}
        suffixTitle={buySuffix === '·B' ? t('bountyActiveTitle') : t('manualTitle')}
        suffixClass={buySuffix === '·B' ? 'font-medium text-accent' : 'font-medium text-text'}
        aria={t('rowAriaSource', {
          label: t('buy'),
          value: money(pricing.buy.effectiveCents),
          source: t(`source.${sourceKey(pricing.buy.source)}`),
        })}
        pendingTitle={t('pendingTitle')}
      />
      <CompactRow
        label={t('sell')}
        cents={pricing.sell.effectiveCents}
        suffix={sellSuffix}
        suffixTitle={t('manualTitle')}
        suffixClass="font-medium text-text"
        aria={t('rowAriaSource', {
          label: t('sell'),
          value: money(pricing.sell.effectiveCents),
          source: t(`source.${sourceKey(pricing.sell.source)}`),
        })}
        pendingTitle={t('pendingTitle')}
      />
    </span>
  );
}

// ---------------------------------------------------------------------------
// (b) Consola completa en el panel drill-down — edición super_admin, lectura para el resto.
// ---------------------------------------------------------------------------

/** Clave i18n de la fuente (§16.10: rule/manual/bounty/pending; fallback se lee como regla). */
function sourceKey(source: string): string {
  if (source === 'fallback') return 'rule';
  if (source === 'override') return 'manual';
  return source;
}

/** Fuente del EFECTIVO como texto mono en versalitas (el color acompaña, el texto porta §2.4). */
function SourceTag({ source }: { source: string }) {
  const t = useTranslations('admin.pricing.console');
  const key = sourceKey(source);
  return (
    <span
      className={`font-mono text-[10px] uppercase tracking-[0.06em] ${
        key === 'pending'
          ? 'border border-accent px-1 text-accent'
          : key === 'bounty'
            ? 'text-accent'
            : 'text-muted'
      }`}
    >
      {t(`source.${key}`)}
    </span>
  );
}

/** Pesos capturados → centavos (round). '' → null (sin override). NaN → undefined (inválido). */
function parsePesos(v: string): number | null | undefined {
  const s = v.trim();
  if (s === '') return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return undefined;
  return Math.round(n * 100);
}

interface VariantPriceConsoleBaseProps {
  cardId: string;
  finish: Finish;
  /** Estado INICIAL de la consola (la consola lo mantiene vivo con la respuesta del write). */
  pricing: VariantPricingDTO;
  marketRefCents: number | null | undefined;
  marketCapturedDate?: string | null;
  /** Estado resuelto tras el write PUT variant-controls (payload íntegro del contrato). */
  onSaved?: (res: VariantControlsResponse) => void;
  /** Algo cambió server-side (override guardado, mercado fijado): el dueño de la vista refetchea. */
  onChanged?: () => void;
  /** Aviso efímero (toast del dueño de la vista); fallback: banner inline. */
  onToast?: (msg: string) => void;
}

/**
 * `gradeKey` es una CLAVE DE DINERO: con `productType='graded'` el tipo lo exige (no hay
 * default mágico tipo "PSA 10"); en raw es opcional y la clave canónica del contrato es `raw:NM`.
 */
export type VariantPriceConsoleProps = VariantPriceConsoleBaseProps &
  ({ productType?: 'raw'; gradeKey?: string } | { productType: 'graded'; gradeKey: string });

export function VariantPriceConsole(props: VariantPriceConsoleProps) {
  const {
    cardId,
    finish,
    gradeKey,
    marketRefCents,
    marketCapturedDate,
    onSaved,
    onChanged,
    onToast,
  } = props;
  const productType = props.productType ?? 'raw';
  // Clave para POST /admin/pricing/override: en graded viene garantizada por el tipo;
  // en raw la clave canónica del contrato es `raw:NM` (no es un default inventado).
  const marketGradeKey: string = props.productType === 'graded' ? props.gradeKey : gradeKey ?? 'raw:NM';
  const t = useTranslations('admin.pricing.console');
  const tb = useTranslations('admin.bounty');
  const tRoot = useTranslations();
  const locale = useLocale() as AppLocale;
  const { isSuperAdmin } = useRole();
  const errorRef = useRef<HTMLDivElement>(null);

  const money = (c: number) => formatMoneyCents(c, locale);

  // M-1: el pricing RESUELTO vive en estado local — sembrado por el prop y actualizado con
  // `VariantControlsResponse.pricing` de cada write. Tras guardar un override, Efectivo/FUENTE/
  // bounty pintan el estado NUEVO sin reabrir (el prop capturado al abrir se queda atrás hasta
  // que el refetch del dueño lo reemplace, y entonces el efecto re-siembra).
  const [pricing, setPricing] = useState(props.pricing);
  useEffect(() => setPricing(props.pricing), [props.pricing]);

  const [buyInput, setBuyInput] = useState(
    pricing.buy.overrideCents != null ? String(pricing.buy.overrideCents / 100) : '',
  );
  const [sellInput, setSellInput] = useState(
    pricing.sell.overrideCents != null ? String(pricing.sell.overrideCents / 100) : '',
  );
  const bounty = pricing.bounty ?? null;
  const [bountyOn, setBountyOn] = useState(bounty?.enabled ?? false);
  const [bountyPrice, setBountyPrice] = useState(
    bounty?.priceCents != null ? String(bounty.priceCents / 100) : '',
  );
  const [bountyTarget, setBountyTarget] = useState(
    bounty?.targetQty != null ? String(bounty.targetQty) : '',
  );
  const [inlineOk, setInlineOk] = useState<string | null>(null);
  // "Fijar mercado" (referencia M2) — mini-form inline; solo cuando el mercado está pendiente.
  const [marketInput, setMarketInput] = useState('');

  const buyCents = parsePesos(buyInput);
  const sellCents = parsePesos(sellInput);
  const bountyPriceCents = parsePesos(bountyPrice);
  const bountyTargetQty = bountyTarget.trim() === '' ? null : Math.floor(Number(bountyTarget));

  const buyInvalid = buyCents === undefined || (buyCents != null && buyCents <= 0);
  const sellInvalid = sellCents === undefined || (sellCents != null && sellCents <= 0);
  const bountyPriceMissing = bountyOn && (bountyPriceCents == null || bountyPriceCents <= 0);
  const bountyTargetInvalid =
    bountyTarget.trim() !== '' && (!Number.isFinite(bountyTargetQty) || (bountyTargetQty ?? 0) < 1);

  // Premium sobre la regla (§16.7a): bountyPrice − sugerido de compra.
  const premium = useMemo(() => {
    if (bountyPriceCents == null || bountyPriceCents <= 0) return null;
    const suggested = pricing.buy.suggestedCents;
    if (suggested == null) return { noSuggested: true as const };
    const abs = bountyPriceCents - suggested;
    const pct = suggested > 0 ? Math.round((abs / suggested) * 100) : 0;
    return { noSuggested: false as const, abs, pct };
  }, [bountyPriceCents, pricing.buy.suggestedCents]);

  const save = useMutation({
    mutationFn: (req: VariantControlsRequest) => putVariantControls(cardId, finish, req),
    onSuccess: (res, req) => {
      const removed =
        ('buyOverrideCents' in req && req.buyOverrideCents === null) ||
        ('sellOverrideCents' in req && req.sellOverrideCents === null);
      const msg = removed && !('bounty' in req) ? t('overrideRemoved') : t('saved');
      if (onToast) onToast(msg);
      else setInlineOk(msg);
      // M-1: la consola pinta el estado RESUELTO de la respuesta (efectivo/fuente/bounty nuevos).
      setPricing(res.pricing);
      setBuyInput(res.pricing.buy.overrideCents != null ? String(res.pricing.buy.overrideCents / 100) : '');
      setSellInput(
        res.pricing.sell.overrideCents != null ? String(res.pricing.sell.overrideCents / 100) : '',
      );
      const b = res.pricing.bounty ?? null;
      setBountyOn(b?.enabled ?? false);
      setBountyPrice(b?.priceCents != null ? String(b.priceCents / 100) : '');
      setBountyTarget(b?.targetQty != null ? String(b.targetQty) : '');
      onSaved?.(res);
      onChanged?.();
    },
    onError: () => {
      errorRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
      errorRef.current?.focus();
    },
  });

  // M-3: "Fijar mercado" escribe una PriceReference real (POST /admin/pricing/override).
  // El éxito NO fabrica un VariantControlsResponse (ese endpoint no lo devuelve): avisa y
  // dispara `onChanged` para que el dueño de la vista refetchee el estado real.
  const fixMarket = useMutation({
    mutationFn: () =>
      overridePrice({
        cardId,
        productType,
        gradeKey: marketGradeKey,
        finish: productType === 'raw' ? finish : undefined,
        priceMxnCents: Math.round(Number(marketInput) * 100),
      }),
    onSuccess: () => {
      const msg = t('marketFixed');
      if (onToast) onToast(msg);
      else setInlineOk(msg);
      onChanged?.();
    },
    onError: () => {
      errorRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
      errorRef.current?.focus();
    },
  });

  function buildRequest(): VariantControlsRequest {
    const req: VariantControlsRequest = {
      productType,
      ...(gradeKey ? { gradeKey } : {}),
      buyOverrideCents: buyCents ?? null,
      sellOverrideCents: sellCents ?? null,
    };
    if (productType === 'raw') {
      req.bounty = bountyOn
        ? {
            enabled: true,
            ...(bountyPriceCents != null && bountyPriceCents > 0
              ? { priceCents: bountyPriceCents }
              : {}),
            targetQty: bountyTargetQty,
          }
        : { enabled: false };
    }
    return req;
  }

  /** «Restablecer a regla» — null explícito limpia SOLO esa cara (surte efecto al instante). */
  function resetFace(face: 'buy' | 'sell') {
    if (face === 'buy') setBuyInput('');
    else setSellInput('');
    save.mutate({
      productType,
      ...(gradeKey ? { gradeKey } : {}),
      ...(face === 'buy' ? { buyOverrideCents: null } : { sellOverrideCents: null }),
    });
  }

  function serverErrorMessage(error: unknown): string {
    if (error instanceof ApiClientError) {
      if (error.code === 'BOUNTY_BELOW_RULE') {
        const suggested = pricing.buy.suggestedCents;
        return tRoot('error.BOUNTY_BELOW_RULE', {
          suggested: suggested != null ? money(suggested) : '—',
        });
      }
      if (tRoot.has(`error.${error.code}`)) {
        return tRoot(`error.${error.code}`, { suggested: '' });
      }
      return error.message;
    }
    return tRoot('common.errorGeneric');
  }

  const clientInvalid =
    buyInvalid || sellInvalid || bountyPriceMissing || bountyTargetInvalid;

  const faces: {
    key: 'buy' | 'sell';
    label: string;
    face: VariantPricingDTO['buy'] | VariantPricingDTO['sell'];
    input: string;
    setInput: (v: string) => void;
    invalid: boolean;
  }[] = [
    { key: 'buy', label: t('buyLong'), face: pricing.buy, input: buyInput, setInput: setBuyInput, invalid: buyInvalid },
    { key: 'sell', label: t('sellLong'), face: pricing.sell, input: sellInput, setInput: setSellInput, invalid: sellInvalid },
  ];

  return (
    <section className="flex flex-col gap-4" aria-label={t('title')}>
      {/* Error del servidor ANCLADO arriba de la sección (patrón P-4) — guardar Y fijar mercado. */}
      {(save.isError || fixMarket.isError) && (
        <div ref={errorRef} tabIndex={-1} className="outline-none">
          <Banner variant="danger" role="alert">
            {serverErrorMessage(save.isError ? save.error : fixMarket.error)}
          </Banner>
        </div>
      )}
      {inlineOk && !onToast && (
        <Banner variant="success" role="status">
          {inlineOk}
        </Banner>
      )}

      {/* Mercado: referencia (P-15). Sin edición aquí salvo "Fijar mercado" cuando está pendiente. */}
      <div className="flex flex-col gap-1 border-b border-border pb-3">
        <span className="eyebrow">{t('market')}</span>
        {marketRefCents != null ? (
          <span className="font-mono tabular-nums text-sm text-text">
            {money(marketRefCents)}
            {marketCapturedDate && (
              <span className="text-muted"> · {formatDate(marketCapturedDate, locale)}</span>
            )}
          </span>
        ) : (
          <div className="flex flex-col gap-2">
            <SourceTag source="pending" />
            {isSuperAdmin && (
              <div className="flex items-end gap-2">
                <Input
                  label={t('fixMarket')}
                  prefix="MX$"
                  inputMode="decimal"
                  className="w-32"
                  value={marketInput}
                  onChange={(e) => setMarketInput(e.target.value)}
                />
                <Button
                  size="sm"
                  variant="secondary"
                  loading={fixMarket.isPending}
                  disabled={fixMarket.isPending || !((parsePesos(marketInput) ?? 0) > 0)}
                  onClick={() => fixMarket.mutate()}
                >
                  {t('fixMarketCta')}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Compra / Venta: sugerido · override · efectivo + fuente. */}
      {faces.map(({ key, label, face, input, setInput, invalid }) => (
        <div key={key} className="flex flex-col gap-2 border-b border-border pb-3">
          <div className="flex items-center gap-2">
            <span className="eyebrow">{label}</span>
            {face.overrideCents != null && (
              <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-text">
                {t('source.manual')}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
            {isSuperAdmin ? (
              <div className="flex min-w-[10rem] flex-col">
                <Input
                  label={t('override')}
                  prefix="MX$"
                  inputMode="decimal"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  error={invalid ? t('mustBePositive') : undefined}
                />
                <p className="mt-1 text-xs text-muted">
                  {t('suggestedByRule')}:{' '}
                  <span className="font-mono tabular-nums">
                    {face.suggestedCents != null ? money(face.suggestedCents) : '—'}
                  </span>
                </p>
              </div>
            ) : (
              // vault_operator: lectura sí, edición no (texto plano).
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted">{t('override')}</span>
                <span className="font-mono tabular-nums text-sm">
                  {face.overrideCents != null ? money(face.overrideCents) : '—'}
                </span>
                <p className="text-xs text-muted">
                  {t('suggestedByRule')}:{' '}
                  <span className="font-mono tabular-nums">
                    {face.suggestedCents != null ? money(face.suggestedCents) : '—'}
                  </span>
                </p>
              </div>
            )}
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted">{t('effective')}</span>
              <span className="flex items-baseline gap-2 font-mono tabular-nums text-sm text-text">
                {face.effectiveCents != null ? money(face.effectiveCents) : '—'}
                <SourceTag source={face.source} />
              </span>
            </div>
            {isSuperAdmin && face.overrideCents != null && (
              <button
                type="button"
                className="border-b border-accent pb-0.5 text-xs text-accent hover:text-text"
                onClick={() => resetFace(key)}
                disabled={save.isPending}
              >
                {t('resetToRule')}
              </button>
            )}
          </div>
        </div>
      ))}

      {/* Bounty (P-22): solo variantes raw y solo super_admin. */}
      {productType === 'raw' && isSuperAdmin && (
        <div className="flex flex-col gap-3 border-b border-border pb-3">
          <label className="flex items-center gap-2 text-sm text-text">
            <input
              type="checkbox"
              role="switch"
              aria-checked={bountyOn}
              checked={bountyOn}
              onChange={(e) => setBountyOn(e.target.checked)}
              className="h-5 w-5 accent-[color:var(--color-accent)]"
            />
            {tb('toggle')}
            <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-muted">
              {bountyOn
                ? tb('stateOn')
                : bounty && bounty.acquiredQty > 0
                  ? tb('offWithHistory', { count: bounty.acquiredQty })
                  : tb('stateOff')}
            </span>
          </label>
          {bounty?.completedAt && (
            <p className="font-mono text-[11px] uppercase tracking-[0.06em] text-success">
              {tb('completed', { date: formatDate(bounty.completedAt, locale) })}
            </p>
          )}
          {bountyOn && (
            <>
              <Input
                label={tb('price')}
                prefix="MX$"
                inputMode="decimal"
                value={bountyPrice}
                onChange={(e) => setBountyPrice(e.target.value)}
                error={bountyPriceMissing ? tRoot('error.BOUNTY_PRICE_REQUIRED') : undefined}
                hint={
                  premium == null
                    ? undefined
                    : premium.noSuggested
                      ? tb('noSuggested')
                      : tb('premium', {
                          amount: money(Math.abs(premium.abs)),
                          pct: premium.pct,
                        })
                }
              />
              <Input
                label={tb('targetQty')}
                inputMode="numeric"
                value={bountyTarget}
                onChange={(e) => setBountyTarget(e.target.value)}
                error={bountyTargetInvalid ? t('mustBePositive') : undefined}
                hint={tb('targetHelper')}
              />
              {bounty && bounty.targetQty != null && (
                <div className="flex flex-col gap-1">
                  <span
                    aria-hidden
                    className="block h-1 w-full bg-surface-2"
                  >
                    <span
                      className="block h-1 bg-accent"
                      style={{
                        width: `${Math.min(100, Math.round((bounty.acquiredQty / bounty.targetQty) * 100))}%`,
                      }}
                    />
                  </span>
                  <span className="font-mono tabular-nums text-[11px] text-muted">
                    {tb('progress', { acquired: bounty.acquiredQty, target: bounty.targetQty })}
                  </span>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {isSuperAdmin && (
        <Button
          onClick={() => save.mutate(buildRequest())}
          disabled={clientInvalid || save.isPending}
          loading={save.isPending}
        >
          {t('save')}
        </Button>
      )}
      {/* Nota fija de dinero (misma familia §7.6). */}
      <p className="text-xs text-muted">{t('pisaNota')}</p>
    </section>
  );
}
