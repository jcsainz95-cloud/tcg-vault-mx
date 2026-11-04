import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { applyNextImageConfig } from '@/test/next-image-config';
import { imageOptimizerOrigins } from '@/lib/image-optimizer-hosts.mjs';
import { CardImage } from './CardImage';

/**
 * 🔒 DYN-F10 · `optimized` solo pide `/_next/image` si el ORIGEN de `src` está en `images.remotePatterns`.
 *
 * Medido 2026-11-04 (home-perf run 41870766214, FRONTEND_NOTES §DYN.6): `/_next/image` responde 400 a cualquier origen
 * que no esté en `remotePatterns`, y `CardImage` caía al respaldo ⇒ DOS peticiones por foto (un 400 y la original).
 * Con un host fuera de la lista la teja va a nivel B directamente: `<img>` cruda con la URL original, sin `srcset`,
 * sin precarga, y su `error` NO dispara el respaldo (no hay nada a lo que caer). Un host admitido sigue como antes.
 * La lista viene del MISMO módulo que `next.config.mjs` (`image-optimizer-hosts.mjs`); su paridad con el matcher de
 * Next se mide en `src/lib/next-image-remote-patterns.test.ts`.
 * Mutación medida: quitar `imageOptimizerAccepts` de `CardImage` ⇒ rojas aquí y en FeaturedCarousel.leadImage.test.tsx.
 */
const preload = vi.hoisted(() => vi.fn());
vi.mock('react-dom', async (orig) => ({ ...(await orig<typeof import('react-dom')>()), preload }));

const ALLOWED = 'https://images.scrydex.com/pokemon/me5-88/large';
const FOREIGN = 'https://img.e2e.local/e2e-charizard_hires.png';

let restore: () => void = () => undefined;
beforeAll(() => {
  restore = applyNextImageConfig();
});
afterAll(() => restore());
beforeEach(() => preload.mockReset());
afterEach(() => vi.unstubAllEnvs());

const img = () => screen.queryByAltText('Lead') as HTMLImageElement | null;
const viaOptimizer = (el: HTMLImageElement | null) =>
  !!el && new URL(el.getAttribute('src') ?? '', 'http://t.test').pathname === '/_next/image';

describe('DYN-F10 · optimized + origen FUERA de remotePatterns ⇒ nivel B directo', () => {
  it('control: el origen del caso cruzado NO está en la lista y el admitido SÍ (si no, lo de abajo no mide nada)', () => {
    const origins = imageOptimizerOrigins();
    expect(origins).toContain(new URL(ALLOWED).origin);
    expect(origins).not.toContain(new URL(FOREIGN).origin);
  });

  it('<img> cruda con la URL original: sin /_next/image, sin srcset ni sizes', () => {
    render(<CardImage src={FOREIGN} alt="Lead" optimized />);
    expect(img()).toHaveAttribute('src', FOREIGN);
    expect(viaOptimizer(img())).toBe(false);
    expect(img()).not.toHaveAttribute('srcset');
    expect(img()).not.toHaveAttribute('sizes');
  });

  it('la líder (priority) con origen ajeno: NO se precarga nada (ni /_next/image ni la original)', () => {
    render(<CardImage src={FOREIGN} alt="Lead" priority optimized />);
    expect(preload).not.toHaveBeenCalled();
    expect(img()).toHaveAttribute('src', FOREIGN);
  });

  it('su `error` NO dispara el respaldo: la misma <img> (sin elemento nuevo), onLoaded una vez, pozo sin imagen rota NO aplica', async () => {
    const onLoaded = vi.fn();
    render(<CardImage src={FOREIGN} alt="Lead" optimized onLoaded={onLoaded} />);
    const before = img();
    await act(async () => {
      fireEvent.error(before!);
    });
    // Nivel B: el error «asienta» la foto (como en toda CardImage cruda) y no hay segunda petición.
    expect(onLoaded).toHaveBeenCalledTimes(1);
    expect(img()).toBe(before);
    expect(img()).toHaveAttribute('src', FOREIGN);
    await act(async () => {
      fireEvent.error(img()!);
    });
    expect(onLoaded).toHaveBeenCalledTimes(1);
  });

  it('control: con origen admitido sigue pidiendo /_next/image (con srcset) y precarga la líder', () => {
    render(<CardImage src={ALLOWED} alt="Lead" priority optimized />);
    expect(viaOptimizer(img())).toBe(true);
    expect(img()).toHaveAttribute('srcset');
    expect(preload).toHaveBeenCalledTimes(1);
  });

  it('interruptor encendido: también el origen admitido va crudo (la lista queda vacía)', () => {
    vi.stubEnv('NEXT_PUBLIC_IMAGE_OPTIMIZER_KILL_SWITCH', 'on');
    expect(imageOptimizerOrigins()).toEqual([]);
    render(<CardImage src={ALLOWED} alt="Lead" priority optimized />);
    expect(img()).toHaveAttribute('src', ALLOWED);
    expect(img()).not.toHaveAttribute('srcset');
    expect(preload).not.toHaveBeenCalled();
  });
});
