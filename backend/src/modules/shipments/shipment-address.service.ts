/**
 * shipment-address.service.ts — 💰 `PUT /api/v1/admin/shipments/:shipmentId/address`: corregir la dirección del envío
 * (API_CONTRACT §M4-SHIP.19.20.1, errata v1.80.12; ARCHITECTURE §4.60 (m); `HECHOS.md` 2026-10-04 «Poder corregir
 * todo»; criterio 315). Fase C, M-64 = `M-SDX-C`. Propiedad: backend.
 *
 * ⛔ Escribe SOLO `ShipmentRequest.addressSnapshot` (+ versión y sello). Nunca la libreta (`Address`) ni
 * `Order.shippingAddressSnapshot` (evidencia de lo que el cliente capturó al pagar). Operador+, ⛔ sin depender de los
 * diales de Skydropx (`shipping_provider`, `shipping_label_purchase`).
 *
 * ⚠️ FASE C — lo que todavía NO existe y entra con `M-SDX-D` (D2): las columnas `labelSource` y
 * `labelProcessingSince`. Mientras tanto la guarda «ya tiene guía» se lee con `labelSourceOf` (= `trackingNumber ≠
 * null ⇒ 'manual'`, la regla de §19.2 para las filas sin `labelSource`) y el `WHERE` del CAS lleva `trackingNumber:
 * null` como su sustituto. D2 añade `labelSource: null` y `labelProcessingSince: null` (`409 LABEL_IN_PROGRESS`).
 * Hoy una guía manual siempre lleva el envío a `guia` en la misma tx (`setTracking`, `REL-C`), así que esa guarda
 * es inalcanzable sin datos legados: es defensa en profundidad y así se declara (BACKEND_NOTES §58).
 */
import { Injectable } from '@nestjs/common';
import { Prisma, Role, ShipmentRequest } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/business.exception';
import { PostalCodeService } from '../shipping-provider/geo/postal-code';
import { optionalText, requiredPostalCode, requiredText } from '../users/address-rules';
import { ShipmentsService } from './shipments.service';

export interface CorrectShipmentAddressReq {
  expectedAddressVersion: number;
  recipientName: string;
  line1: string;
  line2: string | null;
  postalCode: string;
  neighborhood: string;
  references: string | null;
}

export interface ShipmentAddressActor {
  id: string;
  role: Role;
}

/** Las claves del snapshot que este verbo puede cambiar (⛔ `phone` no: P-ADR-1). */
export const CORRECTABLE_SNAPSHOT_KEYS = [
  'recipientName',
  'line1',
  'line2',
  'postalCode',
  'neighborhood',
  'city',
  'state',
  'country',
  'references',
] as const;
type CorrectableKey = (typeof CORRECTABLE_SNAPSHOT_KEYS)[number];

/**
 * §19.2 — `labelSourceOf(row) = row.labelSource ?? (row.trackingNumber ? 'manual' : null)`. En fase C no hay columna
 * `labelSource`: queda la mitad derivada. D2 sustituye el cuerpo por el de §19.2 (⛔ sin cambiar a los lectores).
 */
export function labelSourceOf(row: Pick<ShipmentRequest, 'trackingNumber'>): 'manual' | null {
  return row.trackingNumber ? 'manual' : null;
}

/** El cuerpo, validado en el SERVIDOR con `400 VALIDATION_ERROR {field}` (el pipe global no emite `field`). */
export function parseCorrectAddressBody(raw: unknown): CorrectShipmentAddressReq {
  const body = (raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const v = body.expectedAddressVersion;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
    throw BusinessException.badRequest('VALIDATION_ERROR', 'expectedAddressVersion must be an integer >= 0', {
      field: 'expectedAddressVersion',
    });
  }
  return {
    expectedAddressVersion: v,
    recipientName: requiredText(body, 'recipientName'),
    line1: requiredText(body, 'line1'),
    line2: optionalText(body, 'line2'),
    postalCode: requiredPostalCode(body),
    neighborhood: requiredText(body, 'neighborhood'),
    references: optionalText(body, 'references'),
  };
}

