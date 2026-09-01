import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { BuylistService } from '../src/modules/buylist/buylist.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { UsersService } from '../src/modules/users/users.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';

const pii = new PiiCryptoService(new ConfigService({}));

/**
 * v1.51 (M-46, D7, ARCHITECTURE §4.39d) — **`InventoryItem.cardProductId`: la columna, la
 * propagación y el backfill.**
 *
 * ### Qué se cura
 * `SellRequestItem.cardProductId` existe desde M-32, y **tres comentarios** (schema, DTO y
 * ARCHITECTURE §4.29d) afirmaban desde v1.30 que *«se propaga al `InventoryItem` al convertir»*.
 * **Era falso**: `InventoryItem` **no tenía la columna** y `convertToInventory` **no la propagaba ni
 * podía**. Sin ella, §P.8 no se sostiene y con ella se cae D6: los conteos de la mesa de decisión
 * mezclarían una promo con la versión del set base — *«tengo 8» cuando son 5 de una y 3 de otra que
 * valen distinto*, y «una sugerencia basada en un conteo que mezcla identidades es **peor** que no
 * dar sugerencia, porque el operador la creería».
 */
function build(itemOverrides: Record<string, unknown> = {}) {
  const seen: { create?: any } = {};
  const prisma: any = {
    sellRequestItem: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'sri-1',
        cardId: 'c1',
        productType: 'raw',
        rawCondition: 'NM',
        finish: 'normal',
        cardProductId: null,
        offeredPriceCents: null,
        approvedPriceCents: 5000,
        quotedPriceCents: 4000,
        inventoryItemId: null,
        itemStatus: 'aprobada',
        card: {},
        ...itemOverrides,
      }),
      update: jest.fn(),
    },
    nextFolio: jest.fn(async () => 'INV-000001'),
    $transaction: jest.fn(async (cb: any) => cb(prisma)),
    inventoryItem: {
      create: jest.fn(async ({ data }: any) => {
        seen.create = data;
        return { id: 'inv-1', folio: data.folio };
      }),
      findFirst: jest.fn(async () => ({ id: 'inv-1' })),
    },
    inventoryMovement: { create: jest.fn() },
  };
  const svc = new BuylistService(
    prisma as PrismaService,
    {} as PricingService,
    {} as SettingsService,
    {} as UsersService,
    pii,
  );
  return { svc, prisma, seen };
}

// ============================================================================================
describe('§4.39d — `convertToInventory` PROPAGA `cardProductId` (la frase por fin es cierta)', () => {
  it('línea de PRODUCTO SEPARADO ⇒ la pieza queda ligada a ESE producto, no al set_base', async () => {
    const { svc, seen } = build({ cardProductId: 512345 });
    await svc.convertToInventory('sri-1', 'actor');
    expect(seen.create.cardProductId).toBe(512345);
  });

  it('línea de SET_BASE (`null`) ⇒ la pieza queda en `null` (retrocompatible)', async () => {
    const { svc, seen } = build({ cardProductId: null });
    await svc.convertToInventory('sri-1', 'actor');
    expect(seen.create.cardProductId).toBeNull();
  });

  it('⚠️ el costo de adquisición es el BRUTO de la línea: `offeredPriceCents` MANDA (§4.39i.5)', async () => {
    // Criterio 135: desde el ciclo, la fuente ÚNICA del costo es `offeredPriceCents` (congelado al
    // ofertar; no se mueve jamás — D2/D9). Registrar el COTIZADO de una pieza comprada a otro precio
    // ensuciaría el P&L por carta que M7 existe para mostrar.
    const { svc, seen } = build({ offeredPriceCents: 7000, approvedPriceCents: 5000 });
    await svc.convertToInventory('sri-1', 'actor');
    expect(seen.create.acquisitionCostCents).toBe(7000);
  });

  it('filas PRE-M-46 (`offeredPriceCents: null`) conservan el fallback aprobado ?? cotizado', async () => {
    const { svc, seen } = build({ offeredPriceCents: null, approvedPriceCents: 5000 });
    await svc.convertToInventory('sri-1', 'actor');
    expect(seen.create.acquisitionCostCents).toBe(5000);
    const b = build({ offeredPriceCents: null, approvedPriceCents: null, quotedPriceCents: 4000 });
    await b.svc.convertToInventory('sri-1', 'actor');
    expect(b.seen.create.acquisitionCostCents).toBe(4000);
  });

  it('⚠️ el ENVÍO no entra al costo de la pieza: solo viajan los campos de la línea', async () => {
    // Dos piezas idénticas compradas al mismo bruto tienen el MISMO costo y el MISMO margen, llegue
    // una en un paquete caro y la otra no. El `create` no toca ningún campo de envío.
    const { svc, seen } = build({ cardProductId: 512345 });
    await svc.convertToInventory('sri-1', 'actor');
    for (const k of Object.keys(seen.create)) {
      expect(k).not.toMatch(/shipping|guide|offerShipping/i);
    }
  });
});

