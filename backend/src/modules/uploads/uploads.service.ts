import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';

type UploadPurpose = 'kyc_ine' | 'dispute_claim' | 'inventory_photo';

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

  async presign(purpose: UploadPurpose, contentType: string) {
    const bucket = this.config.get<string>('S3_BUCKET') ?? 'tcg-photos';
    const ext = contentType.split('/')[1] ?? 'bin';
    const uploadKey = `${purpose}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}.${ext}`;
    const command = new PutObjectCommand({ Bucket: bucket, Key: uploadKey, ContentType: contentType });
    const uploadUrl = await getSignedUrl(this.s3, command, { expiresIn: 900 });
    return {
      uploadKey,
      uploadUrl,
      method: 'PUT' as const,
      headers: { 'Content-Type': contentType },
      expiresAt: new Date(Date.now() + 900 * 1000).toISOString(),
    };
  }

  /**
   * SEC-A5: URL prefirmada de LECTURA (GET) de vida corta. Reemplaza el modelo de "URL
   * pública del bucket" para servir documentos sensibles (INE/KYC, fotos de disputa).
   * El bucket debe ser PRIVADO (sin ACL público-lectura) — lo garantiza devops en infra.
   * @param expiresIn segundos de validez (por defecto 300s = 5 min).
   */
  async presignGet(key: string, expiresIn = 300): Promise<string> {
    const bucket = this.config.get<string>('S3_BUCKET') ?? 'tcg-photos';
    const command = new GetObjectCommand({ Bucket: bucket, Key: key });
    return getSignedUrl(this.s3, command, { expiresIn });
  }
}
