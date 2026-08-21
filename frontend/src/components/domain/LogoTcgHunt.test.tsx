import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LogoTcgHunt, HuntMarkMicro } from './LogoTcgHunt';

describe('LogoTcgHunt (§17.1 v1.7.1) · las 4 variantes del rebrand P-21', () => {
  it('lockup claro: role img con marca+dominio, degradado diagonal #B31217→#4A0D0D y rampa de vino del wordmark', () => {
    const { container } = render(<LogoTcgHunt variant="lockup" />);
    const svg = screen.getByRole('img', { name: 'TCG HUNT — tcghunt.mx' });
    expect(svg).toBeInTheDocument();
    // Degradado de marca (la 2ª y última excepción de gradiente del sistema, §17.2).
    const stops = Array.from(container.querySelectorAll('stop')).map((s) =>
      s.getAttribute('stop-color'),
    );
    expect(stops).toContain('#B31217');
    expect(stops).toContain('#4A0D0D');
    expect(stops).toContain('#6E1013'); // rampa corta del wordmark (huntGradWm)
    // Wordmark presente con la fuente de marca (--font-brand primero, §17.1e).
    const word = Array.from(container.querySelectorAll('text')).find(
      (t) => t.textContent === 'TCG HUNT',
    );
    expect(word?.getAttribute('style')).toContain('--font-brand');
  });

  it('retícula v1.7.1: cruz SEGMENTADA (ninguna línea cruza el centro) y anillos como 4+4 arcos', () => {
    const { container } = render(<LogoTcgHunt variant="lockup" />);
    // 4 líneas independientes; ninguna atraviesa el centro (240,112): las
    // horizontales terminan/empiezan a 18px del centro y las verticales igual.
    const lines = Array.from(container.querySelectorAll('line'));
    expect(lines.length).toBe(4);
    for (const l of lines) {
      const x1 = Number(l.getAttribute('x1'));
      const x2 = Number(l.getAttribute('x2'));
      const y1 = Number(l.getAttribute('y1'));
      const y2 = Number(l.getAttribute('y2'));
      const horizontal = y1 === y2;
      if (horizontal) {
        // no cubre el rango del claro central [222,258]
        expect(Math.min(x1, x2) >= 258 || Math.max(x1, x2) <= 222).toBe(true);
      } else {
        expect(Math.min(y1, y2) >= 130 || Math.max(y1, y2) <= 94).toBe(true);
      }
    }
    // Anillos con gaps cardinales: 8 arcos (4 exterior + 4 interior), no <circle r=56/34>.
    expect(container.querySelectorAll('path').length).toBe(8);
    // El único círculo es el punto central anillado, aislado.
    const circles = container.querySelectorAll('circle');
    expect(circles.length).toBe(1);
    expect(circles[0]).toHaveAttribute('r', '8');
  });

  it('lockup-dark: rampa aclarada #F0685F→#D0362C y wordmark en papel — NUNCA #B31217 sobre tinta (§17.2)', () => {
    const { container } = render(<LogoTcgHunt variant="lockup-dark" />);
    const stops = Array.from(container.querySelectorAll('stop')).map((s) =>
      s.getAttribute('stop-color'),
    );
    expect(stops).toContain('#F0685F');
    expect(stops).toContain('#D0362C');
    expect(stops).not.toContain('#B31217'); // prohibido sobre tinta (~2.5:1)
    const word = Array.from(container.querySelectorAll('text')).find(
      (t) => t.textContent === 'TCG HUNT',
    );
    expect(word?.getAttribute('fill')).toBe('#F4F1EA'); // papel sólido (~15.5:1)
  });

  it('mark decorativa: aria-hidden (el enlace contenedor porta el texto accesible)', () => {
    const { container } = render(<LogoTcgHunt variant="mark" size={28} decorative />);
    const svg = container.querySelector('svg')!;
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).not.toHaveAttribute('role');
    expect(svg).toHaveAttribute('width', '28');
    // Solo-mira: sin wordmark.
    expect(container.querySelector('text')).toBeNull();
  });

  it('micro: currentColor, sin gradiente, anillo cerrado pero cruz segmentada + punto aislado (§17.1d)', () => {
    const { container } = render(<HuntMarkMicro size={12} />);
    const svg = container.querySelector('svg')!;
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('linearGradient')).toBeNull();
    const ring = container.querySelector('circle[r="6.5"]');
    expect(ring).toHaveAttribute('stroke', 'currentColor');
    // La firma de la retícula sobrevive en micro: 4 segmentos de cruz con claro
    // central (nunca una línea corrida) aunque el anillo vaya cerrado.
    expect(container.querySelectorAll('line').length).toBe(4);
  });

  it('dos instancias en la misma página no duplican ids de gradiente en el DOM', () => {
    const { container } = render(
      <>
        <LogoTcgHunt variant="lockup" />
        <LogoTcgHunt variant="mark" decorative />
      </>,
    );
    // lockup claro = 2 gradientes (retícula + wordmark); mark = 1.
    const ids = Array.from(container.querySelectorAll('linearGradient')).map((g) => g.id);
    expect(ids.length).toBe(3);
    expect(new Set(ids).size).toBe(3);
  });
});
