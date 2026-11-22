import { describe, it, expect } from 'vitest';
import {
  chooseBuylistPickup,
  convertAllBuylist,
  markBuylistPickupDone,
  previewBuylistRevision,
  respondBuylistRevision,
  reviseBuylistItemPrice,
  getAdminBuylistRequest,
} from '../api';

/** Servidor FALSO coherente con el anexo §3–§6: mismos errores, mismos códigos. */
describe('buylist-flujo (rama mock) · bajar precio', () => {
  it('paridad: el neto del preview == `revision.netIfAcceptedCents` de la baja guardada == payout proyectado', async () => {
    const preview = await previewBuylistRevision('sri-f2-2', 570_000);
    // Mewtwo ya tiene una baja pendiente a 1,100 ⇒ cuenta a su valor propuesto: 1,850,000 + 570,000 + 110,000 + 38,000 − 18,000.
    expect(preview.payout.netCents).toBe(2_550_000);
    const dto = await reviseBuylistItemPrice('sri-f2-2', { revisedPriceCents: 570_000, reasonCode: 'condition_mismatch' });
    const line = dto.items.find((i) => i.id === 'sri-f2-2')!;
    expect(line.itemStatus).toBe('ajustada');
    expect(line.revision?.state).toBe('pending');
    expect(line.revision?.netIfAcceptedCents).toBe(preview.payout.netCents);
  });

  it('422 REVISION_NOT_LOWER (igual, mayor o ≤ 0), 422 ITEM_NOT_OFFERED, 422 REQUEST_NOT_RECEIVED, 409 REVISION_ALREADY_RESOLVED', async () => {
    await expect(previewBuylistRevision('sri-f2-4', 38_000)).rejects.toMatchObject({ status: 422, code: 'REVISION_NOT_LOWER' });
    await expect(previewBuylistRevision('sri-f2-4', 0)).rejects.toMatchObject({ status: 422, code: 'REVISION_NOT_LOWER' });
    await expect(reviseBuylistItemPrice('sri-f2-4', { revisedPriceCents: 40_000, reasonCode: 'wrong_card' })).rejects.toMatchObject({
      status: 422,
      code: 'REVISION_NOT_LOWER',
    });
    // Ya aprobada ⇒ resuelta.
    await expect(previewBuylistRevision('sri-f2-1', 100)).rejects.toMatchObject({ status: 409, code: 'REVISION_ALREADY_RESOLVED' });
    // Solicitud `aprobada` (ya no está en revisión física).
    await expect(previewBuylistRevision('sri-f2-6', 100)).rejects.toMatchObject({ status: 422, code: 'REQUEST_NOT_RECEIVED' });
    // `other` exige nota 3–500 ⇒ 400.
    await expect(reviseBuylistItemPrice('sri-f2-4', { revisedPriceCents: 30_000, reasonCode: 'other' })).rejects.toMatchObject({
      status: 400,
      details: { field: 'note' },
    });
  });
});

describe('buylist-flujo (rama mock) · alta y recogida', () => {
  it('convert-all: convierte las aprobadas, omite el resto, ubicación inexistente ⇒ 200 con failed[] por línea y el reintento es seguro', async () => {
    const bad = await convertAllBuylist('sr-3021', 'no-existe');
    expect(bad.converted).toHaveLength(0);
    expect(bad.failed).toHaveLength(3);
    expect(bad.failed.every((f) => f.code === 'LOCATION_NOT_AVAILABLE')).toBe(true);
    const first = await convertAllBuylist('sr-3021', 'loc-1');
    expect(first.converted).toHaveLength(3);
    expect(first.skipped).toEqual([{ itemId: 'sri-f2-8', code: 'NOT_APPROVED' }]);
    const retry = await convertAllBuylist('sr-3021');
    expect(retry.converted).toHaveLength(0);
    expect(retry.skipped).toHaveLength(4);
    await expect(convertAllBuylist('nope')).rejects.toMatchObject({ status: 404 });
  });

  it('pickup-done es idempotente y solo aplica a líneas con qué recoger', async () => {
    const a = await markBuylistPickupDone('sri-f2-8');
    const b = await markBuylistPickupDone('sri-f2-8');
    expect(b.itemStatus).toBe('rechazada');
    expect(a.itemStatus).toBe('rechazada');
    await expect(markBuylistPickupDone('sri-f2-1')).rejects.toMatchObject({ status: 422 });
    const dto = await getAdminBuylistRequest('sr-3021');
    expect(dto.items.find((i) => i.id === 'sri-f2-8')?.pickup?.doneAt).toBeTruthy();
  });
});

