'use client';

import { useMutation } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { attachStampedCandidate } from '@/lib/api';
import { formatMoneyCents } from '@/lib/format';
import { PillToggleGroup } from '@/components/domain/VersionPills';
import { Button } from '@/components/ui/Button';
import type { AppLocale } from '@/i18n/routing';
import type { CardDTO, CardLanguage, CardVersionsResponse, Finish, StampDTO, VersionComboDTO } from '@/types/contract';
import type { CaptureModel } from './ids-capture';

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

  const stampLabel = (s: StampDTO | null) =>
    s ? `${t(`stampButton.${s.type}`)}${s.label ? ` ${s.label}` : ''}` : t('noStamp');
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
                {/* Desglose en UNA línea (a 1280 no envuelve), con los campos DEL COMBO (v1.116.2): la base antes de X y
                    el X aplicado. ⛔ Sin aritmética: `previewPriceCents` ya trae curva, piso e IVA; sin base, sin cifra. */}
                <p className="mt-1 whitespace-nowrap text-[12px] text-muted" data-testid="ids-breakdown">
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
