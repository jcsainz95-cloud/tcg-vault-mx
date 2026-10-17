'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { CARD_SHOW, CARD_SHOW_GAMES, type CardShowGame } from '@/content/card-show';
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
  readAttribution,
  useFormTokens,
} from './form-shared';

/**
 * Formulario «Asistente / Jugador» (API_CONTRACT §CARDSHOW.3/.5/.6, v1.96 M-84). Captura pública sin
 * cuenta ⇒ `POST /card-show/leads` con `type=visitor`: nombre + correo + juego de interés (chips,
 * opcional) + participar en la rifa (casilla PREMARCADA) + consentimiento (privacidad + bases).
 *
 * UN solo POST (un `type`). `gameInterest` es un `CardShowGame` (único) y opcional: si el visitante
 * no elige, no se envía. Cuando marca la rifa, se envía `raffleTermsVersion` (§CARDSHOW.1b:
 * obligatorio ⇔ `raffleOptIn=true`); el texto del consentimiento nombra las bases de la rifa.
 *
 * Se pinta SIN JS (SSR): los campos existen en el HTML inicial, nada de `opacity:0` hasta hidratar.
 */
export function LeadVisitorForm() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [game, setGame] = useState<CardShowGame | ''>('');
  const [raffle, setRaffle] = useState(true); // casilla PREMARCADA (§CARDSHOW.1b)
  const [consent, setConsent] = useState(false);
  const [hp, setHp] = useState('');
  const [status, setStatus] = useState<'idle' | 'pending' | 'success' | 'error'>('idle');
  const [errorText, setErrorText] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; email?: string; consent?: string }>({});
  const { prime, withToken } = useFormTokens('leads');

  function validate(): boolean {
    const errs: typeof fieldErrors = {};
    if (name.trim() === '') errs.name = FORM_MESSAGES.needName;
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
      await withToken((token) =>
        submitLead({
          formToken: token,
          type: 'visitor',
          source: 'cta_hero',
          name: name.trim(),
          email: email.trim(),
          gameInterest: game || undefined,
          raffleOptIn: raffle,
          // §CARDSHOW.1b: la versión de bases SOLO cuando participa en la rifa.
          raffleTermsVersion: raffle ? CARD_SHOW.raffleTermsVersion : undefined,
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
    return <SuccessPanel title="¡Listo! Casi terminas." />;
  }

  return (
    <form className="flex flex-col gap-6" onSubmit={onSubmit} onFocus={prime} noValidate>
      <div className="grid gap-6 sm:grid-cols-2">
        <Input
          label="Nombre"
          autoComplete="name"
          placeholder="Tu nombre"
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={fieldErrors.name}
        />
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
      </div>

      <fieldset>
        <legend className="eyebrow">¿Qué juego te interesa? (opcional)</legend>
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Juego de interés">
          {CARD_SHOW_GAMES.map((g) => (
            <Chip key={g.id} pressed={game === g.id} onClick={() => setGame(game === g.id ? '' : g.id)}>
              {g.label}
            </Chip>
          ))}
          <Chip pressed={game === ''} onClick={() => setGame('')}>
            Aún no sé
          </Chip>
        </div>
      </fieldset>

      <label className="flex items-start gap-3 text-[13px] leading-relaxed text-text">
        <input
          type="checkbox"
          className="mt-1 h-5 w-5 shrink-0 accent-[color:var(--color-accent)]"
          checked={raffle}
          onChange={(e) => setRaffle(e.target.checked)}
        />
        <span>
          Quiero participar en la rifa (set 30.º aniversario Pokémon)
          <span className="mt-0.5 block text-muted">Hay que estar presente el día del evento para ganar.</span>
        </span>
      </label>

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
        y acepto las bases de la rifa.
      </PrivacyCheckbox>

      <Honeypot value={hp} onChange={setHp} />

      <div>
        <Button type="submit" variant="accent" loading={status === 'pending'}>
          Registrarme gratis
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
