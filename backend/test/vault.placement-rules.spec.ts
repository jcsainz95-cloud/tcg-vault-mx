import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  VAULT_GATE_NAMESPACE,
  blockReasonOf,
  compareDrawers,
  placeableWhere,
  suggestionOf,
} from '../src/modules/vault/vault-placement.rules';
import { RESERVATION_GATE_NAMESPACE } from '../src/modules/orders/reservation';
import { physicalStateOf } from '../src/modules/vault/vault-physical-inventory.service';
import { preparationCountsOf } from '../src/modules/vault/vault-preparation.view';
import { codigoDeFichero } from './helpers/codigo-de-fichero';

/**
 * API_CONTRACT §M4-VAULT.4/.5/.10/.11 — las reglas PURAS de la colocación, una por una, y los
 * candados de forma que el contrato pide (un helper para el `409`, namespace propio de la puerta).
 */

const custody = { ownerType: 'customer', ownerUserId: 'u', ownershipStatus: 'settled', status: 'in_custody' };

describe('P — blockReasonOf (lectura) y placeableWhere (escritura): un predicado', () => {
  it('colocable ⇔ del cliente, settled, in_custody y sin retiro cobrado', () => {
    expect(blockReasonOf(custody, 'u', false)).toBeNull();
    expect(blockReasonOf(custody, 'u', true)).toBe('in_withdrawal');
    expect(blockReasonOf({ ...custody, ownerUserId: 'otro' }, 'u', false)).toBe('not_in_custody');
    expect(blockReasonOf({ ...custody, status: 'withdrawn' }, 'u', false)).toBe('not_in_custody');
    expect(blockReasonOf({ ...custody, ownershipStatus: 'pending' }, 'u', false)).toBe('not_in_custody');
    expect(blockReasonOf({ ...custody, ownerType: 'platform' }, 'u', false)).toBe('not_in_custody');
    // un retiro cobrado manda aunque la pieza además haya salido de custodia
    expect(blockReasonOf({ ...custody, status: 'shipped' }, 'u', true)).toBe('in_withdrawal');
  });

  it('el where de escritura exige lo mismo y excluye retiros picking|guia|enviado', () => {
    expect(placeableWhere('u')).toEqual({
      ownerType: 'customer',
      ownerUserId: 'u',
      ownershipStatus: 'settled',
      status: 'in_custody',
      shipmentItems: { none: { shipmentRequest: { status: { in: ['picking', 'guia', 'enviado'] } } } },
    });
  });
});

describe('customerDrawers — orden y sugerencia', () => {
  const d = (id: string, label: string, n = 1) => ({ id, label, zone: 'customer_custody' as const, customerPieceCount: n });
  it('por label en unidades de código, desempate id; ⛔ nunca por nº de piezas', () => {
    const list = [d('b', 'C10', 99), d('a', 'C1', 1), d('c', 'C1', 5), d('z', 'c0', 1)];
    expect([...list].sort(compareDrawers).map((x) => x.id)).toEqual(['a', 'c', 'b', 'z']);
  });
  it('0 ⇒ none · 1 ⇒ existing_customer_vault · ≥2 ⇒ multiple_drawers sin propuesta', () => {
    expect(suggestionOf([])).toEqual({ source: 'none' });
    expect(suggestionOf([d('a', 'A')])).toEqual({ source: 'existing_customer_vault', location: d('a', 'A') });
    expect(suggestionOf([d('a', 'A'), d('b', 'B')])).toEqual({ source: 'multiple_drawers', locations: [d('a', 'A'), d('b', 'B')] });
  });
});

