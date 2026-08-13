import { Global, Module } from '@nestjs/common';
import { PiiCryptoService } from './pii-crypto.service';

/**
 * CryptoModule — Provee `PiiCryptoService` de forma GLOBAL para que cualquier módulo
 * (users, buylist, admin) cifre/descifre PII y calcule blind index sin re-declararlo.
 * Endurecimiento de PII en reposo (SECURITY_NOTES §2.3 / bandera legal LFPDPPP).
 */
@Global()
@Module({
  providers: [PiiCryptoService],
  exports: [PiiCryptoService],
})
export class CryptoModule {}
