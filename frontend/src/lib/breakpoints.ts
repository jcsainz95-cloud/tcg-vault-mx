/**
 * DESIGN_SYSTEM §4.4 — los breakpoints del sistema, alineados a Tailwind (`tailwind.config.ts` NO
 * redefine `screens`, así que son los de fábrica; `breakpoints.test.ts` lo vigila con
 * `resolveConfig`). Es la ÚNICA fuente para un umbral en JS: cualquier `matchMedia`/`useMediaQuery`
 * que quiera «lo mismo que la clase `lg:`» lo pide aquí, nunca con un `1024` a mano — si el token
 * cambiara, un número suelto seguiría decidiendo otra cosa que el CSS.
 *
 * ⚠ Regla del sistema (§37.1a): el CONTENEDOR nunca se decide por JS (destello al hidratar, DOM
 * duplicado). Estos umbrales sirven para decisiones que no pintan —p. ej. a qué disparador vuelve el
 * foco— o para pruebas.
 */
export const BREAKPOINTS = {
  /** móvil grande / phablet */
  sm: 640,
  /** tablet vertical — umbral de layout del back-office junto a cajas */
  md: 768,
  /** tablet horizontal / laptop — sidebar admin fijo; barra inferior del cotizador (§37.1a) */
  lg: 1024,
  /** desktop */
  xl: 1280,
  /** desktop ancho */
  '2xl': 1536,
} as const;

export type Breakpoint = keyof typeof BREAKPOINTS;

/** La media query de `≥ bp`, idéntica a la que Tailwind genera para el prefijo `bp:`. */
export function minWidthQuery(bp: Breakpoint): string {
  return `(min-width: ${BREAKPOINTS[bp]}px)`;
}
