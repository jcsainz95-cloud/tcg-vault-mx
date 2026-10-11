/**
 * departure.service.ts — ⭐ D2d: «Salida de hoy» (API_CONTRACT §M4-SHIP.19.9, sin recolección — decisión 2; criterio 240;
 * S-GAS-1 `folio`, §19.30.8). Operador+. ⛔ No toca la red: sigue con `shipping_provider='off'` (SEC-SDX-12).
 *
 *  - `GET /admin/shipments/departure?date=YYYY-MM-DD` — los envíos `status='guia'` con guía de Skydropx (guía y sin salir),
 *    agrupados por paquetería (la preferida primero, `isPreferred`; el respaldo forma su propio grupo), dentro por
 *    `labelPurchasedAt asc`; `date` (default: hoy en `America/Mexico_City`) filtra `labelPurchasedAt ≤ fin de ese día MX` —
 *    la vista es «lo que está por salir», no «lo de hoy». `manualPending` = envíos `guia` con guía manual (conteo).
 *    ⛔ Sin precios, sin teléfonos, sin dirección completa: LISTA BLANCA.
 *  - `POST /admin/shipments/departed {shipmentIds}` — para CADA id, en su propia tx con candado de fila:
 *    `transitionFromProvider(tx, id, 'enviado')` (el MISMO cuerpo que el sondeo y que `PATCH …/status {to:'enviado'}`: CAS
 *    `WHERE status='guia'`, guardas de §M4-SHIP.6, piezas `shipped`, `shippedAt`) y `AV-5` POST-COMMIT al ganador.
 *    `already_shipped` ⇔ CAS 0 y `status ∈ {enviado, entregado}` (sin segundo AV-5); `rejected` con el código de la guarda.
 *    Bitácora `shipment.departed {batchId}` por envío movido. Idempotente por construcción (PS-77).
 */
import { randomUUID } from 'crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/business.exception';
import { DATE_ONLY_RE } from '../../common/admin-list-filters';
import { SettingsService } from '../settings/settings.service';
import { SettingKey } from '../settings/settings.constants';
import { dayMx } from '../spend-alerts/spend-alerts.service';
import { ShipmentsService } from './shipments.service';
import { LabelClock, SHIPMENTS_LABEL_CLOCK } from './label-clock';
import { asRate } from './label-view';
import { OUTBOUND_ONLY } from './label-subject';

const TX = { maxWait: 10_000, timeout: 30_000 } as const;
const MAX_IDS = 200;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface DepartureShipmentDTO {
  shipmentId: string;
  /** S-GAS-1 (§19.30.8): NUESTRO folio (admin; SDX-I-6). */
  folio: string;
  orderNumber: string | null;
  kind: 'vault_withdrawal' | 'guest_direct_ship';
  recipientName: string;
  city: string;
  trackingNumber: string;
  labelAvailable: boolean;
  labelPurchasedAt: string;
}

export interface DepartureBoardDTO {
  date: string;
  groups: {
    carrierName: string;
    carrierLabel: string;
    dropoff: { name: string; address: string } | null;
    isPreferred: boolean;
    shipments: DepartureShipmentDTO[];
  }[];
  manualPending: number;
}

export type DepartedOutcome = 'shipped' | 'already_shipped' | 'rejected';
export interface DepartedResultDTO {
  shipmentId: string;
  outcome: DepartedOutcome;
  code?: string;
}

/** El instante (exclusivo) en que termina el día civil `token` en `America/Mexico_City` (sin asumir el desfase). */
export function mxDayEndExclusive(token: string): Date {
  const [y, m, d] = token.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d + 1, 0, 0, 0);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Mexico_City',
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(t));
  const p = (k: string) => Number(parts.find((x) => x.type === k)?.value);
  const wall = Date.UTC(p('year'), p('month') - 1, p('day'), p('hour'), p('minute'), p('second'));
  return new Date(t - (wall - t));
}

/** `?date=` — ausente/vacío ⇒ hoy MX; fuera de formato o día inexistente (ida y vuelta, §M4-PREP) ⇒ `400 {field:'date'}`. */
export function parseDepartureDate(raw: unknown, now: Date): string {
  if (raw === undefined || raw === null) return dayMx(now);
  const token = String(raw).trim();
  if (token === '') return dayMx(now);
  const d = DATE_ONLY_RE.test(token) ? new Date(`${token}T00:00:00.000Z`) : new Date(NaN);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== token) {
    throw BusinessException.badRequest('VALIDATION_ERROR', 'invalid date (expected a calendar day as YYYY-MM-DD)', { field: 'date' });
  }
  return token;
}

/** `{ shipmentIds: string[] (1..200, uuid) }` ⇒ `400 VALIDATION_ERROR {field:'shipmentIds'}`. Repetidos ⇒ una vez. */
export function parseDepartedBody(raw: unknown): string[] {
  const b = (raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const ids = b.shipmentIds;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > MAX_IDS || !ids.every((x) => typeof x === 'string' && UUID_RE.test(x))) {
    throw BusinessException.badRequest('VALIDATION_ERROR', `shipmentIds must be 1..${MAX_IDS} uuids`, { field: 'shipmentIds' });
  }
  return [...new Set(ids as string[])];
}

@Injectable()
export class ShipmentDepartureService {
  private readonly logger = new Logger(ShipmentDepartureService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly shipments: ShipmentsService,
    @Inject(SHIPMENTS_LABEL_CLOCK) private readonly clock: LabelClock,
  ) {}

