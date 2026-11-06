'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
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
  PriceBasis,
} from '@/types/contract';
import type { AppLocale } from '@/i18n/routing';
import { formatMoneyCents } from '@/lib/format';
import { useRole } from '@/lib/role';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { localUid } from '@/components/master-set/capture';
import { IdsCaptureFields, stampWithFinishLabel } from './IdsCaptureFields';
import { versionContributionReferenceCents } from './ids-capture';
import { useIdsCapture } from './useIdsCapture';

/**
 * Alta rápida simplificada — P-19 (DESIGN_SYSTEM §16.5). SOLO cantidad + adquisición:
 * «Comprar» (precio prellenado con buy.effectiveCents, editable) o «Aportación» (valor de
 * mercado, NO editable, `acquisitionPct: 100` explícito). SIN dropdown de acabado (viene de la
 * casilla picada), SIN ubicación. Reusa POST /admin/inventory/items/batch (lote tolerante).
 * También la usa la pestaña Sellado (§16.8) con `sealedMarketRef` como referencia de aportación.
 *
 * UX-ALTA-LIGA (HECHOS 2026-11-05 «opción A»; §IDS.4 / IDS-UX.2; DESIGN_SYSTEM vIDS-10 §16.5 (a).0): en raw, ANTES de
 * Cantidad van **Idioma** (en TODA carta, «Inglés» de fábrica: 0 toques) y, si la carta tiene liga, **Versión** en
 * burbujas, más el «Precio de venta (auto)» —los mismos `IdsCaptureFields`/`useIdsCapture` de la captura por lote—.
 * `language` viaja solo si ≠ 'en' y `cardProductId` solo con liga (IDS-F11); tras cada alta vuelve a «Inglés / Sin liga».
 * Sin caja de candidatas (queda en Alta por lote).
 *
 * A2 (contrato v1.116.8 I-6 «Acabado del alta» / «Compra sugerida»): el acabado del POST es el RESUELTO por el modelo
 * (`ids.model.altaFinish`): el de la casilla sin liga o si la liga lo tiene; el único de la liga si es otro (la burbuja
 * lo nombra); el elegido en la fila «Acabado» si la liga tiene varios (sin elección, «Dar de alta» queda `aria-disabled`
 * con la ayuda como descripción: elegir mal es precio mal). Con español o liga, «Pagamos por pieza» abre vacío (la
 * sugerencia de compra es del inglés sin liga, P-ARQ-IDS-3) y vuelve a prellenarse al regresar a «Inglés / Sin liga».
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
  buySource: PriceBasis | null;
  /**
   * Referencia de mercado para la APORTACIÓN (raw: variante P-15 en inglés sin liga; sellado: sealedMarketRef). Con otra
   * versión elegida (español o liga) manda la del combo de `GET …/versions` (I-1), no esta.
   */
  marketRefCents: number | null;
  /** Refresca lista de piezas/agregados; recibe los folios creados (resaltado 3s). */
  onCreated?: (folios: string[]) => void;
  onToast?: (msg: string) => void;
  /**
   * El contenedor ofrece un campo de precio manual INLINE (add-flow de sellado). Cambia el copy
   * de la aportación bloqueada: en vez de mandar a «la sección Precios», apunta al campo de arriba.
   * Sin esto (quick-add de variante M1) el mensaje sigue enviando a Precios. Menor de display.
   */
  hasInlineManualField?: boolean;
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
  hasInlineManualField = false,
}: QuickAddProps) {
  const t = useTranslations('admin.quickAdd');
  const tRoot = useTranslations();
  const tIds = useTranslations('admin.m1.ids');
  const tv = useTranslations('version');
  const queryClient = useQueryClient();
  const locale = useLocale() as AppLocale;
  const { isSuperAdmin } = useRole();
  const errorRef = useRef<HTMLDivElement>(null);

  // §IDS.4: idioma y versión de la pieza, solo raw con carta (D-IDS-K: el sellado no tiene versión). Modo casilla
  // (`fixedFinish`, A2): sin burbujas de acabado; el acabado del alta lo resuelve el modelo por versión (`altaFinish`).
  const idsActive = target.productType === 'raw' && !!target.cardId;
  const idsCard = useMemo(
    () => (idsActive ? { id: target.cardId!, availableFinishes: [target.finish] } : null),
    [idsActive, target.cardId, target.finish],
  );
  const ids = useIdsCapture(idsCard, target.finish, { enabled: idsActive, fixedFinish: true });
  // vIDS-10 (ratificado): Idioma se dibuja en TODA carta raw, también sin liga; la fila Versión solo si hay liga. Si
  // `GET …/versions` falló, el aviso con «Reintentar» va dentro (QA 2026-11-03: nunca caer en silencio).
  const showIds = ids.enabled;
  // A2 (b): liga con varios acabados y ninguno el de la casilla, sin elegir ⇒ el CTA espera (aria-disabled + ayuda).
  const finishPending = ids.enabled && ids.model.altaFinishMode === 'choose' && ids.model.altaFinish == null;
  const finishHintId = useId();
  // El acabado que viaja: el resuelto (IDS-F11 a/b/c); sin modelo (sellado), el del target.
  const altaFinish: Finish = ids.enabled ? ids.model.altaFinish ?? target.finish : target.finish;
  // «Español · De liga · Promo de Liga (Holo)» para el resumen (misma función de rótulo que la burbuja, TL-A2-3); el
  // sufijo del acabado solo si la liga va en uno distinto al de la casilla. `null` en inglés sin liga (el texto de hoy).
  const versionLabel: string | null =
    ids.enabled && (ids.language !== 'en' || ids.model.stampProductId != null)
      ? [
          tv(`language.${ids.language}`),
          stampWithFinishLabel(
            tIds,
            tv,
            ids.model.versionOptions.find((o) => (o.stamp?.productId ?? null) === ids.model.stampProductId)?.stamp ?? null,
            ids.model.stampProductId != null && ids.model.altaFinish != null && ids.model.altaFinish !== target.finish
              ? ids.model.combo?.finishLabel ?? null
              : null,
          ),
        ].join(' · ')
      : null;

  const [qty, setQty] = useState('1');
  // I-1 (QA 2026-11-05): el backend costea la aportación de una versión no default con la referencia DE LA VERSIÓN
  // (`versionReferenceForAlta`), no con la del inglés del binder. La tarjeta «Aportación» y su bloqueo leen la misma:
  // inglés sin liga ⇒ `marketRefCents` (la de hoy); otra versión ⇒ la de su combo (`versionContributionReferenceCents`),
  // y sin referencia ⇒ bloqueada con el aviso de siempre (el servidor respondería PRICE_PENDING).
  const isDefaultVersion = !ids.enabled || (ids.language === 'en' && ids.model.stampProductId == null);
  const contribRefCents = isDefaultVersion ? marketRefCents : versionContributionReferenceCents(ids.model.combo);
  const contribBlocked = contribRefCents == null;
  const [path, setPath] = useState<AcqPath>('compra');
  // Si la versión elegida pierde su referencia con «Aportación» marcada (p. ej. versiones releídas tras ligar una
  // candidata), el camino vuelve a «Comprar»: nunca un POST de aportación sin referencia.
  if (contribBlocked && path === 'aportacion') setPath('compra');
  // A2 (d) «Compra sugerida»: el prellenado con `buy.effectiveCents` es del inglés sin liga (curva de compra, 528). Con
  // español o liga el campo se VACÍA y el operador teclea lo pagado; al volver a «Inglés / Sin liga» (también tras un
  // alta, por el `reset`) vuelve el prellenado. ⛔ Ningún sugerido por versión (P-ARQ-IDS-3).
  const prefill = buyEffectiveCents != null ? String(buyEffectiveCents / 100) : '';
  const [price, setPrice] = useState(prefill);
  const wasDefaultRef = useRef(isDefaultVersion);
  useEffect(() => {
    if (wasDefaultRef.current === isDefaultVersion) return;
    wasDefaultRef.current = isDefaultVersion;
    setPrice(isDefaultVersion ? prefill : '');
  }, [isDefaultVersion, prefill]);

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
    // `versionLabel` viaja como variable del intento: el resumen lo lee de ahí aunque el panel ya haya vuelto a
    // «Inglés / Sin liga» (reset tras el éxito).
    mutationFn: (_vars: { versionLabel: string | null }) => {
      // v1.39 (P-38): con IDENTIDAD (`sealedProductId`) el backend deriva la Card ancla ⇒ se OMITE
      // el cardId del cliente (la pieza nace «ETB …», no un single). Los 4 campos M-37 sueltos quedan
      // deprecados y solo se envían en el camino legacy (sin sealedProductId).
      const usesSealedIdentity = target.productType === 'sealed' && !!target.sealedProductId;
      const line: BatchInventoryItemInput = {
        ...(usesSealedIdentity ? {} : { cardId: target.cardId }),
        productType: target.productType,
        ...(target.productType === 'raw'
          ? // §IDS.4 / IDS-F11: `language` solo si ≠ 'en' y `cardProductId` solo con liga (`useIdsCapture.payload`);
            // inglés sin liga = el cuerpo de hoy. A2: `finish` = el RESUELTO (el de la casilla, o el de la liga cuando
            // la casilla no lo tiene; backend lo valida contra `P.finishes`). ⛔ Sin `listPriceCents` (I-4).
            { rawCondition: 'NM' as const, finish: altaFinish, ...ids.payload }
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
    onSuccess: (data, vars) => {
      if (data.summary.failedLines === 0) {
        // Éxito → la siguiente alta usa una batchKey nueva (un reintento del MISMO intento
        // fallido reusa la key = replay idempotente).
        batchKeyRef.current = null;
        const folios = data.results.flatMap((r) => (r.ok ? r.folios : []));
        onCreated?.(folios);
        // IDS-UX.2: idioma y versión no se guardan entre piezas; cada alta vuelve a «Inglés / Sin liga».
        ids.reset();
        // §SU-UX.6 (e): el alta puede dejar piezas en «Listas para publicar» → se refresca la cola.
        void queryClient.invalidateQueries({ queryKey: ['pending-publish'] });
        // §SU-UX.6 (d): la nota va en el toast (si hay) DETRÁS del texto de hoy; sin toast (cajón) va en el banner.
        onToast?.(`${summaryOf(data, vars.versionLabel)} ${tRoot('admin.m1.batchPublishNote')}`);
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

  function summaryOf(data: BatchCreateInventoryResponse, version: string | null): string {
    const folios = data.results.flatMap((r) => (r.ok ? r.folios : []));
    // UX-ALTA-LIGA: la versión se nombra en el resumen si no es inglés sin liga («… · Español · De liga · Prize Pack · INV-…»).
    if (folios.length === 1) {
      return version ? t('successOneVersion', { version, folio: folios[0] }) : t('successOne', { folio: folios[0] });
    }
    const range = { count: folios.length, first: folios[0] ?? '', last: folios[folios.length - 1] ?? '' };
    return version ? t('successSummaryVersion', { version, ...range }) : t('successSummary', range);
  }

  function lineErrorMessage(code: string, message: string): string {
    if (code === 'PRICE_PENDING') return t('pricePendingError');
    if (tRoot.has(`error.${code}`)) return tRoot(`error.${code}`);
    return message;
  }

  const buyHelper = (() => {
    // A2 (d): con español o liga no hay sugerencia (la del binder es del inglés sin liga).
    if (!isDefaultVersion) return t('buyNoSuggestionVersion');
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
          {summaryOf(submit.data, submit.variables?.versionLabel ?? null)}
          {submit.data.idempotentReplay ? ` · ${t('replay')}` : ''}
          {/* §16.5 (b): sin toast (cajón) la nota «Listas para publicar» es la segunda frase del banner. */}
          {!onToast && ` ${tRoot('admin.m1.batchPublishNote')}`}
        </Banner>
      )}

      {/* 0. Idioma (siempre), Versión (con liga) y Acabado (A2, solo si la liga tiene varios y ninguno el de la casilla). */}
      {showIds && idsCard && (
        <IdsCaptureFields
          card={idsCard}
          model={ids.model}
          data={ids.data}
          isLoading={ids.isLoading}
          isError={ids.isError}
          onRetry={ids.refetch}
          finish={target.finish}
          onFinish={() => {}}
          language={ids.language}
          onLanguage={ids.setLanguage}
          onStamp={ids.setStampProductId}
          onAttached={ids.onAttached}
          slot={{ onChosenFinish: ids.setChosenFinish, finishHintId }}
          showCandidates={false}
        />
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
              {isSuperAdmin
                ? hasInlineManualField
                  ? t('contrib.pendingBlockedInline')
                  : t('contrib.pendingBlockedAdmin')
                : t('contrib.pendingBlocked')}
            </span>
          ) : (
            <span className="font-mono tabular-nums text-base text-text">
              {formatMoneyCents(contribRefCents!, locale)}
            </span>
          )}
        </label>
      </div>

      {/* 3. CTA */}
      <Button
        className="w-full"
        onClick={() => {
          if (finishPending) return;
          submit.mutate({ versionLabel });
        }}
        // A2 (b): sin acabado elegido el botón queda `aria-disabled` (sigue enfocable) con la ayuda de la fila como
        // descripción; el clic no hace nada. TL-A2-1: en ese estado NADA lo vuelve `disabled` real (ni el precio vacío).
        aria-disabled={finishPending || undefined}
        aria-describedby={finishPending ? finishHintId : undefined}
        // IDS-UX.2: una versión no default sin precio no se crea.
        // M-2 (QA 2026-11-05): con `GET …/versions` en vuelo no hay burbujas y `canCreate` aún no sabe nada ⇒ el CTA
        // espera; un clic rápido no crea «inglés sin liga» sin haber visto la opción. Si la consulta falla, el CTA vive
        // (aviso con «Reintentar» arriba; el camino de siempre sigue abierto).
        disabled={
          submit.isPending ||
          (path === 'compra' && priceInvalid && !finishPending) ||
          (ids.enabled && !finishPending && (ids.isLoading || !ids.model.canCreate))
        }
        loading={submit.isPending}
      >
        {submit.isPending ? t('loading') : t('cta')}
      </Button>
      {/* SELLADO-M1(A): el CTA deshabilitado NO se queda mudo. Cuando el único camino es «Comprar»
          (aportación bloqueada por falta de mercado) y el precio pagado está vacío/invalido, el botón
          quedaba gris SIN explicación y el alta «no salía» en silencio. Display-only: no cambia la
          validación ni el payload — solo hace legible por qué no se puede dar de alta todavía. */}
      {path === 'compra' && priceInvalid && (
        <p className="text-xs text-accent" role="status">
          {t('buy.priceRequired')}
        </p>
      )}
    </section>
  );
}
