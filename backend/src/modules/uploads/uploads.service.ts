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

    // S-B3: límite de tamaño. Si el cliente declara `contentLength`, se valida y se FIJA en la
    // firma (`ContentLength`) para que el PUT deba enviar exactamente ese tamaño (S3 rechaza si
    // el cuerpo no coincide). Así el tope no depende solo de la buena fe del cliente.
    const maxBytes = this.maxUploadBytes;
    if (contentLength !== undefined) {
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
    }

    const bucket = this.config.get<string>('S3_BUCKET') ?? 'tcg-photos';
    const ext = normalizedType.split('/')[1] ?? 'bin';
    const uploadKey = `${validPurpose}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}.${ext}`;
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: uploadKey,
      ContentType: contentType,
      ...(contentLength !== undefined ? { ContentLength: contentLength } : {}),
    });
    const uploadUrl = await getSignedUrl(this.s3, command, { expiresIn: 900 });
    const headers: Record<string, string> = { 'Content-Type': contentType };
    if (contentLength !== undefined) headers['Content-Length'] = String(contentLength);
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
