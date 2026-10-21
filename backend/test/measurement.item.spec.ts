/**
 * C-B10 (API_CONTRACT v1.106 §MKT.H.4/.11) — `measurementItemOf` del servidor rinde EXACTAMENTE las filas entre los marcadores
 * `MKT-ITEM-ID` del contrato (esta prueba lee el fichero: si el contrato cambia, esto se pone rojo). Y el drenador y d1/d2 la
 * importan (no hay otra). Canario del contrato: cambiar el prefijo `sc_` por `c_` ⇒ rojo.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { measurementItemOf, parseMeasurementItemId } from '../src/modules/measurement/measurement-item';

const CONTRACT = join(__dirname, '..', '..', 'docs', 'API_CONTRACT.md');

function contractRows(): { facts: Record<string, unknown>; item_id: string; item_name: string; item_category: string }[] {
  const text = readFileSync(CONTRACT, 'utf8');
  const start = text.indexOf('<!-- MKT-ITEM-ID:start -->');
  const end = text.indexOf('<!-- MKT-ITEM-ID:end -->');
  if (start < 0 || end < start) throw new Error('marcadores MKT-ITEM-ID ausentes en docs/API_CONTRACT.md');
  const lines = text.slice(start, end).split('\n').filter((l) => l.startsWith('| `{'));
  return lines.map((l) => {
    const cells = l.split(' | ').map((c) => c.replace(/^\|?\s*`?|`?\s*\|?$/g, ''));
    return { facts: JSON.parse(cells[0]), item_id: cells[1], item_name: cells[2], item_category: cells[3] };
  });
}

describe('C-B10 · measurementItemOf = la tabla MKT-ITEM-ID del contrato', () => {
  const rows = contractRows();

  it('la tabla existe y trae al menos los cinco casos de v1.106 (carta, graded, sellado ligado, sin ligar null y ausente)', () => {
    expect(rows.length).toBeGreaterThanOrEqual(5);
    expect(new Set(rows.map((r) => r.item_id.split('_')[0]))).toEqual(new Set(['c', 's', 'sc']));
  });

  it.each(rows.map((r) => [JSON.stringify(r.facts), r]))('%s', (_n, r) => {
    expect(measurementItemOf(r.facts as never)).toEqual({ item_id: r.item_id, item_name: r.item_name, item_category: r.item_category });
  });
});

describe('§MKT.H.4 · casos de servidor fuera de la tabla', () => {
  it('sin identidad ⇒ null (la línea no viaja): carta sin cardId, sellado sin nada, accesorio sin ids', () => {
    expect(measurementItemOf({ name: 'x', productType: 'raw' })).toBeNull();
    expect(measurementItemOf({ name: 'x', productType: 'sealed', sealedProductId: null })).toBeNull();
    expect(measurementItemOf({ kind: 'accessory', name: 'Funda' })).toBeNull();
  });

  it('accesorio: a_<accessoryId>, si no m_<metaDeckId>; nombre del snapshot', () => {
    expect(measurementItemOf({ kind: 'accessory', accessoryId: 'acc1', metaDeckId: 'md1', name: 'Funda' })).toEqual({ item_id: 'a_acc1', item_name: 'Funda', item_category: 'accessory' });
    expect(measurementItemOf({ kind: 'accessory', accessoryId: null, metaDeckId: 'md1', name: 'Mazo' })).toEqual({ item_id: 'm_md1', item_name: 'Mazo', item_category: 'accessory' });
  });

  it('parseMeasurementItemId separa por prefijo (d1/d2); lo no canónico ⇒ null', () => {
    expect(parseMeasurementItemId('c_sv3-125')).toEqual({ table: 'card', id: 'sv3-125' });
    expect(parseMeasurementItemId('s_sp-9')).toEqual({ table: 'sealedProduct', id: 'sp-9' });
    expect(parseMeasurementItemId('sc_sv3-1')).toEqual({ table: 'sealedAnchor', id: 'sv3-1' });
    for (const raw of ['sv3-125', 'c_', 'a_acc1', '']) expect(parseMeasurementItemId(raw)).toBeNull();
  });
});

describe('C-B10 · una sola función: nadie más arma un item_id', () => {
  it('fuera de measurement-item.ts ningún fichero de src/ escribe los prefijos `c_`/`s_`/`sc_` en un literal de plantilla', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (p.endsWith('.ts') && !p.endsWith('measurement-item.ts') && /`(?:c|s|sc|a|m)_\$\{/.test(readFileSync(p, 'utf8'))) offenders.push(p);
      }
    };
    walk(join(__dirname, '..', 'src'));
    expect(offenders).toEqual([]);
  });

  it('el drenador y el panel importan measurementItemOf', () => {
    for (const f of ['modules/measurement/measurement-drain.service.ts', 'modules/marketing/marketing-analytics.service.ts']) {
      expect({ f, imports: /measurementItemOf/.test(readFileSync(join(__dirname, '..', 'src', f), 'utf8')) }).toEqual({ f, imports: true });
    }
  });
});
