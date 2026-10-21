/**
 * TL D8 (2026-10-19) · un solo patrón para publicar altos en `<html>`: barras fijas (`--sticky-bottom-h`)
 * y banner de cookies (`--consent-banner-h`). La mayor gana; desmontar limpia; las variables no se mezclan.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { STICKY_BOTTOM_VAR, stickyBottomHeightsForTest, usePublishedHeight, useStickyBottomBar } from './useStickyBottomBar';

const BANNER = '--consent-banner-h';
const root = () => document.documentElement.style;

/** jsdom no maqueta: el alto se fija en el nodo antes de que el ref lo mida. */
function withHeight(h: number) {
  return (node: HTMLDivElement | null) => {
    if (node) Object.defineProperty(node, 'offsetHeight', { configurable: true, value: h });
  };
}

function Bar({ h }: { h: number }) {
  const ref = useStickyBottomBar<HTMLDivElement>();
  return <div ref={(n) => (withHeight(h)(n), ref(n))} />;
}

function Banner({ h }: { h: number }) {
  const ref = usePublishedHeight<HTMLDivElement>(BANNER);
  return <div ref={(n) => (withHeight(h)(n), ref(n))} />;
}

afterEach(() => {
  root().removeProperty(STICKY_BOTTOM_VAR);
  root().removeProperty(BANNER);
});

describe('D8 · usePublishedHeight', () => {
  it('dos barras ⇒ la mayor; desmontar ambas limpia la variable', () => {
    const a = render(<Bar h={56} />);
    const b = render(<Bar h={72.4} />);
    expect(root().getPropertyValue(STICKY_BOTTOM_VAR)).toBe('73px');
    expect(stickyBottomHeightsForTest().sort()).toEqual([56, 72.4]);
    b.unmount();
    expect(root().getPropertyValue(STICKY_BOTTOM_VAR)).toBe('56px');
    a.unmount();
    expect(root().getPropertyValue(STICKY_BOTTOM_VAR)).toBe('');
  });

  it('el banner publica en SU variable y no toca la de las barras', () => {
    const bar = render(<Bar h={60} />);
    const banner = render(<Banner h={120} />);
    expect(root().getPropertyValue(BANNER)).toBe('120px');
    expect(root().getPropertyValue(STICKY_BOTTOM_VAR)).toBe('60px');
    banner.unmount();
    expect(root().getPropertyValue(BANNER)).toBe('');
    expect(root().getPropertyValue(STICKY_BOTTOM_VAR)).toBe('60px');
    bar.unmount();
  });
});
