/**
 * card-show.constants.ts — v1.93⟨cardshow⟩ (API_CONTRACT §CARDSHOW). Cifras del anti-abuso, TTLs y
 * nombres de variables de entorno. ⛔ NINGÚN dato real del evento vive aquí (estructura, no valores).
 * Los valores secretos (fecha/sede/precios/`CARD_SHOW_SUPPRESS_UNTIL`) entran por entorno, fuera del repo.
 */

// ── Nombres de variables de entorno (las declara/cablea devops; valores en Railway, §CARDSHOW.16) ──
export const ENV = {
  FORM_SECRET: 'CARD_SHOW_FORM_SECRET',
  LINK_SECRET: 'CARD_SHOW_LINK_SECRET',
  BUDGET_HOUR: 'CARD_SHOW_CONFIRM_BUDGET_HOUR',
  BUDGET_DAY: 'CARD_SHOW_CONFIRM_BUDGET_DAY',
  ALERT_EMAIL: 'CARD_SHOW_ALERT_EMAIL',
  SUPPRESS_UNTIL: 'CARD_SHOW_SUPPRESS_UNTIL',
  TRUST_PROXY_HOPS: 'TRUST_PROXY_HOPS',
  // El From/subdominio de envío propio de la landing (SPF/DKIM/DMARC lo prepara devops). ⛔ NUNCA hardcodeado.
  MAIL_FROM: 'CARD_SHOW_MAIL_FROM',
  // Reply-To de los correos de la landing (decisión del dueño: jsainz@tcghunt.mx). Devops confirma el env.
  MAIL_REPLY_TO: 'CARD_SHOW_MAIL_REPLY_TO',
  // Destinatarios INTERNOS del aviso al staff / resumen diario (coma-separados). Default a `jsainz@tcghunt.mx`.
  INTERNAL_RECIPIENTS: 'CARD_SHOW_INTERNAL_RECIPIENTS',
  // Base pública para construir los enlaces del correo (confirmar / «No fui yo» / aviso). Dominio propio.
  PUBLIC_BASE_URL: 'CARD_SHOW_PUBLIC_BASE_URL',
  // Cupo del torneo por día (dato de Jakomi; en staging = 2). Vacío ⇒ sin cupo conocido (no se recorta).
  TOURNAMENT_CAP_PER_DAY: 'CARD_SHOW_TOURNAMENT_CAP_PER_DAY',
  // Secreto del webhook de Resend (Svix, `whsec_…`). Lo cablea devops. ⛔ nunca en el repo.
  RESEND_WEBHOOK_SECRET: 'CARD_SHOW_RESEND_WEBHOOK_SECRET',
} as const;

/** Bandera de corte de envíos (C1 al 100 % / C6). Mientras esté puesta, las confirmaciones se retienen. */
export const SENDING_CUT_FLAG = 'sending:cut';

// Defaults de §CARDSHOW.7/.16 (ajustables por entorno). ⛔ No son datos del evento.
export const DEFAULT_BUDGET_HOUR = 150;
export const DEFAULT_BUDGET_DAY = 600;
export const DEFAULT_ALERT_EMAIL = 'jsainz@tcghunt.mx';
export const DEFAULT_TRUST_PROXY_HOPS = 1;

// ── Remitente de la landing (decisión del dueño 2026-10-16; devops confirma los env) ──
/** `From` sensato por defecto si no hay `CARD_SHOW_MAIL_FROM` ni `MAIL_FROM`. */
export const DEFAULT_MAIL_FROM = 'TCG HUNT <contacto@tcghunt.mx>';
/** `Reply-To` por defecto de los correos de la landing. */
export const DEFAULT_MAIL_REPLY_TO = 'jsainz@tcghunt.mx';
/** Destinatario interno principal (To) del aviso al staff / resumen diario. */
export const DEFAULT_INTERNAL_TO = 'jsainz@tcghunt.mx';
/** CC fijo del aviso interno al staff (copy del dueño). El From/Reply-To se añaden aparte. */
export const INTERNAL_NOTICE_CC = ['cardshow@jakomi.mx', 'scarranza@tcghunt.mx'];

// ── Token de formulario (L0-SEG-04, §CARDSHOW.5) ──
export const FORM_TOKEN_MIN_AGE_MS = 2_000; // POST < 2 s ⇒ demasiado rápido para un humano (silencioso 0/0)
export const FORM_TOKEN_MAX_AGE_MS = 2 * 60 * 60 * 1000; // > 2 h ⇒ 400 FORM_EXPIRED

// ── Doble opt-in (C4, §CARDSHOW.6) ──
export const LINK_TTL_LEAD_MS = 7 * 24 * 60 * 60 * 1000; // 7 d (leads)
export const LINK_TTL_SIGNUP_MS = 72 * 60 * 60 * 1000; // 72 h (torneo)

// ── Throttle por IP en Redis (C7, §CARDSHOW.4) ──
export const THROTTLE = {
  POST_PER_MIN: 5, // 5/min por IP en cada endpoint de POST
  POST_PER_HOUR: 20, // 20/h por IP en cada endpoint de POST
  GLOBAL_PER_MIN: 60, // 60/min global (todas las IP)
  FORM_TOKEN_PER_HOUR: 30, // 30/h por IP en GET /form-token (⇒ 429 en la 31.ª)
  CONFIRM_PER_MIN: 30, // 30/min por IP en /confirm,/unsubscribe,/cancel (⇒ 429 en la 31.ª)
} as const;
export const MIN_MS = 60_000;
export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;

