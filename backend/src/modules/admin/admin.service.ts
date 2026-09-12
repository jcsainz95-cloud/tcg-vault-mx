import { Injectable, Logger } from '@nestjs/common';
import { randomBytes, randomUUID } from 'crypto';
import * as argon2 from 'argon2';
import { SELL_REQUEST_LIVE_STATES } from '../../common/sell-request-states';
import { BANXICO_FX_ORDER, BANXICO_FX_WHERE } from '../../common/fx-mode';
import {
  AuthProvider,
  DisputeStatus,
  Finish,
  KycStatus,
  Locale,
  NameSource,
  MarketBracket,
  OrderStatus,
  PriceConvention,
  Prisma,
  ProductType,
  Role,
  SellRequestStatus,
  UserStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PricingService, PriceInfo, MONEY_REF_WHERE, isBetterRef } from '../pricing/pricing.service';
import { toCardDTO } from '../catalog/catalog.service';
import { IneViewUrlTtl, UploadsService } from '../uploads/uploads.service';
import { PiiCryptoService } from '../../common/crypto/pii-crypto.service';
import { maskClabe, maskRfc } from '../../common/crypto/pii-mask';
import { BusinessException } from '../../common/business.exception';
import { toAddressDTO } from '../users/address-dto';
import { netRevenueCents } from '../../common/money';
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
 *
 * ⛔⛔ **v1.60 (D51, API_CONTRACT §M5-K.5(a)) — `legalName` NO SE SELECCIONA: CAMPO MUERTO.**
 * Existía **solo** para sostener el nombre del titular en el cotejo INE↔CLABE; retirado el cotejo no
 * tiene ningún uso, y **nunca tuvo escritor que le pusiera un nombre** (su único escritor en todo
 * `backend/src` es la anonimización del soft-delete, que lo pone a `null` — y **ése no se toca**).
 * No se «deja vacío en la ficha»: un campo que el panel pinta y que **siempre llega `null` invita a
 * poblarlo**, y poblarlo **reintroduce el cotejo por la puerta de atrás**. La columna se **conserva
 * INERTE** en el schema (**cero DDL**, precedente exacto de `capPerRequestCentsOverride`).
 */
const ADMIN_KYC_SELECT = {
  id: true,
  userId: true,
  kycStatus: true,
  // ⛔ v1.59 (D47, §M5-D.3 · §11) — `capPerRequestCentsOverride` **NO se lee ni se emite**. El
  // contrato lo retiró de los DOS DTOs de admin hace cuatro revisiones y el código seguía
  // publicándolo: el override por-solicitud quedó INERTE (columna conservada, cero lectores). Lo
  // levanta el candado de CONJUNTO DE CLAVES de `admin.user-detail-shape.spec.ts`, que es
  // justamente la clase de defecto que un candado de valores no ve.
  capPerMonthCentsOverride: true,
  verifiedBy: true,
  verifiedAt: true,
  createdAt: true,
  updatedAt: true,
  // ⭐ v1.69 (P-78, M-54 · §M6-K.4, §11 `AdminKycProfileDTO`): la DECISIÓN. `rejectionReason` es la
  // decisión de negocio de un admin sobre un documento —NO es PII del cliente— y el contrato la
  // publica al `super_admin` (y al propio cliente, por otra ruta). `reviewedAt`/`reviewedBy` sellan
  // quién decidió y cuándo. ⛔ Al OPERADOR no le llega ninguna de las tres (ver `getUser`).
  rejectionReason: true,
  reviewedAt: true,
  reviewedBy: true,
  // SOLO para `ineOnFile`; no se exponen (ver toAdminKycDTO).
  ineFrontKey: true,
  ineBackKey: true,
} satisfies Prisma.KycProfileSelect;

/**
 * ⭐ v1.69 (P-78, §M6-K.4/K.7) — **`rejectionReason` sale SI Y SOLO SI el estado es `rejected`.**
 *
 * Una sola función porque hay **dos** proyectores de KYC hacia el `super_admin` (`toAdminKycDTO`
 * para el `PATCH`, y la rama de `getUser` que proyectaba por SPREAD DE RESTO) y ésta es justo la
 * cuando se copia: el contrato dice *«⛔ ausente en cualquier otro estado — no se deja `null`
 * clase de regla que diverge al copiarse: un SPREAD DE RESTO sobre la fila cruda publica el residual **por
 * omisión**. (La columna **conserva** el motivo viejo a propósito: es evidencia de la decisión
 * anterior en la bitácora y en la BD; lo que no se hace es **enseñarlo** junto a un estado que ya no
 * es `rejected`.)
 */
function kycDecisionFields(k: {
  kycStatus: KycStatus;
  rejectionReason: string | null;
  reviewedAt: Date | null;
  reviewedBy: string | null;
}) {
  return {
    ...(k.kycStatus === KycStatus.rejected && k.rejectionReason
      ? { rejectionReason: k.rejectionReason }
      : {}),
    reviewedAt: k.reviewedAt,
    reviewedBy: k.reviewedBy,
  };
}

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
interface AdminUserRow {
  id: string;
  email: string;
  name: string;
  nameSource: NameSource;
  role: Role;
  status: UserStatus;
  locale: Locale;
  emailVerified: boolean;
  authProvider: AuthProvider;
  phone: string | null;
  avatarUrl: string | null;
  mustChangePassword: boolean;
  deletedAt: Date | null;
  anonymizedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function toAdminUserHeader(u: AdminUserRow) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    // ⭐ v1.69 (P-78, §M6-K.3, BK-5) — **el campo que hace LEGIBLE el cotejo contra la INE**, y va a
    // los DOS DTOs (super_admin y vault_operator). Sin él, un nombre FABRICADO del correo (P-73,
    // `nameSource='derived'`) parece un nombre: el revisor compara «Jcsainz95» contra un INE que
    // dice otra cosa y concluye que no coinciden. Con él sabe que el nombre a cotejar es el
    // `recipientName` de la dirección, no el del perfil. ⛔ No es PII nueva para el operador (ya ve
    // `name`) y es justo lo que le evita imprimir una etiqueta a nombre de un correo.
    nameSource: u.nameSource,
    role: u.role,
    status: u.status,
    locale: u.locale,
    emailVerified: u.emailVerified,
    phone: u.phone,
    deletedAt: u.deletedAt,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
    // FUERA por construcción: `passwordHash`, `tokenVersion` (revocación de sesiones) y `googleId`
    // — ninguno tiene por qué viajar en una ficha de back-office, y **ya no se leen de la BD**
    // (`ADMIN_USER_DETAIL_SELECT`).
  };
}

