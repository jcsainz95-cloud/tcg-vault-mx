import { Body, Controller, Get, Header, HttpCode, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequireEmailVerified } from '../../common/decorators/require-email-verified.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { BuylistService } from './buylist.service';
import {
  BatchQuoteDto,
  CreateRequestDto,
  OfferResponseDto,
  PublicQuoteDto,
  RespondDto,
} from './dto/buylist.dto';

@Controller('buylist')
export class BuylistController {
  constructor(private readonly buylist: BuylistService) {}

  // Rate-limit dedicado (60/min por IP) alineado con los controllers públicos hermanos
  // (`buylist-catalog.controller.ts`). El cotizador por-carta es anónimo (@Public) y READ-ONLY;
  // se acota para no depender solo del throttler global (300/min) — B-C1 (seguridad).
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Post('quote')
  @HttpCode(200)
  quote(@Body() dto: PublicQuoteDto) {
    return this.buylist.publicQuote(
      dto.cardId,
      dto.productType,
      dto.rawCondition,
      dto.finish,
      dto.productId,
    );
  }

  // v1.15 (§4.16b): batch quote — cotiza N cartas en 1 request (mata el fan-out FE-12). Público y
  // READ-ONLY como el quote por-carta (anónimo, no se bloquea por emailVerified). Errores por-ítem:
  // HTTP global 200; el cap 50 / vacío lo impone el DTO (400 VALIDATION_ERROR).
  // Rate-limit MÁS restrictivo (12/min) que el quote por-carta: cada request amplifica hasta 50×
  // el trabajo, así que 12 req/min ≈ el mismo techo de cotizaciones/min que 60/min por-carta.
  // Cierra la amplificación DoS anónima — B-C1 (seguridad).
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 12 } })
  @Post('quote/batch')
  @HttpCode(200)
  quoteBatch(@Body() dto: BatchQuoteDto) {
    return this.buylist.batchQuote(dto.items);
  }

  // v1.28 (P-22, §6): vitrina pública «Top Bounties» — bounties ACTIVOS, orden precio desc, cap
  // 50, sin query params. READ-ONLY estricto (doctrina v1.12 de anónimos: no persiste, no escala
  // pendientes, no mueve dinero). Mismo rate-limit dedicado que el quote por-carta (60/min).
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Get('bounties')
  bounties() {
    return this.buylist.publicBounties();
  }

  /**
   * v1.51.4 (D43, §6 / ARCHITECTURE §4.39r) — **la política pública del cotizador: UN entero.**
   *
   * `public`, **READ-ONLY estricto** (misma doctrina que `/quote` y `/bounties`: no persiste, no
   * escala pendientes, no mueve dinero), sin query params y sin body. **Mismo throttle público**
   * (60/min por IP) que los otros dos anónimos de este controller.
   *
   * **`Cache-Control: public, max-age=300` es OBLIGATORIO por contrato**, no una optimización: el
   * mínimo **gatea un botón**, así que cuando el humano mueve el dial el storefront debe reflejarlo
   * *en lo que dura un café*. No es `no-store` porque es **un entero sin PII, idéntico para todos y
   * pedido en cada visita** — cacheable también en CDN, **sin `Vary` por sesión** y **sin variante
   * autenticada**. La rancidez está aceptada a ojos abiertos en las dos direcciones y **ninguna es
   * money-unsafe**: si el mínimo SUBE, el vendedor manda y recibe el `422` con el número correcto
   * (un viaje de más, con mensaje accionable); si BAJA, el botón queda apagado hasta 5 min a alguien
   * que ya califica (solo retrasa). **En ningún caso se crea una solicitud incorrecta**: la puerta
   * revalida siempre (criterio 132(b)).
   *
   * ⚠️ **Es un `GET` PROPIO y no un campo dentro de un `POST`, y las tres alternativas se
   * rechazaron por escrito (§4.39r.3):** en `POST /buylist/quote` el mismo número se repetiría **N
   * veces por render de la rejilla** y **un `POST` no se cachea**; en `quote/batch` sería peor —ese
   * endpoint cotiza **la rejilla que se está mirando, NO el carrito**, así que un total calculado
   * ahí sería *«una cifra de dinero correcta que describe otra cosa: la peor clase de bug, porque
   * cuadra»*—; y `GET /buylist/bounties` es una **vitrina** que puede quedar **vacía**, y la copia de
   * dinero del cotizador no puede depender de que haya bounties.
   *
   * ⚠️ **El nombre importa: JAMÁS `GET /config`.** `quote-policy` nombra **la categoría** (*las
   * reglas que gobiernan la cotización pública*), no su contenido. *Un cajón llamado «config
   * pública» invita a echarle la siguiente bandera, y así es como el umbral de INE acaba publicado
   * «porque ya había un endpoint».* El guardarraíl real es la **lista cerrada** de exclusiones del
   * servicio.
   */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Get('quote-policy')
  @Header('Cache-Control', 'public, max-age=300')
  quotePolicy() {
    return this.buylist.quotePolicy();
  }

  // v1.5: vender (crear SellRequest) es acción sensible → requiere emailVerified. El cotizador
  // público `POST /buylist/quote` (arriba) queda abierto (es anónimo, no se bloquea).
  @Roles(Role.customer, Role.vault_operator, Role.super_admin)
  @RequireEmailVerified()
  @Post('requests')
  @HttpCode(201)
  create(@CurrentUser('id') userId: string, @Body() dto: CreateRequestDto) {
    return this.buylist.createRequest(userId, dto.items, dto.clabe, dto.ineUploadKeys);
  }

  @Roles(Role.customer, Role.vault_operator, Role.super_admin)
  @Get('requests')
  list(@CurrentUser('id') userId: string) {
    return this.buylist.listMine(userId);
  }

  @Roles(Role.customer, Role.vault_operator, Role.super_admin)
  @Get('requests/:id')
  get(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.buylist.getMine(userId, id);
  }

  @Roles(Role.customer, Role.vault_operator, Role.super_admin)
  @Post('requests/:id/respond')
  @HttpCode(200)
  respond(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: RespondDto,
  ) {
    return this.buylist.respond(userId, id, dto.decision);
  }

  /**
   * v1.51 (§6, D1/D2/D3, criterios 118/119/120/121/146/161) — **la respuesta a la OFERTA.**
   *
   * ⚠️ **`accept` sobre `ofertada` ⇒ `aceptada`, NUNCA `aprobada`.** Si saltara a `aprobada`, la
   * solicitud caería en la cola de «listas para pagar SPEI» **sin envío, sin recepción y sin
   * verificación** — pagaríamos por cartas que nunca recibimos.
   *
   * **EXIGE SESIÓN DEL DUEÑO** (criterio 146): el correo **lleva** a esta pantalla, pero la respuesta
   * **no se ejecuta desde un enlace anónimo** — **no existe enlace tokenizado de aceptación**.
   * **SEC-A1 (criterio 120):** ningún monto viaja en el body; la defensa es **la forma del DTO**.
   */
  @Roles(Role.customer, Role.vault_operator, Role.super_admin)
  @Post('requests/:id/offer-response')
  @HttpCode(200)
  offerResponse(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: OfferResponseDto,
  ) {
    return this.buylist.offerResponse(userId, id, dto.decision);
  }
}
