'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { subscribeSealedRestock } from '@/lib/api';
import type { SealedCondition, SealedSubtype } from '@/types/contract';
import { ApiClientError } from '@/lib/api-client';
import { useSession } from '@/lib/session';
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
  // ⭐ §WSH.7 (b) / WSH-UX-13: con sesión el servidor IGNORA `dto.email` y usa el de la cuenta ⇒ sin campo; se manda el
  // de la cuenta solo porque el cuerpo lo pide, y la pantalla dice a dónde llegará.
  const { user } = useSession();
  const accountEmail = user?.email ?? null;
  const target = accountEmail ?? email.trim();

  const mutation = useMutation({
    mutationFn: () =>
      subscribeSealedRestock({ email: target, cardId, sealedSubtype, sealedCondition }),
    onError: (err) => {
      // 404 FEATURE_DISABLED (race con el dial) → ocultar el formulario en vez de mostrar error.
      if (err instanceof ApiClientError && err.status === 404 && err.code === 'FEATURE_DISABLED') {
        setFeatureOff(true);
      }
    },
  });

  if (featureOff) return null;

  // `429` (5/min) ⇒ su texto; el `404` del dial ya retiró el formulario; lo demás, el genérico.
  const restockError =
    mutation.isError && !(mutation.error instanceof ApiClientError && mutation.error.status === 404)
      ? mutation.error instanceof ApiClientError && mutation.error.status === 429
        ? t('rateLimited')
        : tc('errorGeneric')
      : null;

  return (
    <div>
      <p className="eyebrow">{t('title')}</p>
      <p className="mt-2 text-[13px] leading-relaxed text-muted">{t('body')}</p>

      {mutation.isSuccess ? (
        <Banner variant="success" role="status" className="mt-4">
          {t('confirmed')}
        </Banner>
      ) : accountEmail ? (
        <form
          className="mt-4 flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          <p className="text-[13px] text-muted">{t('signedInAs', { email: accountEmail })}</p>
          <div>
            <Button type="submit" variant="secondary" loading={mutation.isPending}>
              {t('cta')}
            </Button>
          </div>
          {restockError && (
            <p role="alert" className="text-[13px] text-accent">
              {restockError}
            </p>
          )}
        </form>
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
              error={restockError ?? undefined}
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
