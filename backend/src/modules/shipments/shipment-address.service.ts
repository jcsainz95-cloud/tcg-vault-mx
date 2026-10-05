/**
 * shipment-address.service.ts — 💰 `PUT /api/v1/admin/shipments/:shipmentId/address`: corregir la dirección del envío
 * (API_CONTRACT §M4-SHIP.19.20.1, errata v1.80.12; ARCHITECTURE §4.60 (m); `HECHOS.md` 2026-10-04 «Poder corregir
 * todo»; criterio 315). Fase C, M-64 = `M-SDX-C`. Propiedad: backend.
 *
 * ⛔ Escribe SOLO `ShipmentRequest.addressSnapshot` (+ versión y sello) y, por corrección, UNA `ShipmentAddressRevision`
 * (los valores) y UNA fila de bitácora SIN valores (v1.80.12.2, SKX-SEC-1). Nunca la libreta (`Address`) ni
 * `Order.shippingAddressSnapshot` (evidencia de lo que el cliente capturó al pagar). Operador+, ⛔ sin depender de los
 * diales de Skydropx (`shipping_provider`, `shipping_label_purchase`).
 *
 * ⭐💰 D2a (M-66 = `M-SDX-D`, §M4-SHIP.19.23.3, v1.80.12.3) — la guarda «ya tiene guía» con las columnas nuevas, en el
 * MISMO pase que las crea (⛔ no puede existir un despliegue con `labelSource` en el esquema y una guarda que no lo lea):
 *   · `labelSourceOf(row) = row.labelSource ?? (row.trackingNumber ? 'manual' : null)` (§19.2): la fila legada (número
 *     sin `labelSource`, anterior a v1.81 y sin backfill) sigue siendo guía manual;
 *   · paso 3: estado ⇒ `SHIPMENT_ALREADY_LABELED` ⇒ `LABEL_IN_PROGRESS` (reclamo de compra vivo) ⇒ versión;
 *   · el `WHERE` del CAS expresa el MISMO predicado entero: `labelSource`, `trackingNumber` y `labelProcessingSince`
 *     nulos + versión. Candado y `WHERE` son dos muros (§19.23.2): cada uno basta solo; las mutaciones van por pares.
 * Hoy una guía manual siempre lleva el envío a `guia` en la misma tx (`setTracking`, `REL-C`), así que la rama legada es
 * defensa en profundidad (BACKEND_NOTES §58); las de Skydropx las escribirá D2c (`label`), y PS-104 las siembra.
 */
import { Injectable } from '@nestjs/common';
import { Prisma, Role, ShipmentRequest } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/business.exception';
import { PostalCodeService } from '../shipping-provider/geo/postal-code';
import { optionalText, requiredPostalCode, requiredText } from '../users/address-rules';
import { ShipmentsService } from './shipments.service';
import { labelSourceOf } from './label-source';

export interface CorrectShipmentAddressReq {
  expectedAddressVersion: number;
  recipientName: string;
  line1: string;
  line2: string | null;
  postalCode: string;
  neighborhood: string;
  /** ⭐ v1.80.12.5 (§M4-SHIP.19.25.1): obligatorio, 1..120; solo se escribe con el CP fuera del catálogo. */
  city: string;
  /** ⭐ v1.80.12.5: ídem `city`. */
  state: string;
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

/** §19.2 / §19.23.3 (1) — UN helper; vive en `label-source.ts` (sin ciclo de imports) y se re-exporta aquí. */
export { labelSourceOf };

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
    city: requiredText(body, 'city'),
    state: requiredText(body, 'state'),
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
    // 2. ⭐ v1.80.12.5 (§M4-SHIP.19.25.1): `resolveAddressGeo`, FUERA de la tx (el mismo cuerpo que
    //    `GET /geo/postal-codes/:cp`, `C-SDX-3`). ⛔ Sin `422` geográficos: `city`/`state` del cuerpo solo cuentan con
    //    el CP fuera del catálogo; con el CP dentro ganan los del catálogo.
    const geo = await this.postalCodes.resolveAddressGeo(req.postalCode, req.neighborhood, req.city, req.state);

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
        // 5. CAS: la versión que el operador vio, y la fila todavía corregible — el MISMO predicado que la guarda del
        //    paso 3, entero (§19.23.3 (3): sin guía de ningún origen, legada incluida, y sin reclamo de compra vivo).
        const cas = await tx.shipmentRequest.updateMany({
          where: {
            id: shipmentId,
            status: 'picking',
            labelSource: null,
            trackingNumber: null,
            labelProcessingSince: null,
            addressVersion: req.expectedAddressVersion,
          },
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
        // 6. ⭐ v1.80.12.2 (§M4-SHIP.19.22.1, SKX-SEC-1): en la MISMA tx, (a) los VALORES en `ShipmentAddressRevision`
        //    (la anonimización de cuenta la borra) y (b) la bitácora SIN valores: versión, claves y la revisión.
        //    ⛔ Ningún valor del snapshot en `AuditLog`. Si (a) o (b) fallan, la corrección no ocurre.
        const before: Record<string, unknown> = {};
        const after: Record<string, unknown> = {};
        for (const k of changed) {
          before[k] = prev[k] ?? null;
          after[k] = wanted[k];
        }
        const revision = await tx.shipmentAddressRevision.create({
          data: {
            shipmentRequestId: shipmentId,
            fromVersion: req.expectedAddressVersion,
            changedKeys: [...changed],
            before: before as Prisma.InputJsonValue,
            after: after as Prisma.InputJsonValue,
            correctedByUserId: actor.id,
          },
          select: { id: true },
        });
        await tx.auditLog.create({
          data: {
            actorUserId: actor.id,
            actorRole: actor.role,
            action: 'shipment.address_corrected',
            entityType: 'ShipmentRequest',
            entityId: shipmentId,
            before: { addressVersion: req.expectedAddressVersion },
            after: { addressVersion: req.expectedAddressVersion + 1, changedKeys: [...changed], revisionId: revision.id },
          },
        });
        return 'corrected' as const;
      },
      { maxWait: 10_000, timeout: 30_000 },
    );
    // 7. Commit ⇒ `200 { outcome, shipment: AdminShipmentDTO }`.
    return { outcome, shipment: await this.shipments.adminGet(shipmentId) };
  }

  /** Paso 3 (§19.23.3 (2)): `status` ⇒ guía ⇒ compra en vuelo ⇒ versión, en ese orden (PS-104). */
  private assertCorrectable(row: ShipmentRequest, expectedAddressVersion: number): void {
    if (row.status !== 'picking') {
      throw BusinessException.conflict('SHIPMENT_NOT_IN_PREPARATION', 'Shipment is not in preparation', { status: row.status });
    }
    const labelSource = labelSourceOf(row);
    if (labelSource !== null) {
      throw BusinessException.conflict('SHIPMENT_ALREADY_LABELED', 'Shipment already has a label', { labelSource });
    }
    // Reclamo de compra vivo (§19.7 paso 7): la compra salió o está saliendo con la dirección de AHORA. Sin `details`.
    if (row.labelProcessingSince !== null) {
      throw BusinessException.conflict('LABEL_IN_PROGRESS', 'A label purchase is in progress for this shipment');
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
