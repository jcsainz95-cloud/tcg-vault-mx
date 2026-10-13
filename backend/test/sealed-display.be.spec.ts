/**
 * sealed-display.be.spec.ts — ARCHITECTURE §4.34a.2 / §5.2.6-D (v1.94⟨sellado-display⟩).
 *
 * EL BUG: un producto SELLADO se pinta como su carta ANCLA (ej. «Exeggcute») en la preparación,
 * el acta del pedido y el correo de confirmación, porque 15 superficies leen `item.card.name` sin
 * rama de sellado. La pieza reservada ES la sellada (`sealedProductId`/`sealedProductName` poblados,
 * `productType='sealed'`); es solo display.
 *
 * Este archivo es la prueba que DEBE FALLAR HOY (§5.2.6-D) y que, tras el arreglo, fija la conducta:
 *   (i)  la preparación devuelve el `SealedProduct.name` y NO el `card.name` del ancla;
 *   (ii) el resolutor único `pieceDisplayIdentityOf` nunca pinta el ancla para el nombre de un
 *        sellado — sin nombre resoluble pinta «Sellado sin identificar», jamás «Exeggcute»;
 *        la IMAGEN sí cae al ancla (clase P, aceptado §5.2.6).
 *
 * Las superficies de pedido/acta/correo e invitado (ii)-(iv) de §5.2.6-D que cruzan BD/HTTP viven
 * en la suite de integración (QA las ejecuta); aquí se fija el cuerpo PURO que todas consumen.
 */
import { pieceDisplayIdentityOf, UNIDENTIFIED_SEALED_NAME } from '../src/common/piece-display-identity';
import { preparationCardOf } from '../src/modules/shipments/preparation-view';
import { OrdersService } from '../src/modules/orders/orders.service';
import { FROZEN_CARD_FACT_KEYS } from '../src/modules/orders/order-item-card';

// Ancla del set — el single «Exeggcute» que el bug pintaba para el sellado.
const ANCLA = { name: 'Exeggcute', number: '2', imageSmallUrl: 'http://img/exeggcute.png', set: { name: 'Obsidian Flames' } };

// Pieza SELLADA bien capturada: su identidad de sellado está poblada (snapshot por-pieza M-37).
const sealedPiece = (over: Record<string, unknown> = {}) => ({
  productType: 'sealed' as const,
  finish: 'normal' as const,
  gradingCompany: null,
  gradeValue: null,
  rawCondition: null,
  sealedCondition: 'mint' as const,
  sealedProductId: 'sp_1',
  sealedProductName: 'Obsidian Flames Elite Trainer Box',
  sealedImageUrl: 'http://img/etb.jpg',
  card: ANCLA,
  ...over,
});

describe('§5.2.6-D (i) — preparationCardOf pinta el SELLADO, no el ancla', () => {
  it('sellado con snapshot ⇒ nombre del SealedProduct, NO «Exeggcute»', () => {
    const dto = preparationCardOf(sealedPiece());
    expect(dto.name).toBe('Obsidian Flames Elite Trainer Box');
    expect(dto.name).not.toBe('Exeggcute');
  });

  it('sellado SIN nombre resoluble ⇒ «Sellado sin identificar», JAMÁS el ancla', () => {
    const dto = preparationCardOf(sealedPiece({ sealedProductId: null, sealedProductName: null, sealedImageUrl: null }));
    expect(dto.name).toBe(UNIDENTIFIED_SEALED_NAME);
    expect(dto.name).not.toBe('Exeggcute');
  });

  it('no-sellado (raw) ⇒ el nombre del single, exactamente como hoy', () => {
    const dto = preparationCardOf({
      productType: 'raw' as const,
      finish: 'normal' as const,
      gradingCompany: null,
      gradeValue: null,
      rawCondition: 'NM' as const,
      sealedCondition: null,
      sealedProductId: null,
      sealedProductName: null,
      sealedImageUrl: null,
      card: ANCLA,
    });
    expect(dto.name).toBe('Exeggcute');
  });
});

