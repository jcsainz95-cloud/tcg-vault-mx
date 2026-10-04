/**
 * sk5-valuation.e2e-spec.ts — v1.80.1 (API_CONTRACT §M2-SK **SK-5**, ARCHITECTURE §4.50.1-bis) contra
 * Postgres REAL y por HTTP. Candados **VK-3, VK-4, VK-5 y VK-7**.
 *
 * **UNA función de valuación por pieza, y los seis lectores la usan.** El defecto medido (BACKEND_NOTES
 * P-83, «Discrepancia», sonda HTTP N=1): una caja de CLIENTE sin mapeo + una `PriceReference` legada bajo
 * `gradeKey:'sealed'` de MX$800 en la misma `Card` ⇒ «Mi bóveda» decía `priced 80000` y el valor de
 * custodia subía 80 000. La llave `'sealed'` es de COLA: no identifica al producto.
 *
 * Los seis lectores y dónde muerde cada uno aquí:
 *   holdings            → `GET /vault/holdings`               (fila + `portfolio`)
 *   holdingDetail       → `GET /vault/holdings/:id`
 *   custodyValue        → `GET /admin/finance/custody-value`   (DELTA: es global)
 *   adminVaults.list    → `GET /admin/vaults?q=<email>`
 *   ownedItemRefs       → `GET /admin/users/:id` (`ownedItems`, ficha 360°)
 *   inventoryValue      → `GET /admin/finance/inventory-value` (DELTA; piezas de PLATAFORMA)
 *
 * ⚠️ **Fixture PROPIO** (contrato: «no con datos de semilla»): set, cartas, clientes y piezas nacen aquí
 * con un sufijo por corrida, así que un cambio de semilla no puede ponerlas verdes por ausencia. Del
 * seed solo se toman el admin (para leer) y el hash de contraseña del cliente (para no derivar argon2).
 */
import { randomBytes } from 'node:crypto';
import { E2EHarness } from './helpers/e2e-app';
import { E2E_USERS } from '../../prisma/e2e-fixtures';

const RUN = randomBytes(4).toString('hex');
const LEGACY_CENTS = 80_000; // fila legada bajo 'sealed' — ⛔ no debe valuar NINGUNA caja
const MAPPED_CENTS = 120_000; // override manual bajo sealed:tcg:<PID_MAPPED>
const PARITY_CENTS = 150_000; // override manual bajo sealed:tcg:<PID_PARITY>
const TCGCSV_CENTS = 99_000; // fuente automática bajo sealed:tcg:<PID_TCGCSV> (el dial la gatea)
const RAW_CENTS = 5_000; // raw:NM normal de la carta de control
const GRADED_CENTS = 30_000; // graded:PSA:10 de la carta de control
// productIds reservados para esta suite (fuera del rango del seed y de P-83 983_xxx).
const PID_MAPPED = 985_001;
const PID_PARITY = 985_002;
const PID_TCGCSV = 985_003;

type PriceInfo = { status: 'priced' | 'pending'; referenceMxnCents?: number };
type Holding = { inventoryItemId: string; referenceValue: PriceInfo };
type Holdings = { data: Holding[]; portfolio: { totalValueMxnCents: number; pendingPriceCount: number } };
type Bucket = { atReferenceCents: number; pendingPriceCount: number; pieceCount: number };
type InventoryValue = Bucket & { breakdown: { raw: Bucket; sealed: Bucket; graded: Bucket } };