// ── Tope por buzón (C2, §CARDSHOW.8) ──
export const MAILBOX = {
  UNCONFIRMED_MAX: 2, // buzón NO confirmado: máx 2 confirmaciones en toda la campaña
  UNCONFIRMED_GAP_MS: 24 * 60 * 60 * 1000, // separadas ≥ 24 h
  CONFIRMED_MAX_PER_DAY: 4, // buzón confirmado: máx 4 correos / 24 h (el 5.º no sale)
  DOMAIN_MAX_PER_DAY: 20, // tope por dominio no masivo: 20 / 24 h (el 21.º no sale)
  INTERNAL_MAX_PER_HOUR: 10, // avisos internos (vendedor/patrocinador/jsainz@): ≤ 10/h
  CONFIRMED_READD_WINDOW_MS: 24 * 60 * 60 * 1000, // re-alta de confirmado dentro de 24 h ⇒ 0 envíos
} as const;

/**
 * Dominios públicos masivos (freemail): un tope PLANO por dominio los convierte en un vector de DoS
 * contra sus usuarios legítimos — 20 envíos a cualquier `@gmail.com` en 24 h retendrían al 21.º
 * registro legítimo de Gmail. Se EXIMEN del tope por DOMINIO (C2, §CARDSHOW.8). Eximirlos es seguro:
 * el abuso desde esos buzones sigue acotado por el tope por BUZÓN (`reserveUnconfirmedSend`, 2/campaña,
 * con la clave canonicalizada que colapsa `+etiqueta` y puntos) y por el throttle por IP (C7). ⛔ El
 * tope por dominio existe para dominios PROPIOS/pequeños, donde 20 correos a un mismo dominio sí es señal
 * de abuso. Normalizados a minúsculas; incluye variantes `.com.mx` comunes en MX.
 */
export const PUBLIC_FREEMAIL_DOMAINS: ReadonlySet<string> = new Set([
  'gmail.com',
  'googlemail.com',
  'hotmail.com',
  'hotmail.com.mx',
  'outlook.com',
  'outlook.com.mx',
  'live.com',
  'live.com.mx',
  'msn.com',
  'yahoo.com',
  'yahoo.com.mx',
  'ymail.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'proton.me',
  'protonmail.com',
  'aol.com',
  'gmx.com',
  'zoho.com',
  'hey.com',
  'prodigy.net.mx',
]);

/** ¿`domain` es un freemail público (exento del tope por dominio)? Normaliza a minúsculas + trim. */
export function isPublicFreemailDomain(domain: string): boolean {
  return PUBLIC_FREEMAIL_DOMAINS.has(domain.trim().toLowerCase());
}

// ── Torneo (L0-SEG-02, §CARDSHOW.12) ──
export const TOURNAMENT = {
  MAX_PLAYERS_PER_MAILBOX_DAY: 4, // máx 4 playerId por buzón y día (el 5.º ⇒ 0 filas)
  MAX_PENDING_PER_PLAYER: 3, // máx 3 PENDING por playerId (la 4.ª ⇒ 0 filas)
} as const;

// ── Corte por webhooks de Resend (C6, §CARDSHOW.10) ──
export const WEBHOOK_CUT = {
  COMPLAINED_THRESHOLD: 2, // ≥ 2 quejas en 24 h ⇒ corte
  BOUNCED_THRESHOLD: 10, // ≥ 10 rebotes duros en 24 h ⇒ corte
  WINDOW_MS: 24 * 60 * 60 * 1000,
} as const;

// ── Validación de forma (§CARDSHOW.11.v) ──
export const MAX_BODY_BYTES = 4 * 1024; // > 4 KB ⇒ 413
export const MAX_EMAIL_LEN = 254; // > 254 ⇒ 400
export const MAX_PLAYER_ID_DIGITS = 12; // 13 dígitos ⇒ 400
export const MAX_PLAYER_NAME_LEN = 80;

// Propósitos disjuntos de los tokens de enlace (§CARDSHOW.6).
export const LINK_PURPOSES = ['confirm', 'cancel', 'unsubscribe'] as const;
export type LinkPurpose = (typeof LINK_PURPOSES)[number];

// Propósitos del token de formulario (§CARDSHOW.5).
export const FORM_PURPOSES = ['leads', 'players'] as const;
export type FormPurpose = (typeof FORM_PURPOSES)[number];

// El tipo de fila que ata un token de enlace (lead «Avísame» o preinscripción al torneo).
export const LINK_KINDS = ['lead', 'signup'] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

/** Asunto FIJO del correo de confirmación (C3). ⛔ Ningún dato tecleado, ⛔ ningún valor del evento. */
export const CONFIRM_SUBJECT = 'Confirma tu registro — TCG HUNT';

/** Cuerpo NEUTRO idéntico de todo caso silencioso (§CARDSHOW.3). Mismo código que el molde de captura. */
export const NEUTRAL_BODY = { ok: true } as const;
export const NEUTRAL_STATUS = 202;
