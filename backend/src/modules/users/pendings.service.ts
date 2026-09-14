import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SELL_REQUEST_LIVE_STATES } from '../../common/sell-request-states';

/**
 * # LA CAMPANA — `GET /api/v1/me/pendings`. **SE DERIVA, ⛔ NO SE PERSISTE** (§R.2, §4.54.2)
 *
 * > **No hay tabla de avisos. No hay bandeja. No hay «marcar como leído». El pendiente se CALCULA
 * > del estado que ya existe, cada vez que se pregunta.**
 *
 * ## Por qué, en el orden en que importa
 * 1. ⭐⭐ **Dos fuentes para un mismo hecho.** Una fila que dijera *«te falta la identidad»* sería una
 *    **segunda fuente** de algo cuya primera fuente es `KycProfile.kycStatus`. El día que discrepen,
 *    **la campana miente** — y `PROJECT §R.1` nombró ese defecto exacto: *«una lista que le repite
 *    para siempre algo que ya resolvió»*.
 * 2. ⭐ **El criterio 202(c) sale GRATIS y por construcción.** *«Resuelto el pendiente, desaparece»*:
 *    derivando, se apaga **el mismo instante** en que deja de ser verdad, porque **no hay nada que
 *    apagar**. Con tabla, es código que alguien tiene que acordarse de escribir — y el día que se
 *    olvide, **falla en silencio**.
 * 3. **El lazo de extinción YA EXISTE**: resubir el INE devuelve el estado a `pending` y limpia el
 *    motivo (`users.service.ts`). Derivar **hereda** ese lazo; persistir **lo duplica**.
 * 4. Lo único que una tabla compra de verdad es **historial**, y el historial está **en fase 2**.
 * 5. **Coste:** una lectura por `KycProfile.userId`, que ya es `@unique`. ⛔ Sin índice nuevo.
 *
 * ## ⚠️⚠️ LA MITAD QUE IMPIDE QUE «DERIVAR» SE CONVIERTA EN EL RIESGO Nº 1 (criterio 204)
 * **Se deriva de una LISTA BLANCA CERRADA de predicados, ⛔ JAMÁS de «cambió un estado».** La forma
 * ingenua —recorrer transiciones y publicar las que «parezcan del cliente»— **filtra
 * `SellOfferState.pending_authorization` sola**, y `schema.prisma` es explícito: *«EL CLIENTE NO DEBE
 * ENTERARSE DE QUE EXISTE […] le filtraría el orden de magnitud de nuestro tope»*.
 * ⇒ **este fichero no contiene ni una referencia a `SellOfferState`, en ninguna dirección**, y
 * `C-AV-8` lo comprueba **por lo negativo sobre el código**: rojo en cuanto aparezca.
 *
 * ## ⛔ LAS OTRAS TRES PROHIBICIONES DEL DOMINIO (§R.2.3)
 * - ⛔ **Un código nuevo es CAMBIO DE CONTRATO** y lo escribe el arquitecto (regla 9). No se añade
 *   una fila a {@link PENDING_CODES} «porque encaja».
 * - ⛔ **La campana no lleva EVENTOS** (pedido enviado, pago recibido, guía capturada…). Eso es la
 *   clase B de `PROJECT §R.1` y está en **fase 2**: construirla es fallar el criterio 202(d) **por
 *   exceso**.
 * - ⛔ **El DTO no lleva dinero, cifras, topes ni umbrales.** Dos campos, y ninguno es un número de
 *   negocio. *Un pendiente no es un resumen.*
 */

/** Dominio CERRADO. **Hoy: UNO.** Ampliarlo es cambio de contrato (§R.2.3). */
export const PENDING_CODES = ['identity_action_required'] as const;
export type PendingCode = (typeof PENDING_CODES)[number];

export interface PendingDTO {
  code: PendingCode;
  /** ISO-8601 — **desde cuándo es verdad el pendiente**. ⛔ No es «cuándo se avisó». */
  since: string;
}

export interface MePendingsResponse {
  pendings: PendingDTO[];
}

