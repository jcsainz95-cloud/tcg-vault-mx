'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { CARD_SHOW, type CardShowDayId } from '@/content/card-show';
import { submitPlayer } from '@/lib/card-show-api';
import { PrivacyMini } from './PrivacyMini';
import {
  FORM_MESSAGES,
  Honeypot,
  PrivacyCheckbox,
  SuccessPanel,
  errorMessage,
  isEmail,
  isPlayerId,
  readAttribution,
  withFormToken,
} from './form-shared';

type DaySel = CardShowDayId | 'both' | '';

/**
 * Formulario de PREINSCRIPCIÓN al torneo (RONDA_0 §6.B, API_CONTRACT §CARDSHOW.3/.5/.6/.12).
 * Día (sat/sun/«los dos»), nombre del jugador, Player ID (solo dígitos), correo, menor +
 * consentimiento del tutor, casilla de privacidad, honeypot. POST neutro a `/card-show/players`;
 * doble opt-in por correo.
 *
 * «los dos» ⇒ DOS filas (§CARDSHOW.12): dos POST (sat y sun), cada uno con su propio token de un
 * solo uso; el backend manda UN solo correo de confirmación por buzón.
 *
 * Si el torneo está CERRADO (cupo lleno o pasó el cierre) ⇒ no acepta envíos y lo dice (⛔ nunca
 * «disponible»). El estado real llega con los datos de Jakomi; hoy se lee de `content/card-show.ts`.
 */
export function TorneoForm() {
  const cerrado = CARD_SHOW.torneo.estado === 'cerrada';
  const [day, setDay] = useState<DaySel>('');
  const [playerName, setPlayerName] = useState('');
  const [playerId, setPlayerId] = useState('');
  const [email, setEmail] = useState('');
  const [isMinor, setIsMinor] = useState(false);
  const [guardian, setGuardian] = useState(false);
  const [consent, setConsent] = useState(false);
  const [hp, setHp] = useState('');
  const [status, setStatus] = useState<'idle' | 'pending' | 'success' | 'error'>('idle');
  const [errorText, setErrorText] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{
    day?: string;
    playerName?: string;
    playerId?: string;
    email?: string;
    guardian?: string;
    consent?: string;
  }>({});

  function validate(): boolean {
    const errs: typeof fieldErrors = {};
    if (day === '') errs.day = FORM_MESSAGES.needDay;
    if (playerName.trim() === '') errs.playerName = FORM_MESSAGES.needName;
    if (!isPlayerId(playerId)) errs.playerId = FORM_MESSAGES.needPlayerId;
    if (!isEmail(email)) errs.email = FORM_MESSAGES.needEmail;
    if (isMinor && !guardian) errs.guardian = FORM_MESSAGES.needGuardian;
    if (!consent) errs.consent = FORM_MESSAGES.needConsent;
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorText(null);
    if (cerrado || !validate()) return;
    setStatus('pending');
    const days: CardShowDayId[] = day === 'both' ? ['sat', 'sun'] : [day as CardShowDayId];
    const attribution = readAttribution();
    try {
      for (const d of days) {
        await withFormToken('players', (token) =>
          submitPlayer({
            token,
            day: d,
            playerName: playerName.trim(),
            playerId: playerId.trim(),
            email: email.trim(),
            isMinor,
            guardianConsent: isMinor ? guardian : undefined,
            consent,
            website: hp,
            ...attribution,
          }),
        );
      }
      setStatus('success');
    } catch (err) {
      setErrorText(errorMessage(err));
      setStatus('error');
    }
  }

  if (cerrado) {
    return (
      <div className="rule-note py-3">
        <p className="eyebrow">Preinscripción</p>
        <p className="mt-2 font-medium text-text">Cerrada</p>
        <p className="mt-1 text-[13px] text-muted">La preinscripción al torneo está cerrada por ahora.</p>
      </div>
    );
  }

  if (status === 'success') {
    return <SuccessPanel title="¡Listo! Casi terminas tu preinscripción." />;
  }

  return (
    <form className="flex flex-col gap-6" onSubmit={onSubmit} noValidate>
      <fieldset>
        <legend className="eyebrow">Día del torneo</legend>
        <div className="mt-3 flex flex-col gap-2">
          {CARD_SHOW.torneo.dias.map((d) => (
            <label key={d.id} className="flex items-center gap-3 text-[13px] text-text">
              <input
                type="radio"
                name="cs-day"
                value={d.id}
                checked={day === d.id}
                onChange={() => setDay(d.id)}
                className="h-5 w-5 accent-[color:var(--color-accent)]"
              />
              {d.label}
            </label>
          ))}
          <label className="flex items-center gap-3 text-[13px] text-text">
            <input
              type="radio"
              name="cs-day"
              value="both"
              checked={day === 'both'}
              onChange={() => setDay('both')}
              className="h-5 w-5 accent-[color:var(--color-accent)]"
            />
            Los dos días
          </label>
        </div>
        {fieldErrors.day && <p className="mt-2 font-mono text-xs text-accent">{fieldErrors.day}</p>}
      </fieldset>

      <Input
        label="Nombre del jugador"
        autoComplete="name"
        value={playerName}
        onChange={(e) => setPlayerName(e.target.value)}
        error={fieldErrors.playerName}
      />

      <Input
        label="Player ID"
        inputMode="numeric"
        autoComplete="off"
        hint="Solo dígitos."
        value={playerId}
        onChange={(e) => setPlayerId(e.target.value.replace(/\D/g, ''))}
        error={fieldErrors.playerId}
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

      <div className="flex flex-col gap-3">
        <label className="flex items-center gap-3 text-[13px] text-text">
          <input
            type="checkbox"
            checked={isMinor}
            onChange={(e) => setIsMinor(e.target.checked)}
            className="h-5 w-5 accent-[color:var(--color-accent)]"
          />
          El jugador es menor de edad
        </label>
        {isMinor && (
          <PrivacyCheckbox checked={guardian} onChange={setGuardian} error={fieldErrors.guardian}>
            Soy el padre, madre o tutor del jugador y doy mi consentimiento para su preinscripción.
          </PrivacyCheckbox>
        )}
      </div>

      <PrivacyCheckbox checked={consent} onChange={setConsent} error={fieldErrors.consent}>
        He leído el{' '}
        <Link href="/privacidad" className="text-accent underline underline-offset-2">
          aviso de privacidad
        </Link>{' '}
        y acepto el tratamiento de mis datos para la preinscripción.
      </PrivacyCheckbox>

      <Honeypot value={hp} onChange={setHp} />

      <div>
        <Button type="submit" variant="accent" loading={status === 'pending'}>
          Preinscríbete
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
