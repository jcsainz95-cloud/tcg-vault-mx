import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CardImage } from './CardImage';

const SRC = 'https://images.pokemontcg.io/base1/4.png';

/**
 * PERF — la prop `priority` existe para UNA cosa: la teja candidata a LCP (hoy la líder del
 * carrusel de la home). Estas pruebas fijan los tres atributos que la hacen valer y, sobre
 * todo, que el DEFAULT no cambió: el resto de la app (rejillas, listas) sigue en `lazy`.
 */
describe('CardImage · prioridad de carga', () => {
  afterEach(() => vi.restoreAllMocks());

  it('por defecto difiere la carga (rejillas y listas)', () => {
    render(<CardImage src={SRC} alt="Charizard" />);
    const img = screen.getByAltText('Charizard');
    expect(img).toHaveAttribute('loading', 'lazy');
    expect(img).not.toHaveAttribute('fetchpriority');
  });

  it('con `priority` carga en caliente y con prioridad alta', () => {
    render(<CardImage src={SRC} alt="Charizard" priority />);
    const img = screen.getByAltText('Charizard');
    expect(img).toHaveAttribute('loading', 'eager');
    // Atributo en minúsculas: es como lo lee el navegador y como react-dom 18 lo emite
    // sin quejarse (ver la nota de HIGH_FETCH_PRIORITY en CardImage.tsx).
    expect(img).toHaveAttribute('fetchpriority', 'high');
  });

  it('decoding="async" siempre (no bloquea el hilo principal al descomprimir)', () => {
    render(<CardImage src={SRC} alt="Charizard" />);
    expect(screen.getByAltText('Charizard')).toHaveAttribute('decoding', 'async');
  });

  it('`priority` pinta la imagen sin esperar al onLoad (el fade retrasa el LCP)', () => {
    const { rerender } = render(<CardImage src={SRC} alt="Charizard" priority />);
    expect(screen.getByAltText('Charizard')).toHaveClass('opacity-100');
    // Sin `priority` la conducta previa se conserva: opacidad 0 hasta que carga.
    rerender(<CardImage src={SRC} alt="Charizard" />);
    expect(screen.getByAltText('Charizard')).toHaveClass('opacity-0');
  });

  it('no dispara avisos de React por props desconocidas', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<CardImage src={SRC} alt="Charizard" priority />);
    expect(spy).not.toHaveBeenCalled();
  });
});
