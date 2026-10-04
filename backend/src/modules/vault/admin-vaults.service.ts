import { Injectable } from '@nestjs/common';
import { customerEmailOrBlank } from '../../common/customer-email';
import { PrismaService } from '../../prisma/prisma.service';
import { PricingService } from '../pricing/pricing.service';
import { NOT_ON_HAND } from '../inventory/master-set.service';
import { VaultService } from './vault.service';
import { BusinessException } from '../../common/business.exception';
import { parseEnumFilter } from '../../common/enum-filter';
import { variantKey } from '../../common/variant-key';
import { compareByDisplayName, customerDisplayName } from './customer-display-name';

/**
 * AdminVaultsService (v1.20-master-set-everywhere, §4.20c) — GET /admin/vaults: lista de clientes
 * CON bóveda (≥1 pieza en bóveda) para soporte/operación. Identificación mínima (name/email, misma
 * exposición que M6 para vault_operator; NUNCA CLABE/RFC/INE) + conteo de piezas + valor estimado
 * con la MISMA base de valuación del portafolio §3: referencia vigente POR ACABADO
 * (`getReferencesBatch`, 1 lote); piezas sin precio se EXCLUYEN del total y se cuentan en
 * `pendingPriceCount`. SIN N+1: 3 queries fijas (piezas en bóveda + usuarios de esas piezas +
 * lote de referencias); el sort global (value_desc default) se hace en memoria sobre el agregado.
 */

/**
 * ⭐ **`EQ-D1` lote 2 — dominio del eje `?sort=` de `GET /admin/vaults` (CLASE ORDEN, §0-Q punto 6).**
 *
 * Antes, `?sort=zzz` caía al `else` de `sortRows` y devolvía el orden por valor **sin decirlo** — el
 * clamp silencioso que §0-Q punto 6 prohíbe. Ahora fuera de dominio ⇒ `400` con `details.{field,
 * allowed}`. ⛔ La fila FORMAL de §0-Q punto 4 la escribe el ARQUITECTO (regla 9): es un MODO de la
 * consulta (sin columna/enum en el schema). `C-EQ-1` importa este literal REAL para la paridad.
 */
export const ADMIN_VAULTS_SORT_VALUES = ['value_desc', 'pieces_desc', 'name_asc'] as const;
export type AdminVaultsSort = (typeof ADMIN_VAULTS_SORT_VALUES)[number];
/** Default declarado por el controller (`@Query('sort') sort = 'value_desc'`). */
const ADMIN_VAULTS_SORT_DEFAULT: AdminVaultsSort = 'value_desc';

export interface AdminVaultSummaryDTO {
  userId: string;
  /** ⭐ v1.79.3 (H-1): `customerDisplayName(User)` ⇒ `null` si el nombre se fabricó del correo. */
  name: string | null;
  email: string;
  pieceCount: number;
  totalValueMxnCents: number;
  pendingPriceCount: number;
}

export interface AdminVaultListResponse {
  data: AdminVaultSummaryDTO[];
  page: number;
  pageSize: number;
  total: number;
}