describe('§4.34a.2 — pieceDisplayIdentityOf (resolutor único, puro)', () => {
  it('sellado vivo (sealedProduct unido) manda sobre el snapshot y sobre el ancla', () => {
    const r = pieceDisplayIdentityOf({
      productType: 'sealed',
      card: ANCLA,
      sealedProductId: 'sp_1',
      sealedProductName: 'nombre viejo del snapshot',
      sealedImageUrl: 'http://img/snap.jpg',
      sealedProduct: { name: 'ETB Pitch Black', imageUrl: 'http://img/live.jpg' },
    });
    expect(r.isSealed).toBe(true);
    expect(r.name).toBe('ETB Pitch Black');
    expect(r.name).not.toBe('Exeggcute');
  });

  it('sellado sin vivo ⇒ snapshot sealedProductName; nunca el ancla', () => {
    const r = pieceDisplayIdentityOf({
      productType: 'sealed',
      card: ANCLA,
      sealedProductId: 'sp_1',
      sealedProductName: 'Obsidian Flames Elite Trainer Box',
      sealedImageUrl: 'http://img/etb.jpg',
    });
    expect(r.name).toBe('Obsidian Flames Elite Trainer Box');
    expect(r.name).not.toBe('Exeggcute');
    expect(r.imageSmallUrl).toBe('http://img/etb.jpg');
  });

  it('sellado sin nombre ⇒ «Sellado sin identificar»; la IMAGEN sí cae al ancla (clase P)', () => {
    const r = pieceDisplayIdentityOf({
      productType: 'sealed',
      card: ANCLA,
      sealedProductId: null,
      sealedProductName: null,
      sealedImageUrl: null,
    });
    expect(r.name).toBe(UNIDENTIFIED_SEALED_NAME);
    expect(r.name).not.toBe('Exeggcute');
    // La imagen del ancla es la cola aceptada (§5.2.6); solo el NOMBRE jamás cae al ancla.
    expect(r.imageSmallUrl).toBe('http://img/exeggcute.png');
  });

  it('sellado con nombre en blanco se trata como ausente (money-safe): «Sellado sin identificar»', () => {
    const r = pieceDisplayIdentityOf({
      productType: 'sealed',
      card: ANCLA,
      sealedProductId: 'sp_1',
      sealedProductName: '   ',
      sealedImageUrl: null,
    });
    expect(r.name).toBe(UNIDENTIFIED_SEALED_NAME);
  });

  it('no-sellado ⇒ card.name / card.imageSmallUrl, isSealed=false', () => {
    const r = pieceDisplayIdentityOf({
      productType: 'raw',
      card: ANCLA,
      sealedProductId: null,
      sealedProductName: null,
    });
    expect(r.isSealed).toBe(false);
    expect(r.name).toBe('Exeggcute');
    expect(r.imageSmallUrl).toBe('http://img/exeggcute.png');
  });
});

describe('§5.2.6-D (ii) — cardSnapshot congela la identidad CORRECTA del sellado', () => {
  // cardSnapshot es puro: no toca ninguna dependencia, así que el servicio se arma con nulls.
  const svc = new OrdersService(null as never, null as never, null as never, null as never, null as never);
  const snapshot = (over: Record<string, unknown> = {}) =>
    (svc as unknown as { cardSnapshot: (i: unknown) => Record<string, unknown> }).cardSnapshot({
      cardId: 'c1',
      productType: 'sealed',
      rawCondition: null,
      gradingCompany: null,
      gradeValue: null,
      sealedProductId: 'sp_1',
      sealedProductName: 'Obsidian Flames Elite Trainer Box',
      sealedImageUrl: 'http://img/etb.jpg',
      card: { name: 'Exeggcute', number: '2', set: { name: 'Obsidian Flames' } },
      ...over,
    });

  it('sellado ⇒ `name` del SealedProduct (no el ancla), + sealedProductId + productType', () => {
    const snap = snapshot();
    expect(snap.name).toBe('Obsidian Flames Elite Trainer Box');
    expect(snap.name).not.toBe('Exeggcute');
    expect(snap.sealedProductId).toBe('sp_1');
    expect(snap.sealedProductName).toBe('Obsidian Flames Elite Trainer Box');
    expect(snap.productType).toBe('sealed');
    // `cardId`/`number` del ancla SE CONSERVAN (pertenencia al set + cola de la cascada).
    expect(snap.cardId).toBe('c1');
    expect(snap.number).toBe('2');
  });

  it('sellado legado sin nombre ⇒ `name` = «Sellado sin identificar», sealedProductId: null, sin sealedProductName', () => {
    const snap = snapshot({ sealedProductId: null, sealedProductName: null, sealedImageUrl: null });
    expect(snap.name).toBe(UNIDENTIFIED_SEALED_NAME);
    expect(snap.name).not.toBe('Exeggcute');
    expect(snap.sealedProductId).toBeNull();
    // ⛔ nunca se congela la copia display como si fuera un hecho de la compra.
    expect('sealedProductName' in snap).toBe(false);
  });

  it('no-sellado ⇒ `name` del ancla y SIN claves de sellado (ausentes en raw/graded)', () => {
    const snap = snapshot({ productType: 'raw', rawCondition: 'NM', sealedProductId: null, sealedProductName: null });
    expect(snap.name).toBe('Exeggcute');
    expect('sealedProductId' in snap).toBe(false);
    expect('sealedProductName' in snap).toBe(false);
  });

  it('la allowlist de hechos congelados trae las dos claves de sellado (candado §5.2.6)', () => {
    expect(FROZEN_CARD_FACT_KEYS).toContain('sealedProductId');
    expect(FROZEN_CARD_FACT_KEYS).toContain('sealedProductName');
  });
});
