import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * LIVE-7 (API_CONTRACT §14.7, v1.84) — cuerpo de `POST /api/v1/telemetry/client-error`.
 * `{ message: string ≤ 300, digest?: string ≤ 64, path: string ≤ 200, release?: string ≤ 40 }`.
 * Forma inválida ⇒ `400 VALIDATION_ERROR` (ValidationPipe global + filtro).
 */
export class ClientErrorReportDto {
  @IsString()
  @MaxLength(300)
  message!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  digest?: string;

  @IsString()
  @MaxLength(200)
  path!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  release?: string;
}