/**
 * ⭐ `R-1` — la cabecera del `super_admin` = la del operador **+ cuatro claves enumeradas**
 * (`AdminUserDetailDTO`, §11). Es un SUPERSET EXPLÍCITO, no un «lo mismo sin recortar»: la
 * diferencia entre los dos roles **es parte de la forma** (§11: «dos DTOs, no uno con opcionales»),
 * y escribirla aquí es lo que hace que el candado de conjunto de claves pueda ponerse rojo.
 *
 * `anonymizedAt` **entra** (solo aquí): el contrato lo pide desde v2.1.9 —«en la ficha 360° la
 * pregunta *¿esta cuenta está anonimizada?* es legítima»— y el código lo excluía por herencia de
 * `PATCH /status`, donde sí era ruido.
 */
function toAdminUserHeaderSuper(u: AdminUserRow) {
  return {
    ...toAdminUserHeader(u),
    authProvider: u.authProvider,
    avatarUrl: u.avatarUrl,
    mustChangePassword: u.mustChangePassword,
    anonymizedAt: u.anonymizedAt,
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

/**
 * ⭐⭐ **`R-1` (techlead, 2026-09-12) — LOS PROYECTORES DE LA FICHA 360°: UNO POR DTO, Y NINGUNO POR
 * RESTA.**
 *
 * ### Por qué esta puerta filtró TRES veces por el mismo motivo
 * `getUser` derivaba `AdminKycProfileDTO` **por sustracción**: siete exclusiones a mano y un SPREAD DE RESTO
 * sobre la fila CRUDA del `include`. Una lista NEGRA protege de lo que su autor recordó, así que
 * **cada columna nueva del schema se publicaba sola**: `clabeSnapshotEnc` (S49-M1-R), `legalName`
 * (D51) y las **object keys del INE** (P-78, cazada llamando al endpoint). La columna número ocho
 * habría salido igual.
 *
 * ### Las tres cosas que cambian, y ninguna es cosmética
 * 1. **La lista blanca vive en el `select` de la CONSULTA** (`ADMIN_USER_DETAIL_SELECT`): lo que no
 *    está enumerado **ni se lee de la base**. Es la única forma de que una columna nueva no pueda
 *    publicarse por omisión — un filtro en memoria depende de que alguien se acuerde.
 * 2. **Un proyector por DTO.** `toAdminKycDTO` (que ya existía, y que **solo** usaba el `PATCH`) pasa
 *    a ser la fuente ÚNICA del KYC de admin; la ficha añade encima los dos enmascarados. Dos
 *    proyectores para un DTO es lo que el contrato ya prohibió por escrito: *«una relación que se
 *    proyecta dos veces se filtra por la copia que su autor no revisó»*.
 * 3. **El operador y el `super_admin` son DOS DTOs**, no uno con opcionales (§11): cada uno tiene su
 *    proyector y su lista, y lo que no está en la lista **no existe** en esa respuesta.
 */
function toAdminKycDetailDTO(
  k: Parameters<typeof toAdminKycDTO>[0],
  masked: { clabeMasked: string | undefined; rfcMasked: string | undefined },
) {
  // `AdminKycProfileDTO` (§11) = lo que emite el `PATCH` + los dos enmascarados de la ficha.
  // ⛔ Nada de SPREAD DE RESTO: si el schema gana una columna, esta función devuelve lo mismo.
  return { ...toAdminKycDTO(k), clabeMasked: masked.clabeMasked, rfcMasked: masked.rfcMasked };
}

/**
 * `AdminKycProfileOperatorDTO` (§11) — **siete claves, y las siete están enumeradas.**
 * SEC-A4: el `vault_operator` es el rol de menor confianza. ⛔ Sin RFC, sin motivo de rechazo (no
 * decide el KYC y el material de la revisión le está vedado, §M6-K), sin sello de decisión y sin una
 * sola object key.
 */
function toAdminKycOperatorDTO(
  k: {
    id: string;
    userId: string;
    kycStatus: KycStatus;
    capPerMonthCentsOverride: number | null;
    verifiedAt: Date | null;
    ineFrontKey: string | null;
    ineBackKey: string | null;
  },
  clabeMasked: string | undefined,
) {
  return {
    id: k.id,
    userId: k.userId,
    kycStatus: k.kycStatus,
    clabeMasked,
    ineOnFile: Boolean(k.ineFrontKey && k.ineBackKey),
    capPerMonthCents: k.capPerMonthCentsOverride,
    verifiedAt: k.verifiedAt,
  };
}

/**
 * `AdminBillingProfileDTO` (§11) — **diez claves enumeradas.**
 * Antes era un SPREAD DE RESTO quitando solo `rfcEnc`: **lista negra pura**, que cuadraba con el contrato
 * **por coincidencia** (la tabla tiene justo esas columnas). La misma trampa que el KYC, un release
 * antes de saltar. ⛔ `rfcEnc` no se lee de la BD; solo se descifra para enmascararlo.
 */
function toAdminBillingDTO(
  b: {
    id: string;
    userId: string;
    razonSocial: string;
    regimenFiscal: string;
    usoCfdi: string;
    postalCode: string;
    email: string;
    createdAt: Date;
    updatedAt: Date;
  },
  rfcMasked: string | undefined,
) {
  return {
    id: b.id,
    userId: b.userId,
    rfcMasked,
    razonSocial: b.razonSocial,
    regimenFiscal: b.regimenFiscal,
    usoCfdi: b.usoCfdi,
    postalCode: b.postalCode,
    email: b.email,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  };
}

/**
 * ⭐ v1.69 (P-78, §M6-K.3, §11 `AdminShipmentRecipientRef`) — **«¿a nombre de quién han salido sus
 * paquetes?»**, que es la única pregunta que este ref existe para contestar (cotejo identidad ↔
 * destino, decisión (d) del dueño).
 *
 * **LISTA BLANCA ESTRICTA sobre `ShipmentRequest.addressSnapshot` (Json).** ⛔ El snapshot ENTERO no
 * viaja: lleva `line1`, `line2`, `phone` y el CP. El cotejo necesita **a quién** y **a qué ciudad**;
 * la calle exacta es PII que no aporta a esa pregunta. Misma doctrina que `AdminUserSellRequestRef`:
 * **un ref, no la fila**.
 *
 * ⛔ `recipientName: null` (envío anterior a M-52, sin destinatario capturado) **se emite `null` y NO
 * se deriva de `User.name`**: derivarlo sería inventar exactamente el dato que el cotejo intenta
 * comprobar.
 *
 * El `Json` de Prisma es `unknown` en la práctica: se lee **campo por campo y con tipo comprobado**,
 * nunca con un cast del objeto entero — un cast haría que cualquier clave futura del snapshot (o una
 * fila vieja con otra forma) entrara al DTO sin que nadie lo decidiera.
 */
function toAdminShipmentRecipientRef(s: {
  id: string;
  addressSnapshot: Prisma.JsonValue;
  requestedAt: Date;
}) {
  const snap: Record<string, unknown> =
    s.addressSnapshot !== null && typeof s.addressSnapshot === 'object' && !Array.isArray(s.addressSnapshot)
      ? (s.addressSnapshot as Record<string, unknown>)
      : {};
  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  return {
    shipmentId: s.id,
    recipientName: typeof snap.recipientName === 'string' ? snap.recipientName : null,
    city: str(snap.city),
    state: str(snap.state),
    // La clave es la del contrato (`createdAt`); el hecho es el alta del envío (`requestedAt`).
    createdAt: s.requestedAt,
  };
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

/**
 * v2.1.9 (R1) — proyección del KYC hacia el back-office. Espeja la que `getUser` ya emite
 * (`AdminKycProfileDTO` del contrato §M6): estado, límites y `ineOnFile`; **cero** PII cifrada.
 * Los `*Override` se renombran a `capPerRequestCents`/`capPerMonthCents`, que es como los llama el
 * contrato y como `getUser` los devuelve — el consumidor recibe la forma que ya conoce.
 */
function toAdminKycDTO(k: {
  id: string;
  userId: string;
  kycStatus: KycStatus;
  capPerMonthCentsOverride: number | null;
  verifiedBy: string | null;
  verifiedAt: Date | null;
  rejectionReason: string | null;
  reviewedAt: Date | null;
  reviewedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  ineFrontKey: string | null;
  ineBackKey: string | null;
}) {
  return {
    id: k.id,
    userId: k.userId,
    kycStatus: k.kycStatus,
    capPerMonthCents: k.capPerMonthCentsOverride,
    verifiedBy: k.verifiedBy,
    verifiedAt: k.verifiedAt,
    // ⭐ v1.69 (P-78): el motivo solo acompaña a `rejected` (ver `kycDecisionFields`).
    ...kycDecisionFields(k),
    createdAt: k.createdAt,
    updatedAt: k.updatedAt,
    // El INE se reduce a un booleano: al back-office le basta saber SI está en archivo; la imagen
    // se sirve por presigned GET dedicado, nunca publicando su object key en un cuerpo de respuesta.
    ineOnFile: Boolean(k.ineFrontKey && k.ineBackKey),
  };
}

/**
 * ⭐ **v1.64 (`D-IVA-5` + §4.44.j sitio 3) — el INGRESO DE ENVÍO de una orden `direct_ship`, neteado
 * por la convención de ESA orden.**
 *
 * **En el DEPLOY 1 devuelve `o.shippingFeeCents` tal cual, para toda fila**, porque toda fila es
 * `IVA_EXCLUSIVE` y bajo esa convención la tarifa persistida ya es NETA (hoy `computeDirectShipBreakdown`
 * apila el IVA aparte, en `Order.ivaCents`). El neteo es, literalmente, la identidad. *Eso es lo que
 * hace verificable que este sumando nuevo no reinterpreta nada: solo cuenta lo que ya nadie contaba.*
 *
 * ⚠️⚠️ **PUNTO ABIERTO PARA EL DEPLOY 2 — marca interna `IVA-R1` (no es un candado de contrato).**
 * Bajo `IVA_INCLUSIVE`, `Order.ivaCents` es el **residual del AGREGADO** `G = S + E` (regla R2 de
 * §4.44.c): el IVA que corresponde a la línea de envío **no está persistido por separado**, así que
 * repartirlo entre mercancía y envío es una **decisión de asignación** y **no la tomo yo aquí**. Lo que
 * este helper hace es aplicar al envío la misma regla de base gravable que §4.44.c aplica al agregado
 * —`taxBase = round(E / (1 + r))`, con `r` leído de la columna congelada `ivaRatePct`—, que es la
 * lectura más directa de «`E` lleva su IVA dentro» (§4.44.f). **Suma de las dos partes puede diferir
 * del residual agregado en ±1 centavo**, y ésa es exactamente la clase de detalle que decide el
 * arquitecto y no el implementador. **Queda enrutado en `BACKEND_NOTES` como pregunta del deploy 2;
 * en el deploy 1 esta rama es INALCANZABLE** (ninguna fila es `IVA_INCLUSIVE`) y se prueba que lo es.
 *
 * ⛔ Igual que `netRevenueCents`, **solo columnas persistidas de esa fila**: nunca el dial vivo.
 */
function netShippingRevenueOfOrder(o: {
  shippingFeeCents: number;
  ivaRatePct: number;
  priceConvention: PriceConvention;
}): number {
  // El IVA embebido en la línea de envío, derivado de la propia línea y de la TASA congelada.
  // Bajo IVA_EXCLUSIVE `netRevenueCents` ignora este valor y devuelve `shippingFeeCents` intacto.
  const shippingIvaCents =
    o.shippingFeeCents - Math.round(o.shippingFeeCents / (1 + o.ivaRatePct / 100));
  return netRevenueCents({
    subtotalCents: o.shippingFeeCents,
    ivaCents: shippingIvaCents,
    priceConvention: o.priceConvention,
  });
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

/**
 * ⭐⭐ **`R-1` (techlead) — LA LISTA BLANCA DE LA FICHA 360°, EN EL `select` DE LA CONSULTA.**
 *
 * **Lo que no está enumerado aquí NI SIQUIERA SE LEE DE LA BASE.** Es la diferencia entre «filtrar»
 * y «no tener»: un filtro en memoria (la lista negra + el spread de resto que había) protege de las columnas
 * que su autor recordó; este `select` protege de las que **todavía no existen**. Tres fugas por esa
 * misma puerta —`clabeSnapshotEnc` (S49-M1-R), `legalName` (D51) y las object keys del INE (P-78)—
 * y las tres eran **la misma**: lo que se proyecta por resto se publica por omisión.
 *
 * ⛔ FUERA por construcción, y ahora de verdad: `passwordHash`, `tokenVersion` (contador de
 * revocación de sesión), `googleId`, `clabeHmac` (**blind index**: clave de CORRELACIÓN entre
 * cuentas, jamás sale) y `legalName` (campo muerto, §M5-K.5a).
 *
 * ⚠️ `clabeEnc`/`rfcEnc` **sí se leen** —y **solo** para descifrarlos y devolverlos ENMASCARADOS—;
 * las object keys del INE **sí se leen** y **solo** para derivar `ineOnFile: boolean`. Los tres
 * salen del DTO por sus proyectores, que son listas blancas explícitas. *Leer no es publicar; lo
 * que estaba roto era publicar por omisión.*
 */
const ADMIN_USER_DETAIL_SELECT = {
  id: true,
  email: true,
  name: true,
  nameSource: true,
  role: true,
  status: true,
  locale: true,
  emailVerified: true,
  authProvider: true,
  phone: true,
  avatarUrl: true,
  mustChangePassword: true,
  deletedAt: true,
  anonymizedAt: true,
  createdAt: true,
  updatedAt: true,
  kycProfile: {
    select: {
      ...ADMIN_KYC_SELECT,
      // Solo para ENMASCARAR (nunca viajan): `maskClabe`/`maskRfc` sobre el descifrado.
      clabeEnc: true,
      rfcEnc: true,
    },
  },
  billingProfile: {
    select: {
      id: true,
      userId: true,
      // Solo para `rfcMasked`. ⛔ El blob cifrado no sale nunca.
      rfcEnc: true,
      razonSocial: true,
      regimenFiscal: true,
      usoCfdi: true,
      postalCode: true,
      email: true,
      createdAt: true,
      updatedAt: true,
    },
  },
  // Las 11 columnas de `AddressDTO` (§11) — las MISMAS que `/users/me/addresses`.
  addresses: {
    select: {
      id: true,
      recipientName: true,
      line1: true,
      line2: true,
      neighborhood: true,
      city: true,
      state: true,
      postalCode: true,
      country: true,
      phone: true,
      isDefault: true,
    },
  },
  orders: {
    orderBy: { createdAt: 'desc' },
    take: 20,
    // ⛔ Sin `billingSnapshot` (lleva `rfcEnc`) ni ids de Stripe.
    select: {
      id: true,
      userId: true,
      orderNumber: true,
      status: true,
      totalCents: true,
      createdAt: true,
      settledAt: true,
    },
  },
  sellRequests: {
    orderBy: { createdAt: 'desc' },
    take: 20,
    // ⛔ Sin `clabeSnapshotEnc` — el fallo exacto de S49-M1-R, ahora imposible desde la BD.
    select: { id: true, status: true, quotedTotalCents: true, createdAt: true },
  },
  disputes: {
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: { id: true, status: true, type: true, createdAt: true },
  },
  ownedItems: {
    select: {
      id: true,
      folio: true,
      cardId: true,
      productType: true,
      finish: true,
      rawCondition: true,
      gradingCompany: true,
      gradeValue: true,
      ownershipStatus: true,
      card: { include: { set: true } },
    },
  },
  // ⭐ v1.69 (P-78, §M6-K.3, BK-5): los ÚLTIMOS 5 envíos, SOLO para el cotejo identidad ↔ destino.
  // De `ShipmentRequest` salen TRES columnas, y de `addressSnapshot` solo tres claves
  // (`toAdminShipmentRecipientRef`). Se proyecta **solo en la rama `super_admin`**.
  // ⚠️ El contrato (§11 `AdminShipmentRecipientRef`) dice «`ShipmentRequest.createdAt desc`» y **esa
  // columna no existe**: la tabla sella su alta en `requestedAt` (`@default(now())`). Se ordena y se
  // emite por `requestedAt` —el mismo hecho, con el nombre que tiene el schema— bajo la clave
  // `createdAt` que el DTO declara. ⛔ Sin migración. Anotado para el arquitecto.
  shipmentRequests: {
    orderBy: { requestedAt: 'desc' },
    take: 5,
    select: { id: true, addressSnapshot: true, requestedAt: true },
  },
} satisfies Prisma.UserSelect;

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
    // ⭐⭐ `R-1` — **`select`, NO `include`.** Lo que no está enumerado aquí **no se lee de la base**:
    // ni `passwordHash`, ni `tokenVersion`, ni `googleId`, ni `clabeHmac`, ni `legalName`, ni la
    // columna que el schema gane mañana. *Un filtro en memoria protege de lo que su autor recordó;
    // un `select` protege de lo que todavía no existe.*
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: ADMIN_USER_DETAIL_SELECT,
    });
    if (!user) throw BusinessException.notFound();

    // Las relaciones ya vienen acotadas por el `select`, y cada una pasa además por SU proyector
    // (los del encabezado de este fichero). ⛔ Ni un SPREAD DE RESTO en esta función.
    const comunes = {
      // v1.67.1 (F2-2, D-CTA-8, contrato §M6): LA MISMA proyección que `/users/me/addresses` —
      // `AddressDTO` completa, con `recipientName`. Prohibida una segunda copia de la lista blanca.
      addresses: user.addresses.map(toAddressDTO),
      orders: user.orders.map(toAdminUserOrderRef),
      sellRequests: user.sellRequests.map(toAdminUserSellRequestRef),
      disputes: user.disputes.map(toAdminUserDisputeRef),
      // Conforma la bóveda al contrato §M6 `AdminUserOwnedItemRef` (v1.8-ronda-c / BE-10):
      // { inventoryItemId, folio, card, productType, finish, ownershipStatus, referenceValue }.
      ownedItems: await this.ownedItemRefs(user.ownedItems),
    };
    // La CLABE vive CIFRADA en reposo: se descifra SOLO para enmascararla, y sale `****1234` también
    // para el `super_admin`. En claro únicamente por `GET /admin/buylist/:id/reveal-clabe`.
    const clabeMasked = maskClabe(this.pii.decryptOptional(user.kycProfile?.clabeEnc));

    if (role === Role.super_admin) {
      return {
        ...toAdminUserHeaderSuper(user),
        ...comunes,
        // ⭐ v1.69 (P-78, §M6-K.3): SOLO aquí. El operador no recibe la clave (ni vacía): un perfil
        // de movimientos POR PERSONA no es de su rol.
        recentShipmentRecipients: user.shipmentRequests.map(toAdminShipmentRecipientRef),
        kycProfile: user.kycProfile
          ? toAdminKycDetailDTO(user.kycProfile, {
              clabeMasked,
              rfcMasked: maskRfc(this.pii.decryptOptional(user.kycProfile.rfcEnc)),
            })
          : null,
        billingProfile: user.billingProfile
          ? toAdminBillingDTO(
              user.billingProfile,
              maskRfc(this.pii.decryptOptional(user.billingProfile.rfcEnc)),
            )
          : null,
      };
    }

    // Proyección reducida para `vault_operator` (y cualquier rol no `super_admin`), SEC-A4.
    return {
      ...toAdminUserHeader(user),
      ...comunes,
      kycProfile: user.kycProfile ? toAdminKycOperatorDTO(user.kycProfile, clabeMasked) : null,
      // SIEMPRE `null`, nunca «omitido»: el front pinta «sin acceso», no «sin datos» (§11).
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
      // v1.53 (§4.40.4b, MONEY) — LECTURA: sin identidad de slab no hay clave, y sin clave no hay
      // referencia ⇒ `pending`. Antes la fila se resolvía como `graded:PSA:10` y el admin veía el
      // valor del grado MÁS CARO para una pieza cuyo grado nunca se capturó.
      const gradeKey = this.pricing.tryGradeKeyFor(item);
      const r = gradeKey
        ? latest.get(`${item.cardId}|${item.productType}|${gradeKey}|${item.finish}`)
        : undefined;
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
    actorUserId?: string,
    rejectionReason?: string,
  ) {
    // ⭐⭐ v1.69 (P-78, §M6-K.4, BK-2) — **EL MOTIVO ES OBLIGATORIO SI Y SOLO SI SE RECHAZA.**
    //
    // Las dos mitades de la regla, y ninguna sobra:
    //  · rechazar SIN motivo ⇒ `422 KYC_REJECTION_REASON_REQUIRED`. El motivo LE LLEGA AL CLIENTE
    //    (`GET /users/me/kyc`): sin él ve «rechazada» y no sabe qué corregir — un rechazo que no se
    //    puede corregir es un callejón, no un rechazo.
    //  · mandar motivo SIN rechazar ⇒ `422 VALIDATION_ERROR`. ⛔ **No se ignora en silencio**: un
    //    motivo aceptado y descartado es un motivo que el cliente NUNCA verá y que el admin CREE
    //    haber mandado. Un 422 cuesta un reintento; el silencio cuesta la confianza del cliente.
    //
    // Rango **3–500 tras `trim()`**: el MISMO exacto que `SellRequestItem.rejectionReason` (M-22,
    // `schema.prisma`). El mismo concepto no estrena una segunda talla.
    const isRejection = kycStatus === 'rejected';
    const trimmedReason = typeof rejectionReason === 'string' ? rejectionReason.trim() : undefined;
    if (isRejection) {
      if (trimmedReason === undefined || trimmedReason.length === 0) {
        throw BusinessException.validation(
          'KYC_REJECTION_REASON_REQUIRED',
          'rejectionReason is required when rejecting a KYC profile',
          { field: 'rejectionReason' },
        );
      }
      if (trimmedReason.length < 3 || trimmedReason.length > 500) {
        throw BusinessException.validation(
          'VALIDATION_ERROR',
          'rejectionReason must be 3 to 500 characters after trim',
          { field: 'rejectionReason', min: 3, max: 500 },
        );
      }
    } else if (rejectionReason !== undefined) {
      throw BusinessException.validation(
        'VALIDATION_ERROR',
        'rejectionReason is only accepted when kycStatus is "rejected"',
        { field: 'rejectionReason' },
      );
    }

    const now = new Date();
    // Lo que se ESCRIBE en cada rama (§M6-K.4), y por qué cada `null` es deliberado:
    //  · `rejectionReason`: el trimmed al rechazar; **`null` en cualquier otro estado** — §M6-K.7
    //    prohíbe el residual («no se deja `null` residual de un rechazo anterior»), y limpiarlo EN
    //    LA COLUMNA es más fuerte que esconderlo en la proyección: el cliente lo lee por otra ruta.
    //  · `verifiedAt`: se sella al verificar y **se anula al rechazar** (dejó de estar verificado).
    //  · `verifiedBy`: ⭐ **ahora solo se escribe al VERIFICAR.** Antes se escribía en CUALQUIER
    //    `PATCH` (incluido un rechazo), así que «quién verificó» acababa nombrando a quien RECHAZÓ.
    //    Con `reviewedBy` existiendo, mantener eso sería conservar la única lectura falsa que la
    //    columna admite. ⛔ No se anula al rechazar: el contrato solo manda anular `verifiedAt`.
    //  · `reviewedAt`/`reviewedBy`: se sellan en TODA decisión (verificar, rechazar y deshacer a
    //    `none`) — son «cuándo/quién DECIDIÓ», y deshacer también es decidir.
    const decision = {
      kycStatus: kycStatus as never,
      capPerRequestCentsOverride: capPerRequestCents,
      capPerMonthCentsOverride: capPerMonthCents,
      rejectionReason: isRejection ? trimmedReason : null,
      reviewedAt: now,
      reviewedBy: actorUserId ?? null,
      ...(kycStatus === 'verified' ? { verifiedBy: actorUserId, verifiedAt: now } : {}),
      ...(isRejection ? { verifiedAt: null } : {}),
    };
    const row = await this.prisma.kycProfile.upsert({
      select: ADMIN_KYC_SELECT,
      where: { userId: id },
      create: { userId: id, ...decision },
      update: decision,
    });
    return toAdminKycDTO(row);
  }

  /**
   * ⭐⭐ **v1.69 (P-78, BK-1 · API_CONTRACT §M6-K.2 · ARCHITECTURE §3.4.c/§4.49) —
   * los dos enlaces de `GET /admin/users/:id/kyc/ine-links`. `super_admin` ÚNICAMENTE.**
   *
   * Es la **primera vez que una imagen de identidad sale de este servidor**, así que esto se escribe
   * para que `seguridad` lo revise leyéndolo: cada candado, con su motivo, en su sitio.
   *
   * ### La secuencia es NORMATIVA y este orden no es casual (§M6-K.2.4)
   * ```
   * 1. guard de rol         → 403 si no es super_admin   (decorador, ANTES de tocar la BD)
   * 2. cargar KycProfile    → 404 / 422 INE_NOT_ON_FILE          ← aquí
   * 3. firmar las dos URLs  ← operación LOCAL: no toca R2, no lee el objeto, no deja rastro ← aquí
   * 4. await audit.log(...) ← si LANZA: 500 AUDIT_WRITE_FAILED   ← en el CONTROLLER
   * 5. responder con las URLs                                     ← en el CONTROLLER
   * ```
   * **Firmar ANTES de auditar** porque firmar **no es el acto auditable** —es local y sin efecto—,
   * así que auditar primero registraría miradas que quizá no ocurran. Lo que hace **cerrado** el
   * fallo es que el `await audit.log` está **en el camino de la respuesta**: si la fila no entra, el
   * cuerpo no sale, y una URL prefirmada que nadie recibió no es una fuga.
   *
   * ⚠️ **Los pasos 4 y 5 viven en `AdminUsersController.ineLinks`, y NO por descuido:** es la MISMA
   * forma que el precedente vivo de revelado de PII (`admin-buylist.controller.ts`,
   * `buylist.reveal_clabe`), y esta clase no inyecta `AuditService`. **La consecuencia hay que
   * decirla:** quien llame a este método desde otro sitio **no audita**. Por eso el método se llama
   * `ineLinksUnaudited` — el nombre es el candado que queda cuando el comentario se deja de leer.
   *
   * ### Lo que NO sale, y es la mitad que sostiene la promesa del dueño
   * ⛔ Las *object keys* (`ineFrontKey`/`ineBackKey`) **no viajan** — el servidor las resuelve desde
   * `:id`. ⛔ Tampoco viajan en la fila de bitácora (ver el controller). ⛔ Y no se emiten en ningún
   * listado ni en la ficha: un enlace que viaja «por si acaso» acaba en un log, en un historial de
   * navegador y en una captura de pantalla.
   *
   * **Un solo endpoint para los DOS documentos** y es deliberado: una revisión necesita frente *y*
   * reverso (el reverso lleva CURP y vigencia). Dos endpoints darían **dos filas por un acto** y la
   * bitácora dejaría de contestar *«¿cuántas veces se miró esta identidad?»*.
   */
  async ineLinksUnaudited(targetUserId: string): Promise<{
    links: {
      userId: string;
      front: { url: string; expiresAt: string };
      back: { url: string; expiresAt: string };
      expiresInSeconds: number;
    };
    ttl: IneViewUrlTtl;
  }> {
    // (2) — `select` de DOS columnas: ni siquiera se leen la CLABE cifrada ni el blind index.
    const kyc = await this.prisma.kycProfile.findUnique({
      where: { userId: targetUserId },
      select: { ineFrontKey: true, ineBackKey: true },
    });

    // `404` SOLO si el usuario no existe (paridad exacta con `AuditService.listForUser`). Sin perfil
    // de KYC el usuario puede existir perfectamente ⇒ eso es `422`, no `404`. La consulta extra se
    // hace únicamente en esa rama: con perfil, el `User` existe por la FK.
    if (!kyc) {
      const user = await this.prisma.user.findUnique({
        where: { id: targetUserId },
        select: { id: true },
      });
      if (!user) throw BusinessException.notFound();
    }

    const frontKey = kyc?.ineFrontKey ?? null;
    const backKey = kyc?.ineBackKey ?? null;
    if (!frontKey || !backKey) {
      // ⚠️ `422` y no `404`: el recurso *usuario* EXISTE y la respuesta es accionable («pídeselo»),
      // no «te equivocaste de URL». `details` dice CUÁL de las dos falta, que es lo que el revisor
      // va a tener que pedirle al cliente. ⛔ Los `details` NO llevan las keys.
      throw BusinessException.validation('INE_NOT_ON_FILE', 'No complete INE on file for this user', {
        frontOnFile: Boolean(frontKey),
        backOnFile: Boolean(backKey),
      });
    }

    // (3) Firmar: local, sin red, sin efecto. 120 s por defecto, techo duro de 300 (§M6-K.2.1).
    // ⭐ v1.70 (C10(c)): **UNA sola resolución del dial por petición**, usada en los TRES sitios —
    // la firma de las dos URLs, el `expiresInSeconds` del cuerpo y el `after` de la bitácora (que lo
    // recibe por `ttl`, sin volver a leer el env). Dos lecturas del mismo dial en la misma petición
    // serían dos fuentes para un hecho, y una mentiría el día del despliegue que lo cambie.
    const ttl = this.uploads.resolveIneViewUrlTtl();
    const expiresInSeconds = ttl.seconds;
    const [frontUrl, backUrl] = await Promise.all([
      this.uploads.presignGet(frontKey, expiresInSeconds),
      this.uploads.presignGet(backKey, expiresInSeconds),
    ]);
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();

    return {
      links: {
        userId: targetUserId,
        front: { url: frontUrl, expiresAt },
        back: { url: backUrl, expiresAt },
        expiresInSeconds,
      },
      ttl,
    };
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

  /**
   * P&L: ingresos + envío − costo de lo vendido − comisiones Stripe = ganancia.
   *
   * ⭐⭐ **v1.64-iva-inclusive (§4.44.j, criterio 191) — TODO INGRESO PASA POR `netRevenueCents`.**
   * `incomeCents += o.subtotalCents` era correcto mientras el subtotal fuera SIEMPRE neto. El día que
   * una fila pueda llevar el IVA dentro (deploy 2), esa línea **no revienta: MIENTE**, contando el
   * impuesto que se le debe al SAT como ingreso propio. El neteo se decide **por fila y desde columnas
   * persistidas** (`subtotalCents`/`ivaCents`/`priceConvention`), ⛔ jamás desde el dial vivo: por eso
   * mover el dial no mueve ni un centavo de un periodo ya cerrado (criterio 190, candado `IVA-5` ⭐⭐).
   * **En el DEPLOY 1 esto es bit a bit lo de hoy**, porque toda fila es `IVA_EXCLUSIVE`.
   *
   * ⭐ **v1.64 — `D-IVA-5` (§9): el sumando de envío que FALTABA, y el contrato lo manda desde v1.21.**
   * `shippingRevenueCents = Σ ShipmentRequest.shippingFeeCents + Σ Order.shippingFeeCents`. El segundo
   * sumando **no existía en este método**, y el dinero se perdía ENTERO (no a medias): el
   * `ShipmentRequest` de fulfillment de un pedido `direct_ship` lleva `shippingFeeCents = 0` **a
   * propósito** (para no contar dos veces) y `Order.subtotalCents` **excluye** el envío (columna
   * aparte) ⇒ **el ingreso de envío de TODO pedido de invitado no lo contaba nadie**, mientras su
   * COSTO sí se capturaba. El P&L **subestimaba** la ganancia. Pre-existente: **no lo causa D54**; se
   * cierra aquí porque vive en este mismo bucle y arreglar el neteo sin arreglarlo dejaría el reporte
   * mal por la otra vía (`ARCHITECTURE §9 · D-IVA-5`: *«va con el helper desde el primer commit»*).
   * ⚠️ **Esta cifra del reporte SÍ cambia con este pase, y debe cambiar**: hoy falta un sumando.
   */
  async pnl(from?: string, to?: string) {
    const createdAt = range(from, to);
    const settledOrders = await this.prisma.order.findMany({
      where: { status: 'settled', ...(createdAt ? { settledAt: createdAt } : {}) },
      include: { items: { include: { inventoryItem: true } } },
    });
    let incomeCents = 0;
    let stripeFeesCents = 0;
    let cogsCents = 0;
    // `D-IVA-5`: el ingreso de envío cobrado DENTRO de la orden (`direct_ship`). Se acumula aparte
    // porque es INGRESO DE ENVÍO, no ingreso de mercancía: va a `shippingRevenueCents`, jamás a
    // `incomeCents`. Se acota por `settledAt` (el mismo predicado del `findMany` de arriba), que es
    // lo que el contrato dice: «órdenes settled del periodo».
    let directShipShippingRevenueCents = 0;
    for (const o of settledOrders) {
      incomeCents += netRevenueCents(o);
      stripeFeesCents += o.processingFeeCents;
      if (o.fulfillmentMode === 'direct_ship') {
        directShipShippingRevenueCents += netShippingRevenueOfOrder(o);
      }
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
    let shippingRevenueCents = directShipShippingRevenueCents;
    let shippingCostCents = 0;
    for (const s of shipments) {
      // v1.64 (§4.44.j, sitio 2): neteado por la convención de ESTA `ShipmentRequest`. En el retiro
      // de bóveda el «subtotal» del desglose ES la tarifa de envío (`computeShipmentBreakdown`
      // devuelve `subtotalCents: shippingFeeCents`), así que la fila se lee con esa correspondencia.
      shippingRevenueCents += netRevenueCents({
        subtotalCents: s.shippingFeeCents,
        ivaCents: s.ivaCents,
        priceConvention: s.priceConvention,
      });
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
        // v1.53 (§4.40.4b, MONEY) — LECTURA agregada: una graduada sin identidad de slab NO aporta
        // clave al lote (mismo idioma que el sellado no mapeado, justo arriba). Abajo cae a
        // `pendingPriceCount`, que es la verdad: no se puede valuar lo que no se sabe qué grado es.
        const gk = this.pricing.tryGradeKeyFor(item);
        if (gk) {
          keys.push({
            cardId: item.cardId,
            productType: item.productType,
            gradeKey: gk,
            finish: item.finish,
          });
        }
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
        // v1.53 (§4.40.4b): sin clave ⇒ `null` ⇒ suma a `pendingPriceCount`, jamás a `atReferenceCents`.
        const gk = this.pricing.tryGradeKeyFor(item);
        cents = gk ? refCentsOf(item.cardId, item.productType, gk, item.finish) : null;
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
      // v1.53 (§4.40.4b, MONEY) — VALOR DE CUSTODIA: sin identidad de slab la pieza no se valúa (no
      // suma). Sumarla al precio de un PSA 10 inflaría el pasivo con el cliente por una carta cuyo
      // grado nunca se preguntó; no sumarla es honesto y entra al censo §4.40.8.
      const gradeKey = this.pricing.tryGradeKeyFor(item);
      if (gradeKey == null) continue;
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
    // ⭐ `R-1` — enumerado, no por resto. Aquí el spread era inofensivo (el `select` de arriba ya
    // acota a cuatro columnas), pero la REGLA es la que vale: en este fichero **no se proyecta por
    // sustracción**, ni siquiera donde hoy no duele. Si mañana alguien ensancha ese `select`, el
    // informe de IVA no se lleva la columna nueva de regalo.
    const byOrder = orders.map((o) => ({
      orderId: o.id,
      ivaCents: o.ivaCents,
      settledAt: o.settledAt,
      status: o.status,
    }));
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
          // v1.51 (M-46, §4.39c **SITIO 6**) — una línea que NO compramos no es una operación de
          // compra. Con el cherry-pick al ofertar (§P.2), una solicitud pagada puede llevar líneas
          // `skip` que nunca costaron un peso; contarlas como operaciones contaminaría la
          // instrumentación de §N.8 (infla el conteo y hunde el precio medio del bracket).
          // `null` = línea PREVIA al ciclo (todas las de hoy) ⇒ **sigue contando**, que es correcto:
          // antes de M-46 no había forma de no comprar una línea aprobada.
          // ⚠️ Se escribe con un `OR` EXPLÍCITO y no con `{ not: 'skip' }`: sobre una columna
          // NULLABLE, el trato que un `not` le da al `NULL` es una sutileza del ORM, y aquí la
          // diferencia es **borrar de la serie histórica TODAS las líneas previas al ciclo** —o sea,
          // el 100% de los datos que existen hoy. Un predicado de instrumentación no puede depender
          // de recordar esa regla.
          OR: [{ offerDecision: null }, { offerDecision: { not: 'skip' } }],
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
        // v1.51 (M-46, §4.39c **SITIO 5**) — la cola de trabajo se define POR EXCLUSIÓN, no con una
        // lista de estados vivos. Codificaba `['cotizada','recibida','verificacion','aprobada']`, así
        // que M-46 la habría dejado **SUBCONTANDO el pipeline**: `ofertada`, `aceptada` y
        // `en_transito` —las tres nuevas y no terminales— no aparecerían en la cola del operador.
        // ⚠️ **LA CIFRA CAMBIA A PROPÓSITO** (ahora incluye esos tres estados) y **no vuelve a
        // subcontar** cuando se añada otro: `LIVE = enum − TERMINAL` (criterio 129).
        this.prisma.sellRequest.count({ where: { status: { in: [...SELL_REQUEST_LIVE_STATES] } } }),
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
        // ⚠️⚠️ **I-FX5 · el mismo predicado y el mismo modo de fallo que la línea de arriba.**
        // Esto **decía `findFirst` a secas**, sin filtro de fuente y ordenando por `createdAt`.
        // Antes de v1.63.1 era defendible —la fila `manual-<hoy>` SÍ regía—; **desde I-FX5 no rige
        // nunca**, así que el tablero estaba afirmando la frescura del tipo de cambio **apoyándose
        // en una fila declarada inerte**, y `PUT /admin/fx { rate }` escribe justo esa fila. Con
        // `D-OPS-1` abierta (sin `BANXICO_SIE_TOKEN` el refresco **no escribe fila**) el tablero
        // podía decir «FX de hoy» durante semanas mientras el panel de §M2-F decía `missing`/`stale`:
        // **dos superficies de admin contestando distinto sobre el mismo dinero.**
        //
        // ⇒ **`lastFxAt` significa: cuándo se escribió la fila de Banxico QUE HOY RIGE.** Se nombra
        // la MISMA fila que `projectFxState` (mismo `where`, mismo `orderBy`), así que las dos
        // superficies no pueden divergir: sin fila de Banxico ⇒ `null` aquí y `missing` allá.
        // ⚠️ Si el refresco corre **dos veces el mismo día**, el `upsert` actualiza la fila y
        // `createdAt` **no se mueve** (`FxRate` no tiene `updatedAt` y este pase es CERO DDL): el
        // valor es *«cuándo apareció la fila vigente»*, no *«el último HTTP 200 a Banxico»*. Es la
        // lectura honesta de lo que la tabla sabe.
        this.prisma.fxRate.findFirst({ where: BANXICO_FX_WHERE, orderBy: BANXICO_FX_ORDER }),
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