@Injectable()
export class AdminVaultsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly vault: VaultService,
  ) {}

  /**
   * v1.23-sealed-sales (§4.23g / API_CONTRACT §M1) — pestaña «Sellado» de la bóveda de UN cliente
   * (hermana admin de `GET /vault/sealed`). Mismo shape (`VaultSealedResponse`) con `owner`
   * (name/email, ya visibles para vault_operator en M6; NUNCA CLABE/RFC/INE). Reusa la agregación de
   * `VaultService.sealedTab` (una fuente de verdad). Err 404 NOT_FOUND si el usuario no existe.
   */
  async sealed(userId: string, q: { sealedSubtype?: string; condition?: string; sort?: string }) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, nameSource: true, email: true },
    });
    if (!user) throw BusinessException.notFound('NOT_FOUND', 'User not found');
    const base = await this.vault.sealedTab(userId, q);
    // ⭐ v1.79.3 (H-1): la pestaña «Sellado» nombra al cliente con la MISMA regla que el resto de
    // «Bóvedas de clientes» (un nombre fabricado del correo sale `null`).
    return {
      ...base,
      owner: { userId: user.id, name: customerDisplayName(user), email: customerEmailOrBlank(user.email, 'AdminVault.owner', user.id) },
    };
  }

  async list(q: {
    q?: string;
    page: number;
    pageSize: number;
    sort: string;
  }): Promise<AdminVaultListResponse> {
    // (1) TODAS las piezas "en bóveda" de clientes (mismo filtro de status del scope user_vault).
    const pieces = await this.prisma.inventoryItem.findMany({
      where: {
        ownerType: 'customer',
        ownerUserId: { not: null },
        status: { notIn: NOT_ON_HAND },
      },
      select: {
        ownerUserId: true,
        cardId: true,
        productType: true,
        rawCondition: true,
        gradingCompany: true,
        gradeValue: true,
        finish: true,
        // v1.80.1 (SK-5): sin él, la valuación no puede distinguir una caja mapeada de una sin mapear.
        tcgplayerProductId: true,
      },
    });
    if (pieces.length === 0) return { data: [], page: q.page, pageSize: q.pageSize, total: 0 };

    // (2) Identificación mínima de los dueños (filtro q por nombre/email aquí).
    const ownerIds = [...new Set(pieces.map((p) => p.ownerUserId as string))];
    const users = await this.prisma.user.findMany({
      where: {
        id: { in: ownerIds },
        ...(q.q
          ? {
              OR: [
                { name: { contains: q.q, mode: 'insensitive' } },
                { email: { contains: q.q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      select: { id: true, name: true, nameSource: true, email: true },
    });
    const userById = new Map(users.map((u) => [u.id, u]));

    // (3) Valuación en LOTE — misma base que el portafolio §3 (referencia vigente por acabado).
    // v1.53 (§4.40.4b, MONEY) — LECTURA: una pieza `graded` sin identidad de slab no aporta clave al
    // lote; abajo suma a `pendingPriceCount` y queda EXCLUIDA del total, que es la verdad. Antes se
    // valuaba la bóveda del cliente al precio de un PSA 10.
    // v1.80.1 (SK-5, MONEY): por la ÚNICA puerta de valuación. Sellado mapeado ⇒ su `sealed:tcg:<id>`
    // con el gate de dial de `/vault/sealed`; sin mapeo ⇒ sin clave ⇒ pendiente. ⛔ Nunca la fila
    // legada `'sealed'` (clave de COLA: puede ser el precio de otra caja anclada a la misma `Card`).
    const keyOf = pieces.map((p) => this.pricing.valuationKeyFor(p));
    const refs = await this.pricing.getReferencesBatch(keyOf.flatMap((k) => (k ? [k] : [])));
    // El dial del sellado, UNA vez por petición y solo si hay sellado que gatear (v1.80.2.2 D-4: un
    // solo cuerpo, `sealedSourceOnFor`).
    const sourceOn = await this.pricing.sealedSourceOnFor(pieces);

    const agg = new Map<
      string,
      { pieceCount: number; totalValueMxnCents: number; pendingPriceCount: number }
    >();
    pieces.forEach((p, i) => {
      const userId = p.ownerUserId as string;
      if (!userById.has(userId)) return; // fuera del filtro q (o usuario inexistente)
      const a = agg.get(userId) ?? { pieceCount: 0, totalValueMxnCents: 0, pendingPriceCount: 0 };
      a.pieceCount += 1;
      const k = keyOf[i];
      // D-1 (v1.80.2.2): la MISMA `variantKey` que el productor del lote (`getReferencesBatch`).
      const ref = k ? refs.get(variantKey(k)) : undefined;
      const cents = this.pricing.valuationCentsOf(p, ref, sourceOn);
      if (cents != null) {
        a.totalValueMxnCents += cents;
      } else {
        a.pendingPriceCount += 1; // pendientes EXCLUIDOS del total y CONTADOS (§3)
      }
      agg.set(userId, a);
    });

    let rows: AdminVaultSummaryDTO[] = [...agg.entries()].map(([userId, a]) => {
      const u = userById.get(userId)!;
      // v1.80.9 (I-STF-1): dueño de bóveda = cliente ⇒ con correo; `null` ⇒ log + `""`.
      return { userId, name: customerDisplayName(u), email: customerEmailOrBlank(u.email, 'AdminVaultSummary', userId), ...a };
    });

    rows = this.sortRows(rows, q.sort);
    const total = rows.length;
    const start = (q.page - 1) * q.pageSize;
    return { data: rows.slice(start, start + q.pageSize), page: q.page, pageSize: q.pageSize, total };
  }

  /**
   * Orden normado: value_desc (default) | pieces_desc | name_asc.
   *
   * ⭐ `EQ-D1` lote 2 — `?sort=` pasa por `parseEnumFilter` (§0-Q): ausente/vacío ⇒ el default
   * `value_desc`; fuera de dominio ⇒ `400` con `details.{field,allowed}` (antes caía al `else` y
   * devolvía `value_desc` **sin decirlo** — el clamp silencioso que §0-Q punto 6 prohíbe).
   */
  private sortRows(rows: AdminVaultSummaryDTO[], sortRaw: string): AdminVaultSummaryDTO[] {
    const sort =
      parseEnumFilter('sort', sortRaw, ADMIN_VAULTS_SORT_VALUES) ?? ADMIN_VAULTS_SORT_DEFAULT;
    // ⭐ v1.79.3 (H-1): `name` puede ser `null` ⇒ ⛔ `a.name.localeCompare(b.name)` reventaba con
    // `TypeError` (500). Los `null` van al final, entre ellos por `email` (unidades de código) y
    // `userId`; lo mismo como desempate de `value_desc`/`pieces_desc`.
    const byName = compareByDisplayName;
    if (sort === 'pieces_desc') {
      return [...rows].sort((a, b) => b.pieceCount - a.pieceCount || byName(a, b));
    }
    if (sort === 'name_asc') return [...rows].sort(byName);
    return [...rows].sort((a, b) => b.totalValueMxnCents - a.totalValueMxnCents || byName(a, b));
  }
}
