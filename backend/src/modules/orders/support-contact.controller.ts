import { Controller, Get, Header } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { supportContact } from '../mail/support-contact';

/**
 * v1.82 · **PNL-1** — `GET /api/v1/support/contact` (`API_CONTRACT §PNL.1`).
 *
 * Público (sin sesión), con el limitador global de siempre (`ThrottlerModule.forRoot`, `app.module.ts`),
 * y cacheable cinco minutos: el buzón cambia solo con un redeploy de env. Res `200 { contact }`, nunca
 * vacío (el resolutor cae al default de código).
 *
 * Sirve el «¿Problema con tu pedido? Escríbenos» de la tienda (pedido directo entregado, «Retiros»
 * entregado, confirmación de compra) y cierra el MOCK de `frontend/…/checkout/support-contact.ts`.
 * ⛔ No lee la BD ni la sesión: no hay nada que filtrar y nada que un anónimo no pueda ver ya en
 * cualquier correo nuestro.
 */
@Controller('support')
export class SupportContactController {
  @Public()
  @Get('contact')
  @Header('Cache-Control', 'public, max-age=300')
  contact(): { contact: string } {
    return { contact: supportContact() };
  }
}
