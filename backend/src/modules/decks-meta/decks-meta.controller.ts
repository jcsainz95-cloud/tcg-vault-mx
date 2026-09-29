import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsString, MaxLength } from 'class-validator';
import { Public } from '../../common/decorators/public.decorator';
import { DecksMetaService } from './decks-meta.service';

/**
 * DECKS-META §13 (Fase 1) — endpoints PÚBLICOS. Diseño: `docs/API_CONTRACT.md §13`. El frontend de
 * Fase 1 (ya entregado) consume estas formas al pie de la letra.
 */

/** `POST /decks-meta/paste` — el motor (H3). `text` es CUERPO (no query), acotado para no abusar. */
export class PasteDeckDto {
  // ≤ 20 000 chars: un mazo Standard son 60 líneas; el tope corta pegados patológicos sin estorbar.
  @IsString() @MaxLength(20_000) text!: string;
}

@Controller('decks-meta')
export class DecksMetaController {
  constructor(private readonly service: DecksMetaService) {}

  /** Top-10 del meta publicado, por `rank` asc, con cita de fuente. */
  @Public()
  @Get()
  list() {
    return this.service.listPublished();
  }

  /** Detalle + disponibilidad por línea. Slug desconocido ⇒ `404 DECK_NOT_FOUND`. */
  @Public()
  @Get(':slug')
  bySlug(@Param('slug') slug: string) {
    return this.service.getBySlug(slug);
  }

  /**
   * Pega una lista: parsea+empareja+valora EN MEMORIA (no persiste) y devuelve la misma forma
   * `groups`. Rate-limited (`429`). Texto sin líneas válidas ⇒ `422 DECK_LIST_UNPARSEABLE`.
   */
  @Public()
  @Post('paste')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  paste(@Body() dto: PasteDeckDto) {
    return this.service.paste(dto.text);
  }
}
