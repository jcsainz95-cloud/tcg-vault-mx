import { ConfigService } from '@nestjs/config';
import { AdminService } from '../src/modules/admin/admin.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';

/**
 * ⭐ **`dataHealth.lastFxAt` — el tablero y el panel del FX nombran LA MISMA FILA** (v1.63.2).
 *
 * ### El defecto
 * `admin.service.ts` leía `fxRate.findFirst({ orderBy: { createdAt: 'desc' } })`: **sin filtro de
 * fuente**, y ordenando por otra columna que el lector canónico. Antes de I-FX5 era defendible —la
 * fila `manual-<hoy>` **sí** regía—; **desde I-FX5 no rige nunca**, así que el tablero afirmaba la
 * frescura del tipo de cambio **apoyándose en una fila que el propio sistema declara inerte**. Y
 * `PUT /admin/fx { rate }` escribe exactamente esa fila.
 *
 * ### Por qué importa en producción y no solo en teoría
 * Con **D-OPS-1** abierta (sin `BANXICO_SIE_TOKEN` el refresco **no escribe fila**), el tablero podía
 * decir «FX de hoy» durante semanas mientras `automatic.status` decía `missing`/`stale` en la otra
 * pantalla: **dos superficies de admin contestando distinto sobre el mismo dinero.**
 *
 * ### Qué significa la etiqueta, dicho de una vez
 * **`lastFxAt` = cuándo se escribió la fila de Banxico QUE HOY RIGE.** No es «el último HTTP 200 a
 * Banxico»: si el refresco corre dos veces el mismo día, el `upsert` actualiza la fila y `createdAt`
 * no se mueve (`FxRate` no tiene `updatedAt`). Es la lectura honesta de lo que la tabla sabe, y es la
 * que hace imposible que las dos pantallas se contradigan.
 */
describe('⭐ dashboard.dataHealth.lastFxAt — la MISMA fila que rige, o nada', () => {
  const HOY = new Date('2026-09-09T12:00:00Z');
  const AYER = new Date('2026-09-08T12:00:00Z');

  /** Tabla `FxRate` en memoria que respeta lo único que decide aquí: el filtro y el orden. */
  function build(filas: { source: string; effectiveDate: Date; createdAt: Date }[]) {
    const prisma: any = {
      order: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        aggregate: jest.fn().mockResolvedValue({ _sum: { totalCents: 0 } }),
      },
      shipmentRequest: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
      sellRequest: {
        count: jest.fn().mockResolvedValue(0),
        aggregate: jest.fn().mockResolvedValue({ _sum: { approvedTotalCents: 0 } }),
      },
      dispute: { count: jest.fn().mockResolvedValue(0) },
      pendingPriceEntry: { count: jest.fn().mockResolvedValue(0) },
      priceReference: { findFirst: jest.fn().mockResolvedValue(null) },
      fxRate: {
        findFirst: jest.fn(async (args?: { where?: { source?: string }; orderBy?: Record<string, string> }) => {
          const src = args?.where?.source;
          const campo = Object.keys(args?.orderBy ?? { createdAt: 'desc' })[0] as
            | 'createdAt'
            | 'effectiveDate';
          const filtradas = filas.filter((f) => src == null || f.source === src);
          return (
            [...filtradas].sort((a, b) => b[campo].getTime() - a[campo].getTime())[0] ?? null
          );
        }),
      },
      user: { count: jest.fn().mockResolvedValue(0) },
      inventoryItem: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new AdminService(
      prisma as unknown as PrismaService,
      {} as PricingService,
      new PiiCryptoService(new ConfigService({})),
      {} as never,
    );
    return { service, prisma };
  }

  it('⭐ una fila `manual` de HOY no vuelve fresco el tablero: sin Banxico, `lastFxAt` es null', async () => {
    // Es el estado exacto de un entorno con D-OPS-1 abierta donde el dueño fijó una tasa a mano.
    const { service } = build([{ source: 'manual', effectiveDate: HOY, createdAt: HOY }]);
    const res: any = await service.dashboard('vault_operator' as never);
    expect(res.dataHealth.lastFxAt).toBeNull(); // ⛔ rojo con `findFirst` sin filtro de fuente
  });

  it('con las dos fuentes, gana la de Banxico aunque la manual sea más reciente', async () => {
    const { service } = build([
      { source: 'banxico', effectiveDate: AYER, createdAt: AYER },
      { source: 'manual', effectiveDate: HOY, createdAt: HOY },
    ]);
    const res: any = await service.dashboard('vault_operator' as never);
    expect(res.dataHealth.lastFxAt).toEqual(AYER);
  });

  it('estructural: se lee con el MISMO predicado y el MISMO orden que el lector canónico (I-FX5)', async () => {
    const { service, prisma } = build([{ source: 'banxico', effectiveDate: HOY, createdAt: HOY }]);
    await service.dashboard('vault_operator' as never);
    // Si alguien reintroduce un `findFirst` a secas, o cambia el orden, esta aserción cae. Es la
    // mitad que impide que las dos superficies vuelvan a nombrar filas distintas.
    expect(prisma.fxRate.findFirst).toHaveBeenCalledWith({
      where: { source: 'banxico' },
      orderBy: { effectiveDate: 'desc' },
    });
  });

  it('sin ninguna fila, `lastFxAt` es null (y no una fecha inventada)', async () => {
    const { service } = build([]);
    const res: any = await service.dashboard('vault_operator' as never);
    expect(res.dataHealth.lastFxAt).toBeNull();
  });
});
