'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { subscribeSealedRestock } from '@/lib/api';
import type { SealedCondition, SealedSubtype } from '@/types/contract';
import { ApiClientError } from '@/lib/api-client';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Banner } from '@/components/ui/Banner';

/** Un correo válido a grandes rasgos (el backend hace la validación autoritativa). */
function isEmail(v: string): boolean {
  return /.+@.+\..+/.test(v.trim());
}

/**
 * «Avísame cuando vuelva» (contrato §2-S · POST /catalog/sealed/restock-subscriptions,
 * FEATURE-FLAGGED `sealed_restock_alerts`). Respuesta NEUTRA (no revela si el producto existe): un
 * éxito siempre muestra el mismo mensaje. Si el flag está apagado el endpoint responde
 * `404 FEATURE_DISABLED` y el componente se OCULTA (cableado apagado limpio).
 */
export function SealedRestockForm({
  cardId,
  sealedSubtype,
  sealedCondition,
}: {
  cardId: string;
  sealedSubtype?: SealedSubtype;
  sealedCondition: SealedCondition;
}) {
  const t = useTranslations('sealed.restock');
  const tc = useTranslations('common');
  const [email, setEmail] = useState('');
  const [featureOff, setFeatureOff] = useState(false);

  const mutation = useMutation({
    mutationFn: () =>
      subscribeSealedRestock({ email: email.trim(), cardId, sealedSubtype, sealedCondition }),
    onError: (err) => {
      // 404 FEATURE_DISABLED (race con el dial) → ocultar el formulario en vez de mostrar error.
      if (err instanceof ApiClientError && err.status === 404 && err.code === 'FEATURE_DISABLED') {
        setFeatureOff(true);
      }
    },
  });

  if (featureOff) return null;

  return (
    <div>
      <p className="eyebrow">{t('title')}</p>
      <p className="mt-2 text-[13px] leading-relaxed text-muted">{t('body')}</p>

      {mutation.isSuccess ? (
        <Banner variant="success" role="status" className="mt-4">
          {t('confirmed')}
        </Banner>
      ) : (
        <form
          className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            if (isEmail(email)) mutation.mutate();
          }}
        >
          <div className="flex-1">
            <Input
              label={t('emailLabel')}
              type="email"
              autoComplete="email"
              placeholder={t('emailPlaceholder')}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              error={
                mutation.isError && !(mutation.error instanceof ApiClientError && mutation.error.status === 404)
                  ? tc('errorGeneric')
                  : undefined
              }
            />
          </div>
          <Button type="submit" variant="secondary" disabled={!isEmail(email)} loading={mutation.isPending}>
            {t('cta')}
          </Button>
        </form>
      )}
    </div>
  );
}
