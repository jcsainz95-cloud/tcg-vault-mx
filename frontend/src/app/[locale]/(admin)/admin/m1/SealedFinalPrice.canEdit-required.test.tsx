import type { ComponentProps } from 'react';
import { describe, it, expect } from 'vitest';
import type { SealedFinalPrice, SealedFinalPricePiece } from './SealedFinalPrice';

/**
 * F-SP-11 (`API_CONTRACT §M11-SP.13.5.1`, C-2 del techlead) — candado ESTÁTICO: `canEdit` de `SealedFinalPrice` es
 * obligatorio y sin valor por defecto, para que olvidarlo no compile (un default `true` abría el editor con la clave
 * `sealedProductId` ausente). Lo muerde `tsc --noEmit`: si la prop vuelve a ser opcional, el `@ts-expect-error` queda
 * sin error que esperar y `tsc` falla (TS2578). Solo tipos: nada se monta ni se importa en ejecución.
 */
type Props = ComponentProps<typeof SealedFinalPrice>;
const noop = () => {};
const base = { piece: {} as SealedFinalPricePiece, layout: 'queue' as const, editing: false, onEditingChange: noop, onDone: noop };

// @ts-expect-error — F-SP-11: montar `SealedFinalPrice` sin `canEdit` no compila.
const withoutCanEdit: Props = { ...base };
const withCanEdit: Props = { ...base, canEdit: false };

describe('F-SP-11 · `SealedFinalPrice.canEdit` obligatorio', () => {
  it('el candado vive en `tsc` (ver el `@ts-expect-error` de arriba)', () => {
    expect(withoutCanEdit).toBeDefined();
    expect(withCanEdit.canEdit).toBe(false);
  });
});
