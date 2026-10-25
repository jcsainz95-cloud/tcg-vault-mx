'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Save } from 'lucide-react';
import { getSettings, updateSettings } from '@/lib/api';
import { asApiError } from '@/lib/api-client';
import type { SettingsDTO } from '@/types/contract';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Banner } from '@/components/ui/Banner';
import { QueryState, useErrorMessage } from '@/components/ui/QueryState';
import { pesosToCents } from '../../m4/pesosToCents';

type DirectShipDialKey = 'directShipCardsFeeCents' | 'directShipSealedFeeCents' | 'directShipFreeFromCents';

/**
 * Los tres diales del envío directo (API_CONTRACT §4-G.12 punto 3, v1.109), en pesos en pantalla y centavos en el
 * `PUT`. ⭐ **Los tres son CON IVA INCLUIDO**: el importe final que ve el cliente (decisión del dueño 2026-10-24,
 * `HECHOS.md` «envío v2 con IVA incluido»). La pantalla lo dice en cada campo (sufijo «IVA incluido» + ayuda),
 * porque el dial vecino «Envío de un retiro» (`shippingFeeCents`) sigue NETO y se confunden con facilidad.
 */
const DIALS: ReadonlyArray<{ key: DirectShipDialKey; convention: 'gross' }> = [
  { key: 'directShipCardsFeeCents', convention: 'gross' },
  { key: 'directShipSealedFeeCents', convention: 'gross' },
  { key: 'directShipFreeFromCents', convention: 'gross' },
];

/** Claves que edita esta sección (candado REL-S7 en `M10View.test.tsx`: cada dial en UN solo bloque de M10). */
export const DIRECT_SHIP_DIAL_KEYS: readonly DirectShipDialKey[] = DIALS.map((d) => d.key);

const RICH_BOLD = { b: (chunks: React.ReactNode) => <strong className="font-medium text-text">{chunks}</strong> };

function savedText(key: DirectShipDialKey, s: SettingsDTO | undefined): string {
  const v = s?.[key];
  return v == null ? '' : String(v / 100);
}

/**
 * Grupo «Envío a domicilio» de M10 (solo `super_admin`: la página entera va en `SuperAdminOnly`). Mismo patrón que
 * los demás grupos: borrador propio y `PUT` parcial con SOLO las claves tocadas; `422` por campo.
 * Un servidor anterior a v1.109 no trae las claves ⇒ la sección no se pinta como si existieran.
 */
export function DirectShipSection() {
  const t = useTranslations('admin.m10.directShip');
  const tc = useTranslations('common');
  const qc = useQueryClient();
  const getError = useErrorMessage('operator');
  const settings = useQuery({ queryKey: ['admin-settings'], queryFn: getSettings });
  const [draft, setDraft] = useState<Partial<Record<DirectShipDialKey, string>>>({});
  const [fieldErrors, setFieldErrors] = useState<Set<DirectShipDialKey>>(new Set());
  const [banner, setBanner] = useState<string | null>(null);

  const s = settings.data;
  const available = !!s && DIALS.every((d) => typeof s[d.key] === 'number');
  const dirty = (Object.keys(draft) as DirectShipDialKey[]).filter((k) => draft[k] !== savedText(k, s));
  // 💰 TL-R1: un campo tocado que no da centavos (vacío o no numérico) NO viaja. Antes `Number('')` daba 0 y el
  // `PUT` dejaba el envío en MX$0 sin avisar. Inválido ⇒ el campo se marca y Guardar queda bloqueado.
  const localInvalid = new Set(dirty.filter((k) => pesosToCents(draft[k]!) === null));

  const save = useMutation({
    mutationFn: (p: Partial<SettingsDTO>) => updateSettings(p),
    onMutate: () => {
      setFieldErrors(new Set());
      setBanner(null);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-settings'] });
      setDraft({});
    },
    onError: (e) => {
      const err = asApiError(e);
      const errors = err?.details?.errors;
      if (err?.status === 422 && err.code === 'VALIDATION_ERROR' && errors && typeof errors === 'object') {
        const keys = Object.keys(errors as Record<string, unknown>).filter((k): k is DirectShipDialKey =>
          DIALS.some((d) => d.key === k),
        );
        setFieldErrors(new Set(keys));
        setBanner(t('checkFields'));
        return;
      }
      setBanner(getError(e));
    },
  });

  function patch(): Partial<SettingsDTO> {
    const out: Partial<Record<DirectShipDialKey, number>> = {};
    for (const k of dirty) {
      const cents = pesosToCents(draft[k]!);
      if (cents !== null) out[k] = cents;
    }
    return out;
  }

  return (
    <section id="envio-directo" className="flex scroll-mt-24 flex-col gap-3" data-testid="m10-direct-ship">
      <h2 className="text-h2 font-semibold">{t('title')}</h2>
      <p className="text-sm text-muted">{t('subtitle')}</p>
      <QueryState isLoading={settings.isLoading} isError={settings.isError} error={settings.error} onRetry={() => settings.refetch()}>
        {s && !available && <p className="text-sm text-muted">{t('unavailable')}</p>}
        {s && available && (
          <div className="flex flex-col gap-5 rounded-lg border border-border bg-surface p-4">
            {banner && (
              <Banner variant="danger" role="alert">
                {banner}
              </Banner>
            )}
            <div className="grid gap-5 sm:grid-cols-3">
              {DIALS.map(({ key, convention }) => {
                const bad = fieldErrors.has(key) || localInvalid.has(key);
                return (
                  <div key={key} className="flex flex-col gap-1">
                    <Input
                      label={t(`labels.${key}`)}
                      type="text"
                      inputMode="decimal"
                      prefix="MX$"
                      suffix={t(`convention.${convention}`)}
                      value={draft[key] ?? savedText(key, s)}
                      onChange={(e) => {
                        const v = e.target.value;
                        setDraft((prev) => ({ ...prev, [key]: v }));
                        setFieldErrors((cur) => {
                          if (!cur.has(key)) return cur;
                          const next = new Set(cur);
                          next.delete(key);
                          return next;
                        });
                      }}
                      aria-invalid={bad || undefined}
                      data-convention={convention}
                    />
                    <p className={bad ? 'text-xs text-accent' : 'text-xs text-muted'}>
                      {bad ? t('invalid') : t.rich(`help.${key}`, RICH_BOLD)}
                    </p>
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-muted">{t('withdrawalNote')}</p>
            <div className="flex items-center gap-3">
              <Button
                disabled={dirty.length === 0 || localInvalid.size > 0}
                loading={save.isPending}
                onClick={() => {
                  if (localInvalid.size === 0) save.mutate(patch());
                }}
                data-testid="m10-direct-ship-save"
              >
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
    </section>
  );
}
