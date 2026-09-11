import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import { BusinessException } from '../../common/business.exception';

// v1.2: object storage acotado SOLO al INE del buylist. `inventory_photo`/`dispute_claim`
// quedan eliminados (producto sin fotos propias; evidencia de disputa por correo a soporte).
type UploadPurpose = 'kyc_ine';

// S-B3: el INE es una FOTO. Solo se admite `image/*` (rechaza HTML/PDF/binarios arbitrarios).
const ALLOWED_CONTENT_TYPE_PREFIX = 'image/';
// S-B3: tamaño máximo por defecto para una foto de INE (10 MiB), configurable por env
// `KYC_UPLOAD_MAX_BYTES`. Suficiente para una foto de credencial; corta el abuso de storage.
const DEFAULT_KYC_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

/**
 * UploadsService — Presign de object storage (S3/MinIO). API_CONTRACT §8.
 * El cliente hace PUT directo al bucket con la URL prefirmada; la DB guarda solo la key.
 */
@Injectable()
export class UploadsService {
  private client?: S3Client;

  constructor(private readonly config: ConfigService) {}

  private get s3(): S3Client {
    if (!this.client) {
      this.client = new S3Client({
        region: this.config.get<string>('S3_REGION') ?? 'us-east-1',
        endpoint: this.config.get<string>('S3_ENDPOINT'),
        forcePathStyle: (this.config.get<string>('S3_FORCE_PATH_STYLE') ?? 'true') === 'true',
        credentials: {
          accessKeyId: this.config.get<string>('S3_ACCESS_KEY_ID') ?? 'minioadmin',
          secretAccessKey: this.config.get<string>('S3_SECRET_ACCESS_KEY') ?? 'minioadmin',
        },
        // BUG A1 (INE): el AWS SDK v3 por defecto (`requestChecksumCalculation: 'WHEN_SUPPORTED'`)
        // inyecta headers `x-amz-sdk-checksum-algorithm` / `x-amz-checksum-crc32` en los SignedHeaders
        // de la URL prefirmada. El navegador hace PUT directo a R2 enviando SOLO `Content-Type`
        // (y `Content-Length`), NO esos headers → la firma no coincide → 403 SignatureDoesNotMatch.
        // Con `WHEN_REQUIRED` el SDK NO agrega checksum al presign salvo que la operación lo exija,
        // así el PUT del navegador vuelve a validar la firma. No cambia el contrato (§8).
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
      });
    }
    return this.client;
  }

  /** Tamaño máximo permitido para el upload de INE (bytes). Dial por env `KYC_UPLOAD_MAX_BYTES`. */
  private get maxUploadBytes(): number {
    const raw = this.config.get<string>('KYC_UPLOAD_MAX_BYTES');
    const parsed = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_KYC_UPLOAD_MAX_BYTES;
  }