describe('buylist-flujo (rama mock) · baja cancelada (anexo §3.2)', () => {
  it('aprobar o rechazar una carta con baja pendiente la deja `cancelled`; la respuesta del vendedor ⇒ 409 REVISION_ALREADY_RESOLVED', async () => {
    const { mockAdminBuylist } = await import('../mock/fixtures');
    const { decideBuylistItem, rejectBuylistItems } = await import('../api');
    const req = mockAdminBuylist.find((r) => r.id === 'sr-3020')!;
    const pend = req.items.filter((i) => i.revision?.state === 'pending');
    expect(pend.length).toBeGreaterThan(0);
    const a = await decideBuylistItem(pend[0].id, { decision: 'approve' });
    expect(a.itemStatus).toBe('aprobada');
    expect(a.revision?.state).toBe('cancelled');
    expect(a.approvedPriceCents).toBe(pend[0].offeredPriceCents);
    // reject-items exige reasonCode (400 sin él) y cancela las bajas pendientes de las demás.
    await expect(rejectBuylistItems('sr-3020', { itemIds: ['x'], reason: 'abc' } as never)).rejects.toMatchObject({
      status: 400,
      details: { field: 'reasonCode' },
    });
  });
});

describe('buylist-flujo (rama mock) · portal del vendedor', () => {
  it('revision-response: aceptar ⇒ aprobada al nuevo precio; repetir lo mismo ⇒ 200; lo contrario ⇒ 409 REVISION_ALREADY_RESOLVED', async () => {
    // Sin monto esperado ⇒ 400; con un monto distinto del vigente ⇒ 409 REVISION_CHANGED (sin efectos).
    await expect(respondBuylistRevision('sr-3020', 'sri-f2c-1', 'accept')).rejects.toMatchObject({ status: 400 });
    await expect(respondBuylistRevision('sr-3020', 'sri-f2c-1', 'accept', 120_000)).rejects.toMatchObject({
      status: 409,
      code: 'REVISION_CHANGED',
      details: { expectedRevisedPriceCents: 120_000, currentRevisedPriceCents: 110_000 },
    });
    const ok = await respondBuylistRevision('sr-3020', 'sri-f2c-1', 'accept', 110_000);
    // Devuelve la SOLICITUD completa.
    expect(ok.sellRequestId).toBe('sr-3020');
    const line = ok.items.find((i) => i.id === 'sri-f2c-1')!;
    expect(line.itemStatus).toBe('aprobada');
    expect(line.approvedPriceCents).toBe(110_000);
    const again = await respondBuylistRevision('sr-3020', 'sri-f2c-1', 'accept', 110_000);
    expect(again.items.find((i) => i.id === 'sri-f2c-1')!.itemStatus).toBe('aprobada');
    await expect(respondBuylistRevision('sr-3020', 'sri-f2c-1', 'decline')).rejects.toMatchObject({
      status: 409,
      code: 'REVISION_ALREADY_RESOLVED',
    });
    await expect(respondBuylistRevision('sr-3020', 'nope', 'accept')).rejects.toMatchObject({ status: 404 });
  });

  it('pickup: elegir método es idempotente; tras «Entregada» cambiarlo ⇒ 409 PICKUP_ALREADY_DONE', async () => {
    const a = await chooseBuylistPickup('sr-3020', 'sri-f2c-2', 'in_person');
    expect(a.items.find((i) => i.id === 'sri-f2c-2')?.pickup?.method).toBe('in_person');
    const b = await chooseBuylistPickup('sr-3020', 'sri-f2c-2', 'ship_back');
    expect(b.items.find((i) => i.id === 'sri-f2c-2')?.pickup?.method).toBe('ship_back');
    const item = (await import('../mock/fixtures')).mockSellRequests.find((r) => r.sellRequestId === 'sr-3020')!.items[1];
    item.pickup = { ...item.pickup!, doneAt: '2026-11-21T10:00:00Z' };
    await expect(chooseBuylistPickup('sr-3020', 'sri-f2c-2', 'in_person')).rejects.toMatchObject({
      status: 409,
      code: 'PICKUP_ALREADY_DONE',
    });
    await expect(chooseBuylistPickup('sr-3020', 'sri-f2c-1', 'in_person')).rejects.toMatchObject({ status: 422 });
  });
});
