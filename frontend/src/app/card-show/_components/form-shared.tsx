'use client';

import { forwardRef, useCallback, useEffect, useId, useRef } from 'react';
import { cn } from '@/lib/cn';
import {
  CardShowApiError,
  getFormToken,
  type BaseSubmitBody,
  type FormPurpose,
} from '@/lib/card-show-api';

/**
 * Piezas compartidas por los dos formularios del Card Show (API_CONTRACT §CARDSHOW.3/.5/.11,
 * RONDA_0 §6). Diseño: sistema editorial (reglas, no cajas; etiquetas mono; foco rojo de marca).
 */

/** Mensajes de estado EXACTOS que pide marketing (§CARDSHOW.5 + encargo). */
export const FORM_MESSAGES = {
  expired: 'Formulario caducado: La página lleva mucho rato abierta. Recarga la página e inténtalo otra vez.',
  rateLimited: 'Hay demasiados intentos en este momento. Espera unos minutos y vuelve a intentarlo.',
  generic: 'No pudimos procesar tu registro. Inténtalo de nuevo en un momento.',
  success: 'Revisa tu correo: te enviamos un enlace para confirmar tu registro. (Si no lo ves, revisa la carpeta de spam.)',
  needEmail: 'Escribe un correo válido.',
  needConsent: 'Marca la casilla del aviso de privacidad para continuar.',
  needInteres: 'Elige al menos una opción.',
  needDay: 'Elige el día.',
  needName: 'Escribe tu nombre.',
  needNameOrBrand: 'Escribe tu nombre o el de tu marca.',
  needPlayerName: 'Escribe el nombre del jugador.',
  needPlayerId: 'El Player ID debe tener solo dígitos.',
  needPhone: 'Escribe un teléfono válido (10 dígitos).',
  needGame: 'Elige el juego del torneo.',
  needRaffleTerms: 'Para entrar a la rifa, acepta las bases.',
  needGuardian: 'Si el jugador es menor de edad, el padre/madre o tutor debe dar su consentimiento.',
} as const;

/** Un correo válido a grandes rasgos (el backend hace la validación autoritativa, §CARDSHOW.11). */
export function isEmail(v: string): boolean {
  return /.+@.+\..+/.test(v.trim()) && v.trim().length <= 254;
}

/** Player ID: SOLO dígitos, longitud acotada (§CARDSHOW.12). */
export function isPlayerId(v: string): boolean {
  return /^\d{1,12}$/.test(v.trim());
}

/**
 * Teléfono MX válido a grandes rasgos (el backend normaliza y valida, §CARDSHOW.1b): 10 dígitos tras
 * quitar `+52`/`52` y separadores ` -()`. Entrada ≤ 20 chars.
 */
export function isPhone(v: string): boolean {
  if (v.trim().length > 20) return false;
  const digits = v.replace(/[\s\-()]/g, '').replace(/^\+?52/, '');
  return /^\d{10}$/.test(digits);
}

/** Lee los `utm_*` y el host del referer SIN query ni ruta (§CARDSHOW.1), para la atribución. */
export function readAttribution(): Pick<
  BaseSubmitBody,
  'utmSource' | 'utmMedium' | 'utmCampaign' | 'utmContent' | 'referrerHost'
> {
  if (typeof window === 'undefined') return {};
  const q = new URLSearchParams(window.location.search);
  let referrerHost: string | undefined;
  try {
    if (document.referrer) referrerHost = new URL(document.referrer).host || undefined;
  } catch {
    referrerHost = undefined;
  }
  return {
    utmSource: q.get('utm_source') ?? undefined,
    utmMedium: q.get('utm_medium') ?? undefined,
    utmCampaign: q.get('utm_campaign') ?? undefined,
    utmContent: q.get('utm_content') ?? undefined,
    referrerHost,
  };
}

/**
 * Tiempos del token anti-bot (§CARDSHOW.5). El backend descarta en silencio (`too_fast`) cualquier
 * POST cuyo token tenga <2 s de edad (`FORM_TOKEN_MIN_AGE_MS`). Por eso NO pedimos el token en el
 * submit (sería recién emitido), sino al MONTAR el formulario; para cuando el humano envía, el token
 * ya pasó los 2 s. `slackMs` es el margen por encima de los 2 s al pedir uno en caliente.
 *
 * Se expone como objeto mutable SOLO para que las pruebas lo pongan en 0 y no esperen de verdad; en
 * producción conserva los valores reales.
 */
export const formTokenTiming = { minAgeMs: 2_000, slackMs: 150 };

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();
}

/** Pide un token FRESCO y espera a que supere el min-age antes de devolverlo (evita `too_fast`). */
async function freshAgedToken(purpose: FormPurpose): Promise<string> {
  const token = await getFormToken(purpose);
  await sleep(formTokenTiming.minAgeMs + formTokenTiming.slackMs);
  return token;
}

