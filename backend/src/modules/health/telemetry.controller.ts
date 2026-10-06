import { Body, Controller, HttpCode, Logger, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { ClientErrorReportDto } from './dto/client-error-report.dto';
import { pathWithoutQuery, scrubClientText, summarizeCspReports } from './telemetry-report';

/**
 * LIVE-7 (API_CONTRACT §14.7, v1.84) — telemetría del navegador. Públicos, con tope por IP, ⛔ SOLO LOG:
 * nada se guarda en BD (TLM-5). Ninguna línea lleva IP, UA ni usuario.
 *
 * - `POST /telemetry/csp` — informes CSP (`application/csp-report` o `application/reports+json`). El cuerpo
 *   lo lee un parser PROPIO de esta ruta (texto crudo, ≤ 16 KB ⇒ si no `413`; ver `src/body-parsers.ts`).
 *   Siempre `204`, también si no se entiende: un navegador no reintenta y no hay nada que enseñarle.
 * - `POST /telemetry/client-error` — un error mostrado por `error.tsx` / `global-error.tsx`. `204`.
 */
@Controller('telemetry')
export class TelemetryController {
  private readonly logger = new Logger('Telemetry');

  @Public()
  @Post('csp')
  @HttpCode(204)
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  csp(@Body() body: unknown): void {
    for (const fields of summarizeCspReports(body)) {
      this.logger.warn(`CSP_VIOLATION ${JSON.stringify(fields)}`);
    }
  }

  @Public()
  @Post('client-error')
  @HttpCode(204)
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  clientError(@Body() dto: ClientErrorReportDto): void {
    // Campo a campo (⛔ no `...dto`): solo lo que el contrato nombra. `message` pasa por `scrubClientText`
    // (v1.84.2 §14.15 E2-3: query/fragmento pegados, `nombre=valor` de secreto, JWT) y `JSON.stringify` escapa
    // sus saltos de línea ⇒ una sola línea de log (TLM-8).
    const line: Record<string, string> = { message: scrubClientText(dto.message), path: pathWithoutQuery(dto.path) };
    if (dto.digest !== undefined) line.digest = dto.digest;
    if (dto.release !== undefined) line.release = dto.release;
    this.logger.error(`CLIENT_ERROR ${JSON.stringify(line)}`);
  }
}
