'use client';

import { useEffect, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { attachStampedCandidate } from '@/lib/api';
import { formatMoneyCents } from '@/lib/format';
import { PillToggleGroup } from '@/components/domain/VersionPills';
import { ManualVersionForm } from './ManualVersionForm';
import type { ManualVersionResponse } from '@/lib/api/manual-version';
import { Button } from '@/components/ui/Button';
import { Banner } from '@/components/ui/Banner';
import { asApiError } from '@/lib/api-client';
import type { AppLocale } from '@/i18n/routing';
import type { CardDTO, CardLanguage, CardVersionsResponse, Finish, FinishLabel, StampDTO, VersionComboDTO } from '@/types/contract';
import type { CaptureModel } from './ids-capture';

/** Texto del botón de versión (`admin.m1.ids.stampButton.*` + `label` del producto, o «Sin liga»). Lo reusa el resumen del alta rápida. */
export function stampButtonLabel(t: (key: string) => string, s: StampDTO | null): string {
  if (!s) return t('noStamp');
  const type = t(`stampButton.${s.type}`);
  // QA-PRM-UX: si la etiqueta repite el nombre del tipo («Staff» + «Staff») se muestra uno solo.
  const norm = (x: string) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  const label = s.label?.trim();
  return label && norm(label) !== norm(type) ? `${type} ${label}` : type;
}

/**
 * TL-A2-3: UNA sola función de rótulo «De liga · Promo de Liga (Holo)» para la burbuja, el desglose y el resumen del alta
 * rápida. `finishLabel` solo se pasa cuando el acabado difiere del de la casilla; `null` ⇒ el rótulo sin sufijo.
 */
export function stampWithFinishLabel(
  t: (key: string) => string,
  tv: (key: string) => string,
  s: StampDTO | null,
  finishLabel: FinishLabel | null,
): string {
  const base = stampButtonLabel(t, s);
  return finishLabel ? `${base} (${tv(`finishLabel.${finishLabel}`)})` : base;
}

/**
 * §IDS-UX.2 / IDS-UX.8 (captura, `01-captura-v6`; opción A del dueño): tras el Acabado, **Idioma** (`Inglés | Español`,
 * «Inglés» de fábrica) y **Versión** (`Sin liga | De liga · Prize Pack | …`, solo si la carta tiene versiones), en
 * burbujas de 44 px; la versión sin precio va apagada con su motivo. Después, «Precio de venta (auto)» con el desglose
 * en una línea. Sin campo de precio: una versión no default no admite precio tecleado (I-4). Las candidatas ambiguas
 * se ligan aquí (`attach`, identidad, no precio) — solo en la captura por lote (`showCandidates`); el alta rápida del
 * cajón no las dibuja (vIDS-10 §16.5 (a).0).
 *
 * **Modo casilla (`slot`, A2 v1.116.8):** el acabado del alta lo resuelve el modelo (`model.altaFinish`): la burbuja de
 * una liga que solo existe en otro acabado lo nombra («De liga · Promo de Liga (Holo)», `finishLabel` del combo, solo si
 * difiere del de la casilla; igual en el desglose); con varios acabados y ninguno el de la casilla aparece la fila
 * **Acabado** entre Versión y el precio (`admin.quickAdd.finish`), solo con los de la liga en el orden del servidor, sin
 * preselección, con la ayuda `finishHint` como descripción; sin elección el precio dice `finishPricePending`.
 */
export function IdsCaptureFields({
  card,
  model,
  data,
  isLoading,
  isError,
  onRetry,
  finish,
  onFinish,
  language,
  onLanguage,
  onStamp,
  onAttached,
  onManualCreated,
  slot,
  showCandidates = true,
}: {
  card: Pick<CardDTO, 'id' | 'availableFinishes'>;
  model: CaptureModel;
  data: CardVersionsResponse | undefined;
  isLoading: boolean;
  /** `GET …/versions` falló: sin combos no hay precio ni versiones de liga; el aviso lo dice en vez de caer en silencio. */
  isError: boolean;
  /** Vuelve a pedir `GET …/versions` (reintento del aviso y «Recargar versiones» tras un `attach` fallido). */
  onRetry: () => void;
  finish: Finish;
  onFinish: (f: Finish) => void;
  language: CardLanguage;
  onLanguage: (l: CardLanguage) => void;
  onStamp: (productId: number | null) => void;
  onAttached: (res: CardVersionsResponse) => void;
  /** §ALTA-LIGA-2: tras crear la versión a mano (el padre re-pide `GET …/versions` y la deja elegida). Sin él, sin botón. */
  onManualCreated?: (res: ManualVersionResponse, finish: Finish) => Promise<void>;
  /** A2 modo casilla: elección de la fila «Acabado» y el `id` de su ayuda (también descripción del CTA apagado). */
  slot?: { onChosenFinish: (f: Finish) => void; finishHintId: string };
  /** Caja de candidatas («Hay versiones de liga que no supimos ligar solas…»): solo en Alta por lote. */
  showCandidates?: boolean;
}) {
  const t = useTranslations('admin.m1.ids');
  const tm1 = useTranslations('admin.m1');
  const tq = useTranslations('admin.quickAdd');
  const tv = useTranslations('version');
  const tFinish = useTranslations('finish');
  const locale = useLocale() as AppLocale;

  const attach = useMutation({
    mutationFn: (productId: number) => attachStampedCandidate(productId, card),
    onSuccess: onAttached,
  });
  // QA 2026-11-03: `attach` fallaba en silencio. 404 (la candidata ya no existe) y 409 (el producto ya está colgado)
  // dicen qué pasó; ambos se resuelven releyendo las versiones. El resto (red, 5xx), genérico.
  const attachCode = asApiError(attach.error)?.code;
  const attachErrorText =
    attachCode === 'NOT_FOUND' || attachCode === 'STAMPED_PRODUCT_TAKEN' ? t(`attachError.${attachCode}`) : t('attachError.generic');
  const reload = () => {
    attach.reset();
    onRetry();
  };
  // Petición 9b (IDS-UX.7): el aviso va en línea, con `role="alert"`, y el foco pasa a su botón de acción
  // («Recargar versiones»): quien teclea no se queda en la candidata que acaba de fallar.
  const reloadRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (attach.isError) reloadRef.current?.focus();
  }, [attach.isError]);

  const stampLabel = (s: StampDTO | null) => stampButtonLabel(t, s);
  const reasonText = (r: string | null) => (r ? t(`reason.${r}`) : null);
  /** Nombre de cliente del acabado `f` de la liga `stampId` (el `finishLabel` de cualquier combo de esa liga con ese acabado). */
  const finishLabelOf = (f: Finish, stampId: number | null): FinishLabel | null =>
    data?.combos.find((c) => c.finish === f && (c.stamp?.productId ?? null) === stampId)?.finishLabel ?? null;
  const finishText = (f: Finish, stampId: number | null): string => {
    const fl = finishLabelOf(f, stampId);
    return fl ? tv(`finishLabel.${fl}`) : tFinish(f);
  };
  /** A2: «De liga · Promo de Liga (Holo)» cuando la liga solo existe en un acabado distinto al de la casilla. */
  const versionText = (o: { stamp: StampDTO | null; altaFinish: Finish | null; implicitFinish: boolean }): string => {
    const differs = slot && o.implicitFinish && o.altaFinish && o.altaFinish !== finish;
    return stampWithFinishLabel(t, tv, o.stamp, differs ? finishLabelOf(o.altaFinish!, o.stamp?.productId ?? null) : null);
  };

  const combo = model.combo;
  const breakdown = (c: VersionComboDTO): string => {
    // A2: el desglose nombra el acabado cuando el alta va en uno distinto al de la casilla (implícito o elegido).
    const version = stampWithFinishLabel(t, tv, c.stamp, slot && c.stamp && model.altaFinish && model.altaFinish !== finish ? c.finishLabel : null);
    const base = c.baseReferenceMxnCents != null ? formatMoneyCents(c.baseReferenceMxnCents, locale) : null;
    if (c.language === 'es' && c.appliedMarketPct != null) {
      return base
        ? t('breakdownEs', { version, base, pct: c.appliedMarketPct })
        : t('breakdownEsNoBase', { version, pct: c.appliedMarketPct });
    }
    return base ? t('breakdownEn', { version, base }) : t('breakdownEnNoBase', { version });
  };

  const finishPending = !!slot && model.altaFinishMode === 'choose' && model.altaFinish == null;

  return (
    <div className="flex flex-col gap-4" data-testid="ids-capture">
      {isError && (
        <div data-testid="ids-versions-error">
          <Banner
            variant="danger"
            role="alert"
            title={t('versionsErrorTitle')}
            action={
              <Button size="sm" variant="secondary" onClick={onRetry}>
                {t('versionsRetry')}
              </Button>
            }
          >
            {t('versionsError')}
          </Banner>
        </div>
      )}
      {model.finishOptions && (
        <PillToggleGroup
          label={tm1('finish')}
          testId="ids-finish"
          value={finish}
          onChange={(f) => onFinish(f as Finish)}
          options={model.finishOptions.map((f) => {
            // El nombre de cliente del acabado lo da el servidor en cada combo (`finishLabel`); el de la carta sin liga
            // primero (un Holofoil de Cosmos no renombra el Holo de la carta). Sin combo, el nombre de `finish`.
            const fl =
              data?.combos.find((c) => c.finish === f && c.stamp == null)?.finishLabel ??
              data?.combos.find((c) => c.finish === f)?.finishLabel;
            return { value: f, label: fl ? tv(`finishLabel.${fl}`) : tFinish(f) };
          })}
        />
      )}

      <PillToggleGroup
        label={t('language')}
        testId="ids-language"
        value={language}
        onChange={(l) => onLanguage(l as CardLanguage)}
        options={model.languageOptions.map((o) => ({
          value: o.language,
          label: tv(`language.${o.language}`),
          disabledReason:
            o.language === 'en' && model.stampProductId == null && o.disabledReason !== 'combo_missing'
              ? null
              : reasonText(o.disabledReason),
        }))}
      />

      {model.showVersionRow && (
        <PillToggleGroup
          label={t('version')}
          testId="ids-version"
          value={model.stampProductId == null ? 'none' : String(model.stampProductId)}
          onChange={(k) => onStamp(k === 'none' ? null : Number(k))}
          options={model.versionOptions.map((o) => ({
            value: o.key,
            label: versionText(o),
            // Inglés sin liga se crea como hoy aunque no tenga precio (cola de pendientes, I-1): nunca se apaga.
            disabledReason:
              o.stamp == null && language === 'en' && o.disabledReason !== 'combo_missing' ? null : reasonText(o.disabledReason),
          }))}
        />
      )}

      {model.showVersionRow && data?.canAddManual && onManualCreated && (
        <ManualVersionForm
          card={card}
          stampTypes={data.stampTypes}
          defaultFinish={finish}
          onCreated={async (res, f) => {
            await onManualCreated(res, f);
            onFinish(f);
          }}
          onAttached={onAttached}
          onStamp={onStamp}
        />
      )}

      {/* A2: fila «Acabado» solo con los acabados de la liga elegida, sin preselección (`value` que no casa con ninguna). */}
      {slot && model.altaFinishMode === 'choose' && (
        <div className="flex flex-col gap-1.5" data-testid="ids-alta-finish">
          <PillToggleGroup
            label={tq('finish')}
            value={model.altaFinish ?? ''}
            onChange={(f) => slot.onChosenFinish(f as Finish)}
            describedBy={slot.finishHintId}
            options={model.altaFinishOptions.map((f) => {
              const c = data?.combos.find((x) => x.finish === f && x.language === language && (x.stamp?.productId ?? null) === model.stampProductId);
              return { value: f, label: finishText(f, model.stampProductId), disabledReason: reasonText(c ? c.unavailableReason : 'combo_missing') };
            })}
          />
          <p id={slot.finishHintId} className="text-xs text-muted">
            {tq('finishHint')}
          </p>
        </div>
      )}

      {showCandidates && (data?.candidates.length ?? 0) > 0 && (
        <div className="flex flex-col gap-2 border border-border-strong p-3" data-testid="ids-candidates">
          <p className="text-sm text-text">{t('candidatesTitle')}</p>
          {data!.candidates.map((c) => (
            <Button
              key={c.tcgplayerProductId}
              size="sm"
              variant="secondary"
              loading={attach.isPending && attach.variables === c.tcgplayerProductId}
              onClick={() => attach.mutate(c.tcgplayerProductId)}
            >
              {t('candidateAttach', { name: c.name })}
            </Button>
          ))}
          {attach.isError && (
            <Banner
              variant="danger"
              role="alert"
              title={t('attachErrorTitle')}
              action={
                <Button ref={reloadRef} size="sm" variant="secondary" onClick={reload}>
                  {t('reloadVersions')}
                </Button>
              }
            >
              {attachErrorText}
            </Banner>
          )}
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-muted">{t('loadingVersions')}</p>
      ) : finishPending ? (
        <div data-testid="ids-price">
          <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted">{t('priceLabel')}</p>
          <p className="mt-1 text-sm text-muted">{tq('finishPricePending')}</p>
        </div>
      ) : (
        combo && (
          <div data-testid="ids-price">
            <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted">{t('priceLabel')}</p>
            {combo.previewPriceCents != null ? (
              <>
                <p className="tabular mt-1 text-[24px] font-medium leading-none text-text">
                  {formatMoneyCents(combo.previewPriceCents, locale)}
                </p>
                {/* Desglose: envuelve siempre (QA-PRM-UX: a 1280 en una línea se cortaba por la derecha del cajón), con los campos DEL COMBO (v1.116.2): la base antes
                    de X y el X aplicado. Bajo 640 px (cajón del binder a 390) envuelve: medido 2026-11-05, `nowrap` a 12 px
                    mide ≈373 px y, por `min-width:auto` del flex item, ensanchaba el cajón entero a ≈405 px (desborde
                    horizontal, burbujas fuera del viewport). ⛔ Sin aritmética: `previewPriceCents` ya trae curva, piso e
                    IVA; sin base, sin cifra. */}
                <p className="mt-1 min-w-0 break-words text-[12px] text-muted" data-testid="ids-breakdown">
                  {breakdown(combo)}
                </p>
                {combo.priceSource === 'inherited_base' && (
                  <p className="mt-1 text-[12px] text-muted" data-testid="ids-price-source">
                    {t('priceInherited')}
                  </p>
                )}
              </>
            ) : (
              <p className="mt-1 text-sm text-muted">
                {reasonText(combo.unavailableReason)} — {t('noPrice')}
              </p>
            )}
          </div>
        )
      )}
    </div>
  );
}