// ============================================================================================
describe('§4.39d — el BACKFILL: COPIA por FK única, y por eso NO viola el criterio 160', () => {
  const MIGRATION = readFileSync(
    join(
      __dirname,
      '..',
      'prisma',
      'migrations',
      '20260901120000_m46_buylist_acquisition_cycle',
      'migration.sql',
    ),
    'utf8',
  );

  it('la columna se crea como `INTEGER` nullable (es el tcgplayerProductId, no el UUID interno)', () => {
    expect(MIGRATION).toMatch(/ALTER TABLE "InventoryItem" ADD COLUMN "cardProductId" INTEGER;/);
    // Sin `NOT NULL`: `null` = pieza de set_base, que es el estado de TODAS las filas de hoy.
    expect(MIGRATION).not.toMatch(/"cardProductId" INTEGER NOT NULL/);
  });

  it('⚠️ el backfill JOINEA por `sourceSellRequestItemId`, que es la FK `@unique`', () => {
    // ESTA es la distinción que hace legal al backfill y que QA va a mirar: el criterio 160 prohíbe
    // INFERIR identidad («ninguna migración puede adivinar si aquella pieza era la promo o la del
    // set base»). Aquí no se infiere nada: se COPIA, a través de una llave ÚNICA, el valor que EL
    // PROPIO VENDEDOR eligió al cotizar. *Copiar por una llave única no es adivinar por heurística.*
    expect(MIGRATION).toMatch(/inv\."sourceSellRequestItemId" = sri\."id"/);
    const schema = readFileSync(join(__dirname, '..', 'prisma', 'schema.prisma'), 'utf8');
    expect(schema).toMatch(/sourceSellRequestItemId\s+String\?\s+@unique/);
  });

  it('el backfill NO usa ninguna heurística (nada de rareza, nombre, fecha o acabado)', () => {
    const stmt = /UPDATE "InventoryItem"[\s\S]*?;/.exec(MIGRATION)?.[0] ?? '';
    expect(stmt).not.toMatch(/rarity|name|createdAt|LIKE|finish|ORDER BY/i);
  });

  it('es IDEMPOTENTE (`WHERE cardProductId IS NULL`): la segunda corrida toca 0 filas', () => {
    const stmt = /UPDATE "InventoryItem"[\s\S]*?;/.exec(MIGRATION)?.[0] ?? '';
    expect(stmt).toMatch(/inv\."cardProductId" IS NULL/);
    // Y no pisa un valor ya presente en la línea origen con un `null`.
    expect(stmt).toMatch(/sri\."cardProductId" IS NOT NULL/);
  });

  it('el otro backfill (bounty, D35) también es idempotente y NO adivina POR FILA', () => {
    // El número es 2 PARA TODAS porque es la política que fijó el dueño, no una inferencia; y no
    // toca bounties apagados ni completados (su meta no la consulta nadie).
    const stmt = /UPDATE "VariantPriceOverride"[\s\S]*?;/.exec(MIGRATION)?.[0] ?? '';
    expect(stmt).toMatch(/SET "bountyTargetQty" = 2/);
    expect(stmt).toMatch(/"bountyEnabled" = true/);
    expect(stmt).toMatch(/"bountyCompletedAt" IS NULL/);
    expect(stmt).toMatch(/"bountyTargetQty" IS NULL/);
    expect(stmt).not.toMatch(/bountyAcquiredQty/); // nada de deducir la meta de lo ya adquirido
  });

  it('⚠️ M-46 es ADITIVA PURA: cero `DROP`, cero cambio de tipo, cero UPDATE de dinero', () => {
    // Sobre el SQL EJECUTABLE, no sobre los comentarios (que dicen «cero DROP» y darían positivo).
    const sql = MIGRATION.replace(/^--.*$/gm, '');
    expect(sql).not.toMatch(/\bDROP\b/);
    expect(sql).not.toMatch(/ALTER COLUMN/);
    // Los ÚNICOS dos `UPDATE` del archivo son los dos backfills declarados.
    const updates = MIGRATION.match(/^UPDATE /gm) ?? [];
    expect(updates).toHaveLength(2);
  });

  it('⚠️ `offerShippingPaidByUs` NO SE CREA (retirada en v1.51.1 por D31)', () => {
    // Con UNA sola banda no hay `fee = 0` que desambiguar y el campo solo podría valer `true`; un
    // booleano de un solo valor INVITA a que alguien lo ponga en `false` y resucite la banda. Misma
    // doctrina que los diales retirados: no se apaga, DEJA DE EXISTIR.
    const sinComentarios = MIGRATION.replace(/^--.*$/gm, '');
    expect(sinComentarios).not.toMatch(/offerShippingPaidByUs/);
    const schema = readFileSync(join(__dirname, '..', 'prisma', 'schema.prisma'), 'utf8');
    expect(schema).not.toMatch(/offerShippingPaidByUs/);
  });

  it('⚠️ NO existe `pickupAddressId`: el domicilio es SNAPSHOT, no FK', () => {
    // Si apareciera, alguien haría el join e imprimiría la dirección VIVA — el bug exacto que el
    // snapshot existe para impedir. Además `Address` se puede BORRAR: una referencia viva dejaría
    // solicitudes en vuelo SIN ORIGEN.
    const schema = readFileSync(join(__dirname, '..', 'prisma', 'schema.prisma'), 'utf8');
    expect(schema).toMatch(/pickupAddressSnapshot\s+Json\?/);
    expect(schema.replace(/^\s*\/\/.*$/gm, '')).not.toMatch(/pickupAddressId/);
  });

  it('el invariante de v1.51.4: `offerReissueCount` es NOT NULL con default ⇒ CERO backfill', () => {
    expect(MIGRATION).toMatch(
      /ALTER TABLE "SellRequest" ADD COLUMN "offerReissueCount"\s+INTEGER NOT NULL DEFAULT 0;/,
    );
    const stmts = MIGRATION.match(/^UPDATE "SellRequest"/gm) ?? [];
    expect(stmts).toHaveLength(0); // ninguna fila de `SellRequest` se toca
  });
});

