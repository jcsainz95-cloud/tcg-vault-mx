'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { CARD_SHOW } from '@/content/card-show';
import { submitLead } from '@/lib/card-show-api';
import { PrivacyMini } from './PrivacyMini';
import {
  Chip,
  FORM_MESSAGES,
  Honeypot,
  PrivacyCheckbox,
  SuccessPanel,
  errorMessage,
  isEmail,
  isPhone,
  readAttribution,
  useFormTokens,
} from './form-shared';

type ComercialTipo = 'merchant' | 'sponsor';
const TIPOS: { value: ComercialTipo; label: string }[] = [
  { value: 'merchant', label: 'Vendedor (mesa)' },
  { value: 'sponsor', label: 'Patrocinador' },
];

/**
 * Formulario «Vendedor / Patrocinador» (API_CONTRACT §CARDSHOW.3/.5/.6, v1.96 M-84). Captura pública
 * ⇒ `POST /card-show/leads` con `type=merchant|sponsor`: tipo + nombre o marca + teléfono + correo +
 * «¿qué vendes/qué marca?» (opcional) + consentimiento. ⛔ Sin precios de mesa ni montos de
 * patrocinio en pantalla: el contacto es privado (decisión del dueño — pivote a captura).
 *
 * UN solo POST (un `type`). `phone` es OBLIGATORIO aquí y ⛔ prohibido en visitor; `gameInterest`,
 * `raffleOptIn` y `raffleTermsVersion` ⛔ no se envían (§CARDSHOW.1b).
 */
export function MerchantSponsorForm() {
  const [tipo, setTipo] = useState<ComercialTipo>('merchant');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [sellsWhat, setSellsWhat] = useState('');
  const [consent, setConsent] = useState(false);
  const [hp, setHp] = useState('');
  const [status, setStatus] = useState<'idle' | 'pending' | 'success' | 'error'>('idle');
  const [errorText, setErrorText] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; phone?: string; email?: string; consent?: string }>({});

  function validate(): boolean {
    const errs: typeof fieldErrors = {};
    if (name.trim() === '') errs.name = FORM_MESSAGES.needNameOrBrand;
    if (!isPhone(phone)) errs.phone = FORM_MESSAGES.needPhone;
    if (!isEmail(email)) errs.email = FORM_MESSAGES.needEmail;
    if (!consent) errs.consent = FORM_MESSAGES.needConsent;
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  }

  const { withToken } = useFormTokens('leads', 1);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorText(null);
    if (!validate()) return;
    setStatus('pending');
    const attribution = readAttribution();
    try {
      await withToken((token) =>
        submitLead({
          formToken: token,
          type: tipo,
          source: 'cta_patrocinio',
          name: name.trim(),
          phone: phone.trim(),
          email: email.trim(),
          sellsWhat: sellsWhat.trim() || undefined,
          consent,
          website: hp,
          ...attribution,
        }),
      );
      setStatus('success');
    } catch (err) {
      setErrorText(errorMessage(err));
      setStatus('error');
    }
  }

  if (status === 'success') {
    return <SuccessPanel title="¡Gracias! Te contactamos pronto." />;
  }

  return (
    <form className="flex flex-col gap-6" onSubmit={onSubmit} noValidate>
      <fieldset>
        <legend className="eyebrow">Me interesa como…</legend>
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Tipo de interés">
          {TIPOS.map((tp) => (
            <Chip key={tp.value} pressed={tipo === tp.value} onClick={() => setTipo(tp.value)}>
              {tp.label}
            </Chip>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-6 sm:grid-cols-2">
        <Input
          label="Nombre o marca"
          autoComplete="organization"
          placeholder="Tu nombre o tu tienda"
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={fieldErrors.name}
        />
        <Input
          label="Teléfono"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="55 0000 0000"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          error={fieldErrors.phone}
        />
      </div>

      <Input
        label="Correo"
        type="email"
        inputMode="email"
        autoComplete="email"
        placeholder="contacto@tumarca.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        error={fieldErrors.email}
      />

      <Input
        label="¿Qué vendes o qué marca eres? (opcional)"
        value={sellsWhat}
        onChange={(e) => setSellsWhat(e.target.value)}
        placeholder="Singles, sellado, accesorios, tu marca…"
      />

      <PrivacyCheckbox checked={consent} onChange={setConsent} error={fieldErrors.consent}>
        Acepto que TCG HUNT me contacte por este medio y he leído el{' '}
        <a
          href={CARD_SHOW.footer.privacidadUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent underline underline-offset-2"
        >
          aviso de privacidad
        </a>
        .
      </PrivacyCheckbox>

      <Honeypot value={hp} onChange={setHp} />

      <div>
        <Button type="submit" variant="accent" loading={status === 'pending'}>
          Quiero que me contacten
        </Button>
      </div>

      {errorText && (
        <p role="alert" className="text-[13px] text-accent">
          {errorText}
        </p>
      )}

      <PrivacyMini />
    </form>
  );
}
