'use client';

import { useEffect, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { attachStampedCandidate } from '@/lib/api';
import { formatMoneyCents } from '@/lib/format';
import { PillToggleGroup } from '@/components/domain/VersionPills';
import { Button } from '@/components/ui/Button';
import { Banner } from '@/components/ui/Banner';
import { asApiError } from '@/lib/api-client';
import type { AppLocale } from '@/i18n/routing';
import type { CardDTO, CardLanguage, CardVersionsResponse, Finish, StampDTO, VersionComboDTO } from '@/types/contract';
import type { CaptureModel } from './ids-capture';

/** Texto del botón de versión (`admin.m1.ids.stampButton.*` + `label` del producto, o «Sin liga»). Lo reusa el resumen del alta rápida. */
export function stampButtonLabel(t: (key: string) => string, s: StampDTO | null): string {
  return s ? `${t(`stampButton.${s.type}`)}${s.label ? ` ${s.label}` : ''}` : t('noStamp');
}

/**
 * §IDS-UX.2 / IDS-UX.8 (captura, `01-captura-v6`; opción A del dueño): tras el Acabado, **Idioma** (`Inglés | Español`,
 * «Inglés» de fábrica) y **Versión** (`Sin liga | De liga · Prize Pack | …`, solo si la carta tiene versiones), en
 * burbujas de 44 px; la versión sin precio va apagada con su motivo. Después, «Precio de venta (auto)» con el desglose
 * en una línea. Sin campo de precio: una versión no default no admite precio tecleado (I-4). Las candidatas ambiguas
 * se ligan aquí (`attach`, identidad, no precio).
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
}) {
  const t = useTranslations('admin.m1.ids');
  const tm1 = useTranslations('admin.m1');
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

  const combo = model.combo;
  const breakdown = (c: VersionComboDTO): string => {
    const version = stampLabel(c.stamp);
    const base = c.baseReferenceMxnCents != null ? formatMoneyCents(c.baseReferenceMxnCents, locale) : null;
    if (c.language === 'es' && c.appliedMarketPct != null) {
      return base
        ? t('breakdownEs', { version, base, pct: c.appliedMarketPct })
        : t('breakdownEsNoBase', { version, pct: c.appliedMarketPct });
    }
    return base ? t('breakdownEn', { version, base }) : t('breakdownEnNoBase', { version });
  };

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
            label: stampLabel(o.stamp),
            // Inglés sin liga se crea como hoy aunque no tenga precio (cola de pendientes, I-1): nunca se apaga.
            disabledReason:
              o.stamp == null && language === 'en' && o.disabledReason !== 'combo_missing' ? null : reasonText(o.disabledReason),
          }))}
        />
      )}

      {(data?.candidates.length ?? 0) > 0 && (
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
      ) : (
        combo && (
          <div data-testid="ids-price">
            <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted">{t('priceLabel')}</p>
            {combo.previewPriceCents != null ? (
              <>
                <p className="tabular mt-1 text-[24px] font-medium leading-none text-text">
                  {formatMoneyCents(combo.previewPriceCents, locale)}
                </p>
                {/* Desglose en UNA línea desde `sm` (a 1280 no envuelve), con los campos DEL COMBO (v1.116.2): la base antes
                    de X y el X aplicado. Bajo 640 px (cajón del binder a 390) envuelve: medido 2026-11-05, `nowrap` a 12 px
                    mide ≈373 px y, por `min-width:auto` del flex item, ensanchaba el cajón entero a ≈405 px (desborde
                    horizontal, burbujas fuera del viewport). ⛔ Sin aritmética: `previewPriceCents` ya trae curva, piso e
                    IVA; sin base, sin cifra. */}
                <p className="mt-1 text-[12px] text-muted sm:whitespace-nowrap" data-testid="ids-breakdown">
                  {breakdown(combo)}
                </p>
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
