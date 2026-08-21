'use client';

import { useId } from 'react';
import { cn } from '@/lib/cn';

/**
 * Logo TCG HUNT — reconstrucción vectorial oficial (DESIGN_SYSTEM §17.1, v1.7.1, P-21).
 *
 * Es una RETÍCULA de mira de rifle (scope reticle) y la regla de oro es que ningún
 * trazo pisa a otro: cruz SEGMENTADA en cuatro líneas independientes (la izquierda
 * la más larga; la vertical superior sobresale más que la inferior), anillos
 * dibujados como 4 arcos con hueco en cada cardinal (12° exterior / 20° interior en
 * el lockup) por donde pasan las líneas, y punto central anillado AISLADO.
 *
 * Cuatro variantes normativas:
 *  - `lockup`       (§17.1a) retícula + wordmark dominante; retícula en degradado
 *                   diagonal #B31217→#4A0D0D y wordmark en rampa corta de vino
 *                   #6E1013→#4A0D0D (`--hunt-wine-up`→`--hunt-wine`).
 *  - `lockup-dark`  (§17.1c) para paneles de tinta: rampa aclarada #F0685F→#D0362C
 *                   y wordmark en papel sólido (el degradado claro está PROHIBIDO
 *                   sobre tinta, ~2.5:1 — tabla §17.2).
 *  - `mark` / `mark-dark` (§17.1b) solo-mira cuadrada (topbar, sellos, apple-touch).
 *  - `micro`        (§17.1d) glifo simplificado `currentColor` para <28px (badge
 *                   BOUNTY, usos inline): anillo único CERRADO (los gaps no leen a
 *                   ese tamaño) pero cruz segmentada y punto aislado — la firma.
 *
 * Tamaños mínimos (§17.3 v1.7.1): lockup ≥160px de ancho; solo-mira ≥28px; por
 * debajo de 28px SIEMPRE el micro. Los `id` de gradiente se derivan de `useId()`
 * para montar varias instancias sin ids duplicados en el DOM.
 *
 * El wordmark usa `--font-brand` (Montserrat 700, §17.1e) con fallback declarado
 * Montserrat → Archivo → system-ui. Métricas a cotejar con el PNG original cuando
 * el humano lo suba a `frontend/public/branding/` (§17.5.1).
 */

export type LogoTcgHuntVariant = 'lockup' | 'lockup-dark' | 'mark' | 'mark-dark' | 'micro';

const STOPS = {
  light: { from: '#B31217', to: '#4A0D0D' },
  dark: { from: '#F0685F', to: '#D0362C' },
  // Rampa corta del wordmark claro (§17.1a): vino casi plano.
  wordmark: { from: '#6E1013', to: '#4A0D0D' },
} as const;

// En el DOM la familia de next/font solo existe vía la variable CSS (el nombre
// interno va hasheado): var(--font-brand) primero, luego los fallbacks del DS.
const BRAND_FONT = 'var(--font-brand), Montserrat, Archivo, system-ui, sans-serif';

export interface LogoTcgHuntProps {
  variant?: LogoTcgHuntVariant;
  /**
   * Lado en px para las variantes cuadradas (`mark`, `mark-dark`, `micro`).
   * Los lockups (ratio 480:330) se dimensionan por `className` (p. ej. `w-[300px]`).
   */
  size?: number;
  /**
   * true = decorativo (`aria-hidden`); el texto accesible lo porta el contenedor
   * (p. ej. el enlace con `aria-label="TCG HUNT — inicio"`). `micro` es SIEMPRE
   * decorativo (§17.1d).
   */
  decorative?: boolean;
  className?: string;
}