// ============================================================================================
describe('§4.39d — los TRES comentarios que mentían quedan corregidos', () => {
  const ROOT = join(__dirname, '..', '..');
  const FRASE_FALSA = /Se PROPAGA al InventoryItem al convertir \(M5\): la pieza queda ligada/;

  it('`schema.prisma` ya no afirma una propagación inexistente', () => {
    const schema = readFileSync(join(__dirname, '..', 'prisma', 'schema.prisma'), 'utf8');
    expect(schema).not.toMatch(FRASE_FALSA);
    expect(schema).toMatch(/CORREGIDO en v1\.51 \(M-46/);
  });

  it('`dto/buylist.dto.ts` ya no la afirma', () => {
    const dto = readFileSync(
      join(__dirname, '..', 'src', 'modules', 'buylist', 'dto', 'buylist.dto.ts'),
      'utf8',
    );
    expect(dto).not.toMatch(/snapshotea en SellRequestItem\.cardProductId[\s\S]{0,80}y al convertir a inventario la\n\s*\/\/ pieza queda ligada/);
    expect(dto).toMatch(/CORREGIDO en v1\.51 \(M-46/);
  });

  it('la deuda documental queda REGISTRADA en `docs/TECH_DEBT.md` con cierre = M-46', () => {
    // ARCHITECTURE §4.39d lo exige explícitamente («Backend registra la corrección en
    // docs/TECH_DEBT.md»), y §11 M-32 se contradecía a sí misma sin que hubiera entrada alguna.
    const debt = readFileSync(join(ROOT, 'docs', 'TECH_DEBT.md'), 'utf8');
    expect(debt).toMatch(/INV-D7/);
    expect(debt).toMatch(/M-46/);
  });
});