@Injectable()
export class ShipmentAddressService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly postalCodes: PostalCodeService,
    private readonly shipments: ShipmentsService,
  ) {}

  async correct(shipmentId: string, raw: unknown, actor: ShipmentAddressActor) {
    // 1. Forma ⇒ 400; inexistente ⇒ 404.
    const req = parseCorrectAddressBody(raw);
    const exists = await this.prisma.shipmentRequest.findUnique({ where: { id: shipmentId }, select: { id: true } });
    if (!exists) throw BusinessException.notFound();
    // 2. La lista del CP, FUERA de la tx (el mismo cuerpo que `GET /geo/postal-codes/:cp`, `C-SDX-3`).
    const geo = await this.postalCodes.canonicalize(req.postalCode, req.neighborhood);

    const outcome = await this.prisma.$transaction(
      async (tx) => {
        // 3. Candado de fila (primera sentencia) y las guardas, en el orden del contrato.
        await tx.$queryRaw`SELECT id FROM "ShipmentRequest" WHERE id = ${shipmentId} FOR UPDATE`;
        const row = await tx.shipmentRequest.findUniqueOrThrow({ where: { id: shipmentId } });
        this.assertCorrectable(row, req.expectedAddressVersion);

        // 4. `next` y `changed` (solo las claves cuyo valor difiere; ausente ≡ null, así un snapshot de 9 campos sin
        //    `references` no «cambia» por recibir `references: null`).
        const prev = (row.addressSnapshot !== null && typeof row.addressSnapshot === 'object' && !Array.isArray(row.addressSnapshot)
          ? row.addressSnapshot
          : {}) as Record<string, unknown>;
        const wanted: Record<CorrectableKey, string | null> = {
          recipientName: req.recipientName,
          line1: req.line1,
          line2: req.line2,
          postalCode: geo.postalCode,
          neighborhood: geo.neighborhood,
          city: geo.city,
          state: geo.state,
          country: 'MX',
          references: req.references,
        };
        const changed = CORRECTABLE_SNAPSHOT_KEYS.filter((k) => (prev[k] ?? null) !== wanted[k]);
        if (changed.length === 0) return 'unchanged' as const;

        const next = { ...prev, ...wanted };
        const now = new Date();
        // 5. CAS: la versión que el operador vio, y la fila todavía corregible.
        const cas = await tx.shipmentRequest.updateMany({
          where: { id: shipmentId, status: 'picking', trackingNumber: null, addressVersion: req.expectedAddressVersion },
          data: {
            addressSnapshot: next as Prisma.InputJsonValue,
            addressVersion: { increment: 1 },
            addressCorrectedAt: now,
            addressCorrectedByUserId: actor.id,
          },
        });
        if (cas.count !== 1) {
          const actual = await tx.shipmentRequest.findUniqueOrThrow({ where: { id: shipmentId } });
          this.assertCorrectable(actual, req.expectedAddressVersion);
          throw this.addressChanged(actual.addressVersion);
        }
        // 6. Bitácora en la MISMA tx: antes/después SOLO de lo que cambió, y quién.
        const before: Record<string, unknown> = {};
        const after: Record<string, unknown> = {};
        for (const k of changed) {
          before[k] = prev[k] ?? null;
          after[k] = wanted[k];
        }
        after.addressVersion = req.expectedAddressVersion + 1;
        await tx.auditLog.create({
          data: {
            actorUserId: actor.id,
            actorRole: actor.role,
            action: 'shipment.address_corrected',
            entityType: 'ShipmentRequest',
            entityId: shipmentId,
            before: before as Prisma.InputJsonValue,
            after: after as Prisma.InputJsonValue,
          },
        });
        return 'corrected' as const;
      },
      { maxWait: 10_000, timeout: 30_000 },
    );
    // 7. Commit ⇒ `200 { outcome, shipment: AdminShipmentDTO }`.
    return { outcome, shipment: await this.shipments.adminGet(shipmentId) };
  }

  /** Paso 3: `status` ⇒ guía ⇒ versión, en ese orden (PS-104). */
  private assertCorrectable(row: ShipmentRequest, expectedAddressVersion: number): void {
    if (row.status !== 'picking') {
      throw BusinessException.conflict('SHIPMENT_NOT_IN_PREPARATION', 'Shipment is not in preparation', { status: row.status });
    }
    const labelSource = labelSourceOf(row);
    if (labelSource !== null) {
      throw BusinessException.conflict('SHIPMENT_ALREADY_LABELED', 'Shipment already has a label', { labelSource });
    }
    if (row.addressVersion !== expectedAddressVersion) throw this.addressChanged(row.addressVersion);
  }

  private addressChanged(addressVersion: number): BusinessException {
    return BusinessException.conflict('CONFLICT', 'The shipment address changed; reload it', {
      reason: 'address_changed',
      addressVersion,
    });
  }
}
