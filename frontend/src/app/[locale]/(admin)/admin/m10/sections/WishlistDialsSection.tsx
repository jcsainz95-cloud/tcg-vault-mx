'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Save } from 'lucide-react';
import { getSettings, updateSettings } from '@/lib/api';
import { asApiError } from '@/lib/api-client';
import type { SettingsDTO } from '@/types/contract';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { Banner } from '@/components/ui/Banner';
import { Modal } from '@/components/ui/Modal';
import { QueryState, useErrorMessage } from '@/components/ui/QueryState';

type WishlistDialKey =
  | 'wishlistEnabled'
  | 'wishlistMaxPerAccount'
  | 'wishlistMaxIvaMode'
  | 'wishlistTargetMarginPct'
  | 'wishlistMarginBasis'
  | 'wishlistDailyMailCap'
  | 'wishlistMailWindowMin';

type Dial =
  | { key: WishlistDialKey; kind: 'enum'; options: readonly string[]; fallback: string }
  | { key: WishlistDialKey; kind: 'int' | 'pct' };

/**
 * Los siete diales del grupo (API_CONTRACT §WSH.2, DESIGN_SYSTEM §WSH-UX.9 a), en el orden del diseño. El octavo
 * (`sealedRestockMaxPendingPerEmail`) vive en M11, junto al interruptor del «avísame» de sellados (WSH-UX.9 c).
 * `fallback` = el seed del contrato cuando un servidor anterior no trae la clave (`wishlist_enabled` seed `off`).
 */
const DIALS: Dial[] = [
  { key: 'wishlistEnabled', kind: 'enum', options: ['off', 'on'], fallback: 'off' },
  { key: 'wishlistMaxPerAccount', kind: 'int' },
  { key: 'wishlistMaxIvaMode', kind: 'enum', options: ['with_iva', 'without_iva'], fallback: 'with_iva' },
  { key: 'wishlistTargetMarginPct', kind: 'pct' },
  { key: 'wishlistMarginBasis', kind: 'enum', options: ['cost', 'sale'], fallback: 'cost' },
  { key: 'wishlistDailyMailCap', kind: 'int' },
  { key: 'wishlistMailWindowMin', kind: 'int' },
];

/** Claves que edita esta sección (candado REL-S7 en `M10View.test.tsx`). */
export const WISHLIST_DIAL_KEYS: readonly WishlistDialKey[] = DIALS.map((d) => d.key);

const RICH_BOLD = { b: (chunks: React.ReactNode) => <strong className="font-medium text-text">{chunks}</strong> };

function savedText(dial: Dial, s: SettingsDTO | undefined): string {
  const v = s?.[dial.key as keyof SettingsDTO] as string | number | undefined;
  if (v == null) return dial.kind === 'enum' ? dial.fallback : '';
  return String(v);
}

/**
 * Grupo «Lista de deseos» de M10 (`id="wishlist"`: ancla del enlace «Cambiar en Configuración» de la lista de compra).
 * Mismo patrón que los demás grupos: borrador propio y `PUT` parcial con SOLO las claves tocadas.
 *
 * ⭐ **Encender pide confirmación** (criterio 824: el aviso de privacidad va antes; WSH-UX-14): pasar
 * `wishlistEnabled` de `off` a `on` abre el diálogo y ⛔ no hay `PUT` hasta «Sí, encender». Apagar no pregunta.
 */
