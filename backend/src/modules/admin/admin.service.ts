import { Injectable, Logger } from '@nestjs/common';
import { randomBytes, randomUUID } from 'crypto';
import * as argon2 from 'argon2';
import {
  AuthProvider,
  DisputeStatus,
  Finish,
  KycStatus,
  Locale,
  MarketBracket,
  OrderStatus,
  Prisma,
  ProductType,
  Role,
  SellRequestStatus,
  UserStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PricingService, PriceInfo, MONEY_REF_WHERE, isBetterRef } from '../pricing/pricing.service';
import { toCardDTO } from '../catalog/catalog.service';
import { UploadsService } from '../uploads/uploads.service';
import { PiiCryptoService } from '../../common/crypto/pii-crypto.service';
import { maskClabe, maskRfc } from '../../common/crypto/pii-mask';
import { BusinessException } from '../../common/business.exception';
import {
  MIN_PASSWORD_LENGTH,
  isStrongPassword,
  isValidEmailFormat,
  normalizeEmail,
} from '../../common/validation/credentials';

/**
 * v2.1.9 (R1) — **lista BLANCA de columnas de `KycProfile` que pueden salir de una respuesta admin.**
 *
 * Lo que deja fuera es el punto: `rfcEnc`, `clabeEnc` (PII cifrada en reposo), `ineFrontKey`/
 * `ineBackKey` (llaves de objeto R2 del INE) y **`clabeHmac`** — el *blind index* determinista, que
 * existe precisamente para comparar CLABEs SIN descifrarlas y por tanto **nunca** debe salir del
 * servidor. Al ser un `select` de Prisma, esas columnas ni siquiera se leen de la BD.
 *
 * `ineFrontKey`/`ineBackKey` SÍ se seleccionan, pero **sólo para derivar `ineOnFile: boolean`** en
 * `toAdminKycDTO` — exactamente el mismo trato que ya les da `getUser`. Las llaves no viajan.
 */
const ADMIN_KYC_SELECT = {
  id: true,
  userId: true,
  legalName: true,
  kycStatus: true,
  capPerRequestCentsOverride: true,
  capPerMonthCentsOverride: true,
  verifiedBy: true,
  verifiedAt: true,
  createdAt: true,
  updatedAt: true,
  // SOLO para `ineOnFile`; no se exponen (ver toAdminKycDTO).
  ineFrontKey: true,
  ineBackKey: true,
} satisfies Prisma.KycProfileSelect;

/**
 * v2.1.9 (S49-M1-R) — **las RELACIONES de la ficha 360°, proyectadas una por una.**
 *
 * ### El fallo que cierra, y por qué el sitio es instructivo
 * `getUser` filtraba la cabecera con una **lista NEGRA** (`const { passwordHash, ownedItems, ...safe }`)
 * y **no tocaba las relaciones del `include`**. `sellRequests: { take: 20 }` entraba como **filas
 * enteras**, así que `...safe` arrastraba **`clabeSnapshotEnc`** —el blob AES-256-GCM de la CLABE— a
 * un endpoint que el **`vault_operator`** puede leer. Es exactamente lo que S49-M1 cerró en las cinco
 * rutas de `buylist`, entrando por la puerta de al lado.
 *
 * Lo instructivo: **es la misma función cuyo `kycProfile` sirvió de modelo para arreglar R1**. Unas
 * líneas más abajo enmascara la CLABE con cuidado. La ruta que enseñaba el patrón correcto para una
 * relación filtraba por otra — porque la cabecera se filtraba con lista negra y las relaciones no se
 * miraban. Una lista negra protege de lo que su autor recordó; una relación entera no está en esa lista.
 *
 * Todas las proyecciones de abajo son **listas blancas** y espejan los refs que el contrato §M6 ya
 * declara (`AdminUserSellRequestRef`, `AdminUserDisputeRef`, `OrderSummaryDTO`, `AddressDTO`).
 */
function toAdminUserHeader(u: {
  id: string;
  email: string;
  name: string;
  role: Role;
  status: UserStatus;
  locale: Locale;
  emailVerified: boolean;
  authProvider: AuthProvider;
  phone: string | null;
  avatarUrl: string | null;
  mustChangePassword: boolean;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    status: u.status,
    locale: u.locale,
    emailVerified: u.emailVerified,
    authProvider: u.authProvider,
    phone: u.phone,
    avatarUrl: u.avatarUrl,
    mustChangePassword: u.mustChangePassword,
    deletedAt: u.deletedAt,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
    // FUERA por construcción: `passwordHash`, `tokenVersion` (revocación de sesiones), `googleId`,
    // `anonymizedAt`. Ninguno tiene por qué viajar en una ficha de back-office.
  };
}

/** `AdminUserSellRequestRef` (§M6). **Sin `clabeSnapshotEnc`** — el fallo exacto de S49-M1-R. */
function toAdminUserSellRequestRef(r: {
  id: string;
  status: SellRequestStatus;
  quotedTotalCents: number;
  createdAt: Date;
}) {
  return { id: r.id, status: r.status, quotedTotalCents: r.quotedTotalCents, createdAt: r.createdAt };
}

/** `AdminUserDisputeRef` (§M6). Sin `resolution`/`resolvedBy` (detalle operativo del caso). */
function toAdminUserDisputeRef(d: {
  id: string;
  status: DisputeStatus;
  type: string;
  createdAt: Date;
}) {
  return { id: d.id, status: d.status, type: d.type, createdAt: d.createdAt };
}

/** `OrderSummaryDTO` (§DTOs). **Sin `billingSnapshot`** (lleva `rfcEnc`) ni ids de Stripe. */
function toAdminUserOrderRef(o: {
  id: string;
  userId: string | null;
  orderNumber: string | null;
  status: OrderStatus;
  totalCents: number;
  createdAt: Date;
  settledAt: Date | null;
}) {
  return {
    id: o.id,
    userId: o.userId,
    orderNumber: o.orderNumber,
    status: o.status,
    totalCents: o.totalCents,
    createdAt: o.createdAt,
    settledAt: o.settledAt,
  };
}

/** `AddressDTO` (§DTOs) — misma lista blanca que `UsersService.toAddressDTO`. */
function toAdminUserAddressRef(a: {
  id: string;
  line1: string;
  line2: string | null;
  neighborhood: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  phone: string;
  isDefault: boolean;
}) {
  return {
    id: a.id,
    line1: a.line1,
    line2: a.line2,
    neighborhood: a.neighborhood,
    city: a.city,
    state: a.state,
    postalCode: a.postalCode,
    country: a.country,
    phone: a.phone,
    isDefault: a.isDefault,
  };
}

