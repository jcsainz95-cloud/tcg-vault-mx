'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { normalizeMxPhone, normalizePhoneInput } from '@/lib/phone';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

/**
 * §CELULAR-ALTA §6.5 · `POST /orders/claim` respondió `422 PHONE_REQUIRED` (ni la cuenta ni el pedido traen un celular
 * válido): se pide AQUÍ MISMO y quien lo usa reintenta el reclamo con `phone`. ⛔ El celular no va a medición ni a la URL.
 */
export function ClaimPhonePrompt({
  onSubmit,
  busy = false,
  failed = false,
}: {
  onSubmit: (phone: string) => void;
  busy?: boolean;
  /** El reintento falló por otra causa distinta del formato. */
  failed?: boolean;
}) {
  const t = useTranslations('auth.phoneSignup');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState(false);
  const normalized = normalizeMxPhone(phone);
  return (
    <form
      noValidate
      data-testid="claim-phone-prompt"
      className="flex max-w-[420px] flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!normalized) return setError(true);
        onSubmit(normalized);
      }}
    >
      <p id="claim-phone-help" className="text-sm leading-relaxed text-text">
        {t('claimHelp')}
      </p>
      <div aria-live="polite">
        <Input
          label={t('label')}
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          prefix="+52"
          aria-describedby="claim-phone-help"
          value={phone}
          onChange={(e) => {
            setError(false);
            setPhone(normalizePhoneInput(e.target.value));
          }}
          error={error ? t('error') : failed ? t('failed') : undefined}
        />
      </div>
      <Button type="submit" disabled={!normalized} loading={busy}>
        {t('claimButton')}
      </Button>
    </form>
  );
}