describe('E2E — SK-5: una sola llave de valuación para el sellado en los seis lectores', () => {
  let h: E2EHarness;
  let admin: string;
  let passwordHash: string | null;
  let setId: string;
  let boxCardId: string; // la Card ancla de las cajas (lleva la fila legada 'sealed')
  let ctlCardId: string; // la Card de control raw/graduada
  const userIds: string[] = [];
  const itemIds: string[] = [];
  let seq = 0;
  let dialBefore: unknown | undefined; // fila previa de sealed_price_source (undefined = no había)

  const today = () => new Date(new Date().toISOString().slice(0, 10));

  async function ref(cardId: string, productType: 'raw' | 'graded' | 'sealed', gradeKey: string, cents: number, source: 'manual' | 'tcgcsv' = 'manual') {
    await h.prisma.priceReference.create({
      data: {
        cardId, productType, gradeKey, finish: 'normal', source, priceMxnCents: cents,
        capturedDate: today(), isManualOverride: source === 'manual',
      },
    });
  }

  async function mkCustomer(tag: string) {
    seq += 1;
    const u = await h.prisma.user.create({
      data: {
        email: `sk5.${tag}.${RUN}.${seq}@e2e.local`, passwordHash, name: `SK5 ${tag}`, role: 'customer',
        emailVerified: true,
      },
    });
    userIds.push(u.id);
    const token = await h.login(u.email!, E2E_USERS.customer.password);
    return { id: u.id, email: u.email, token };
  }

  type PieceSpec =
    | { kind: 'box'; tcgplayerProductId?: number | null }
    | { kind: 'raw' }
    | { kind: 'graded'; gradingCompany: 'PSA' | null; gradeValue: string | null };

  async function mkPiece(ownerUserId: string | null, spec: PieceSpec) {
    seq += 1;
    const common = {
      folio: `SK5-${RUN}-${String(seq).padStart(3, '0')}`,
      acquisitionType: 'compra' as const,
      acquisitionCostCents: 0,
      finish: 'normal' as const,
      ...(ownerUserId
        ? { ownerType: 'customer' as const, ownerUserId, status: 'in_custody' as const, ownershipStatus: 'settled' as const }
        : { ownerType: 'platform' as const, status: 'in_stock' as const }),
    };
    const data =
      spec.kind === 'box'
        ? {
            ...common, cardId: boxCardId, productType: 'sealed' as const, sealedSubtype: 'box' as const,
            sealedCondition: 'mint' as const, sealedProductName: `SK5 Caja ${seq}`,
            tcgplayerProductId: spec.tcgplayerProductId ?? null,
          }
        : spec.kind === 'raw'
          ? { ...common, cardId: ctlCardId, productType: 'raw' as const, rawCondition: 'NM' }
          : {
              ...common, cardId: ctlCardId, productType: 'graded' as const,
              gradingCompany: spec.gradingCompany, gradeValue: spec.gradeValue,
            };
    const it = await h.prisma.inventoryItem.create({ data: data as never });
    itemIds.push(it.id);
    return it.id;
  }

  // --- lectores -------------------------------------------------------------------------------
  async function holdings(token: string): Promise<Holdings> {
    const res = await h.api('GET', '/vault/holdings', { token });
    expect(res.status).toBe(200);
    return res.body as Holdings;
  }
  async function holdingDetail(token: string, id: string): Promise<PriceInfo> {
    const res = await h.api('GET', `/vault/holdings/${id}`, { token });
    expect(res.status).toBe(200);
    return (res.body as { referenceValue: PriceInfo }).referenceValue;
  }
  async function custody(): Promise<number> {
    const res = await h.api('GET', '/admin/finance/custody-value', { token: admin });
    expect(res.status).toBe(200);
    return (res.body as { totalCustodyValueCents: number }).totalCustodyValueCents;
  }
  async function vaultRow(email: string) {
    const res = await h.api('GET', `/admin/vaults?q=${encodeURIComponent(email)}`, { token: admin });
    expect(res.status).toBe(200);
    const row = (res.body.data as { email: string; totalValueMxnCents: number; pendingPriceCount: number; pieceCount: number }[])
      .find((r) => r.email === email);
    expect(row).toBeDefined();
    return row!;
  }
  async function owned(userId: string): Promise<Map<string, PriceInfo>> {
    const res = await h.api('GET', `/admin/users/${userId}`, { token: admin });
    expect(res.status).toBe(200);
    const items = (res.body.ownedItems ?? res.body.data?.ownedItems) as { inventoryItemId: string; referenceValue: PriceInfo }[];
    expect(Array.isArray(items)).toBe(true);
    return new Map(items.map((i) => [i.inventoryItemId, i.referenceValue]));
  }
  async function inventoryValue(): Promise<InventoryValue> {
    const res = await h.api('GET', '/admin/finance/inventory-value', { token: admin });
    expect(res.status).toBe(200);
    return res.body as InventoryValue;
  }
  async function sealedTab(token: string) {
    const res = await h.api('GET', '/vault/sealed', { token });
    expect(res.status).toBe(200);
    return res.body as { data: { marketValue: PriceInfo; count: number }[]; totalValueMxnCents: number; pendingPriceCount: number };
  }
  const row = (hs: Holdings, id: string) => {
    const r = hs.data.find((d) => d.inventoryItemId === id);
    expect(r).toBeDefined();
    return r!.referenceValue;
  };

  async function setDial(value: 'tcgcsv' | 'off') {
    await h.prisma.configSetting.upsert({
      where: { key: 'sealed_price_source' },
      create: { key: 'sealed_price_source', valueJson: value },
      update: { valueJson: value },
    });
  }

  beforeAll(async () => {
    h = await E2EHarness.create();
    admin = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    passwordHash = (await h.prisma.user.findUniqueOrThrow({ where: { email: E2E_USERS.customer.email } })).passwordHash;
    const set = await h.prisma.cardSet.create({ data: { externalId: `sk5-set-${RUN}`, name: `SK5 Set ${RUN}` } });
    setId = set.id;
    boxCardId = (
      await h.prisma.card.create({ data: { externalId: `sk5-box-${RUN}`, setId, name: 'SK5 Ancla', number: '1' } })
    ).id;
    ctlCardId = (
      await h.prisma.card.create({ data: { externalId: `sk5-ctl-${RUN}`, setId, name: 'SK5 Control', number: '2' } })
    ).id;
    // La fila legada 'sealed' (como la dejaban las versiones previas a v1.70) + las de mercado por producto.
    await ref(boxCardId, 'sealed', 'sealed', LEGACY_CENTS);
    await ref(boxCardId, 'sealed', `sealed:tcg:${PID_MAPPED}`, MAPPED_CENTS);
    await ref(boxCardId, 'sealed', `sealed:tcg:${PID_PARITY}`, PARITY_CENTS);
    await ref(boxCardId, 'sealed', `sealed:tcg:${PID_TCGCSV}`, TCGCSV_CENTS, 'tcgcsv');
    await ref(ctlCardId, 'raw', 'raw:NM', RAW_CENTS);
    await ref(ctlCardId, 'graded', 'graded:PSA:10', GRADED_CENTS);
    const prev = await h.prisma.configSetting.findUnique({ where: { key: 'sealed_price_source' } });
    dialBefore = prev ? prev.valueJson : undefined;
    // Estado de partida explícito: dial APAGADO (el default money-safe). Cada test que lo enciende lo apaga.
    await setDial('off');
  }, 180000);

  afterAll(async () => {
    if (!h) return;
    if (dialBefore === undefined) await h.prisma.configSetting.deleteMany({ where: { key: 'sealed_price_source' } });
    else await h.prisma.configSetting.update({ where: { key: 'sealed_price_source' }, data: { valueJson: dialBefore as never } });
    await h.prisma.inventoryItem.deleteMany({ where: { id: { in: itemIds } } });
    if (boxCardId || ctlCardId) {
      await h.prisma.priceReference.deleteMany({ where: { cardId: { in: [boxCardId, ctlCardId].filter(Boolean) } } });
      await h.prisma.pendingPriceEntry.deleteMany({ where: { cardId: { in: [boxCardId, ctlCardId].filter(Boolean) } } }).catch(() => undefined);
      await h.prisma.card.deleteMany({ where: { id: { in: [boxCardId, ctlCardId].filter(Boolean) } } });
    }
    if (setId) await h.prisma.cardSet.deleteMany({ where: { id: setId } });
    await h.prisma.auditLog.deleteMany({ where: { actorUserId: { in: userIds } } }).catch(() => undefined);
    await h.prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => undefined);
    await h.close();
  });

  it('VK-3 — caja de CLIENTE sin mapeo + fila legada `sealed` MX$800 ⇒ `pending` en las cinco superficies de cliente/custodia', async () => {
    const u = await mkCustomer('vk3');
    const c0 = await custody();
    const box = await mkPiece(u.id, { kind: 'box', tcgplayerProductId: null });
    const rawId = await mkPiece(u.id, { kind: 'raw' }); // ancla del total: prueba que el total NO es 0 por otra razón

    // holdings — fila `pending`, fuera del total, +1 pendiente
    const hs = await holdings(u.token);
    expect(row(hs, box)).toEqual({ status: 'pending' });
    expect(row(hs, rawId)).toMatchObject({ status: 'priced', referenceMxnCents: RAW_CENTS });
    expect(hs.portfolio).toMatchObject({ totalValueMxnCents: RAW_CENTS, pendingPriceCount: 1 });
    // holdingDetail
    expect(await holdingDetail(u.token, box)).toEqual({ status: 'pending' });
    // custody-value — NO sube 80 000
    expect((await custody()) - c0).toBe(RAW_CENTS);
    // /admin/vaults — +1 pendiente, total sin la legada
    expect(await vaultRow(u.email!)).toMatchObject({ pieceCount: 2, totalValueMxnCents: RAW_CENTS, pendingPriceCount: 1 });
    // ficha 360° — `pending`
    const o = await owned(u.id);
    expect(o.get(box)).toEqual({ status: 'pending' });
    expect(o.get(rawId)).toMatchObject({ status: 'priced', referenceMxnCents: RAW_CENTS });
  });

  it('VK-3 (6º lector) — caja de PLATAFORMA sin mapeo ⇒ inventory-value la cuenta pendiente, la legada no suma', async () => {
    const v0 = await inventoryValue();
    await mkPiece(null, { kind: 'box', tcgplayerProductId: null });
    const v1 = await inventoryValue();
    expect(v1.breakdown.sealed.atReferenceCents - v0.breakdown.sealed.atReferenceCents).toBe(0);
    expect(v1.breakdown.sealed.pendingPriceCount - v0.breakdown.sealed.pendingPriceCount).toBe(1);
  });

  it('VK-4 — caja MAPEADA con `sealed:tcg:<id>` MX$1,200 (manual) y legada MX$800 en la misma Card ⇒ 120000 en todas, nunca 80000', async () => {
    const u = await mkCustomer('vk4');
    const c0 = await custody();
    const v0 = await inventoryValue();
    const box = await mkPiece(u.id, { kind: 'box', tcgplayerProductId: PID_MAPPED });
    await mkPiece(null, { kind: 'box', tcgplayerProductId: PID_MAPPED });

    const hs = await holdings(u.token);
    expect(row(hs, box)).toMatchObject({ status: 'priced', referenceMxnCents: MAPPED_CENTS });
    expect(hs.portfolio).toMatchObject({ totalValueMxnCents: MAPPED_CENTS, pendingPriceCount: 0 });
    expect(await holdingDetail(u.token, box)).toMatchObject({ status: 'priced', referenceMxnCents: MAPPED_CENTS });
    expect((await custody()) - c0).toBe(MAPPED_CENTS);
    expect(await vaultRow(u.email!)).toMatchObject({ pieceCount: 1, totalValueMxnCents: MAPPED_CENTS, pendingPriceCount: 0 });
    expect((await owned(u.id)).get(box)).toMatchObject({ status: 'priced', referenceMxnCents: MAPPED_CENTS });
    const v1 = await inventoryValue();
    expect(v1.breakdown.sealed.atReferenceCents - v0.breakdown.sealed.atReferenceCents).toBe(MAPPED_CENTS);
  });

  it('VK-5 — paridad entre pestañas: «Mis piezas» y «Sellado» dan el MISMO número de la misma caja', async () => {
    const u = await mkCustomer('vk5');
    const box = await mkPiece(u.id, { kind: 'box', tcgplayerProductId: PID_PARITY });
    const hs = await holdings(u.token);
    const st = await sealedTab(u.token);
    expect(st.data).toHaveLength(1);
    expect(row(hs, box).referenceMxnCents).toBe(PARITY_CENTS);
    expect(row(hs, box).referenceMxnCents).toBe(st.data[0].marketValue.referenceMxnCents);
    expect(hs.portfolio.totalValueMxnCents).toBe(st.totalValueMxnCents);
  });

  it('VK-5 — dial APAGADO + ref `tcgcsv` ⇒ AMBAS pestañas `pending` (y los seis lectores no la suman)', async () => {
    await setDial('off');
    const u = await mkCustomer('vk5off');
    const c0 = await custody();
    const v0 = await inventoryValue();
    const box = await mkPiece(u.id, { kind: 'box', tcgplayerProductId: PID_TCGCSV });
    await mkPiece(null, { kind: 'box', tcgplayerProductId: PID_TCGCSV });

    const hs = await holdings(u.token);
    const st = await sealedTab(u.token);
    expect(row(hs, box)).toEqual({ status: 'pending' });
    expect(st.data[0].marketValue).toEqual({ status: 'pending' });
    expect(hs.portfolio).toMatchObject({ totalValueMxnCents: 0, pendingPriceCount: 1 });
    expect(await holdingDetail(u.token, box)).toEqual({ status: 'pending' });
    expect((await custody()) - c0).toBe(0);
    expect(await vaultRow(u.email!)).toMatchObject({ totalValueMxnCents: 0, pendingPriceCount: 1 });
    expect((await owned(u.id)).get(box)).toEqual({ status: 'pending' });
    const v1 = await inventoryValue();
    expect(v1.breakdown.sealed.atReferenceCents - v0.breakdown.sealed.atReferenceCents).toBe(0);
    expect(v1.breakdown.sealed.pendingPriceCount - v0.breakdown.sealed.pendingPriceCount).toBe(1);
  });

  it('VK-5 CONTROL — dial ENCENDIDO + ref `tcgcsv` ⇒ ambas pestañas `priced` con el mismo número', async () => {
    await setDial('tcgcsv');
    try {
      const u = await mkCustomer('vk5on');
      const c0 = await custody();
      const box = await mkPiece(u.id, { kind: 'box', tcgplayerProductId: PID_TCGCSV });
      const hs = await holdings(u.token);
      const st = await sealedTab(u.token);
      expect(row(hs, box)).toMatchObject({ status: 'priced', referenceMxnCents: TCGCSV_CENTS });
      expect(st.data[0].marketValue.referenceMxnCents).toBe(TCGCSV_CENTS);
      expect(await holdingDetail(u.token, box)).toMatchObject({ status: 'priced', referenceMxnCents: TCGCSV_CENTS });
      expect((await custody()) - c0).toBe(TCGCSV_CENTS);
      expect(await vaultRow(u.email!)).toMatchObject({ totalValueMxnCents: TCGCSV_CENTS, pendingPriceCount: 0 });
      expect((await owned(u.id)).get(box)).toMatchObject({ status: 'priced', referenceMxnCents: TCGCSV_CENTS });
    } finally {
      await setDial('off');
    }
  });

  it('VK-7 CONTROL — raw y graduada con identidad: el mismo número de siempre; graduada sin identidad sigue `pending`', async () => {
    const u = await mkCustomer('vk7');
    const c0 = await custody();
    const rawId = await mkPiece(u.id, { kind: 'raw' });
    const gId = await mkPiece(u.id, { kind: 'graded', gradingCompany: 'PSA', gradeValue: '10' });
    const noId = await mkPiece(u.id, { kind: 'graded', gradingCompany: null, gradeValue: null });

    const hs = await holdings(u.token);
    expect(row(hs, rawId)).toMatchObject({ status: 'priced', referenceMxnCents: RAW_CENTS });
    expect(row(hs, gId)).toMatchObject({ status: 'priced', referenceMxnCents: GRADED_CENTS });
    expect(row(hs, noId)).toEqual({ status: 'pending' });
    expect(hs.portfolio).toMatchObject({ totalValueMxnCents: RAW_CENTS + GRADED_CENTS, pendingPriceCount: 1 });
    expect(await holdingDetail(u.token, rawId)).toMatchObject({ status: 'priced', referenceMxnCents: RAW_CENTS });
    expect(await holdingDetail(u.token, gId)).toMatchObject({ status: 'priced', referenceMxnCents: GRADED_CENTS });
    expect(await holdingDetail(u.token, noId)).toEqual({ status: 'pending' });
    expect((await custody()) - c0).toBe(RAW_CENTS + GRADED_CENTS);
    expect(await vaultRow(u.email!)).toMatchObject({ pieceCount: 3, totalValueMxnCents: RAW_CENTS + GRADED_CENTS, pendingPriceCount: 1 });
    const o = await owned(u.id);
    expect(o.get(rawId)).toMatchObject({ status: 'priced', referenceMxnCents: RAW_CENTS });
    expect(o.get(gId)).toMatchObject({ status: 'priced', referenceMxnCents: GRADED_CENTS });
    expect(o.get(noId)).toEqual({ status: 'pending' });
  });
});
