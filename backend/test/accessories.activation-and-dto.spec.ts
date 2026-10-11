/**
 * accessories.activation-and-dto.spec.ts — mitades puras de **AC-B6 / AC-B45** (qué falta para activar) y de
 * **AC-B3 / AC-B7** (listas blancas de los DTO). API_CONTRACT §AC.3, §AC.11.
 *
 *  - `activationMissing`: `price | photo | dimensions | weight | energy_type`, EXACTO; la energía ⛔ nunca pide medidas
 *    ni peso (v1.86.1).
 *  - DTO público (`toCardDTO`/`toDetailDTO`): ⛔ nunca `unitCostCents`, `stockQty`, `reservedQty`, `suggested`, medidas
 *    ni peso (criterio 730). La lista blanca se arma campo por campo: una fila con llaves de más no se cuela.
 *  - DTO del panel (`toAdminDTO`): `unitCostCents` AUSENTE (no null) para el operador (criterio 720).
 */
import { activationMissing } from '../src/modules/accessories/activation';
import { photoDTO, toAdminDTO, toCardDTO, toDetailDTO } from '../src/modules/accessories/accessory-dto';

const row = (over: Record<string, unknown> = {}) => ({
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Fundas mate',
  description: 'Cien fundas',
  category: 'sleeves' as const,
  energyType: null,
  lengthMm: 90,
  widthMm: 65,
  heightMm: 20,
  weightG: 50,
  priceCents: 8900,
  unitCostCents: 4000,
  stockQty: 20,
  reservedQty: 3,
  active: true,
  suggested: true,
  photoVersion: '0123456789abcdef',
  createdAt: new Date('2026-10-07T12:00:00Z'),
  updatedAt: new Date('2026-10-07T13:00:00Z'),
  ...over,
});

describe('AC-B6/AC-B45 — activationMissing', () => {
  it('completo ⇒ []', () => {
    expect(activationMissing(row())).toEqual([]);
  });
  it('sin precio, foto, medidas ni peso ⇒ los cuatro, en orden fijo', () => {
    expect(activationMissing(row({ priceCents: null, photoVersion: null, lengthMm: null, weightG: null }))).toEqual([
      'price',
      'photo',
      'dimensions',
      'weight',
    ]);
  });
  it('una sola medida faltante ⇒ dimensions', () => {
    expect(activationMissing(row({ heightMm: null }))).toEqual(['dimensions']);
  });
  it('energía con precio y foto, SIN medidas ni peso ⇒ [] (v1.86.1)', () => {
    expect(
      activationMissing(row({ category: 'energy', energyType: 'fire', lengthMm: null, widthMm: null, heightMm: null, weightG: null })),
    ).toEqual([]);
  });
  it('energía sin foto ⇒ exactamente [photo] (⛔ sin dimensions/weight)', () => {
    expect(activationMissing(row({ category: 'energy', energyType: 'fire', photoVersion: null, lengthMm: null, weightG: null }))).toEqual([
      'photo',
    ]);
  });
  it('energía sin tipo ⇒ energy_type', () => {
    expect(activationMissing(row({ category: 'energy', energyType: null }))).toEqual(['energy_type']);
  });
});

describe('AC-B3 — DTO público: lista blanca campo por campo', () => {
  const PROHIBIDAS = ['unitCostCents', 'stockQty', 'reservedQty', 'suggested', 'lengthMm', 'widthMm', 'heightMm', 'weightG', 'photoVersion', 'active'];

  it('toCardDTO: llaves EXACTAS, soldOut por disponible, foto con versión', () => {
    const dto = toCardDTO({ ...row(), secreto: 'x' } as never);
    expect(Object.keys(dto).sort()).toEqual(['category', 'energyType', 'id', 'name', 'photo', 'priceCents', 'soldOut'].sort());
    expect(dto.soldOut).toBe(false);
    expect(dto.photo).toEqual(photoDTO(row().id, '0123456789abcdef'));
    for (const k of PROHIBIDAS) expect(dto).not.toHaveProperty(k);
  });

  it('toDetailDTO: + description y maxQty = min(disponible, 99); agotado ⇒ 0', () => {
    const dto = toDetailDTO(row() as never);
    expect(Object.keys(dto).sort()).toEqual(
      ['category', 'description', 'energyType', 'id', 'maxQty', 'name', 'photo', 'priceCents', 'soldOut'].sort(),
    );
    expect(dto.maxQty).toBe(17);
    expect(toDetailDTO(row({ stockQty: 500, reservedQty: 0 }) as never).maxQty).toBe(99);
    const agotado = toDetailDTO(row({ stockQty: 3, reservedQty: 3 }) as never);
    expect(agotado.maxQty).toBe(0);
    expect(agotado.soldOut).toBe(true);
    for (const k of PROHIBIDAS) expect(dto).not.toHaveProperty(k);
  });

  it('la URL de la foto es la ruta pública con versión y variante', () => {
    expect(photoDTO('abc', 'v1')).toEqual({
      url: '/api/v1/accessories/abc/photo/v1/full',
      thumbUrl: '/api/v1/accessories/abc/photo/v1/thumb',
    });
  });
});

describe('AC-B7 — DTO del panel: costo ★', () => {
  it('súper-admin ⇒ unitCostCents presente', () => {
    const dto = toAdminDTO(row() as never, { superAdmin: true, hasSales: false });
    expect(dto.unitCostCents).toBe(4000);
    expect(dto.availableQty).toBe(17);
  });
  it('operador ⇒ unitCostCents AUSENTE (no null)', () => {
    const dto = toAdminDTO(row() as never, { superAdmin: false, hasSales: true });
    expect('unitCostCents' in dto).toBe(false);
    expect(dto.hasSales).toBe(true);
    expect(dto.priceCents).toBe(8900);
  });
  it('sin foto ⇒ photo null', () => {
    expect(toAdminDTO(row({ photoVersion: null }) as never, { superAdmin: true, hasSales: false }).photo).toBeNull();
  });
});
