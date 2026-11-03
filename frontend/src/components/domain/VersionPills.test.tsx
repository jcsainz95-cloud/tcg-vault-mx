/**
 * IDS-F3 / IDS-F6 (API_CONTRACT §IDS.9) — candados 10–14 y 16 de IDS-UX.8 sobre `VersionPills`.
 *  (10) cada burbuja ≥ 44 px (min-h 64);  (11) solo lo que el servidor manda (agotadas omitidas por él: N burbujas = N
 *  entradas);  (12) una sola versión ⇒ sin `radiogroup`;  (13) solo este fichero usa `rounded-pill` (999 px);
 *  (14) el borde es `--color-border-control` y mide ≥ 3:1 sobre papel (mutación: `-strong` ⇒ rojo);
 *  (16) 2×N con 6 entradas ⇒ 3 rótulos de fila, sin insignia dentro, un solo tab-stop.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fireEvent, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { renderWithIntl } from '@/test/render';
import type { VersionOptionDTO } from '@/types/contract';
import { VersionPills, PillToggleGroup } from './VersionPills';

function opt(
  optionKey: string,
  language: 'en' | 'es',
  fromPriceCents: number,
  stamp: VersionOptionDTO['version']['stamp'] = null,
  finish: VersionOptionDTO['finish'] = 'holofoil',
  finishLabel: VersionOptionDTO['finishLabel'] = 'holo',
): VersionOptionDTO {
  return {
    optionKey,
    version: { key: stamp ? `${language}.${stamp.productId}` : language, language, stamp },
    finish,
    finishLabel,
    fromPriceCents,
    stockCount: 1,
    representativeInventoryItemId: `inv-${optionKey}`,
  };
}
const PP = { type: 'prize_pack' as const, label: null, productId: 565451 };
const COSMOS = { type: 'prize_pack' as const, label: 'Cosmos Holo', productId: 703819 };

const STD: VersionOptionDTO[] = [
  opt('en', 'en', 20000),
  opt('es', 'es', 15000),
  opt('en.565451.holofoil', 'en', 48000, PP),
  opt('es.565451.holofoil', 'es', 36000, PP),
];
const EXT: VersionOptionDTO[] = [
  opt('en', 'en', 20000),
  opt('es', 'es', 15000),
  opt('en.565451.normal', 'en', 9000, PP, 'normal', 'non_holo'),
  opt('es.565451.normal', 'es', 6750, PP, 'normal', 'non_holo'),
  opt('en.703819.holofoil', 'en', 48000, COSMOS, 'holofoil', 'cosmos_holo'),
  opt('es.703819.holofoil', 'es', 36000, COSMOS, 'holofoil', 'cosmos_holo'),
];

function Harness({ versions, initial }: { versions: VersionOptionDTO[]; initial: string }) {
  const [sel, setSel] = useState(initial);
  return <VersionPills versions={versions} selectedKey={sel} onSelect={(o) => setSel(o.optionKey)} />;
}

describe('VersionPills · ficha (IDS-UX.8)', () => {
  it('2×2 estándar: rótulo «IDIOMA Y VERSIÓN», 4 radios en el orden del servidor, insignia «De liga» en la fila de liga', () => {
    renderWithIntl(<Harness versions={STD} initial="en" />);
    const group = screen.getByRole('radiogroup', { name: 'IDIOMA Y VERSIÓN' });
    const radios = within(group).getAllByRole('radio');
    expect(radios.map((r) => r.getAttribute('data-option-key'))).toEqual(STD.map((v) => v.optionKey));
    expect(radios[3]).toHaveAccessibleName('Español, De liga, MX$360.00');
    expect(radios[3].querySelector('[data-version-chip="stamp"]')?.textContent).toBe('De liga');
    expect(screen.getByTestId('version-pills').getAttribute('data-form')).toBe('2x2');
    expect(screen.queryAllByTestId('version-row-label')).toHaveLength(0);
  });

  it('EN: «LANGUAGE AND VERSION», «English»/«Spanish» y la insignia «Prize Pack»', () => {
    renderWithIntl(<Harness versions={STD} initial="en" />, 'en');
    expect(screen.getByRole('radiogroup', { name: 'LANGUAGE AND VERSION' })).toBeInTheDocument();
    expect(screen.getAllByRole('radio')[2]).toHaveAccessibleName(/^English, Prize Pack, /);
  });

  it('(16) 2×N con 6 entradas: 3 rótulos de fila con acabado, sin insignia dentro, un solo tab-stop', () => {
    renderWithIntl(<Harness versions={EXT} initial="es.703819.holofoil" />);
    expect(screen.getByTestId('version-pills').getAttribute('data-form')).toBe('2xN');
    const labels = screen.getAllByTestId('version-row-label').map((l) => l.textContent);
    expect(labels).toEqual(['Sin liga · Holo', 'De liga · Prize Pack · No holo', 'De liga · Prize Pack · Cosmos Holo']);
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(6);
    expect(document.querySelectorAll('[data-version-chip]')).toHaveLength(0);
    expect(radios.filter((r) => r.tabIndex === 0)).toHaveLength(1);
    expect(radios.find((r) => r.tabIndex === 0)?.getAttribute('data-option-key')).toBe('es.703819.holofoil');
    // la burbuja se describe por su rótulo de fila
    const desc = radios[5].getAttribute('aria-describedby');
    expect(document.getElementById(desc!)?.textContent).toBe('De liga · Prize Pack · Cosmos Holo');
    // márgenes del rótulo: 6 px abajo siempre, 12 px arriba salvo el primero
    const ls = screen.getAllByTestId('version-row-label');
    expect(ls[0].className).toContain('mb-1.5');
    expect(ls[0].className).not.toContain('mt-3');
    expect(ls[1].className).toContain('mt-3');
  });

  it('(10) cada burbuja tiene min-h 64 px (≥ 44 táctil); (11) N burbujas = N entradas que mandó el servidor', () => {
    renderWithIntl(<Harness versions={EXT.slice(0, 5)} initial="en" />);
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(5);
    for (const r of radios) expect(r.className.split(/\s+/)).toContain('min-h-16');
  });

  it('(12) con una sola versión no hay radiogroup (ni nada)', () => {
    const { container } = renderWithIntl(<Harness versions={[opt('es', 'es', 100)]} initial="es" />);
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(container.textContent).toBe('');
  });

  it('teclado: flechas mueven y eligen en orden de lectura', () => {
    renderWithIntl(<Harness versions={STD} initial="en" />);
    const radios = () => screen.getAllByRole('radio');
    fireEvent.keyDown(radios()[0], { key: 'ArrowRight' });
    expect(radios()[1]).toHaveAttribute('aria-checked', 'true');
    fireEvent.keyDown(radios()[1], { key: 'ArrowDown' });
    expect(radios()[2]).toHaveAttribute('aria-checked', 'true');
    fireEvent.keyDown(radios()[2], { key: 'ArrowLeft' });
    expect(radios()[1]).toHaveAttribute('aria-checked', 'true');
    expect(document.activeElement).toBe(radios()[1]);
  });

  it('D-IDS-6: dos filas del mismo tipo y acabado ⇒ rótulos distintos con stamp.label', () => {
    const L = { type: 'prize_pack' as const, label: 'Left Stamp', productId: 1 };
    const R = { type: 'prize_pack' as const, label: 'Right Stamp', productId: 2 };
    renderWithIntl(
      <Harness versions={[opt('en', 'en', 1), opt('en.1.holofoil', 'en', 2, L), opt('en.2.holofoil', 'en', 3, R)]} initial="en" />,
    );
    const labels = screen.getAllByTestId('version-row-label').map((l) => l.textContent);
    expect(new Set(labels).size).toBe(3);
    expect(labels[1]).toBe('De liga · Prize Pack · Holo · Left Stamp');
  });
});

describe('PillToggleGroup · captura admin (IDS-UX.2)', () => {
  it('opción apagada: borde discontinuo, motivo en aria-describedby, no se elige al clic', () => {
    let v = 'none';
    renderWithIntl(
      <PillToggleGroup
        label="Versión"
        value={v}
        onChange={(x) => (v = x)}
        options={[
          { value: 'none', label: 'Sin liga' },
          { value: 'staff', label: 'Staff', disabledReason: 'Sin mercado de esta versión' },
        ]}
      />,
    );
    const staff = screen.getByRole('radio', { name: 'Staff' });
    expect(staff).toHaveAttribute('aria-disabled', 'true');
    expect(staff.className).toContain('border-dashed');
    expect(staff).toHaveAccessibleDescription('Sin mercado de esta versión');
    fireEvent.click(staff);
    expect(v).toBe('none');
    expect(screen.getByRole('radio', { name: 'Sin liga' }).className).toContain('min-h-11');
  });
});

// ---- (13) y (14): candados estáticos ----
const SRC = join(__dirname, '..', '..');
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.(tsx?|css)$/.test(n) && !/\.test\./.test(n) ? [p] : [];
  });
}

describe('(13) solo VersionPills usa la burbuja redondeada', () => {
  it('`rounded-pill` / 999px no aparece fuera de VersionPills.tsx', () => {
    const offenders = walk(SRC)
      .filter((p) => /rounded-pill|[Rr]adius[^\n]{0,24}(?<![\d-])999px/.test(readFileSync(p, 'utf8')))
      .map((p) => relative(SRC, p))
      // tailwind.config.ts está fuera de `src/`: allí vive la definición del radio, no su uso.
      .filter((p) => p !== join('components', 'domain', 'VersionPills.tsx'));
    expect(offenders).toEqual([]);
  });
});

/** Luminancia relativa WCAG de un color sRGB 0–255. */
function lum([r, g, b]: number[]): number {
  const c = [r, g, b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function cssVar(name: string): string {
  const css = readFileSync(join(SRC, 'app', 'globals.css'), 'utf8');
  const m = css.match(new RegExp(`${name}:\\s*([^;]+);`));
  if (!m) throw new Error(`falta ${name}`);
  return m[1].trim();
}
function hex(h: string): number[] {
  const x = h.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16));
}
function over(rgba: string, bg: number[]): number[] {
  const m = rgba.match(/rgba\(\s*(\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\s*\)/);
  if (!m) return hex(rgba);
  const a = parseFloat(m[4]);
  return [1, 2, 3].map((i, k) => Math.round(parseInt(m[i], 10) * a + bg[k] * (1 - a)));
}

describe('(14) el borde de las burbujas mide ≥ 3:1 sobre papel (WCAG 1.4.11)', () => {
  it('la clase de borde de la burbuja resuelve a un token que contrasta ≥ 3:1', () => {
    renderWithIntl(<Harness versions={STD} initial="en" />);
    const idle = screen.getAllByRole('radio')[1];
    const cls = idle.className.split(/\s+/).find((c) => /^border-border-/.test(c));
    expect(cls).toBeDefined();
    const token = `--color-${cls!.replace(/^border-/, '')}`;
    const paper = hex(cssVar('--color-bg'));
    const border = over(cssVar(token), paper);
    const [a, b] = [lum(paper), lum(border)].sort((x, y) => y - x);
    const ratio = (a + 0.05) / (b + 0.05);
    expect(ratio).toBeGreaterThanOrEqual(3);
  });
});
