import { describe, it, expect } from 'vitest';
import type { ProductType, Role } from '@/types/contract';
import { canEditSealedPiecePrice, sealedPieceLinkOf } from './sealed-price-role';

/**
 * 💰 F-SP-9 (`API_CONTRACT §M11-SP.13.5.1`, C-2 del techlead) — la puerta del editor de precio por pieza falla
 * CERRADO: `true` solo para el dueño sobre una pieza sellada SIN producto (`null`). Con la clave `sealedProductId`
 * AUSENTE, nadie edita. Mutación que la pone roja: `id === null ? canSetSealedPrice(role) : true`.
 */
type Row = { productType: ProductType; sealedProductId?: string | null };
const ROWS: Array<[string, Row]> = [
  ['sealed id «x»', { productType: 'sealed', sealedProductId: 'x' }],
  ['sealed null', { productType: 'sealed', sealedProductId: null }],
  ['sealed sin clave', { productType: 'sealed' }],
  ['raw sin clave', { productType: 'raw' }],
  ['raw null', { productType: 'raw', sealedProductId: null }],
];
const ROLES: Role[] = ['super_admin', 'vault_operator'];

describe('F-SP-9 · canEditSealedPiecePrice', () => {
  for (const role of ROLES) {
    for (const [label, row] of ROWS) {
      const expected = role === 'super_admin' && label === 'sealed null';
      it(`${role} × ${label} ⇒ ${expected}`, () => {
        expect(canEditSealedPiecePrice(role, row)).toBe(expected);
      });
    }
  }
});

describe('sealedPieceLinkOf', () => {
  it.each<[string, Row, string]>([
    ['sealed id', { productType: 'sealed', sealedProductId: 'x' }, 'linked'],
    ['sealed null', { productType: 'sealed', sealedProductId: null }, 'unlinked'],
    ['⛔ sealed sin clave', { productType: 'sealed' }, 'unknown'],
    ['sealed undefined explícito', { productType: 'sealed', sealedProductId: undefined }, 'unknown'],
    ['raw null', { productType: 'raw', sealedProductId: null }, 'unknown'],
    ['graded con id', { productType: 'graded', sealedProductId: 'x' }, 'unknown'],
  ])('%s ⇒ %s', (_l, row, link) => {
    expect(sealedPieceLinkOf(row)).toBe(link);
  });
});
