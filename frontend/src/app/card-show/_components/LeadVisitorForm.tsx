'use client';

import { useRef, useState } from 'react';
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
  focusFirstInvalid,
  isEmail,
  readAttribution,
  useFormTokens,
} from './form-shared';

/**
 * Formulario «Asistente» (API_CONTRACT §CARDSHOW.3/.5/.6/.18, v1.100 M-89). Captura pública sin cuenta
 * ⇒ `POST /card-show/leads` con `type=visitor`: nombre + correo + juego de interés (chips, opcional) +
 * participar en la rifa (casilla PROPIA y DESMARCADA, con enlace a bases) + consentimiento de privacidad.
 *
 * ⭐M-89: la casilla de privacidad obligatoria NO bundlea las bases de la rifa; `raffleOptIn` es una
 * casilla SEPARADA y DESMARCADA por defecto, con enlace a las bases. Solo cuando el visitante marca la
 * rifa se envía `raffleTermsVersion` (§CARDSHOW.1b: obligatorio ⇔ `raffleOptIn=true`).
 *
 * UN solo POST (un `type`). `gameInterest` es un `CardShowGame` (único) y opcional: si el visitante
 * no elige, no se envía.
 *
 * Se pinta SIN JS (SSR): los campos existen en el HTML inicial, nada de `opacity:0` hasta hidratar.
 */
export function LeadVisitorForm() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [game, setGame] = useState<CardShowGame | ''>('');
  const [raffle, setRaffle] = useState(false); // ⭐M-89: casilla propia, DESMARCADA por defecto
  const [consent, setConsent] = useState(false);
  const [hp, setHp] = useState('');
  const [status, setStatus] = useState<'idle' | 'pending' | 'success' | 'error'>('idle');
  const [errorText, setErrorText] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; email?: string; consent?: string }>({});
  const { prime, withToken } = useFormTokens('leads');
  const formRef = useRef<HTMLFormElement>(null);

  function validate(): boolean {
    const errs: typeof fieldErrors = {};
    if (name.trim() === '') errs.name = FORM_MESSAGES.needName;
    if (!isEmail(email)) errs.email = FORM_MESSAGES.needEmail;
    if (!consent) errs.consent = FORM_MESSAGES.needConsent;
    setFieldErrors(errs);
    // §CS-UX.3: foco al primer control inválido tras pintar los `aria-invalid`.
    if (Object.keys(errs).length > 0) requestAnimationFrame(() => focusFirstInvalid(formRef.current));
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
    <form ref={formRef} className="flex flex-col gap-6" onSubmit={onSubmit} onFocus={prime} noValidate>
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

      {/* ⭐M-89: casilla de rifa PROPIA y DESMARCADA, con enlace a las bases (separada de privacidad). */}
      <label className="flex items-start gap-3 text-[13px] leading-relaxed text-text">
        <input
          type="checkbox"
          className="mt-1 h-5 w-5 shrink-0 accent-[color:var(--color-accent)]"
          checked={raffle}
          onChange={(e) => setRaffle(e.target.checked)}
        />
        <span>
          Quiero participar en la rifa (set 30.º aniversario Pokémon)
          <span className="mt-0.5 block text-muted">
            Hay que estar presente el día del evento para ganar.{' '}
            <a href="#rifa" className="text-accent underline underline-offset-2">
              Ver bases de la rifa
            </a>
            .
          </span>
        </span>
      </label>

      {/* ⭐M-89: privacidad obligatoria = SOLO privacidad (⛔ no fuerza aceptar las bases de la rifa). */}
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
        y acepto el tratamiento de mis datos.
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
