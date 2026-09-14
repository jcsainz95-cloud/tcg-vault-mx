import { Controller, Get, Header } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { MePendingsResponse, PendingsService } from './pendings.service';

/**
 * # `GET /api/v1/me/pendings` — LA CAMPANA (§R.2.1, v1.74)
 *
 * ```
 * Roles: customer+            (⛔ sin sesión ⇒ 401; NO es @Public)
 * Cabecera OBLIGATORIA: Cache-Control: no-store
 * Query: ⛔ NINGUNA
 * → 200 { pendings: [{ code, since }] }   ·   `{ "pendings": [] }` es la respuesta NORMAL
 * ```
 *
 * ## ⛔⛔ CERO PARÁMETROS DE QUERY, Y ES DELIBERADO
 * ⇒ esta rev **no toca `§0-Q`** ni su registro de ejes, y **`C-EQ-1` sigue verde sin cambios**.
 * *No hay eje que clasificar porque no hay eje.* ⚠️ Añadirle un `?code=` (o cualquier otro) más
 * adelante **es cambio de contrato**: pasa por el arquitecto (regla 9) y **obliga** a darle clase
 * **E/R/L** en §0-Q — un eje nuevo sin clase pone `C-EQ-1` en rojo, y ésa es exactamente la mitad de
 * descubrimiento que ese candado tiene.
 *
 * ## ⛔ SIN PAGINACIÓN Y SIN `total`
 * El dominio tiene **un** código hoy y una **lista blanca cerrada** siempre: *un listado que no puede
 * crecer sin que el arquitecto lo escriba no se pagina.*
 *
 * ## ⛔ `Cache-Control: no-store`, y no es ceremonia
 * Es **estado por usuario**: un `304` de un proxy **pintaría la campana de otro**.
 *
 * ## ⛔ ESTE `GET` NO ESCRIBE NADA
 * No marca leído, no sella, no audita. *Un `GET` que muta es la vía por la que un prefetch del
 * navegador despacha un aviso que el cliente nunca vio.*
 *
 * ## ⛔ Para un INVITADO la campana NO APLICA, y se DECLARA (criterio 203)
 * No tiene sesión ⇒ **401**, y ⛔ **no se inventa una variante tokenizada**. **No es un hueco**: el
 * único pendiente del corte es la identidad, y la identidad **exige cuenta** (`KycProfile` cuelga de
 * `User`) ⇒ para el invitado **el pendiente no existe**, no es que no se le muestre.
 *
 * ## ⚠️ Por qué un controller nuevo y no un handler más en `UsersController`
 * La ruta del contrato es **`/me/pendings`**, no `/users/me/pendings`, y `UsersController` está
 * montado en `@Controller('users/me')`. ⛔ La ruta no se «corrige» para que quepa en el controller
 * que ya existe: **el contrato manda sobre el código**.
 */
@Controller('me')
// `customer+` = los tres roles con sesión. Un operador o un súper-admin también pueden tener su
// propio expediente de identidad, y la campana es **suya**, no de su rol.
@Roles(Role.customer, Role.vault_operator, Role.super_admin)
export class MePendingsController {
  constructor(private readonly pendings: PendingsService) {}

  @Get('pendings')
  @Header('Cache-Control', 'no-store')
  list(@CurrentUser('id') userId: string): Promise<MePendingsResponse> {
    return this.pendings.list(userId);
  }
}
