import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { useBuyButtonVisible } from './buy-visible';

const trackMock = vi.hoisted(() => vi.fn());
vi.mock('./track', () => ({ track: trackMock }));

let callback: IntersectionObserverCallback = () => {};
const observed: Element[] = [];

function Probe({ id }: { id: string }) {
  useBuyButtonVisible(id);
  return <button data-buy-cta="">COMPRAR</button>;
}

describe('buy_button_visible (§MKT-V2 6.3)', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_MEASUREMENT_MODE', 'on');
    observed.length = 0;
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(cb: IntersectionObserverCallback) {
          callback = cb;
        }
        observe(el: Element) {
          observed.push(el);
        }
        disconnect() {}
      },
    );
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    trackMock.mockClear();
  });

  const fire = (isIntersecting: boolean) => callback([{ isIntersecting } as IntersectionObserverEntry], {} as IntersectionObserver);

  it('observa el botón y manda el evento UNA vez, al entrar en pantalla, con card_id y segundos', () => {
    render(<Probe id="xy1-1" />);
    expect(observed).toHaveLength(1);
    fire(false);
    expect(trackMock).not.toHaveBeenCalled();
    fire(true);
    fire(true);
    expect(trackMock).toHaveBeenCalledTimes(1);
    expect(trackMock).toHaveBeenCalledWith('buy_button_visible', { card_id: 'xy1-1', seconds_to_visible: expect.any(Number) });
  });

  it('con el modo off no observa nada', () => {
    vi.stubEnv('NEXT_PUBLIC_MEASUREMENT_MODE', 'off');
    render(<Probe id="xy1-1" />);
    expect(observed).toHaveLength(0);
  });
});
