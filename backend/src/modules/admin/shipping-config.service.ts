/**
 * shipping-config.service.ts — 💰 D2f: M10 «Envíos» del lado servidor (API_CONTRACT §19.13, §19.19.6, §19.20.3, §19.22.3).
 *
 *  - Empaques: lectura (operador+) y reemplazo entero (súper-admin) de `ShippingPackage`, con bitácora
 *    `shipping.packages_updated {before, after}` en la MISMA tx que la escritura. Dos `PUT` a la vez se serializan con
 *    `LOCK TABLE … SHARE ROW EXCLUSIVE` (el segundo ve el resultado del primero como su `before`; ⛔ mezcla de los dos).
 *  - Catálogos y Carta Porte: del proveedor, sin PII (la lista blanca la hace el adaptador; aquí solo se proyecta al DTO).
 *  - Saldo: EN VIVO por `ProviderBalanceService.readFresh` (refresca el caché del tablero y pasa por `observeBalance`).
 *  Con el adaptador `noop` (sin credenciales) ⇒ `409 SHIPPING_PROVIDER_NOT_CONFIGURED {missing:['env']}`; fallas del
 *  proveedor ⇒ `502 SHIPPING_PROVIDER_ERROR` / `503 SHIPPING_PROVIDER_BUSY` (los de siempre, `toBusinessException`).
 *  ⛔ Estas lecturas NO miran el dial `shipping_provider`: son de solo lectura y el dueño las necesita para configurar ANTES de
 *  encender (elegir plantilla de origen y Carta Porte); el dial apaga cotizar, comprar y los jobs (§19.10, SEC-SDX-12).
 */
import { Inject, Injectable } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';
import { SettingKey } from '../settings/settings.constants';
import { ProviderBalanceService } from '../spend-alerts/provider-balance.service';
import { SHIPPING_PROVIDER_PORT, ShippingProviderPort } from '../shipping-provider/shipping-provider.port';
import { ShippingProviderError } from '../shipping-provider/shipping-provider.errors';
import { parseConsignmentDescription, parsePackagesBody, ShippingPackageDTO } from './shipping-config';

const PACKAGE_SELECT = {
  code: true,
  label: true,
  lengthCm: true,
  widthCm: true,
  heightCm: true,
  weightKg: true,
  providerPackageType: true,
  active: true,
  sortOrder: true,
  customerFeeCents: true, // v1.86⟨accesorios⟩ (§AC.7): la tarifa entra sola a `shipping.packages_updated {before, after}`
} as const;

export interface ShippingCatalogsDTO {
  packagings: { code: string; name: string }[];
  consignmentNote: { code: string; description: string } | null;
  addressTemplates: { id: string; alias: string; addressType: 'from' | 'to'; isDefault: boolean; postalCode: string }[];
}

export interface ShippingBalanceDTO {
  balanceCents: number;
  currency: 'MXN';
  lowBalance: boolean;
  thresholdCents: number;
  fetchedAt: string;
}

/** El error del proveedor como respuesta HTTP; lo que no es del proveedor ⇒ `502` sin detalle crudo. */
async function viaProvider<T>(op: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ShippingProviderError) throw e.toBusinessException();
    throw ShippingProviderError.error(op, null).toBusinessException();
  }
}

@Injectable()
export class ShippingConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly balance: ProviderBalanceService,
    @Inject(SHIPPING_PROVIDER_PORT) private readonly port: ShippingProviderPort,
  ) {}

  private list(db: Prisma.TransactionClient | PrismaService = this.prisma): Promise<ShippingPackageDTO[]> {
    return db.shippingPackage.findMany({ orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }], select: PACKAGE_SELECT });
  }

  async listPackages(): Promise<{ packages: ShippingPackageDTO[] }> {
    return { packages: await this.list() };
  }

  async replacePackages(body: unknown, actor: { id: string; role: Role }): Promise<{ packages: ShippingPackageDTO[] }> {
    const next = parsePackagesBody(body);
    const packages = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`LOCK TABLE "ShippingPackage" IN SHARE ROW EXCLUSIVE MODE`;
      const before = await this.list(tx);
      await tx.shippingPackage.deleteMany({ where: { code: { notIn: next.map((p) => p.code) } } });
      for (const p of next) await tx.shippingPackage.upsert({ where: { code: p.code }, update: p, create: p });
      const after = await this.list(tx);
      await this.audit.log(
        { actorUserId: actor.id, actorRole: actor.role, action: 'shipping.packages_updated', entityType: 'ShippingPackage', before: { packages: before }, after: { packages: after } },
        tx,
      );
      return after;
    });
    return { packages };
  }

  async catalogs(): Promise<ShippingCatalogsDTO> {
    const port = this.port;
    if (!port.packagings || !port.consignmentNote || !port.addressTemplates) throw ShippingProviderError.notConfigured(['env']).toBusinessException();
    const code = await this.settings.get<string | null>(SettingKey.SHIPPING_CONSIGNMENT_NOTE);
    const [packagings, consignmentNote, templates] = await Promise.all([
      viaProvider('packagings', () => port.packagings!()),
      code ? viaProvider('consignment_notes', () => port.consignmentNote!(code)) : Promise.resolve(null),
      viaProvider('address_templates', () => port.addressTemplates!()),
    ]);
    return {
      packagings: packagings.map((p) => ({ code: p.code, name: p.name })),
      consignmentNote: consignmentNote ? { code: consignmentNote.code, description: consignmentNote.description } : null,
      // El DTO exige `addressType ∈ {from, to}`: una plantilla sin tipo legible no se puede elegir como origen ⇒ fuera.
      addressTemplates: templates
        .filter((t): t is typeof t & { addressType: 'from' | 'to' } => t.addressType === 'from' || t.addressType === 'to')
        .map((t) => ({ id: t.id, alias: t.alias ?? '', addressType: t.addressType, isDefault: t.isDefault, postalCode: t.postalCode ?? '' })),
    };
  }

  async searchConsignmentNotes(description: unknown): Promise<{ consignmentNotes: { code: string; description: string }[]; hasMore: boolean }> {
    const q = parseConsignmentDescription(description);
    const port = this.port;
    if (!port.searchConsignmentNotes) throw ShippingProviderError.notConfigured(['env']).toBusinessException();
    const r = await viaProvider('consignment_notes', () => port.searchConsignmentNotes!(q));
    return { consignmentNotes: r.consignmentNotes.map((n) => ({ code: n.code, description: n.description })), hasMore: r.hasMore };
  }

  async liveBalance(): Promise<ShippingBalanceDTO> {
    const [r, thresholdCents] = await Promise.all([
      viaProvider('balance', () => this.balance.readFresh()),
      this.settings.getNumber(SettingKey.SKYDROPX_LOW_BALANCE_CENTS),
    ]);
    return { balanceCents: r.balanceCents, currency: 'MXN', lowBalance: r.balanceCents < thresholdCents, thresholdCents, fetchedAt: r.readAt.toISOString() };
  }
}