  async board(rawDate: unknown): Promise<DepartureBoardDTO> {
    const date = parseDepartureDate(rawDate, this.clock.now());
    const end = mxDayEndExclusive(date);
    const [rows, manualPending, preferred, dropoffs] = await Promise.all([
      this.prisma.shipmentRequest.findMany({
        // rev BSD-1 (censo BSD-B23): la salida de hoy es de envíos; la guía de ENTRADA la lleva el vendedor a la sucursal.
        where: { ...OUTBOUND_ONLY, status: 'guia', labelSource: 'skydropx', providerShipmentId: { not: null }, trackingNumber: { not: null }, labelPurchasedAt: { lt: end } },
        orderBy: [{ labelPurchasedAt: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          folio: true,
          orderId: true,
          carrier: true,
          trackingNumber: true,
          labelUrl: true,
          labelPurchasedAt: true,
          chosenRateJson: true,
          addressSnapshot: true,
          order: { select: { orderNumber: true } },
        },
      }),
      // T.10: la guía manual no entra a los grupos; se cuenta (incluye la heredada con número y `labelSource` nulo).
      this.prisma.shipmentRequest.count({
        where: { ...OUTBOUND_ONLY, status: 'guia', OR: [{ labelSource: 'manual' }, { labelSource: null, trackingNumber: { not: null } }] },
      }),
      this.settings.get<string[]>(SettingKey.SHIPPING_PREFERRED_CARRIERS),
      this.settings.get<Record<string, { name: string; address: string }> | null>(SettingKey.SHIPPING_DROPOFF_POINTS),
    ]);
    const first = Array.isArray(preferred) && preferred.length > 0 ? preferred[0] : null;
    const groups = new Map<string, DepartureBoardDTO['groups'][number]>();
    for (const r of rows) {
      const rate = asRate(r.chosenRateJson);
      const carrierName = rate?.carrierName ?? r.carrier ?? '';
      let g = groups.get(carrierName);
      if (!g) {
        const dp = dropoffs && typeof dropoffs === 'object' ? dropoffs[carrierName] : undefined;
        g = {
          carrierName,
          carrierLabel: rate?.carrierLabel ?? r.carrier ?? carrierName,
          dropoff: dp && typeof dp.name === 'string' && typeof dp.address === 'string' ? { name: dp.name, address: dp.address } : null,
          isPreferred: first !== null && carrierName === first,
          shipments: [],
        };
        groups.set(carrierName, g);
      }
      const snap = (r.addressSnapshot !== null && typeof r.addressSnapshot === 'object' && !Array.isArray(r.addressSnapshot) ? r.addressSnapshot : {}) as Record<string, unknown>;
      g.shipments.push({
        shipmentId: r.id,
        folio: r.folio,
        orderNumber: r.order?.orderNumber ?? null,
        kind: r.orderId == null ? 'vault_withdrawal' : 'guest_direct_ship',
        recipientName: typeof snap.recipientName === 'string' ? snap.recipientName : '',
        city: typeof snap.city === 'string' ? snap.city : '',
        trackingNumber: r.trackingNumber as string,
        labelAvailable: r.labelUrl !== null,
        labelPurchasedAt: (r.labelPurchasedAt as Date).toISOString(),
      });
    }
    const ordered = [...groups.values()].sort((a, b) => (a.isPreferred === b.isPreferred ? a.carrierName.localeCompare(b.carrierName) : a.isPreferred ? -1 : 1));
    return { date, groups: ordered, manualPending };
  }

  async departed(raw: unknown, actor: { id: string; role: Role }): Promise<{ results: DepartedResultDTO[] }> {
    const ids = parseDepartedBody(raw);
    const batchId = randomUUID();
    const results: DepartedResultDTO[] = [];
    for (const id of ids) {
      const now = this.clock.now();
      let res: DepartedResultDTO;
      try {
        res = await this.prisma.$transaction(async (tx) => {
          const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "ShipmentRequest" WHERE id = ${id} FOR UPDATE`;
          if (locked.length === 0) return { shipmentId: id, outcome: 'rejected' as const, code: 'NOT_FOUND' };
          const t = await this.shipments.transitionFromProvider(tx, id, 'enviado', { now });
          if (t.shipped) {
            await tx.auditLog.create({
              data: {
                actorUserId: actor.id,
                actorRole: actor.role,
                action: 'shipment.departed',
                entityType: 'ShipmentRequest',
                entityId: id,
                after: { batchId },
                createdAt: now,
              },
            });
            return { shipmentId: id, outcome: 'shipped' as const };
          }
          const cur = await tx.shipmentRequest.findUniqueOrThrow({ where: { id }, select: { status: true } });
          if (cur.status === 'enviado' || cur.status === 'entregado') return { shipmentId: id, outcome: 'already_shipped' as const };
          return { shipmentId: id, outcome: 'rejected' as const, code: 'CONFLICT' };
        }, TX);
      } catch (e) {
        if (!(e instanceof BusinessException)) throw e;
        res = { shipmentId: id, outcome: 'rejected', code: e.code };
      }
      // AV-5 al ganador del CAS y a nadie más (criterio 240: si el sondeo llegó antes, cero correos aquí).
      if (res.outcome === 'shipped') await this.shipments.notifyShipped(id);
      results.push(res);
    }
    this.logger.log(`shipment_departed batchId=${batchId} n=${ids.length} shipped=${results.filter((r) => r.outcome === 'shipped').length}`);
    return { results };
  }
}
