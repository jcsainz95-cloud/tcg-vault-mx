'use client';

import { forwardRef, useId } from 'react';
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
  needName: 'Escribe el nombre del jugador.',
  needPlayerId: 'El Player ID debe tener solo dígitos.',
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
 * Pide un token (§CARDSHOW.5), ejecuta `run(token)` y, si el token caducó (400 FORM_EXPIRED),
 * pide OTRO y reintenta UNA vez sin borrar lo tecleado. Si el reintento también caduca, lanza
 * `FORM_EXPIRED` para que la UI pinte el mensaje de «formulario caducado». El resto de errores
 * (429, 413, 400 de validación) se propagan tal cual para que la UI elija el texto.
 */
export async function withFormToken(purpose: FormPurpose, run: (token: string) => Promise<void>): Promise<void> {
  const token = await getFormToken(purpose);
  try {
    await run(token);
  } catch (e) {
    if (e instanceof CardShowApiError && e.status === 400 && e.code === 'FORM_EXPIRED') {
      const fresh = await getFormToken(purpose);
      await run(fresh); // si vuelve a lanzar FORM_EXPIRED, sube a la UI → mensaje «caducado»
      return;
    }
    throw e;
  }
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
