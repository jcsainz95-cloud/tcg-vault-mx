import { describe, it, expect } from 'vitest';
import { historicalCardMeta, historicalCardName } from './historical-card';
import type { HistoricalOrderItemCardDTO } from '@/types/contract';

/**
 * Contrato §4 «Tolerancia del histórico» punto 4 · ARCHITECTURE §5.2.9(b).
 * El acta de un pedido puede haber perdido CUALQUIER hecho congelado. El cliente degrada por
 * campo: etiqueta neutra para el nombre, omisión de los fragmentos que no se pueden componer,
 * y jamás un valor sustituto.
 */

const UNKNOWN = 'Carta sin registro';

/** El peor caso del contrato: blob ausente/no-objeto ⇒ `card` SOLO con la clave de imagen. */
const EMPTY_BLOB: HistoricalOrderItemCardDTO = { imageSmallUrl: null };

describe('historicalCardName · el nombre que el acta no registró', () => {
  it('devuelve el nombre real cuando el blob lo trae', () => {
    expect(historicalCardName({ imageSmallUrl: null, name: 'Charizard' }, UNKNOWN)).toEqual({
      text: 'Charizard',
      hasName: true,
    });
  });

  it('AUSENTE ⇒ etiqueta neutra, NUNCA cadena vacía (era `[""]`)', () => {
    const out = historicalCardName(EMPTY_BLOB, UNKNOWN);
    expect(out).toEqual({ text: UNKNOWN, hasName: false });
    expect(out.text).not.toBe('');
    expect(out.text).not.toContain('undefined');
  });

  it('`null` ≠ ausente al LEER, pero degrada igual: nada de "null" pintado', () => {
    const blob = { imageSmallUrl: null, name: null } as unknown as HistoricalOrderItemCardDTO;
    expect(historicalCardName(blob, UNKNOWN)).toEqual({ text: UNKNOWN, hasName: false });
  });

  it('cadena en blanco cuenta como no registrado (un acta con "  " no dice nada)', () => {
    expect(historicalCardName({ imageSmallUrl: null, name: '   ' }, UNKNOWN).hasName).toBe(false);
  });
});

describe('historicalCardMeta · se compone lo registrado, se omite lo demás', () => {
  it('blob completo raw ⇒ set · #número · condición', () => {
    expect(
      historicalCardMeta({
        imageSmallUrl: null,
        setName: 'Base Set',
        number: '4',
        productType: 'raw',
        rawCondition: 'NM',
      }),
    ).toBe('Base Set · #4 · NM');
  });

  it('sin `setName` ⇒ no queda separador colgando al principio', () => {
    const meta = historicalCardMeta({
      imageSmallUrl: null,
      number: '4',
      productType: 'raw',
      rawCondition: 'NM',
    });
    expect(meta).toBe('#4 · NM');
    expect(meta.startsWith('·')).toBe(false);
  });

  it('sin `number` ⇒ NO se pinta «#» huérfano', () => {
    const meta = historicalCardMeta({ imageSmallUrl: null, setName: 'Base Set', productType: 'raw', rawCondition: 'NM' });
    expect(meta).toBe('Base Set · NM');
    expect(meta).not.toContain('#');
  });

  it('blob vacío ⇒ cadena vacía (la vista omite el renglón entero, sin « · » colgando)', () => {
    expect(historicalCardMeta(EMPTY_BLOB)).toBe('');
  });

  it('sin `productType` NO se infiere el tipo aunque venga la condición (nada de `in` como discriminante)', () => {
    const meta = historicalCardMeta({
      imageSmallUrl: null,
      setName: 'Base Set',
      number: '4',
      rawCondition: 'NM',
    });
    expect(meta).toBe('Base Set · #4');
    expect(meta).not.toContain('NM');
  });

  it('`rawCondition: null` (clave PRESENTE, valor nulo — así lo congela el checkout) ⇒ se omite el chip', () => {
    expect(
      historicalCardMeta({
        imageSmallUrl: null,
        setName: 'Base Set',
        number: '4',
        productType: 'raw',
        rawCondition: null,
      }),
    ).toBe('Base Set · #4');
  });

  it('graded ⇒ empresa + grado; con solo uno de los dos sigue componiendo lo que hay', () => {
    expect(
      historicalCardMeta({
        imageSmallUrl: null,
        number: '4',
        productType: 'graded',
        gradingCompany: 'PSA',
        gradeValue: '10',
      }),
    ).toBe('#4 · PSA 10');
    expect(
      historicalCardMeta({
        imageSmallUrl: null,
        number: '4',
        productType: 'graded',
        gradingCompany: 'PSA',
        gradeValue: null,
      }),
    ).toBe('#4 · PSA');
    expect(
      historicalCardMeta({ imageSmallUrl: null, number: '4', productType: 'graded' }),
    ).toBe('#4');
  });

  it('sellado ⇒ ni condición ni grado, sin adornos inventados', () => {
    expect(
      historicalCardMeta({
        imageSmallUrl: null,
        setName: 'Base Set',
        number: '1',
        productType: 'sealed',
        rawCondition: null,
      }),
    ).toBe('Base Set · #1');
  });
});
