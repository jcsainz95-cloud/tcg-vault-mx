// @vitest-environment node
/**
 * PROJECT §LEG.2 punto 5 (commit 95779460; bandera de seguridad del release BSD): la guía de ENTRADA del buylist manda a
 * Skydropx y a la paquetería el nombre, la dirección y el teléfono del VENDEDOR como remitente. Las dos filas del aviso lo
 * dicen con el texto exacto de la norma (2.ª columna; las demás columnas y filas no cambian).
 */
import { describe, expect, it } from 'vitest';
import { privacyNoticeEs, type LegalBlock } from './privacidad.es';

const rows = privacyNoticeEs.sections
  .flatMap((s) => s.blocks)
  .filter((b): b is Extract<LegalBlock, { type: 'table' }> => b.type === 'table')
  .flatMap((t) => t.rows);
const row = (name: string) => rows.find((r) => r[0] === `**${name}**`);

describe('§LEG.2 p. 5 · el vendedor como remitente en el aviso de privacidad', () => {
  it('Paqueterías', () => {
    expect(row('Paqueterías')).toEqual([
      '**Paqueterías**',
      'Nombre, dirección y teléfono de quien recibe; si nos vendes cartas, también tu nombre, dirección y teléfono como remitente',
      'Entregar o recoger el paquete',
    ]);
  });
  it('Skydropx', () => {
    expect(row('Skydropx')).toEqual([
      '**Skydropx**',
      'Nombre, dirección, teléfono y correo de quien recibe; si nos vendes cartas, también tu nombre, dirección y teléfono como remitente',
      'Cotizar y generar la guía de envío con la paquetería',
    ]);
  });
});
