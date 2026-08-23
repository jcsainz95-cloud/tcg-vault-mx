import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithIntl } from '@/test/render';
import {
  StockBadge,
  stockVariantForSingle,
  stockVariantFromCount,
} from './StockBadge';

/**
 * Regresión FE-1 (rediseño P-30, DS §20.6): un grupo de SINGLES con
 * `stockCount===1` significa «1 disponible ahora mismo» → variante `unique`
 * («Queda 1», accent), NO «Último». El sellado mantiene su semántica propia
 * (`availableCount===1` = «Último», muted), por lo que `lastUnit` sigue vivo.
 */
describe('stockVariantForSingle · mapeo de stock de grupo de singles (§20.6)', () => {
  it('stockCount===1 → «unique» («Queda 1»), no «lastUnit»', () => {
    expect(stockVariantForSingle(1)).toBe('unique');
  });

  it('stockCount===0 → «soldOut»', () => {
    expect(stockVariantForSingle(0)).toBe('soldOut');
  });

  it('stockCount>=2 → «count» («N en stock»)', () => {
    expect(stockVariantForSingle(2)).toBe('count');
    expect(stockVariantForSingle(7)).toBe('count');
  });
});

describe('stockVariantFromCount · mapeo de stock de sellado (§20.6)', () => {
  it('availableCount===1 → «lastUnit» («Último») — sellado conserva su semántica', () => {
    expect(stockVariantFromCount(1)).toBe('lastUnit');
  });

  it('availableCount===0 → «soldOut»; >=2 → «count»', () => {
    expect(stockVariantFromCount(0)).toBe('soldOut');
    expect(stockVariantFromCount(3)).toBe('count');
  });
});

describe('StockBadge · texto renderizado por variante (§20.6, es)', () => {
  it('single con stock 1 pinta «Queda 1» (unique), no «Último»', () => {
    renderWithIntl(<StockBadge variant={stockVariantForSingle(1)} count={1} />, 'es');
    expect(screen.getByText('Queda 1')).toBeInTheDocument();
    expect(screen.queryByText('Último')).not.toBeInTheDocument();
  });

  it('sellado con stock 1 pinta «Último» (lastUnit)', () => {
    renderWithIntl(<StockBadge variant={stockVariantFromCount(1)} count={1} />, 'es');
    expect(screen.getByText('Último')).toBeInTheDocument();
  });

  it('stock N>=2 pinta «N en stock» (count)', () => {
    renderWithIntl(<StockBadge variant={stockVariantForSingle(3)} count={3} />, 'es');
    expect(screen.getByText('3 en stock')).toBeInTheDocument();
  });
});