export function LogoTcgHunt({
  variant = 'lockup',
  size,
  decorative = false,
  className,
}: LogoTcgHuntProps) {
  // useId trae caracteres no válidos para IRIs de SVG (url(#…)): se sanea.
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');

  if (variant === 'micro') return <HuntMarkMicro size={size ?? 16} className={className} />;

  const dark = variant === 'lockup-dark' || variant === 'mark-dark';
  const stops = dark ? STOPS.dark : STOPS.light;
  const gId = `hunt-g-${uid}`;
  const wmId = `hunt-wm-${uid}`;
  const stroke = `url(#${gId})`;
  const a11y = decorative
    ? ({ 'aria-hidden': true } as const)
    : ({
        role: 'img',
        'aria-label':
          variant === 'lockup' || variant === 'lockup-dark'
            ? 'TCG HUNT — tcghunt.mx'
            : 'TCG HUNT',
      } as const);

  if (variant === 'mark' || variant === 'mark-dark') {
    // (b) solo-mira cuadrada: misma gramática de retícula (cruz segmentada, claro
    // de 12px alrededor del punto; anillos con gap 16°/28°; arcos con cap plano).
    return (
      <svg
        viewBox="0 0 128 128"
        width={size}
        height={size}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={className}
        {...a11y}
      >
        <defs>
          {/* degradado diagonal del conjunto: arriba/izquierda → abajo/derecha */}
          <linearGradient id={gId} gradientUnits="userSpaceOnUse" x1="1" y1="2" x2="124" y2="122">
            <stop offset="0" stopColor={stops.from} />
            <stop offset="1" stopColor={stops.to} />
          </linearGradient>
        </defs>
        {/* cruz segmentada (centro 64,64): izquierda la más larga; superior > inferior */}
        <line x1="1" y1="64" x2="52" y2="64" stroke={stroke} strokeWidth="8" strokeLinecap="round" />
        <line x1="76" y1="64" x2="124" y2="64" stroke={stroke} strokeWidth="8" strokeLinecap="round" />
        <line x1="64" y1="2" x2="64" y2="52" stroke={stroke} strokeWidth="8" strokeLinecap="round" />
        <line x1="64" y1="76" x2="64" y2="122" stroke={stroke} strokeWidth="8" strokeLinecap="round" />
        {/* anillo exterior r=36: 4 arcos, gap 16°/cardinal */}
        <path d="M99.65 69.01 A36 36 0 0 1 69.01 99.65" stroke={stroke} strokeWidth="8" />
        <path d="M58.99 99.65 A36 36 0 0 1 28.35 69.01" stroke={stroke} strokeWidth="8" />
        <path d="M28.35 58.99 A36 36 0 0 1 58.99 28.35" stroke={stroke} strokeWidth="8" />
        <path d="M69.01 28.35 A36 36 0 0 1 99.65 58.99" stroke={stroke} strokeWidth="8" />
        {/* anillo interior r=22: 4 arcos, gap 28°/cardinal */}
        <path d="M85.35 69.32 A22 22 0 0 1 69.32 85.35" stroke={stroke} strokeWidth="7" />
        <path d="M58.68 85.35 A22 22 0 0 1 42.65 69.32" stroke={stroke} strokeWidth="7" />
        <path d="M42.65 58.68 A22 22 0 0 1 58.68 42.65" stroke={stroke} strokeWidth="7" />
        <path d="M69.32 42.65 A22 22 0 0 1 85.35 58.68" stroke={stroke} strokeWidth="7" />
        {/* punto central anillado, aislado */}
        <circle cx="64" cy="64" r="5" stroke={stroke} strokeWidth="4.5" />
      </svg>
    );
  }

  // (a) lockup claro / (c) lockup para fondo oscuro. Misma retícula (centro 240,112;
  // anillos r=56 gap 12° y r=34 gap 20°; claro de 18px alrededor del punto); cambia
  // la rampa y el tratamiento del wordmark (papel sólido sobre tinta, §17.2).
  const wordmarkFill = dark ? '#F4F1EA' : `url(#${wmId})`;
  const mxFill = dark ? STOPS.dark.from : STOPS.light.to;

  return (
    <svg
      viewBox="0 0 480 330"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      {...a11y}
    >
      <defs>
        {/* degradado del conjunto: rojo arriba/izquierda → vino abajo/derecha (diagonal) */}
        <linearGradient id={gId} gradientUnits="userSpaceOnUse" x1="10" y1="8" x2="452" y2="198">
          <stop offset="0" stopColor={stops.from} />
          <stop offset="1" stopColor={stops.to} />
        </linearGradient>
        {!dark && (
          // wordmark: vino oscuro casi plano, leve gradiente
          <linearGradient id={wmId} gradientUnits="userSpaceOnUse" x1="0" y1="232" x2="0" y2="290">
            <stop offset="0" stopColor={STOPS.wordmark.from} />
            <stop offset="1" stopColor={STOPS.wordmark.to} />
          </linearGradient>
        )}
      </defs>

      {/* RETÍCULA (centro 240,112) — cruz SEGMENTADA: nada pisa nada */}
      <line x1="10" y1="112" x2="222" y2="112" stroke={stroke} strokeWidth="7" strokeLinecap="round" />
      <line x1="258" y1="112" x2="452" y2="112" stroke={stroke} strokeWidth="7" strokeLinecap="round" />
      <line x1="240" y1="8" x2="240" y2="94" stroke={stroke} strokeWidth="7" strokeLinecap="round" />
      <line x1="240" y1="130" x2="240" y2="198" stroke={stroke} strokeWidth="7" strokeLinecap="round" />

      {/* anillo exterior r=56: 4 arcos, gap de 12° centrado en cada cardinal (cap plano) */}
      <path d="M295.69 117.85 A56 56 0 0 1 245.85 167.69" stroke={stroke} strokeWidth="7" />
      <path d="M234.15 167.69 A56 56 0 0 1 184.31 117.85" stroke={stroke} strokeWidth="7" />
      <path d="M184.31 106.15 A56 56 0 0 1 234.15 56.31" stroke={stroke} strokeWidth="7" />
      <path d="M245.85 56.31 A56 56 0 0 1 295.69 106.15" stroke={stroke} strokeWidth="7" />

      {/* anillo interior r=34: 4 arcos, gap de 20° centrado en cada cardinal (cap plano) */}
      <path d="M273.48 117.90 A34 34 0 0 1 245.90 145.48" stroke={stroke} strokeWidth="6.5" />
      <path d="M234.10 145.48 A34 34 0 0 1 206.52 117.90" stroke={stroke} strokeWidth="6.5" />
      <path d="M206.52 106.10 A34 34 0 0 1 234.10 78.52" stroke={stroke} strokeWidth="6.5" />
      <path d="M245.90 78.52 A34 34 0 0 1 273.48 106.10" stroke={stroke} strokeWidth="6.5" />

      {/* punto central anillado (centro hueco) — AISLADO, nada lo toca */}
      <circle cx="240" cy="112" r="8" stroke={stroke} strokeWidth="5.5" />

      {/* WORDMARK dominante: Montserrat 700 (--font-brand, §17.1e) */}
      <text
        x="240"
        y="278"
        textAnchor="middle"
        fontSize="66"
        fontWeight="700"
        letterSpacing="9"
        fill={wordmarkFill}
        style={{ fontFamily: BRAND_FONT }}
      >
        TCG HUNT
      </text>
      {/* ".mx" alineado al borde derecho del wordmark */}
      <text
        x="452"
        y="312"
        textAnchor="end"
        fontSize="24"
        fontWeight="600"
        letterSpacing="0.5"
        fill={mxFill}
        style={{ fontFamily: BRAND_FONT }}
      >
        .mx
      </text>
    </svg>
  );
}

/**
 * Glifo micro (§17.1d, <28px): anillo único CERRADO (a 16px un gap de 12–20° mide
 * <1px y no lee) + cruz SEGMENTADA + punto sólido aislado — la interrupción
 * alrededor del centro sí lee y es la firma de la retícula. `currentColor`, sin
 * gradiente. Es el glifo oficial del badge BOUNTY (§16.7b, sustituye al `crosshair`
 * de lucide) y de cualquier uso inline. Siempre `aria-hidden` (el texto vecino
 * porta el significado).
 */
export function HuntMarkMicro({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={cn('shrink-0', className)}
    >
      {/* cruz segmentada: 4 segmentos, claro de 4px alrededor del punto; inferior más corta */}
      <line x1="0.75" y1="12" x2="8" y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <line x1="16" y1="12" x2="23.25" y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <line x1="12" y1="1" x2="12" y2="8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <line x1="12" y1="16" x2="12" y2="22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      {/* anillo único CERRADO (simplificación micro: sin gaps) */}
      <circle cx="12" cy="12" r="6.5" stroke="currentColor" strokeWidth="2" />
      {/* punto sólido aislado */}
      <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  );
}
