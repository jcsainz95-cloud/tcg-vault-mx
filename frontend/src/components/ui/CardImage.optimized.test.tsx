import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { applyNextImageConfig } from '@/test/next-image-config';
import { CardImage } from './CardImage';

/**
 * 🔒 DYN-F9 (unitaria) · API_CONTRACT §DYN.6.6, ARCHITECTURE §4.DYN (f) 7 — si `/_next/image` falla, la líder cae
 * UNA vez a la URL original sin `srcset` y se pinta; `onLoaded` (precondición 3 de §23.3: la rotación no arranca con
 * la foto en vuelo) se llama UNA sola vez, después del respaldo. Con la original también rota: `onLoaded` una vez y
 * el pozo sin imagen rota. La versión de navegador (500 interceptado de verdad) es `e2e/lead-image.spec.ts`.
 * Mutaciones medidas (FRONTEND_NOTES §DYN): quitar el respaldo; llamar a `onLoaded` en el primer error; reintentar en
 * bucle.
 */
const preload = vi.hoisted(() => vi.fn());
vi.mock('react-dom', async (orig) => ({ ...(await orig<typeof import('react-dom')>()), preload }));

const HD = 'https://images.scrydex.com/pokemon/me5-88/large';

let restore: () => void = () => undefined;
beforeAll(() => {
  restore = applyNextImageConfig();
});
afterAll(() => restore());
beforeEach(() => preload.mockReset());

const img = () => screen.queryByAltText('Lead') as HTMLImageElement | null;
const optimized = (el: HTMLImageElement | null) =>
  !!el && new URL(el.getAttribute('src') ?? '', 'http://t.test').pathname === '/_next/image';

describe('DYN-F9 · respaldo de la foto líder cuando el optimizador falla', () => {
  it('empieza por /_next/image con srcset; tras su error, la original SIN srcset, y onLoaded aún NO', async () => {
    const onLoaded = vi.fn();
    render(<CardImage src={HD} alt="Lead" priority optimized onLoaded={onLoaded} />);
    expect(optimized(img())).toBe(true);
    expect(img()).toHaveAttribute('srcset');
    await act(async () => {
      fireEvent.error(img()!);
    });
    expect(img()).toHaveAttribute('src', HD);
    expect(img()).not.toHaveAttribute('srcset');
    expect(img()).not.toHaveAttribute('sizes');
    expect(onLoaded).not.toHaveBeenCalled();
  });

  it('la original carga ⇒ onLoaded UNA vez, y se pinta (sin esqueleto)', async () => {
    const onLoaded = vi.fn();
    const { container } = render(<CardImage src={HD} alt="Lead" priority optimized onLoaded={onLoaded} />);
    await act(async () => {
      fireEvent.error(img()!);
    });
    await act(async () => {
      fireEvent.load(img()!);
      fireEvent.load(img()!);
    });
    expect(onLoaded).toHaveBeenCalledTimes(1);
    expect(img()).toHaveClass('opacity-100');
    expect(container.querySelector('.animate-pulse')).toBeNull();
  });

  it('la original también rota ⇒ onLoaded UNA vez, sin reintentos y el pozo SIN imagen rota', async () => {
    const onLoaded = vi.fn();
    const { container } = render(<CardImage src={HD} alt="Lead" priority optimized onLoaded={onLoaded} />);
    await act(async () => {
      fireEvent.error(img()!);
    });
    const fallback = img()!;
    await act(async () => {
      fireEvent.error(fallback);
    });
    expect(onLoaded).toHaveBeenCalledTimes(1);
    expect(img()).toBeNull();
    expect(container.querySelector('.animate-pulse')).toBeNull();
    // Sin bucle: otro error tardío del elemento retirado no reabre nada.
    await act(async () => {
      fireEvent.error(fallback);
    });
    expect(onLoaded).toHaveBeenCalledTimes(1);
    expect(img()).toBeNull();
  });

  it('el optimizador carga ⇒ onLoaded una vez y nunca cae a la original', async () => {
    const onLoaded = vi.fn();
    render(<CardImage src={HD} alt="Lead" priority optimized onLoaded={onLoaded} />);
    await act(async () => {
      fireEvent.load(img()!);
    });
    expect(onLoaded).toHaveBeenCalledTimes(1);
    expect(optimized(img())).toBe(true);
  });

  it('terminada ANTES de hidratar (sin evento): al montar se lee `complete` (con píxeles ⇒ onLoaded; sin ⇒ respaldo)', () => {
    const complete = vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true);
    const natural = vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(640);
    const onLoaded = vi.fn();
    const first = render(<CardImage src={HD} alt="Lead" priority optimized onLoaded={onLoaded} />);
    expect(onLoaded).toHaveBeenCalledTimes(1);
    first.unmount();
    natural.mockReturnValue(0);
    complete.mockReturnValueOnce(true).mockReturnValue(false);
    const onLoaded2 = vi.fn();
    render(<CardImage src={HD} alt="Lead" priority optimized onLoaded={onLoaded2} />);
    expect(img()).toHaveAttribute('src', HD);
    expect(onLoaded2).not.toHaveBeenCalled();
    complete.mockRestore();
    natural.mockRestore();
  });

  it('sin `optimized` la conducta de siempre: el primer error ya es definitivo (onLoaded) y no hay /_next/image', async () => {
    const onLoaded = vi.fn();
    render(<CardImage src={HD} alt="Lead" priority onLoaded={onLoaded} />);
    expect(img()).toHaveAttribute('src', HD);
    await act(async () => {
      fireEvent.error(img()!);
    });
    expect(onLoaded).toHaveBeenCalledTimes(1);
    expect(img()).toHaveAttribute('src', HD);
  });
});