/**
 * Hook de tokens de formulario. Al montar, PRE-CARGA un pool de hasta `poolSize` tokens (uno por
 * cada POST que el formulario pueda hacer: p.ej. 3 chips en leads, 2 días en players). Cada token es
 * de un solo uso (§CARDSHOW.5): un POST = un token.
 *
 * `withToken(run)` toma un token del pool (ya con ≥2 s de edad en el uso real), ejecuta `run(token)`
 * y, si caducó (400 FORM_EXPIRED, TTL 30 min), pide UNO FRESCO —esperando de nuevo el min-age de 2 s
 * para no caer en `too_fast`— y reintenta UNA vez sin borrar lo tecleado. Si el reintento también
 * caduca, sube `FORM_EXPIRED` a la UI. Los demás errores (429, 413, 400 validación) se propagan.
 */
export function useFormTokens(purpose: FormPurpose, poolSize: number): {
  withToken: (run: (token: string) => Promise<void>) => Promise<void>;
} {
  const poolRef = useRef<{ token: string; fetchedAt: number }[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Rellena el pool al montar; si un prefetch falla, el submit lo pide en caliente.
      while (!cancelled && poolRef.current.length < poolSize) {
        try {
          const token = await getFormToken(purpose);
          if (cancelled) return;
          poolRef.current.push({ token, fetchedAt: Date.now() });
        } catch {
          return;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [purpose, poolSize]);

  // Devuelve un token con ≥2 s de edad garantizada: del pool (ya añejo en el uso real) o, si el pool
  // está vacío (más POSTs que tokens o prefetch aún en vuelo), uno fresco esperando el min-age.
  const takeAged = useCallback(async (): Promise<string> => {
    const entry = poolRef.current.shift();
    if (!entry) return freshAgedToken(purpose);
    const age = Date.now() - entry.fetchedAt;
    await sleep(formTokenTiming.minAgeMs - age + formTokenTiming.slackMs);
    return entry.token;
  }, [purpose]);

  const withToken = useCallback(
    async (run: (token: string) => Promise<void>): Promise<void> => {
      const token = await takeAged();
      try {
        await run(token);
      } catch (e) {
        if (e instanceof CardShowApiError && e.status === 400 && e.code === 'FORM_EXPIRED') {
          const fresh = await freshAgedToken(purpose);
          await run(fresh); // si vuelve a caducar, sube a la UI → mensaje «caducado»
          return;
        }
        throw e;
      }
    },
    [purpose, takeAged],
  );

  return { withToken };
}

/** Traduce un error del alta al texto de pantalla (§CARDSHOW.5). */
export function errorMessage(e: unknown): string {
  if (e instanceof CardShowApiError) {
    if (e.status === 429) return FORM_MESSAGES.rateLimited;
    if (e.status === 400 && e.code === 'FORM_EXPIRED') return FORM_MESSAGES.expired;
  }
  return FORM_MESSAGES.generic;
}

/**
 * Honeypot (§CARDSHOW.13): campo señuelo para bots. OCULTO para humanos y lectores de pantalla
 * (`aria-hidden` + `tabIndex=-1` + fuera de flujo), y SIN autocompletar del navegador/iOS/Android
 * (`autoComplete="off"`, `name` genérico que no dispara heurísticas de autollenado). Un humano no
 * lo ve ni lo enfoca; un bot que rellena todos los campos lo llena ⇒ 202 silencioso en el backend.
 */
export const Honeypot = forwardRef<HTMLInputElement, { value: string; onChange: (v: string) => void }>(
  function Honeypot({ value, onChange }, ref) {
    return (
      <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, overflow: 'hidden' }}>
        <label htmlFor="cs-website-url">No llenar este campo</label>
        <input
          ref={ref}
          id="cs-website-url"
          type="text"
          name="website"
          tabIndex={-1}
          autoComplete="off"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    );
  },
);

/** Casilla de privacidad (obligatoria). El `children` lleva el texto + enlace al aviso. */
export function PrivacyCheckbox({
  checked,
  onChange,
  children,
  error,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: React.ReactNode;
  error?: string;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="flex items-start gap-3 text-[13px] leading-relaxed text-text">
        <input
          id={id}
          type="checkbox"
          className="mt-1 h-5 w-5 shrink-0 accent-[color:var(--color-accent)]"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-err` : undefined}
        />
        <span>{children}</span>
      </label>
      {error && (
        <p id={`${id}-err`} className="mt-2 font-mono text-xs text-accent">
          {error}
        </p>
      )}
    </div>
  );
}

/** Chip seleccionable (interés). Zona táctil ≥44px, estado por `aria-pressed` + texto, no por color solo. */
export function Chip({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        'min-h-[44px] border px-4 py-2 text-[11px] uppercase leading-none tracking-label transition-colors',
        pressed ? 'border-text bg-text text-primary-fg' : 'border-border-strong text-text hover:border-text',
      )}
    >
      {children}
    </button>
  );
}

/** Pantalla de éxito del doble opt-in: «revisa tu correo» (§CARDSHOW.6). */
export function SuccessPanel({ title }: { title: string }) {
  return (
    <div role="status" className="rule-note py-3">
      <p className="font-medium text-text">{title}</p>
      <p className="mt-2 text-[13px] leading-relaxed text-muted">{FORM_MESSAGES.success}</p>
    </div>
  );
}
