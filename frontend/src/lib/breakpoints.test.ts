import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import resolveConfig from 'tailwindcss/resolveConfig';
import tailwindConfig from '../../tailwind.config';
import { BREAKPOINTS, minWidthQuery } from './breakpoints';

/**
 * DESIGN_SYSTEM §4.4: los tokens de breakpoint en JS son los MISMOS que Tailwind compila en las
 * clases `sm:`…`2xl:`. Si alguien redefiniera `screens` en `tailwind.config.ts` (o cambiara un
 * número aquí), el CSS y el JS decidirían con umbrales distintos y esta prueba lo dice.
 */
describe('breakpoints · paridad DESIGN_SYSTEM §4.4 ↔ tailwind.config ↔ código', () => {
  it('los cinco umbrales coinciden con los `screens` resueltos de Tailwind', () => {
    const screens = resolveConfig(tailwindConfig).theme.screens as Record<string, string>;
    for (const [bp, px] of Object.entries(BREAKPOINTS)) {
      expect(screens[bp], `screens.${bp}`).toBe(`${px}px`);
    }
  });

  it('coinciden con la tabla de §4.4 del DESIGN_SYSTEM', () => {
    const doc = readFileSync(resolve(__dirname, '../../../docs/DESIGN_SYSTEM.md'), 'utf8');
    for (const [bp, px] of Object.entries(BREAKPOINTS)) {
      expect(doc, `§4.4 ${bp}`).toMatch(new RegExp(`^${bp}\\s+≥ ${px}px`, 'm'));
    }
  });

  it('`minWidthQuery` produce la media query que Tailwind genera para el prefijo', () => {
    expect(minWidthQuery('lg')).toBe('(min-width: 1024px)');
  });

  it('ningún componente lleva un `min-width` en px a mano: todo umbral sale de aquí', () => {
    // Barrido barato sobre el código de producción (sin tests ni el propio módulo).
    const out = execSync(
      "grep -rnE 'min-width: *[0-9]+px' src --include=*.ts --include=*.tsx | grep -v '\\.test\\.' | grep -v 'src/lib/breakpoints.ts' || true",
      { cwd: resolve(__dirname, '../..'), encoding: 'utf8' },
    ).trim();
    expect(out, 'umbrales a mano (fichero:línea)').toBe('');
  });
});