export function WishlistDialsSection() {
  const t = useTranslations('admin.m10.wishlist');
  const tc = useTranslations('common');
  const qc = useQueryClient();
  const getError = useErrorMessage('operator');
  const settings = useQuery({ queryKey: ['admin-settings'], queryFn: getSettings });
  const [draft, setDraft] = useState<Partial<Record<WishlistDialKey, string>>>({});
  const [fieldErrors, setFieldErrors] = useState<Set<WishlistDialKey>>(new Set());
  const [banner, setBanner] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const s = settings.data;
  const dirty = (Object.keys(draft) as WishlistDialKey[]).filter((k) => {
    const dial = DIALS.find((d) => d.key === k)!;
    return draft[k] !== savedText(dial, s);
  });
  const value = (dial: Dial) => draft[dial.key] ?? savedText(dial, s);

  function patch(): Partial<SettingsDTO> {
    const out: Record<string, string | number> = {};
    for (const k of dirty) {
      const dial = DIALS.find((d) => d.key === k)!;
      const raw = draft[k]!.trim();
      out[k] = dial.kind === 'enum' ? raw : Number(raw.replace(/,/g, ''));
    }
    return out as Partial<SettingsDTO>;
  }

  const save = useMutation({
    mutationFn: (p: Partial<SettingsDTO>) => updateSettings(p),
    onMutate: () => {
      setFieldErrors(new Set());
      setBanner(null);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-settings'] });
      setDraft({});
      setConfirming(false);
    },
    onError: (e) => {
      setConfirming(false);
      const err = asApiError(e);
      const errors = err?.details?.errors;
      if (err?.status === 422 && err.code === 'VALIDATION_ERROR' && errors && typeof errors === 'object') {
        const keys = Object.keys(errors as Record<string, unknown>).filter((k): k is WishlistDialKey =>
          DIALS.some((d) => d.key === k),
        );
        setFieldErrors(new Set(keys));
        setBanner(t('checkFields'));
        return;
      }
      setBanner(getError(e));
    },
  });

  const turningOn = dirty.includes('wishlistEnabled') && draft.wishlistEnabled === 'on';

  function onSave() {
    if (turningOn) {
      setConfirming(true);
      return;
    }
    save.mutate(patch());
  }

  return (
    <section id="wishlist" className="flex scroll-mt-24 flex-col gap-3" data-testid="m10-wishlist">
      <h2 className="text-h2 font-semibold">{t('title')}</h2>
      <p className="text-sm text-muted">{t('subtitle')}</p>
      <QueryState isLoading={settings.isLoading} isError={settings.isError} error={settings.error} onRetry={() => settings.refetch()}>
        {s && (
          <div className="flex flex-col gap-5 rounded-lg border border-border bg-surface p-4">
            {banner && (
              <Banner variant="danger" role="alert">
                {banner}
              </Banner>
            )}
            <div className="grid gap-5 sm:grid-cols-2">
              {DIALS.map((dial) => {
                const bad = fieldErrors.has(dial.key);
                const help = (
                  <p className={bad ? 'text-xs text-accent' : 'text-xs text-muted'}>
                    {bad ? t('invalid') : t.rich(`help.${dial.key}`, RICH_BOLD)}
                  </p>
                );
                const onChange = (v: string) => {
                  setDraft((prev) => ({ ...prev, [dial.key]: v }));
                  setFieldErrors((cur) => {
                    if (!cur.has(dial.key)) return cur;
                    const next = new Set(cur);
                    next.delete(dial.key);
                    return next;
                  });
                };
                return (
                  <div key={dial.key} className="flex flex-col gap-1">
                    {dial.kind === 'enum' ? (
                      <Select
                        label={t(`labels.${dial.key}`)}
                        options={dial.options.map((o) => ({ value: o, label: t(`options.${o}`) }))}
                        value={value(dial)}
                        onChange={(e) => onChange(e.target.value)}
                        aria-invalid={bad || undefined}
                      />
                    ) : (
                      <Input
                        label={t(`labels.${dial.key}`)}
                        type="text"
                        inputMode="numeric"
                        suffix={dial.kind === 'pct' ? '%' : undefined}
                        value={value(dial)}
                        onChange={(e) => onChange(e.target.value)}
                        aria-invalid={bad || undefined}
                      />
                    )}
                    {help}
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-3">
              <Button disabled={dirty.length === 0} loading={save.isPending} onClick={onSave} data-testid="m10-wishlist-save">
                <Save size={18} /> {t('save', { count: dirty.length })}
              </Button>
              {dirty.length > 0 && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setDraft({});
                    setFieldErrors(new Set());
                    setBanner(null);
                  }}
                >
                  {tc('cancel')}
                </Button>
              )}
            </div>
            {save.isSuccess && (
              <Banner variant="success" role="status">
                {t('saved')}
              </Banner>
            )}
          </div>
        )}
      </QueryState>

      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title={t('confirm.title')}
        footer={
          <>
            <Button variant="secondary" autoFocus onClick={() => setConfirming(false)}>
              {t('confirm.cancel')}
            </Button>
            <Button loading={save.isPending} onClick={() => save.mutate(patch())}>
              {t('confirm.yes')}
            </Button>
          </>
        }
      >
        <p>{t('confirm.body')}</p>
      </Modal>
    </section>
  );
}