@Injectable()
export class PendingsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * ⭐ **`identity_action_required`** — *«tienes que (volver a) subir tu identificación»*.
   *
   * **El código nombra la OBLIGACIÓN, no nuestro estado interno** (⛔ no `kyc_rejected`): es lo único
   * que le toca **a él**, y sobrevive a que mañana la cláusula (b) tenga otro origen. *Un código que
   * nombra nuestro estado obliga a ux-ui a traducirlo; uno que nombra su tarea, no.*
   *
   * ```
   * (a) KycProfile.kycStatus === 'rejected'                       → since = reviewedAt
   * (b) ≥1 SellRequest VIVA (no terminal) con closedAt IS NULL,
   *     ineRequired = true y ineProvided = false                  → since = createdAt de la más antigua
   * las dos                                                        → la MÁS ANTIGUA
   * ```
   *
   * ### ⛔ Los tres estados que NO son pendiente, y los tres son DECISIÓN, no olvido
   * - **`none`**: un comprador que nunca vende **no tiene obligación de identidad**; encenderle la
   *   campana sería **fabricarle una tarea** — el ruido que `PROJECT §R.2` existe para evitar, y lo
   *   contrario de *«disponible, no impuesto»*. Cambiarlo es decidir **quién está obligado a
   *   identificarse**, que es regla de negocio: **se le pregunta al dueño** (§R.10).
   * - **`pending`**: *«el cliente no tiene nada que hacer y se le dice»* (§M6-K.7). **Un pendiente
   *   cuya acción es esperar no es suyo: es nuestro.**
   * - **`verified`**: no produce nada — ni campana ni correo (pregunta 71).
   *
   * ### ⚠️ La cláusula (b) es hoy, casi con certeza, VACÍA — y se DECLARA en vez de omitirse
   * El intake lanza `422 INE_REQUIRED` cuando `ineRequired && !ineProvided`, así que
   * `POST /buylist/requests` **no puede crear** una fila que la satisfaga. **Se conserva igual**
   * porque el predicado debe nombrar **la obligación**, no la alcanzabilidad de hoy: el día que ese
   * intake cambie, la campana ya está bien. ⛔ **QA no debe perseguirla**: `C-AV-7` la prueba
   * **sembrando la fila por SQL**.
   */
  async list(userId: string): Promise<MePendingsResponse> {
    const kyc = await this.prisma.kycProfile.findUnique({
      where: { userId },
      // ⛔ `select` explícito y mínimo: este endpoint **no necesita** —y por tanto no carga— la CLABE
      // cifrada, las keys de INE ni los overrides de tope. Lo que no se lee no se puede filtrar.
      select: { kycStatus: true, reviewedAt: true, updatedAt: true },
    });

    const sinces: Date[] = [];
    // (a) — el rechazo. `reviewedAt` es la fecha de la decisión que creó la obligación.
    if (kyc?.kycStatus === 'rejected') {
      // ⚠️ `reviewedAt` es NULLABLE y hay filas `rejected` **anteriores a M-54** que no lo tienen.
      // Se cae a `updatedAt`, que es lo más cercano a «desde cuándo es verdad esto» que la fila sabe.
      // ⛔ La alternativa —omitir el pendiente por falta de fecha— **escondería una obligación real**
      // por un detalle de migración, que es exactamente al revés de como debe fallar.
      sinces.push(kyc.reviewedAt ?? kyc.updatedAt);
    }
    // (b) — la solicitud viva que pide identificación y no la tiene.
    const oldestSellRequest = await this.prisma.sellRequest.findFirst({
      where: {
        userId,
        status: { in: [...SELL_REQUEST_LIVE_STATES] },
        closedAt: null,
        ineRequired: true,
        ineProvided: false,
      },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    });
    if (oldestSellRequest) sinces.push(oldestSellRequest.createdAt);

    if (sinces.length === 0) {
      // ⭐ **Vacío es la respuesta normal y correcta** — ⛔ no un `204` ni un `404`. El front oculta
      // la campana con la lista vacía (criterio 202(c): *falla si queda un indicador vacío*).
      return { pendings: [] };
    }
    const since = sinces.reduce((a, b) => (a <= b ? a : b));
    return { pendings: [{ code: 'identity_action_required', since: since.toISOString() }] };
  }
}
