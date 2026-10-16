'use client';

import { useRef, useState } from 'react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { CARD_SHOW } from '@/content/card-show';
import { submitLead, type LeadSubmitBody } from '@/lib/card-show-api';
import { PrivacyMini } from './PrivacyMini';
import {
  Chip,
  FORM_MESSAGES,
  Honeypot,
  PrivacyCheckbox,
  SuccessPanel,
  errorMessage,
  isEmail,
  readAttribution,
  useFormTokens,
} from './form-shared';

type Interes = 'visitor' | 'merchant' | 'sponsor';
const CHIPS: { value: Interes; label: string }[] = [
  { value: 'visitor', label: 'Voy' },
  { value: 'merchant', label: 'Vender' },
  { value: 'sponsor', label: 'Patrocinar' },
];

/**
 * Formulario «Avísame» (RONDA_0 §6.A, API_CONTRACT §CARDSHOW.3/.5/.6). Captura pública sin cuenta:
 * chips de interés (uno o varios) + correo + casilla de privacidad + honeypot. POST neutro a
 * `/api/v1/card-show/leads`; el doble opt-in confirma por correo.
 *
 * ⚠️ HUECO DE CONTRATO (arquitecto): el modelo es «un chip ⇒ una fila» y el body lleva UN `type`.
 * Para varios chips se hace un POST por tipo, cada uno con su PROPIO token (el token es de un solo
 * uso, §CARDSHOW.5). Si el contrato prefiere `types: []` en un solo POST, se simplifica aquí.
 *
 * Se pinta SIN JS (SSR): los campos existen en el HTML inicial, nada de `opacity:0` hasta hidratar.
 */
export function AvisameForm({ source = 'cta_hero' }: { source?: LeadSubmitBody['source'] }) {
  const [interes, setInteres] = useState<Interes[]>([]);
  const [email, setEmail] = useState('');
  const [consent, setConsent] = useState(false);
  const [hp, setHp] = useState('');
  const [status, setStatus] = useState<'idle' | 'pending' | 'success' | 'error'>('idle');
  const [fieldErrors, setFieldErrors] = useState<{ interes?: string; email?: string; consent?: string }>({});
  const [errorText, setErrorText] = useState<string | null>(null);
  const liveRef = useRef<HTMLParagraphElement>(null);
  // Pre-carga tokens al MONTAR (uno por chip posible), para que al enviar ya pasen los 2 s del
  // candado anti-bot del backend (§CARDSHOW.5); cada POST consume su propio token de un solo uso.
  const { withToken } = useFormTokens('leads', CHIPS.length);

  function toggle(v: Interes) {
    setInteres((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));
  }

  function validate(): boolean {
    const errs: typeof fieldErrors = {};
    if (interes.length === 0) errs.interes = FORM_MESSAGES.needInteres;
    if (!isEmail(email)) errs.email = FORM_MESSAGES.needEmail;
    if (!consent) errs.consent = FORM_MESSAGES.needConsent;
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorText(null);
    if (!validate()) return;
    setStatus('pending');
    const attribution = readAttribution();
    try {
      // Un POST por chip seleccionado, cada uno con su token de un solo uso (clave `formToken`).
      for (const type of interes) {
        await withToken((token) =>
          submitLead({ formToken: token, type, source, email: email.trim(), consent, website: hp, ...attribution }),
        );
      }
      setStatus('success');
    } catch (err) {
      setErrorText(errorMessage(err));
      setStatus('error');
    }
  }

  if (status === 'success') {
    return <SuccessPanel title="¡Listo! Casi terminas." />;
  }

  return (
    <form className="flex flex-col gap-6" onSubmit={onSubmit} noValidate>
      <fieldset>
        <legend className="eyebrow">¿Qué te interesa? (elige una o varias)</legend>
        <div className="mt-3 flex flex-wrap gap-2">
          {CHIPS.map((c) => (
            <Chip key={c.value} pressed={interes.includes(c.value)} onClick={() => toggle(c.value)}>
              {c.label}
            </Chip>
          ))}
        </div>
        {fieldErrors.interes && <p className="mt-2 font-mono text-xs text-accent">{fieldErrors.interes}</p>}
      </fieldset>

      <Input
        label="Correo"
        type="email"
        inputMode="email"
        autoComplete="email"
        placeholder="tu@correo.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        error={fieldErrors.email}
      />

      <PrivacyCheckbox checked={consent} onChange={setConsent} error={fieldErrors.consent}>
        He leído el{' '}
        <a
          href={CARD_SHOW.footer.privacidadUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent underline underline-offset-2"
        >
          aviso de privacidad
        </a>{' '}
        y acepto recibir avisos del Card Show.
      </PrivacyCheckbox>

      <Honeypot value={hp} onChange={setHp} />

      <div>
        <Button type="submit" variant="accent" loading={status === 'pending'}>
          Avísame
        </Button>
      </div>

      {errorText && (
        <p ref={liveRef} role="alert" className="text-[13px] text-accent">
          {errorText}
        </p>
      )}

      <PrivacyMini />
    </form>
  );
}
