'use client';

import { useRef, useState } from 'react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { CARD_SHOW, CARD_SHOW_GAMES, type CardShowDayId, type CardShowGame } from '@/content/card-show';
import { submitPlayer } from '@/lib/card-show-api';
import { PrivacyMini } from './PrivacyMini';
import {
  FORM_MESSAGES,
  Honeypot,
  PrivacyCheckbox,
  SuccessPanel,
  errorMessage,
  focusFirstInvalid,
  isEmail,
  isPlayerId,
  readAttribution,
  useFormTokens,
} from './form-shared';

type DaySel = CardShowDayId | 'both' | '';

/**
 * Formulario de PREINSCRIPCIÓN al torneo (API_CONTRACT §CARDSHOW.3/.5/.6/.12, v1.96 M-84).
 *
 * ⭐ `game` decide la forma (decisión del dueño 2026-10-17):
 *  - **Pokémon = FORMAL** ⇒ pide **Player ID** (solo dígitos, obligatorio).
 *  - **Riftbound/Lorcana = LIGERA** ⇒ ⛔ sin Player ID (sólo interés por día/juego).
 *
 * Día (sat/sun/«los dos»), nombre del jugador, correo, menor + consentimiento del tutor, casilla de
 * privacidad, honeypot. POST neutro a `/card-show/players`; doble opt-in por correo. «los dos» ⇒ DOS
 * filas (§CARDSHOW.12): dos POST, cada uno con su propio token de un solo uso.
 */
export function TorneoForm() {
  const cerrado = CARD_SHOW.torneos.estado === 'cerrada';
  const { prime, withToken } = useFormTokens('players');
  const [game, setGame] = useState<CardShowGame | ''>('');
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
    game?: string;
    day?: string;
    playerName?: string;
    playerId?: string;
    email?: string;
    guardian?: string;
    consent?: string;
  }>({});

  const isPokemon = game === 'pokemon';
  const formRef = useRef<HTMLFormElement>(null);

  function validate(): boolean {
    const errs: typeof fieldErrors = {};
    if (game === '') errs.game = FORM_MESSAGES.needGame;
    if (day === '') errs.day = FORM_MESSAGES.needDay;
    if (playerName.trim() === '') errs.playerName = FORM_MESSAGES.needPlayerName;
    // Player ID SÓLO es obligatorio (y sólo se valida) para Pokémon (FORMAL).
    if (isPokemon && !isPlayerId(playerId)) errs.playerId = FORM_MESSAGES.needPlayerId;
    if (!isEmail(email)) errs.email = FORM_MESSAGES.needEmail;
    if (isMinor && !guardian) errs.guardian = FORM_MESSAGES.needGuardian;
    if (!consent) errs.consent = FORM_MESSAGES.needConsent;
    setFieldErrors(errs);
    // §CS-UX.3: foco al primer control inválido tras pintar los `aria-invalid`.
    if (Object.keys(errs).length > 0) requestAnimationFrame(() => focusFirstInvalid(formRef.current));
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
        await withToken((token) =>
          submitPlayer({
            formToken: token,
            game: game as CardShowGame,
            day: d,
            playerName: playerName.trim(),
            // ⛔ Player ID SÓLO para Pokémon; para los demás juegos no se envía (§CARDSHOW.12).
            playerId: isPokemon ? playerId.trim() : undefined,
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

  // §CS-UX.3: el error del grupo de día se asocia al fieldset y a CADA radio; el primer radio lleva
  // `aria-invalid` (el fieldset no es enfocable) para que `focusFirstInvalid` caiga ahí.
  const dayError = fieldErrors.day;
  const dayDescribedBy = dayError ? 'cs-day-error' : undefined;

  return (
    <form ref={formRef} className="flex flex-col gap-6" onSubmit={onSubmit} onFocus={prime} noValidate>
      <Select
        label="Juego"
        placeholder="Elige una opción"
        required
        value={game}
        onChange={(e) => setGame(e.target.value as CardShowGame | '')}
        options={CARD_SHOW_GAMES.map((g) => ({ value: g.id, label: g.label }))}
        error={fieldErrors.game}
      />

      <fieldset aria-describedby={dayDescribedBy}>
        <legend className="eyebrow">Día del torneo (obligatorio)</legend>
        <div className="mt-3 flex flex-col gap-2">
          {CARD_SHOW.torneos.dias.map((d, i) => (
            <label key={d.id} className="flex items-center gap-3 text-[13px] text-text">
              <input
                type="radio"
                name="cs-day"
                value={d.id}
                checked={day === d.id}
                onChange={() => setDay(d.id)}
                className="h-5 w-5 accent-[color:var(--color-accent)]"
                aria-invalid={dayError && i === 0 ? true : undefined}
                aria-describedby={dayDescribedBy}
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
              aria-describedby={dayDescribedBy}
            />
            Los dos días
          </label>
        </div>
        {dayError && (
          <p id="cs-day-error" className="mt-2 flex items-center gap-1.5 font-mono text-xs text-accent">
            {dayError}
          </p>
        )}
      </fieldset>

      <Input
        label="Nombre del jugador"
        autoComplete="name"
        value={playerName}
        onChange={(e) => setPlayerName(e.target.value)}
        error={fieldErrors.playerName}
      />

      {/* Player ID SÓLO para Pokémon (FORMAL); los demás juegos son preinscripción LIGERA sin ID. */}
      {isPokemon && (
        <Input
          label="Player ID"
          inputMode="numeric"
          autoComplete="off"
          hint="Solo dígitos. Lo pide el torneo de Pokémon."
          value={playerId}
          onChange={(e) => setPlayerId(e.target.value.replace(/\D/g, ''))}
          error={fieldErrors.playerId}
        />
      )}

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
        <a
          href={CARD_SHOW.footer.privacidadUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent underline underline-offset-2"
        >
          aviso de privacidad
        </a>{' '}
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