describe('conteos de preparación — una partición de items[]', () => {
  const it_ = (prepStatus: any, blocked = false) =>
    ({ prepStatus, placeability: blocked ? { kind: 'blocked', reason: 'not_in_custody' } : { kind: 'placeable' } }) as any;
  it('picked/missing por su marca; pending = colocable sin marcar; blocked = bloqueada sin marcar; suman total', () => {
    const c = preparationCountsOf([it_('picked'), it_('picked', true), it_('missing', true), it_('pending'), it_('pending', true)]);
    expect(c).toEqual({ total: 5, pending: 1, picked: 2, missing: 1, blocked: 1 });
    expect(c.pending + c.picked + c.missing + c.blocked).toBe(c.total);
  });
});

describe('physicalStateOf — gana la PRIMERA regla (§M4-VAULT.11)', () => {
  const drawer = { id: 'x', label: 'C1', zone: 'customer_custody' as const };
  const shop = { id: 's', label: 'S1', zone: 'platform_stock' as const };
  const mark = (prepStatus: any, status = 'pending') => ({
    prepStatus,
    prepMarkedAt: prepStatus === 'pending' ? null : new Date('2026-09-25T00:00:00Z'),
    prepMarkedByUserId: prepStatus === 'pending' ? null : 'op',
    placement: { id: 'vp', status, preparedAt: null },
  });
  const w = { shipmentId: 'sh', status: 'picking' as const };
  const names = new Map([['op', 'Oper']]);
  it('missing > in_withdrawal > pending_placement > in_drawer > unlocated', () => {
    expect(physicalStateOf({ location: drawer }, mark('missing', 'cancelled'), w, names).state).toBe('missing');
    expect(physicalStateOf({ location: drawer }, mark('picked'), w, names).state).toBe('in_withdrawal');
    expect(physicalStateOf({ location: drawer }, mark('picked'), undefined, names)).toEqual({
      state: 'pending_placement',
      placementId: 'vp',
      prepStatus: 'picked',
      prepared: false,
    });
    expect(physicalStateOf({ location: drawer }, mark('picked', 'placed'), undefined, names).state).toBe('in_drawer');
    expect(physicalStateOf({ location: shop }, undefined, undefined, names)).toEqual({ state: 'unlocated', reason: 'not_in_customer_drawer' });
    expect(physicalStateOf({ location: null }, undefined, undefined, names)).toEqual({ state: 'unlocated', reason: 'no_location' });
  });
});

describe('candados de forma', () => {
  it('la puerta de bóveda tiene namespace PROPIO (⛔ el de reservas serializaría sin motivo)', () => {
    expect(VAULT_GATE_NAMESPACE).not.toBe(RESERVATION_GATE_NAMESPACE);
  });

  it('H-2 — `PLACEMENT_NOT_PENDING` se construye en UN helper (⛔ cuatro copias)', () => {
    const src = readFileSync(join(__dirname, '..', 'src', 'modules', 'vault', 'vault-placement.service.ts'), 'utf8');
    expect(src.match(/'PLACEMENT_NOT_PENDING'/g)).toHaveLength(1);
    expect(src).not.toMatch(/locationId:\s*p\.locationId/); // el 409 {placed} nombra `location`, no `locationId`
  });

  it('los cuatro verbos toman la puerta del cliente (una llamada por verbo)', () => {
    const src = readFileSync(join(__dirname, '..', 'src', 'modules', 'vault', 'vault-placement.service.ts'), 'utf8');
    expect(src.match(/await lockCustomerVaultGate\(tx, userId\)/g)).toHaveLength(4);
  });

  it('⛔ el confirm no reutiliza moveItem ni llama tryAutoPublish; no escribe status/owner de la pieza', () => {
    // Sin comentarios (el docstring NOMBRA lo prohibido): se lee con `codigoDeFichero` y sus anclas.
    const src = codigoDeFichero(join(__dirname, '..', 'src', 'modules', 'vault', 'vault-placement.service.ts'), [
      'async confirm(',
      'data: { locationId }',
    ]);
    expect(src).not.toMatch(/moveItem|tryAutoPublish/);
    expect(src).toMatch(/data: \{ locationId \}/);
  });
});
