import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { SettingKey } from '../settings/settings.constants';
import { MAIL_PORT, MailPort } from '../mail/mail.port';
import { headingRow, mailShell, proseRow, spacerRow } from '../buylist/mail-shell';

const JOB = 'sealed-restock-notify';

export interface SealedRestockNotifyResult {
  job: 'sealed-restock-notify';
  enqueued: boolean;
  /** Con el dial `sealed_restock_alerts=off`: no-op logueado (feature-flagged, seed off). */
  reason?: 'SEALED_RESTOCK_ALERTS_OFF';
  /** Suscripciones emparejadas y notificadas en esta corrida. */
  notified?: number;
}

/**
 * SealedRestockNotifyService (v1.23-sealed-sales, ARCHITECTURE §4.23h(c) / API_CONTRACT §M10-ops) —
 * job CABLEADO pero NO agendado hasta el flip del dial. Con `sealed_restock_alerts=off` (seed) es
 * no-op logueado; con `on` empareja `SealedRestockSubscription` PENDIENTES (`notifiedAt IS NULL`) con
 * los productos SELLADOS que están de vuelta en `status='listed'` (por identidad de producto +
 * condición), envía correo (módulo `mail`) y marca `notifiedAt`. Single-flight. Sin N+1: 1 query de
 * suscripciones pendientes + 1 query de identidades de sellado disponible + emparejamiento en memoria.
 *
 * Identidad = `tcgplayerProductId` (mapeado) o `cardId (+ sealedSubtype)`, más `sealedCondition`
 * (misma clave que el grid §2-S). El disparo es MANUAL (`POST /admin/jobs/sealed-restock-notify`); el
 * cron queda fuera hasta encender el flag (§4.23h).
 */
@Injectable()
export class SealedRestockNotifyService {
  private readonly logger = new Logger(SealedRestockNotifyService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    @Inject(MAIL_PORT) private readonly mail: MailPort,
  ) {}

  async run(): Promise<SealedRestockNotifyResult> {
    if ((await this.settings.getString(SettingKey.SEALED_RESTOCK_ALERTS)) !== 'on') {
      this.logger.log('sealed-restock-notify: dial sealed_restock_alerts=off → no-op (feature-flagged).');
      return { job: JOB, enqueued: false, reason: 'SEALED_RESTOCK_ALERTS_OFF' };
    }
    if (this.running) {
      this.logger.warn('sealed-restock-notify ya en curso; no se lanza otro (single-flight).');
      return { job: JOB, enqueued: false };
    }
    this.running = true;
    try {
      const notified = await this.matchAndNotify();
      return { job: JOB, enqueued: true, notified };
    } finally {
      this.running = false;
    }
  }

  /** Clave de identidad de producto (misma que el grid §2-S). */
  private identityKey(p: {
    tcgplayerProductId: number | null;
    cardId: string;
    sealedSubtype: string | null;
    sealedCondition: string | null;
  }): string {
    const cond = p.sealedCondition ?? 'mint';
    return p.tcgplayerProductId != null
      ? `p:${p.tcgplayerProductId}:${cond}`
      : `c:${p.cardId}:${p.sealedSubtype ?? ''}:${cond}`;
  }

  private async matchAndNotify(): Promise<number> {
    const pending = await this.prisma.sealedRestockSubscription.findMany({
      where: { notifiedAt: null },
      include: { card: { select: { name: true } } },
    });
    if (pending.length === 0) return 0;

    // Identidades de sellado DISPONIBLE (de vuelta a listed, plataforma).
    const available = await this.prisma.inventoryItem.findMany({
      where: { productType: 'sealed', status: 'listed', ownerType: 'platform' },
      select: { tcgplayerProductId: true, cardId: true, sealedSubtype: true, sealedCondition: true },
    });
    const availableKeys = new Set(available.map((a) => this.identityKey(a)));

    let notified = 0;
    for (const sub of pending) {
      if (!availableKeys.has(this.identityKey(sub))) continue;
      try {
        await this.sendRestockEmail(sub.email, sub.card.name);
      } catch (e) {
        // Un fallo de correo NO debe re-notificar en bucle ni tumbar el lote: se loguea y se marca
        // igual (best-effort, paridad con los demás jobs). El operador puede reenviar desde soporte.
        this.logger.error(`sealed-restock-notify: fallo enviando a ${sub.email}: ${String(e)}`);
      }
      await this.prisma.sealedRestockSubscription.update({
        where: { id: sub.id },
        data: { notifiedAt: new Date() },
      });
      notified += 1;
    }
    this.logger.log(`sealed-restock-notify: ${notified}/${pending.length} suscripciones notificadas.`);
    return notified;
  }

  /**
   * Correo bilingüe mínimo de reposición (recipiente puede ser invitado; sin locale de User).
   * P-MAIL-MARCA (2026-10-06): el HTML va sobre el esqueleto de marca `mailShell` (`DESIGN_SYSTEM §31`)
   * con `locale: 'es'` (el correo es bilingüe y el aviso de privacidad es un documento en español) y la
   * `audience` por defecto `'customer'` (criterio 507). Sin CTA: el correo no lleva enlace de acción.
   */
  private async sendRestockEmail(email: string, productName: string): Promise<void> {
    const subject = `¡Volvió a existencia! · Back in stock: ${productName}`;
    // P-21 (rebrand): marca visible "TCG HUNT" (DESIGN_SYSTEM §17.4).
    const es = `El producto "${productName}" que seguías volvió a estar disponible en TCG HUNT.`;
    const en = `The product "${productName}" you were watching is back in stock at TCG HUNT.`;
    const text = `${es}\n${en}`;
    // S15-B1: el nombre entra al HTML como TEXTO PLANO y lo escapa `proseRow` (el escape del esqueleto
    // de correo); el texto plano y el asunto no son HTML y van literales. ⛔ El nombre va SOLO en las dos
    // líneas de prosa: ni en el titular ni en el preheader.
    const title = '¡Volvió a existencia! · Back in stock';
    const html = mailShell({
      locale: 'es',
      title,
      preheader: `${title} — TCG HUNT`,
      blocks: [headingRow(title, 22), spacerRow(24), proseRow(es), spacerRow(16), proseRow(en)],
      footerWhy:
        'Recibes este correo porque pediste que te avisáramos cuando volviera este producto. · ' +
        'You are receiving this email because you asked to be notified when this product was back.',
    });
    await this.mail.send({ to: email, subject, text, html });
  }
}