/**
 * v2.1.9 (R1) — proyección del KYC hacia el back-office. Espeja la que `getUser` ya emite
 * (`AdminKycProfileDTO` del contrato §M6): estado, límites y `ineOnFile`; **cero** PII cifrada.
 * Los `*Override` se renombran a `capPerRequestCents`/`capPerMonthCents`, que es como los llama el
 * contrato y como `getUser` los devuelve — el consumidor recibe la forma que ya conoce.
 */
function toAdminKycDTO(k: {
  id: string;
  userId: string;
  legalName: string | null;
  kycStatus: KycStatus;
  capPerRequestCentsOverride: number | null;
  capPerMonthCentsOverride: number | null;
  verifiedBy: string | null;
  verifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  ineFrontKey: string | null;
  ineBackKey: string | null;
}) {
  return {
    id: k.id,
    userId: k.userId,
    legalName: k.legalName,
    kycStatus: k.kycStatus,
    capPerRequestCents: k.capPerRequestCentsOverride,
    capPerMonthCents: k.capPerMonthCentsOverride,
    verifiedBy: k.verifiedBy,
    verifiedAt: k.verifiedAt,
    createdAt: k.createdAt,
    updatedAt: k.updatedAt,
    // El INE se reduce a un booleano: al back-office le basta saber SI está en archivo; la imagen
    // se sirve por presigned GET dedicado, nunca publicando su object key en un cuerpo de respuesta.
    ineOnFile: Boolean(k.ineFrontKey && k.ineBackKey),
  };
}

/**
 * Ventana de fechas de los reportes. v2.1.6 (fase de seguridad) — **valida**: antes hacía
 * `new Date(garbage)` y metía un `Invalid Date` directo al filtro de Prisma, que revienta con **500**
 * en un endpoint de reportes de dinero. Una entrada inválida es un **422 con el campo señalado**, no
 * un error de servidor. También rechaza el rango invertido (`from > to`), que devolvía un reporte
 * vacío indistinguible de «no hubo operaciones» — peor que un error, porque se lee como un dato.
 */
