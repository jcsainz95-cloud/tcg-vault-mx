import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { headingRow, mailShell, proseRow, spacerRow } from '../buylist/mail-shell';
import { PrismaService } from '../../prisma/prisma.service';
import { MAIL_PORT, MailPort } from '../mail/mail.port';
import { ownerRecipients } from '../spend-alerts/spend-mail.service';
import { AuditService } from '../audit/audit.service';
import { CatalogAutoStateService, CATALOG_AUTO_KEYS } from './catalog-auto-state.service';

/** Spec AUTO_CATALOGO: alerta si pasan > 48 h sin un barrido del catalogo terminado sin fallos. */
export const CATALOG_STALE_AFTER_MS = 48 * 60 * 60 * 1000;

export type StaleCheck = 'fresh' | 'already_alerted' | 'sent' | 'no_recipient' | 'mail_failed';

/**
 * Alerta por correo al DUENO (mecanismo de spend-alerts: `ownerRecipients` + `MAIL_PORT`) cuando el catalogo lleva > 48 h sin exito.
 * UNA vez por incidente: la marca `staleAlert.since` guarda la referencia (ultimo exito) del incidente ya avisado; mientras la
 * referencia no cambie no se repite, y un nuevo exito la cambia (el siguiente incidente avisa de nuevo). Si el correo falla o no hay
 * destinatario NO se marca (se reintenta en la siguiente pasada; no es spam porque nada salio). Sin exito previo, la cuenta de 48 h
 * arranca desde la primera vez que se vigila (no alerta nada mas desplegar).
 */
@Injectable()
export class CatalogStaleAlertService {
  private readonly logger = new Logger(CatalogStaleAlertService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly state: CatalogAutoStateService,
    @Inject(MAIL_PORT) private readonly mail: MailPort,
    @Optional() private readonly audit?: AuditService,
  ) {}

  async check(now = new Date()): Promise<StaleCheck> {
    let ref = await this.state.getLastSuccessAt();
    if (!ref) {
      const w = await this.state.get<{ at?: string }>(CATALOG_AUTO_KEYS.watchSince);
      if (!w?.at) await this.state.set(CATALOG_AUTO_KEYS.watchSince, { at: now.toISOString() });
      ref = w?.at ?? now.toISOString();
    }
    const refMs = Date.parse(ref);
    if (!Number.isFinite(refMs) || now.getTime() - refMs <= CATALOG_STALE_AFTER_MS) return 'fresh';
    const sent = await this.state.get<{ since?: string }>(CATALOG_AUTO_KEYS.staleAlert);
    if (sent?.since === ref) return 'already_alerted';
    const owners = await ownerRecipients(this.prisma);
    if (owners.length === 0) {
      this.logger.warn('catalog stale: > 48 h sin exito y no hay dueno con correo; se reintenta.');
      return 'no_recipient';
    }
    const hours = Math.floor((now.getTime() - refMs) / 3_600_000);
    const subject = 'TCG HUNT: el catalogo lleva mas de 48 horas sin actualizarse';
    const text =
      `El catalogo automatico no ha terminado una actualizacion sin errores en ${hours} horas (ultimo exito o inicio de vigilancia: ${ref}).\n` +
      'La tienda sigue funcionando con los datos que ya tenia. El sistema sigue reintentando solo cada dia; este aviso no se repite hasta que haya un nuevo exito y otro incidente.';
    const html = mailShell({
      locale: 'es',
      title: subject,
      preheader: 'La tienda sigue funcionando; el sistema reintenta solo.',
      blocks: [headingRow(subject, 22), spacerRow(24), ...text.split('\n').flatMap((t) => [proseRow(t), spacerRow(16)])],
      footerWhy: 'Recibes este aviso porque eres el dueno de la tienda.',
    });
    try {
      for (const o of owners) await this.mail.send({ to: o.email, subject, html, text });
    } catch (e) {
      this.logger.warn(`catalog stale: no se pudo enviar el correo (${(e as Error).message}); se reintenta.`);
      return 'mail_failed';
    }
    await this.state.set(CATALOG_AUTO_KEYS.staleAlert, { since: ref, sentAt: now.toISOString() });
    await this.audit?.log({ action: 'catalog.stale_alert', entityType: 'CardSet', after: { since: ref, hours } }).catch(() => undefined);
    return 'sent';
  }
}