  async presign(purpose: string, contentType: string, contentLength?: number) {
    // v1.2: SOLO se admite `kyc_ine`. Cualquier otro propósito → 422 VALIDATION_ERROR.
    if (purpose !== 'kyc_ine') {
      throw BusinessException.validation(
        'VALIDATION_ERROR',
        'Only purpose="kyc_ine" is supported for uploads',
      );
    }
    const validPurpose: UploadPurpose = purpose;

    // S-B3: allow-list de content-type — el INE es una imagen; se rechaza todo lo demás
    // (HTML, PDF, binarios) para no permitir subir contenido no-imagen al bucket.
    const normalizedType = (contentType ?? '').toLowerCase();
    if (!normalizedType.startsWith(ALLOWED_CONTENT_TYPE_PREFIX)) {
      throw BusinessException.validation(
        'VALIDATION_ERROR',
        'Only image/* content types are allowed for kyc_ine uploads',
        { contentType },
      );
    }

    // P-UP-1 (pentest MEDIA): el tope de tamaño es OBLIGATORIO, no opcional.
    //
    // Antes, `contentLength` era opcional: si el cliente lo OMITÍA, el `if` de abajo no corría, la
    // firma salía sin `ContentLength` (`UNSIGNED-PAYLOAD`) y el PUT podía subir lo que quisiera.
    // O sea: **el candado lo elegía el atacante**, porque quien quiere pasarse del tope es
    // justamente quien no va a declarar su tamaño. Un tope que se evade omitiendo un campo no es
    // un tope; es una sugerencia.
    //
    // Ahora el tamaño se exige SIEMPRE y se FIJA SIEMPRE en la firma, de modo que S3/R2 rechaza
    // (`SignatureDoesNotMatch` / 400) cualquier cuerpo cuyo `Content-Length` no sea exactamente el
    // firmado. La cota deja de depender de la buena fe del cliente y pasa a estar en la firma.
    //
    // Alternativa descartada: acotar del lado del almacenamiento. La condición `s3:content-length-range`
    // solo existe para el POST-policy de formulario, no para un PUT prefirmado, y la política del
    // bucket es de devops: no sirve como candado de este endpoint.
    const maxBytes = this.maxUploadBytes;
    if (contentLength === undefined || contentLength === null) {
      throw BusinessException.validation(
        'VALIDATION_ERROR',
        'contentLength is required: the presigned URL is always bound to an exact size',
        { maxBytes },
      );
    }
    if (!Number.isInteger(contentLength) || contentLength <= 0) {
      throw BusinessException.validation(
        'VALIDATION_ERROR',
        'contentLength must be a positive integer',
        { contentLength },
      );
    }
    if (contentLength > maxBytes) {
      throw BusinessException.validation(
        'VALIDATION_ERROR',
        `File too large: max ${maxBytes} bytes for kyc_ine uploads`,
        { contentLength, maxBytes },
      );
    }

    const bucket = this.config.get<string>('S3_BUCKET') ?? 'tcg-photos';
    const ext = normalizedType.split('/')[1] ?? 'bin';
    const uploadKey = `${validPurpose}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}.${ext}`;
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: uploadKey,
      ContentType: contentType,
      // P-UP-1: incondicional. Ya no hay rama «sin ContentLength» que produzca una URL sin cota.
      ContentLength: contentLength,
    });
    const uploadUrl = await getSignedUrl(this.s3, command, { expiresIn: 900 });
    const headers: Record<string, string> = {
      'Content-Type': contentType,
      'Content-Length': String(contentLength),
    };
    return {
      uploadKey,
      uploadUrl,
      method: 'PUT' as const,
      headers,
      maxBytes,
      expiresAt: new Date(Date.now() + 900 * 1000).toISOString(),
    };
  }

  /**
   * SEC-A5: URL prefirmada de LECTURA (GET) de vida corta. Reemplaza el modelo de "URL
   * pública del bucket" para servir el único documento sensible que se sube en v1.2: el
   * INE/KYC del buylist (`kyc_ine`). El bucket debe ser PRIVADO (sin ACL público-lectura)
   * — lo garantiza devops en infra.
   * @param expiresIn segundos de validez (por defecto 300s = 5 min).
   */
  async presignGet(key: string, expiresIn = 300): Promise<string> {
    const bucket = this.config.get<string>('S3_BUCKET') ?? 'tcg-photos';
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      // S-B3: forzar descarga (nunca render inline) al servir el INE → un objeto malicioso
      // no se ejecuta como HTML aunque se abra desde el dominio de storage.
      ResponseContentDisposition: 'attachment',
    });
    return getSignedUrl(this.s3, command, { expiresIn });
  }

  /**
   * Borra un objeto del bucket (retención de PII: purga de imágenes de INE vencidas).
   * DELETE de S3/MinIO es idempotente: borrar una key inexistente no falla.
   */
  async deleteObject(key: string): Promise<void> {
    const bucket = this.config.get<string>('S3_BUCKET') ?? 'tcg-photos';
    await this.s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  }
}
