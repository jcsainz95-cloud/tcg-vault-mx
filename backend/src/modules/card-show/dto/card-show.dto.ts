/**
 * card-show.dto.ts — v1.93⟨cardshow⟩ (API_CONTRACT §CARDSHOW.3/.5/.11/.12). Cuerpos ESTRICTOS: se
 * validan con `StrictBodyPipe` (`whitelist + forbidNonWhitelisted`), así que un campo desconocido ⇒
 * `400 VALIDATION_ERROR {field}`. Validación de FORMA ⇒ 400/413 (⛔ no silenciosa, §CARDSHOW.11.v).
 *
 * El honeypot (`website`) es un campo OCULTO: con valor ⇒ respuesta neutra 0/0 (⛔ no 400) — por eso
 * es un string OPCIONAL permitido aquí y el servicio decide el descarte silencioso.
 */
import { Equals, IsBoolean, IsEmail, IsIn, IsInt, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';
import {
  CARD_SHOW_LEAD_SOURCE_VALUES,
  CARD_SHOW_LEAD_TYPE_VALUES,
} from '../../../common/enum-values';
import { MAX_EMAIL_LEN, MAX_PLAYER_NAME_LEN } from '../card-show.constants';

/** Sin `<`/`>` (corta `<script>` en utm/referrer, §CARDSHOW.11). */
const NO_ANGLE = /^[^<>]*$/;
/** Lista blanca de `playerName`: letras (unicode), espacio, apóstrofo, guion, punto. ⛔ dígitos/@/</http. */
const PLAYER_NAME_WHITELIST = /^[\p{L}\p{M} .'-]+$/u;
/** Player ID: SOLO dígitos, 1..12 (13 dígitos ⇒ 400). */
const PLAYER_ID = /^\d{1,12}$/;

const LEAD_TYPES = CARD_SHOW_LEAD_TYPE_VALUES as unknown as string[];
const LEAD_SOURCES = CARD_SHOW_LEAD_SOURCE_VALUES as unknown as string[];

export class CreateLeadDto {
  @IsIn(LEAD_TYPES) type!: string; // merchant | sponsor | visitor (ADMIN/MERCHANT mayúscula ⇒ 400)
  @IsString() @IsEmail() @MaxLength(MAX_EMAIL_LEN) email!: string;
  @IsIn(LEAD_SOURCES) source!: string;
  @Equals(true) consent!: boolean; // false/ausente ⇒ 400 y 0 filas
  @IsString() @MaxLength(1024) formToken!: string;

  // Honeypot (⛔ no 400 con valor: el servicio descarta en silencio).
  @IsOptional() @IsString() @MaxLength(512) website?: string;

  @IsOptional() @IsString() @MaxLength(256) @Matches(NO_ANGLE) utmSource?: string;
  @IsOptional() @IsString() @MaxLength(256) @Matches(NO_ANGLE) utmMedium?: string;
  @IsOptional() @IsString() @MaxLength(256) @Matches(NO_ANGLE) utmCampaign?: string;
  @IsOptional() @IsString() @MaxLength(256) @Matches(NO_ANGLE) utmContent?: string;
  @IsOptional() @IsString() @MaxLength(256) @Matches(NO_ANGLE) referrerHost?: string;
  @IsOptional() @IsInt() @Min(1) mesaInteres?: number;
}

export class CreatePlayerDto {
  @IsIn(['sat', 'sun', 'both']) day!: 'sat' | 'sun' | 'both'; // «los dos» = DOS filas, 1 envío
  @IsString() @MaxLength(MAX_PLAYER_NAME_LEN) @Matches(PLAYER_NAME_WHITELIST) playerName!: string;
  @IsString() @Matches(PLAYER_ID) playerId!: string;
  @IsString() @IsEmail() @MaxLength(MAX_EMAIL_LEN) email!: string;
  @IsBoolean() isMinor!: boolean;
  @IsOptional() @IsBoolean() guardianConsent?: boolean; // obligatorio ⇔ isMinor (lo exige el servicio)
  // Nombre del tutor: se captura para el aviso legal pero el modelo (contrato) ⛔ no lo persiste.
  @IsOptional() @IsString() @MaxLength(MAX_PLAYER_NAME_LEN) @Matches(PLAYER_NAME_WHITELIST) guardianName?: string;
  @Equals(true) consent!: boolean;
  @IsString() @MaxLength(1024) formToken!: string;

  @IsOptional() @IsString() @MaxLength(512) website?: string;
  @IsOptional() @IsString() @MaxLength(256) @Matches(NO_ANGLE) utmSource?: string;
  @IsOptional() @IsString() @MaxLength(256) @Matches(NO_ANGLE) utmMedium?: string;
  @IsOptional() @IsString() @MaxLength(256) @Matches(NO_ANGLE) utmCampaign?: string;
  @IsOptional() @IsString() @MaxLength(256) @Matches(NO_ANGLE) utmContent?: string;
}

/** Cuerpo del cambio de estado (confirmar/cancelar/baja): SOLO el token de un solo uso (§CARDSHOW.6). */
export class LinkActionDto {
  @IsString() @MaxLength(2048) token!: string;
}

/** Contador de clics vía `sendBeacon` (§CARDSHOW.13). ⛔ sin cookie/IP/user-agent. */
export class ClickDto {
  @IsString() @MaxLength(128) @Matches(NO_ANGLE) destino!: string;
  @IsOptional() @IsInt() @Min(1) mesa?: number;
  @IsOptional() @IsString() @MaxLength(256) @Matches(NO_ANGLE) utmSource?: string;
  @IsOptional() @IsString() @MaxLength(256) @Matches(NO_ANGLE) utmContent?: string;
}