function range(from?: string, to?: string): Prisma.DateTimeFilter | undefined {
  if (!from && !to) return undefined;
  const parse = (raw: string, field: 'from' | 'to'): Date => {
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) {
      throw BusinessException.validation('VALIDATION_ERROR', `invalid ${field} date`, { field, value: raw });
    }
    return d;
  };
  const gte = from ? parse(from, 'from') : undefined;
  const lte = to ? parse(to, 'to') : undefined;
  if (gte && lte && gte.getTime() > lte.getTime()) {
    throw BusinessException.validation('VALIDATION_ERROR', 'from must be earlier than or equal to to', {
      field: 'from',
      from,
      to,
    });
  }
  return { ...(gte ? { gte } : {}), ...(lte ? { lte } : {}) };
}

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly pii: PiiCryptoService,
    private readonly uploads: UploadsService,
  ) {}

  // ---------------- M6 Users ----------------

  /**
   * Alta de usuario por rol desde back-office (E1, v1.7-admin-users). API_CONTRACT §M6 /
   * ARCHITECTURE §4.7bis. super_admin-only (el guard lo aplica el controller); NO es dinero
   * saliente. Crea cuentas de CUALQUIER rol sin KYC/CLABE/INE (datos self-service).
   *
   * VALIDACIÓN → 422: la validación semántica (email, rol, locale, longitud de password) se
   * hace aquí y lanza `BusinessException.validation` (422 VALIDATION_ERROR), como exige el
   * contrato §M6. El ValidationPipe global solo cubre la estructura (@IsString) y devuelve 400;
   * el 422 de reglas de negocio se resuelve en el servicio (mismo patrón que uploads/settings).
   *
   * SEGURIDAD: la contraseña (autogenerada o provista) se hashea con argon2 (patrón
   * `auth.service.ts`); NUNCA se persiste ni se devuelve en claro salvo `tempPassword` (solo
   * cuando se autogeneró) y NUNCA entra al AuditLog. Crear `super_admin` es escalada de
   * privilegios: el control es super_admin-only + auditoría (en el controller).
   */
  async createUser(dto: {
    email?: unknown;
    name?: unknown;
    role?: unknown;
    password?: unknown;
    phone?: unknown;
    locale?: unknown;
  }): Promise<{
    user: {
      id: string;
      email: string;
      name: string;
      role: Role;
      locale: string;
      status: string;
      emailVerified: boolean;
      authProvider: string;
      createdAt: Date;
    };
    tempPassword?: string;
    mustChangePassword: boolean;
  }> {
    // --- Validación semántica → 422 VALIDATION_ERROR (contrato §M6) ---
    // BE-9: reusa el validador compartido de credenciales (misma regla que /auth/register).
    if (!isValidEmailFormat(dto.email)) {
      throw BusinessException.validation('VALIDATION_ERROR', 'Invalid email');
    }
    // email se lowercasea antes de persistir/validar unicidad (paridad con /auth/register).
    const email = normalizeEmail(dto.email);

    if (typeof dto.name !== 'string' || dto.name.trim().length === 0) {
      throw BusinessException.validation('VALIDATION_ERROR', 'Name is required');
    }
    const name = dto.name.trim();

    const roles: Role[] = [Role.customer, Role.vault_operator, Role.super_admin];
    if (typeof dto.role !== 'string' || !roles.includes(dto.role as Role)) {
      throw BusinessException.validation('VALIDATION_ERROR', 'Invalid role');
    }
    const role = dto.role as Role;

    if (dto.locale !== undefined && dto.locale !== null) {
      if (typeof dto.locale !== 'string' || !['es', 'en'].includes(dto.locale)) {
        throw BusinessException.validation('VALIDATION_ERROR', 'Invalid locale');
      }
    }
    const locale = (dto.locale as string | undefined) ?? 'es';

    if (dto.phone !== undefined && dto.phone !== null && typeof dto.phone !== 'string') {
      throw BusinessException.validation('VALIDATION_ERROR', 'Invalid phone');
    }
    const phone = (dto.phone as string | undefined) ?? undefined;

    // password: si se provee, política de /auth/register (MinLength 8). Si se omite, se
    // autogenera una temporal de ALTA ENTROPÍA reusando el generador del reset M-15
    // (randomBytes(18).base64url) y se devuelve UNA sola vez en `tempPassword`.
    let autogenerated = false;
    let plainPassword: string;
    if (dto.password === undefined || dto.password === null || dto.password === '') {
      autogenerated = true;
      plainPassword = randomBytes(18).toString('base64url');
    } else {
      // BE-9: fortaleza mínima vía validador compartido (misma regla que /auth/register).
      if (!isStrongPassword(dto.password)) {
        throw BusinessException.validation(
          'VALIDATION_ERROR',
          `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
        );
      }
      plainPassword = dto.password;
    }
    // mustChangePassword=true SOLO cuando la contraseña fue autogenerada (false si el admin la proveyó).
    const mustChangePassword = autogenerated;

    const passwordHash = await argon2.hash(plainPassword);

    let user;
    try {
      user = await this.prisma.user.create({
        data: {
          email,
          passwordHash,
          name,
          role,
          phone,
          locale: locale as never,
          authProvider: 'local',
          // emailVerified=true para TODO rol creado por admin (staff como el seed; el customer
          // porque el admin da fe de la identidad). NO se dispara correo de verificación.
          emailVerified: true,
          mustChangePassword,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw BusinessException.conflict('EMAIL_TAKEN', 'Email already registered');
      }
      throw e;
    }

    return {
      // shape público (sin passwordHash).
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        locale: user.locale,
        status: user.status,
        emailVerified: user.emailVerified,
        authProvider: user.authProvider,
        createdAt: user.createdAt,
      },
      // tempPassword SOLO si se autogeneró (nunca si el admin envió password).
      ...(autogenerated ? { tempPassword: plainPassword } : {}),
      mustChangePassword,
    };
  }

  async listUsers(q: string | undefined, status: string | undefined, page: number, pageSize: number) {
    const where: Prisma.UserWhereInput = {};
    if (status) where.status = status as never;
    if (q) where.OR = [{ email: { contains: q, mode: 'insensitive' } }, { name: { contains: q, mode: 'insensitive' } }];
    const [data, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: { id: true, email: true, name: true, role: true, status: true, createdAt: true },
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.user.count({ where }),
    ]);
    return { data, page, pageSize, total };
  }

  /**
   * Ficha 360° (compras, bóveda, buylist, disputas, KYC). API_CONTRACT §M6.
   *
   * PII cifrada en reposo: la CLABE y el RFC se descifran y se devuelven SIEMPRE
   * ENMASCARADOS (nunca en claro), incluso para `super_admin`. La CLABE en claro solo
   * se obtiene por el endpoint dedicado `reveal-clabe` (money-out + auditado) al pagar SPEI.
   *
   * SEC-A4: segregación de funciones. El `vault_operator` es un rol de menor confianza
   * (opera M1/M4/M5 hasta verificación; sin finanzas/config). NO debe ver PII bancaria/
   * fiscal/identidad. Se le entrega una proyección REDUCIDA: CLABE enmascarada; RFC e INE
   * keys omitidos; billingProfile omitido. El `super_admin` ve CLABE/RFC enmascarados +
   * INE keys (para servir la imagen por presigned GET) + billingProfile con RFC enmascarado.
   */
  async getUser(id: string, role?: Role) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        kycProfile: true,
        billingProfile: true,
        addresses: true,
        orders: { orderBy: { createdAt: 'desc' }, take: 20 },
        sellRequests: { orderBy: { createdAt: 'desc' }, take: 20 },
        disputes: { orderBy: { createdAt: 'desc' }, take: 20 },
        ownedItems: { include: { card: { include: { set: true } } } },
      },
    });
    if (!user) throw BusinessException.notFound();
    // v2.1.9 (S49-M1-R): antes esto era `const { passwordHash, ownedItems, ...safe } = user` — una
    // lista NEGRA que quitaba dos campos conocidos y dejaba pasar TODO lo demás, incluidas las
    // RELACIONES del `include` como filas enteras. `sellRequests` arrastraba `clabeSnapshotEnc` (el
    // blob AES-256-GCM de la CLABE) a un endpoint que el `vault_operator` puede leer. Ahora cada
    // pieza pasa por su propia lista BLANCA (ver los proyectores del encabezado de este archivo).
    const safe = {
      ...toAdminUserHeader(user),
      addresses: user.addresses.map(toAdminUserAddressRef),
      orders: user.orders.map(toAdminUserOrderRef),
      sellRequests: user.sellRequests.map(toAdminUserSellRequestRef),
      disputes: user.disputes.map(toAdminUserDisputeRef),
      kycProfile: user.kycProfile,
      billingProfile: user.billingProfile,
    };
    const _ownedRaw = user.ownedItems;
    // Conforma la bóveda al contrato §M6 `AdminUserOwnedItemRef` (v1.8-ronda-c / BE-10):
    // { inventoryItemId, folio, card: CardDTO, productType, finish, ownershipStatus, referenceValue }.
    // `referenceValue` reusa la MISMA valuación por-acabado del HoldingDTO (getReference); los items
    // sin precio del día llevan status="pending" (NO se excluyen: es vista 360°, no un total).
    const ownedItems = await this.ownedItemRefs(_ownedRaw);
    const clabeMasked = maskClabe(this.pii.decryptOptional(safe.kycProfile?.clabeEnc));

    if (role === Role.super_admin) {
      // super_admin: ficha completa PERO con CLABE/RFC enmascarados (nunca en claro).
      return {
        ...safe,
        ownedItems,
        kycProfile: safe.kycProfile
          ? (() => {
              const {
                clabeEnc: _c,
                rfcEnc: _r,
                clabeHmac: _h,
                capPerRequestCentsOverride,
                capPerMonthCentsOverride,
                ...rest
              } = safe.kycProfile;
              return {
                ...rest,
                clabeMasked,
                rfcMasked: maskRfc(this.pii.decryptOptional(_r)),
                capPerRequestCents: capPerRequestCentsOverride,
                capPerMonthCents: capPerMonthCentsOverride,
                ineOnFile: Boolean(safe.kycProfile.ineFrontKey && safe.kycProfile.ineBackKey),
              };
            })()
          : null,
        billingProfile: safe.billingProfile
          ? (() => {
              const { rfcEnc: _r, ...rest } = safe.billingProfile;
              return { ...rest, rfcMasked: maskRfc(this.pii.decryptOptional(_r)) };
            })()
          : null,
      };
    }

    // Proyección reducida para vault_operator (y cualquier rol no super_admin).
    return {
      ...safe,
      ownedItems,
      // KYC: solo estado/límites y una CLABE ENMASCARADA; sin INE ni CLABE/RFC completos.
      kycProfile: safe.kycProfile
        ? {
            id: safe.kycProfile.id,
            userId: safe.kycProfile.userId,
            legalName: safe.kycProfile.legalName,
            kycStatus: safe.kycProfile.kycStatus,
            clabeMasked,
            ineOnFile: Boolean(safe.kycProfile.ineFrontKey && safe.kycProfile.ineBackKey),
            capPerRequestCents: safe.kycProfile.capPerRequestCentsOverride,
            capPerMonthCents: safe.kycProfile.capPerMonthCentsOverride,
            verifiedAt: safe.kycProfile.verifiedAt,
          }
        : null,
      // Perfil de facturación (RFC/datos fiscales): oculto al operador.
      billingProfile: null,
    };
  }

  /**
   * BE-10 (v1.8-ronda-c): conforma la bóveda resumen de la ficha 360° admin al contrato
   * `AdminUserOwnedItemRef`, enriqueciendo cada item con `productType`, `finish` y `referenceValue`
   * (misma valuación por-acabado que el HoldingDTO del cliente). Los items sin referencia vigente
   * más reciente (sin filtro de fecha, en paridad con la valuación del cliente) quedan con
   * `referenceValue.status="pending"` (no se excluyen: es una vista 360°, no un total de portafolio).
   *
   * Rendimiento: evita el N+1 de `getReference` por item (BE-4/D3) con UNA lectura batch de
   * PriceReference por `cardId IN (...)`; se elige la referencia vigente por `(cardId, productType,
   * gradeKey, finish)` tomando la más reciente (`capturedDate desc`), misma semántica que `getReference`.
   */
  private async ownedItemRefs(
    items: {
      id: string;
      folio: string;
      cardId: string;
      productType: Prisma.InventoryItemGetPayload<{ include: { card: { include: { set: true } } } }>['productType'];
      finish: Prisma.InventoryItemGetPayload<object>['finish'];
      rawCondition: string | null;
      gradingCompany: string | null;
      gradeValue: string | null;
      ownershipStatus: Prisma.InventoryItemGetPayload<object>['ownershipStatus'];
      card: Prisma.CardGetPayload<{ include: { set: true } }>;
    }[],
  ) {
    if (items.length === 0) return [];
    const cardIds = [...new Set(items.map((i) => i.cardId))];
    const refs = await this.prisma.priceReference.findMany({
      // v1.50.3-f (M-43, §4.38l.4.4A): «cualquier lectura del reporte de dinero de admin» está
      // ENUMERADA en el dictamen. Este `findMany` alimenta el `referenceValue` y el valor de inventario
      // de la consola: sin el predicado, el estimado de un slab seguiría valuando la pieza en admin
      // aunque el storefront ya no la pricie — dos verdades del mismo dinero, que es peor que una mala.
      where: { cardId: { in: cardIds }, ...MONEY_REF_WHERE },
      orderBy: [{ capturedDate: 'desc' }, { createdAt: 'desc' }],
    });
    // §4.27f-2 (P47-2, v1.46): Mapa (cardId|productType|gradeKey|finish) → MEJOR referencia por el
    // desempate determinista money-safe (`isBetterRef`), NO «la primera vista» del orden `capturedDate
    // desc`. Bajo P47-2 el override manual es TIER SUPERIOR ABSOLUTO durable cross-day: «la primera
    // vista» mostraría la automática más fresca aunque exista un override humano durable (divergiendo de
    // `getReference` en la ficha 360°). Este findMany NO lleva `take`, así que todas las filas manuales
    // ya están presentes; solo hay que reducir con la MISMA precedencia que el resto de consumidores
    // (mismo patrón que `set-value.service.ts` / `getReferencesBatch`).
    const latest = new Map<string, (typeof refs)[number]>();
    // v1.22-2 / N-15 (§4.22a-6): acabados priceados (raw `raw:NM`, priceMxnCents>0) por carta para
    // displayFinishes — DERIVADO de los `refs` YA cargados (sin query extra ni N+1).
    const pricedByCard = new Map<string, Set<Finish>>();
    for (const r of refs) {
      const key = `${r.cardId}|${r.productType}|${r.gradeKey}|${r.finish}`;
      const cur = latest.get(key);
      if (cur == null || isBetterRef(r, cur)) latest.set(key, r);
      if (r.productType === 'raw' && r.gradeKey === 'raw:NM' && r.priceMxnCents > 0) {
        let s = pricedByCard.get(r.cardId);
        if (!s) {
          s = new Set<Finish>();
          pricedByCard.set(r.cardId, s);
        }
        s.add(r.finish);
      }
    }
    // v1.x-fx-live: valuación 360° VIVA — recalcula el MXN de referencias de mercado en USD con la FX
    // vigente (izada UNA vez), en paridad con getReference/getReferencesBatch. Overrides manuales y
    // precios nativos en MXN quedan congelados (los distingue `liveMxnCents`).
    const fx = await this.pricing.fxSnapshotSafe();
    return items.map((item) => {
      const gradeKey = this.pricing.gradeKeyFor(item);
      const r = latest.get(`${item.cardId}|${item.productType}|${gradeKey}|${item.finish}`);
      const referenceValue: PriceInfo = r
        ? {
            status: 'priced',
            referenceMxnCents: this.pricing.liveMxnCents(r, fx),
            source: r.source as PriceInfo['source'],
            capturedDate: r.capturedDate.toISOString().slice(0, 10),
          }
        : { status: 'pending' };
      return {
        inventoryItemId: item.id,
        folio: item.folio,
        card: toCardDTO(item.card, pricedByCard.get(item.cardId)),
        productType: item.productType,
        finish: item.finish,
        ownershipStatus: item.ownershipStatus,
        referenceValue,
      };
    });
  }

  /**
   * v2.1.9 (R1 — pentester, Media) — **proyectado**.
   *
   * Devolvía la entidad `KycProfile` COMPLETA: `rfcEnc`, `clabeEnc`, `ineFrontKey`, `ineBackKey` y —
   * lo más grave— **`clabeHmac`**, el *blind index* determinista de la CLABE. Ese HMAC está diseñado
   * para **no salir jamás del servidor**: es lo que permite comparar CLABEs sin descifrarlas, así que
   * publicarlo entrega un oráculo de igualdad («¿estas dos cuentas comparten CLABE?») y un valor
   * pre-computable contra un diccionario de CLABEs si la clave HMAC se filtrara.
   *
   * La decisión ya existía y esta ruta la ignoraba: la ruta hermana `getUser` (mismo `super_admin`)
   * borra a propósito `clabeEnc`/`rfcEnc`/`clabeHmac` y reduce el INE a un booleano `ineOnFile`. Aquí
   * se aplica **esa misma** proyección — no una inventada — vía `ADMIN_KYC_SELECT` + `toAdminKycDTO`.
   *
   * El `select` es lista BLANCA a nivel de BD: la PII cifrada **ni siquiera se lee**, así que una
   * columna sensible futura tampoco se auto-publica (la clase, no sólo el caso).
   */
  async updateUserKyc(
    id: string,
    kycStatus: string,
    capPerRequestCents?: number,
    capPerMonthCents?: number,
    verifiedBy?: string,
  ) {
    const row = await this.prisma.kycProfile.upsert({
      select: ADMIN_KYC_SELECT,
      where: { userId: id },
      create: {
        userId: id,
        kycStatus: kycStatus as never,
        capPerRequestCentsOverride: capPerRequestCents,
        capPerMonthCentsOverride: capPerMonthCents,
        verifiedBy,
        verifiedAt: kycStatus === 'verified' ? new Date() : undefined,
      },
      update: {
        kycStatus: kycStatus as never,
        capPerRequestCentsOverride: capPerRequestCents,
        capPerMonthCentsOverride: capPerMonthCents,
        verifiedBy,
        verifiedAt: kycStatus === 'verified' ? new Date() : undefined,
      },
    });
    return toAdminKycDTO(row);
  }

  /**
   * v2.1.7 (auditoría de la regla «ningún endpoint devuelve una entidad Prisma») — **proyectado**.
   *
   * Devolvía la fila `User` COMPLETA, o sea **`passwordHash`** (y `tokenVersion`, `googleId`,
   * `anonymizedAt`…) en el cuerpo de la respuesta. Es `super_admin` y el hash es un bcrypt, así que no
   * es una fuga explotable de inmediato — pero un hash de credencial no tiene ninguna razón para
   * viajar en una respuesta de «cambiar estado», y es exactamente el fallo que la norma predice:
   * cuando la respuesta ES la entidad, cada columna nueva del schema se auto-publica.
   *
   * La proyección NO se inventa: es la MISMA que ya usa `listUsers` (el endpoint hermano), así que el
   * consumidor recibe la forma que ya conoce.
   */
  async updateUserStatus(id: string, status: 'active' | 'blocked') {
    return this.prisma.user.update({
      where: { id },
      data: { status },
      select: { id: true, email: true, name: true, role: true, status: true, createdAt: true },
    });
  }

  /**
   * Reset de contraseña por admin (M6, super_admin) — SIN correo transaccional. ARCHITECTURE §4.7bis.
   * Genera una contraseña temporal de alta entropía, la hashea con argon2 (como /auth/register) y la
   * persiste. Revoca sesiones vivas (tokenVersion++) y fuerza cambio en el próximo login.
   *
   * SEGURIDAD: la contraseña temporal se devuelve UNA vez y NUNCA se persiste en claro ni se
   * loguea/audita (el AuditLog solo guarda action + actor + target).
   */
  async resetPassword(id: string): Promise<{ userId: string; tempPassword: string; mustChangePassword: boolean }> {
    const user = await this.prisma.user.findUnique({ where: { id }, select: { id: true, status: true } });
    if (!user) throw BusinessException.notFound();
    if (user.status === 'deleted') {
      throw BusinessException.validation('USER_DELETED', 'Cannot reset a deleted account');
    }
    // Alta entropía: 18 bytes → 24 chars base64url. No corresponde a ningún patrón adivinable.
    const tempPassword = randomBytes(18).toString('base64url');
    const passwordHash = await argon2.hash(tempPassword);
    await this.prisma.user.update({
      where: { id },
      data: {
        passwordHash,
        mustChangePassword: true,
        // Revoca refresh/access vigentes (el guard y /auth/refresh rechazan la versión previa).
        tokenVersion: { increment: 1 },
      },
    });
    return { userId: id, tempPassword, mustChangePassword: true };
  }

  /** Purga las imágenes de INE del object storage y limpia las keys (reusa la rutina de retención). */
  private async purgeIne(kyc: { id: string; ineFrontKey: string | null; ineBackKey: string | null } | null) {
    if (!kyc) return;
    for (const key of [kyc.ineFrontKey, kyc.ineBackKey]) {
      if (key) {
        try {
          await this.uploads.deleteObject(key);
        } catch (e) {
          this.logger.error(`user.delete: fallo al purgar INE ${key}: ${String(e)}`);
        }
      }
    }
  }

  /**
   * Borrado híbrido hard/soft (M6, super_admin). ARCHITECTURE §4.7bis, API_CONTRACT §M6.
   * "Tiene transacciones" = ≥1 fila en Order/SellRequest/ShipmentRequest/Dispute/InventoryItem(owner).
   *  - falso → HARD delete (cascada + purga INE).
   *  - verdadero → SOFT delete (status=deleted, anonimiza PII, conserva filas económicas, revoca login).
   * 409 CANNOT_DELETE_SELF si el actor es el propio usuario. Idempotente sobre cuentas ya soft-deleted.
   */
  async deleteUser(id: string, actorUserId: string): Promise<{ userId: string; mode: 'hard' | 'soft' }> {
    if (id === actorUserId) {
      throw new BusinessException('CANNOT_DELETE_SELF', 409, 'A super_admin cannot delete itself');
    }
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { kycProfile: true },
    });
    if (!user) throw BusinessException.notFound();

    // Idempotente: re-DELETE sobre una cuenta ya soft-deleted es no-op.
    if (user.status === 'deleted') {
      return { userId: id, mode: 'soft' };
    }

    const [orders, sellRequests, shipments, disputes, ownedItems] = await Promise.all([
      this.prisma.order.count({ where: { userId: id } }),
      this.prisma.sellRequest.count({ where: { userId: id } }),
      this.prisma.shipmentRequest.count({ where: { userId: id } }),
      this.prisma.dispute.count({ where: { userId: id } }),
      this.prisma.inventoryItem.count({ where: { ownerUserId: id } }),
    ]);
    const hasTransactions = orders + sellRequests + shipments + disputes + ownedItems > 0;

    // La imagen de INE se purga en AMBOS modos (dato de máxima sensibilidad).
    await this.purgeIne(user.kycProfile);

    if (!hasTransactions) {
      // HARD delete: cascada borra KycProfile/BillingProfile/Address/PortfolioSnapshot.
      await this.prisma.user.delete({ where: { id } });
      return { userId: id, mode: 'hard' };
    }

    // SOFT delete: conserva filas económicas; anonimiza PII y revoca login.
    await this.prisma.$transaction(async (tx) => {
      if (user.kycProfile) {
        await tx.kycProfile.update({
          where: { userId: id },
          data: {
            clabeEnc: null,
            clabeHmac: null,
            rfcEnc: null,
            legalName: null,
            ineFrontKey: null,
            ineBackKey: null,
          },
        });
      }
      // BillingProfile y Address contienen PII no económica → se eliminan (los snapshots
      // económicos viven en Order.billingSnapshot / SellRequest.clabeSnapshotEnc, no aquí).
      await tx.billingProfile.deleteMany({ where: { userId: id } });
      await tx.address.deleteMany({ where: { userId: id } });
      await tx.portfolioSnapshot.deleteMany({ where: { userId: id } });
      await tx.user.update({
        where: { id },
        data: {
          status: 'deleted',
          deletedAt: new Date(),
          anonymizedAt: new Date(),
          email: `deleted+${randomUUID()}@anon.invalid`,
          name: 'Usuario eliminado',
          phone: null,
          avatarUrl: null,
          googleId: null,
          passwordHash: null,
          mustChangePassword: false,
          tokenVersion: { increment: 1 },
        },
      });
    });
    return { userId: id, mode: 'soft' };
  }

  // ---------------- M7 Finance ----------------

  /** P&L: ingresos + envío − costo de lo vendido − comisiones Stripe = ganancia. */
  async pnl(from?: string, to?: string) {
    const createdAt = range(from, to);
    const settledOrders = await this.prisma.order.findMany({
      where: { status: 'settled', ...(createdAt ? { settledAt: createdAt } : {}) },
      include: { items: { include: { inventoryItem: true } } },
    });
    let incomeCents = 0;
    let stripeFeesCents = 0;
    let cogsCents = 0;
    for (const o of settledOrders) {
      incomeCents += o.subtotalCents;
      stripeFeesCents += o.processingFeeCents;
      for (const it of o.items) {
        cogsCents += it.inventoryItem.acquisitionCostCents ?? 0;
      }
    }
    // Fix correctness #3: los envíos también se acotan al periodo, por su fecha de
    // liquidación (`pickingAt` = cuando payment_intent.succeeded los movió a picking).
    const shipmentRange = range(from, to);
    const shipments = await this.prisma.shipmentRequest.findMany({
      where: {
        status: { in: ['picking', 'guia', 'enviado', 'entregado'] },
        ...(shipmentRange ? { pickingAt: shipmentRange } : {}),
      },
    });
    // v1.4-finance: el envío separa INGRESO (shippingFeeCents, lo que paga el cliente) de
    // COSTO (shippingCostCents, lo que la plataforma paga al carrier). Ambos se acotan al
    // mismo periodo/conjunto de envíos (por `pickingAt`) para que caigan en el mismo lapso.
    let shippingRevenueCents = 0;
    let shippingCostCents = 0;
    for (const s of shipments) {
      shippingRevenueCents += s.shippingFeeCents;
      shippingCostCents += s.shippingCostCents; // sin captura => 0 (default de columna)
      stripeFeesCents += s.processingFeeCents;
    }
    const profitCents =
      incomeCents + shippingRevenueCents - cogsCents - stripeFeesCents - shippingCostCents;
    return {
      incomeCents,
      shippingRevenueCents,
      cogsCents,
      stripeFeesCents,
      shippingCostCents,
      profitCents,
    };
  }

  /**
   * v1.28 (P-24, §4.26f / API_CONTRACT §M7, ADITIVO) — el valor del inventario gana
   * `breakdown { raw, sealed, graded }` (cada bucket `{ atReferenceCents, atCostCents,
   * pieceCount, pendingPriceCount }`). Los campos top-level = Σ del breakdown (invariante del
   * contrato; el `inventoryValueCents` del dashboard sigue siendo espejo del top-level).
   *
   * Valuación por pieza (money-safe: sin precio ⇒ EXCLUIDA del total y contada en
   * `pendingPriceCount` — nunca un 0 inventado):
   *  - raw/graded → referencia vigente del `(cardId, productType, gradeKey, finish)` del item
   *    (graded típicamente el override de MERCADO manual por grado, §M2 P-20);
   *  - sealed → **`sealedMarketRef`** (`sealed:tcg:<productId>` del mapeo M-23; norma §4.26f) con
   *    FALLBACK al gradeKey legacy `'sealed'` (override manual de mercado preexistente) para no
   *    perder valuaciones capturadas antes de v1.19 — antes se valuaba SOLO por el legacy.
   * Rendimiento: referencias en UN lote (`getReferencesBatch`, cierra la deuda N+1 anotada en
   * ese método), no una query por pieza.
   */
  async inventoryValue() {
    const items = await this.prisma.inventoryItem.findMany({
      where: { ownerType: 'platform', status: { in: ['in_stock', 'listed', 'reserved'] } },
      select: {
        cardId: true,
        productType: true,
        finish: true,
        rawCondition: true,
        gradingCompany: true,
        gradeValue: true,
        acquisitionCostCents: true,
        tcgplayerProductId: true,
      },
    });
    // Claves de valuación por pieza (para sealed mapeado entran AMBAS: mercado + legacy fallback).
    const keys: { cardId: string; productType: ProductType; gradeKey: string; finish: Finish }[] = [];
    for (const item of items) {
      if (item.productType === 'sealed') {
        const gk = this.pricing.sealedMarketGradeKeyForItem(item);
        if (gk) keys.push({ cardId: item.cardId, productType: 'sealed', gradeKey: gk, finish: 'normal' });
        keys.push({ cardId: item.cardId, productType: 'sealed', gradeKey: 'sealed', finish: 'normal' });
      } else {
        keys.push({
          cardId: item.cardId,
          productType: item.productType,
          gradeKey: this.pricing.gradeKeyFor(item),
          finish: item.finish,
        });
      }
    }
    const refs = keys.length ? await this.pricing.getReferencesBatch(keys) : new Map<string, PriceInfo>();
    const refCentsOf = (
      cardId: string,
      productType: string,
      gradeKey: string,
      finish: string,
    ): number | null => {
      const ref = refs.get(`${cardId}|${productType}|${gradeKey}|${finish}`);
      return ref && ref.status === 'priced' && ref.referenceMxnCents != null
        ? ref.referenceMxnCents
        : null;
    };

    const emptyBucket = () => ({
      atReferenceCents: 0,
      atCostCents: 0,
      pieceCount: 0,
      pendingPriceCount: 0,
    });
    const breakdown = { raw: emptyBucket(), sealed: emptyBucket(), graded: emptyBucket() };
    for (const item of items) {
      const bucket = breakdown[item.productType];
      bucket.pieceCount += 1;
      bucket.atCostCents += item.acquisitionCostCents ?? 0;
      let cents: number | null;
      if (item.productType === 'sealed') {
        const gk = this.pricing.sealedMarketGradeKeyForItem(item);
        cents =
          (gk ? refCentsOf(item.cardId, 'sealed', gk, 'normal') : null) ??
          refCentsOf(item.cardId, 'sealed', 'sealed', 'normal');
      } else {
        // v1.6-finish: valúa contra la referencia del ACABADO del item.
        cents = refCentsOf(item.cardId, item.productType, this.pricing.gradeKeyFor(item), item.finish);
      }
      if (cents != null) bucket.atReferenceCents += cents;
      else bucket.pendingPriceCount += 1;
    }

    // Top-level = Σ del breakdown (shape previo intacto; el breakdown es ADITIVO).
    const buckets = [breakdown.raw, breakdown.sealed, breakdown.graded];
    return {
      atReferenceCents: buckets.reduce((s, b) => s + b.atReferenceCents, 0),
      atCostCents: buckets.reduce((s, b) => s + b.atCostCents, 0),
      pendingPriceCount: buckets.reduce((s, b) => s + b.pendingPriceCount, 0),
      breakdown,
    };
  }

  async custodyValue() {
    const items = await this.prisma.inventoryItem.findMany({
      where: { ownerType: 'customer' },
    });
    let totalCustodyValueCents = 0;
    for (const item of items) {
      const gradeKey = this.pricing.gradeKeyFor(item);
      // v1.6-finish: valúa contra la referencia del ACABADO del item.
      const ref = await this.pricing.getReference(item.cardId, item.productType, gradeKey, item.finish);
      if (ref.status === 'priced' && ref.referenceMxnCents != null) {
        totalCustodyValueCents += ref.referenceMxnCents;
      }
    }
    return { totalCustodyValueCents };
  }

  async ivaReport(from?: string, to?: string) {
    const settledAt = range(from, to);
    const orders = await this.prisma.order.findMany({
      where: { status: { in: ['settled', 'refunded', 'chargeback'] }, ...(settledAt ? { settledAt } : {}) },
      select: { id: true, ivaCents: true, settledAt: true, status: true },
    });
    const ivaCollectedCents = orders
      .filter((o) => o.status === 'settled')
      .reduce((s, o) => s + o.ivaCents, 0);
    const byOrder = orders.map(({ id, ...rest }) => ({ orderId: id, ...rest }));
    return { ivaCollectedCents, byOrder };
  }

  async exportCsv(report: string, from?: string, to?: string): Promise<string> {
    if (report === 'pnl') {
      const p = await this.pnl(from, to);
      return `report,incomeCents,shippingRevenueCents,cogsCents,stripeFeesCents,shippingCostCents,profitCents\npnl,${p.incomeCents},${p.shippingRevenueCents},${p.cogsCents},${p.stripeFeesCents},${p.shippingCostCents},${p.profitCents}\n`;
    }
    if (report === 'iva') {
      const iva = await this.ivaReport(from, to);
      const rows = iva.byOrder.map((o) => `${o.orderId},${o.ivaCents},${o.status}`).join('\n');
      return `orderId,ivaCents,status\n${rows}\n`;
    }
    // inventory — v1.28 (P-24): columnas espejo del breakdown, ADITIVAS AL FINAL de la cabecera
    // (contrato §M7: `raw_… , sealed_… , graded_…`); las tres primeras columnas no cambian.
    const inv = await this.inventoryValue();
    const bucketCols = (b: {
      atReferenceCents: number;
      atCostCents: number;
      pieceCount: number;
      pendingPriceCount: number;
    }) => `${b.atReferenceCents},${b.atCostCents},${b.pieceCount},${b.pendingPriceCount}`;
    const bucketHeader = (p: string) =>
      `${p}_atReferenceCents,${p}_atCostCents,${p}_pieceCount,${p}_pendingPriceCount`;
    const header = `atReferenceCents,atCostCents,pendingPriceCount,${bucketHeader('raw')},${bucketHeader('sealed')},${bucketHeader('graded')}`;
    const row = `${inv.atReferenceCents},${inv.atCostCents},${inv.pendingPriceCount},${bucketCols(inv.breakdown.raw)},${bucketCols(inv.breakdown.sealed)},${bucketCols(inv.breakdown.graded)}`;
    return `${header}\n${row}\n`;
  }

  // ---------------- M9 Reports ----------------

  /**
   * Fix correctness #3: TODAS las métricas del periodo respetan el rango de fechas por
   * su fecha de realización: usuarios por alta, ventas por `settledAt`, buylist por
   * `paidAt`, retiros entregados por `deliveredAt`.
   */
  async launchMetrics(from?: string, to?: string) {
    const r = range(from, to);
    const [users, salesSettled, buylistPaid, withdrawalsNoDispute] = await Promise.all([
      this.prisma.user.count({ where: { role: 'customer', ...(r ? { createdAt: r } : {}) } }),
      this.prisma.order.count({ where: { status: 'settled', ...(r ? { settledAt: r } : {}) } }),
      this.prisma.sellRequest.count({ where: { status: 'pagada', ...(r ? { paidAt: r } : {}) } }),
      this.prisma.shipmentRequest.count({
        where: { status: 'entregado', ...(r ? { deliveredAt: r } : {}) },
      }),
    ]);
    // Metas N/X/Y/Z: solo se fijan cuando el humano las define. Mientras no haya
    // ninguna meta, `goals` es `null` (el objeto completo), no un objeto de nulos.
    const goalsRaw: { N: number | null; X: number | null; Y: number | null; Z: number | null } = {
      N: null,
      X: null,
      Y: null,
      Z: null,
    };
    const hasAnyGoal = Object.values(goalsRaw).some((v) => v !== null);
    return {
      users,
      salesSettled,
      buylistPaid,
      withdrawalsNoDispute,
      goals: hasAnyGoal ? goalsRaw : null,
    };
  }

  // ---------------- Dashboard (8 tarjetas) ----------------

  /** Rango del periodo del dashboard: from/to explícitos o el mes calendario en curso (UTC). */
  /**
   * v2.0 (P-48, §4.36.7c / PROJECT §N.8, criterio 95) — **INSTRUMENTACIÓN DE LA CURVA**:
   * `GET /admin/reports/pricing-brackets`. Agrega las operaciones **CONSUMADAS** por eje × bracket
   * para responder «¿qué tan rápido rota cada bracket y con qué margen?» — el dato que falta para
   * calibrar la curva con realidad en vez de con corazonadas.
   *
   * El `bracket` es una ESCALA FIJA e independiente de la curva A PROPÓSITO: si se derivara de los
   * puntos vigentes, la serie histórica dejaría de ser comparable cada vez que el dueño moviera la
   * curva — que es justo lo que se quiere medir. La fila `bracket: null` son las operaciones SIN
   * mercado (override/bounty sin referencia).
   *
   * v2.0 RECOLECTA; NO CALIBRA. El ajuste automático está fuera de alcance (§N.10): el dueño mueve
   * los puntos a mano con este dato en la pantalla.
   *
   * VENTA = `OrderItem` de órdenes **liquidadas** (`Order.status='settled'`): una orden con el pago
   * sin confirmar no es una venta consumada y contaminaría la rotación. COMPRA = `SellRequestItem`
   * de solicitudes **pagadas**, excluyendo los ítems `rechazada` del cherry-pick (BL-1: un ítem
   * rechazado no se compró ni se pagó). El monto pagado se lee de `approvedPriceCents ?? quoted`,
   * porque un ajuste del admin NO reescribe basis/bracket (la serie mide la DECISIÓN de la curva).
   */
  async pricingBrackets(from?: string, to?: string, axis?: 'sale' | 'buy') {
    const r = range(from, to);
    const emptyByBasis = () => ({ market: 0, floor: 0, override: 0, bounty: 0, pending: 0 });
    type Row = {
      bracket: MarketBracket | null;
      operations: number;
      unitsSold?: number;
      unitsBought?: number;
      grossMxnCents?: number;
      paidMxnCents?: number;
      marketMxnCents: number;
      byBasis: ReturnType<typeof emptyByBasis>;
    };

    const out: { from?: string; to?: string; sale?: Row[]; buy?: Row[] } = {
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
    };

    if (axis !== 'buy') {
      const rows = await this.prisma.orderItem.findMany({
        where: { order: { status: 'settled', ...(r ? { settledAt: r } : {}) } },
        select: { marketBracket: true, priceBasis: true, marketMxnCents: true, unitPriceCents: true },
      });
      const acc = new Map<string, Row>();
      for (const it of rows) {
        const key = it.marketBracket ?? 'null';
        const row =
          acc.get(key) ??
          ({ bracket: it.marketBracket, operations: 0, unitsSold: 0, grossMxnCents: 0, marketMxnCents: 0, byBasis: emptyByBasis() } as Row);
        row.operations += 1;
        row.unitsSold = (row.unitsSold ?? 0) + 1;
        row.grossMxnCents = (row.grossMxnCents ?? 0) + it.unitPriceCents;
        row.marketMxnCents += it.marketMxnCents ?? 0;
        if (it.priceBasis) row.byBasis[it.priceBasis] += 1;
        acc.set(key, row);
      }
      out.sale = [...acc.values()];
    }

    if (axis !== 'sale') {
      const rows = await this.prisma.sellRequestItem.findMany({
        where: {
          itemStatus: { not: 'rechazada' },
          sellRequest: { status: 'pagada', ...(r ? { paidAt: r } : {}) },
        },
        select: {
          marketBracket: true,
          priceBasis: true,
          marketMxnCents: true,
          quotedPriceCents: true,
          approvedPriceCents: true,
        },
      });
      const acc = new Map<string, Row>();
      for (const it of rows) {
        const key = it.marketBracket ?? 'null';
        const row =
          acc.get(key) ??
          ({ bracket: it.marketBracket, operations: 0, unitsBought: 0, paidMxnCents: 0, marketMxnCents: 0, byBasis: emptyByBasis() } as Row);
        row.operations += 1;
        row.unitsBought = (row.unitsBought ?? 0) + 1;
        row.paidMxnCents = (row.paidMxnCents ?? 0) + (it.approvedPriceCents ?? it.quotedPriceCents ?? 0);
        row.marketMxnCents += it.marketMxnCents ?? 0;
        if (it.priceBasis) row.byBasis[it.priceBasis] += 1;
        acc.set(key, row);
      }
      out.buy = [...acc.values()];
    }

    return out;
  }

  private resolvePeriod(from?: string, to?: string): { gte: Date; lte: Date } {
    if (from || to) {
      const now = new Date();
      return { gte: from ? new Date(from) : new Date(0), lte: to ? new Date(to) : now };
    }
    const start = new Date();
    start.setUTCDate(1);
    start.setUTCHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + 1);
    return { gte: start, lte: end };
  }

  /**
   * Dashboard (8 tarjetas). Fix correctness #3: las tarjetas "del periodo"
   * (profit/sales/buylist) respetan un rango real de fechas. Si no se pasa `from/to`,
   * el periodo por defecto es el MES CALENDARIO en curso (UTC). Las tarjetas de backlog
   * (workQueue/dataHealth) y los snapshots (inventoryValue/custodyValue) y el acumulado
   * de launchProgress NO son periódicos por diseño.
   */
  async dashboard(role: Role, from?: string, to?: string) {
    const isSuperAdmin = role === Role.super_admin;
    const period = this.resolvePeriod(from, to);

    const [salesCount, salesAgg, shipmentsQueue, buylistQueue, disputesQueue, pendingPrices, buylistPeriodAgg, buylistPeriodCount, lastSync, lastFx, users, salesSettled, buylistPaid, withdrawals] =
      await Promise.all([
        this.prisma.order.count({ where: { status: 'settled', settledAt: period } }),
        this.prisma.order.aggregate({ where: { status: 'settled', settledAt: period }, _sum: { totalCents: true } }),
        this.prisma.shipmentRequest.count({ where: { status: { in: ['solicitado', 'picking', 'guia'] } } }),
        this.prisma.sellRequest.count({ where: { status: { in: ['cotizada', 'recibida', 'verificacion', 'aprobada'] } } }),
        this.prisma.dispute.count({ where: { status: { in: ['abierta', 'en_revision'] } } }),
        this.prisma.pendingPriceEntry.count({ where: { status: 'open' } }),
        this.prisma.sellRequest.aggregate({ where: { status: 'pagada', paidAt: period }, _sum: { approvedTotalCents: true } }),
        this.prisma.sellRequest.count({ where: { status: 'pagada', paidAt: period } }),
        // SEC-M43-5 (§4.38l.4.13) — «última sincronización» del tablero. NO es dinero (nadie cobra ni
        // valúa con esta fecha), pero **es la señal que el operador mira para decidir si confía en los
        // precios**: sin el predicado, una corrida de la fase 2 —que escribe `graded_estimate` sobre
        // todo el catálogo raw publicado— haría que el tablero reporte el feed de MERCADO como recién
        // sincronizado cuando no lo está. Mismo modo de fallo, y mismo remedio, que `hasRecentIngest`.
        this.prisma.priceReference.findFirst({ where: MONEY_REF_WHERE, orderBy: { createdAt: 'desc' } }),
        this.prisma.fxRate.findFirst({ orderBy: { createdAt: 'desc' } }),
        this.prisma.user.count({ where: { role: 'customer' } }),
        this.prisma.order.count({ where: { status: 'settled' } }),
        this.prisma.sellRequest.count({ where: { status: 'pagada' } }),
        this.prisma.shipmentRequest.count({ where: { status: 'entregado' } }),
      ]);

    const periodFrom = period.gte?.toISOString();
    const periodTo = period.lte?.toISOString();
    const pnl = isSuperAdmin ? await this.pnl(periodFrom, periodTo) : null;
    const invValue = isSuperAdmin ? await this.inventoryValue() : null;
    const custody = isSuperAdmin ? await this.custodyValue() : null;

    const card = {
      salesPeriod: { count: salesCount, amountCents: salesAgg._sum.totalCents ?? 0 },
      workQueue: {
        shipments: shipmentsQueue,
        buylist: buylistQueue,
        disputes: disputesQueue,
        pendingPrices,
      },
      buylistPeriod: { count: buylistPeriodCount, amountCents: buylistPeriodAgg._sum.approvedTotalCents ?? 0 },
      dataHealth: {
        pendingPriceCount: pendingPrices,
        lastPriceSyncAt: lastSync?.createdAt ?? null,
        lastFxAt: lastFx?.createdAt ?? null,
      },
      launchProgress: { users, salesSettled, buylistPaid, withdrawalsNoDispute: withdrawals },
    };

    // Campos de dinero solo para super_admin (se omiten para vault_operator).
    if (isSuperAdmin) {
      return {
        profitPeriodCents: pnl!.profitCents,
        ...card,
        inventoryValueCents: invValue!.atReferenceCents,
        custodyValueCents: custody!.totalCustodyValueCents,
      };
    }
    return card;
  }
}
