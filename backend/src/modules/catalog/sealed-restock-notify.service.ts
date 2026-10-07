import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { SettingKey } from '../settings/settings.constants';
import { MAIL_PORT, MailPort } from '../mail/mail.port';
import { appUrl, cardLineRows, ctaRows, headingRow, mailShell, proseRow, ruleRow, spacerRow } from '../buylist/mail-shell';
import { CatalogService } from './catalog.service';
import { readWishlistDials } from '../wishlist/wishlist-dials';
import { SEALED_RESTOCK_NOTIFY_LOCK_KEY, systemWishlistClock, WISHLIST_CLOCK, WishlistClock } from '../wishlist/wishlist.constants';

const JOB = 'sealed-restock-notify';

export interface SealedRestockNotifyResult {
  job: 'sealed-restock-notify';
  enqueued: boolean;
  /** Con el dial `sealed_restock_alerts=off`: no-op logueado (feature-flagged, seed off). */
  reason?: 'SEALED_RESTOCK_ALERTS_OFF' | 'ALREADY_RUNNING';
  /** Suscripciones notificadas (marcadas `notifiedAt`) en esta corrida. */
  notified?: number;
  /** Suscripciones armadas en esta corrida (vieron el producto AGOTADO). */
  armed?: number;
  /** Correos enviados (uno por correo, con todas sus identidades listas). */
  mails?: number;
}

/** Una línea del correo: un producto (identidad) y la pieza vendible más barata a la que lleva el enlace. */
export interface RestockMailLine {
  productName: string;
  inventoryItemId: string;
}

/** Clave de identidad de producto (misma que el grid §2-S): `tcgplayerProductId` o `cardId + subtipo`, más la condición. */
export function sealedIdentityKey(p: {
  tcgplayerProductId: number | null;
  cardId: string;
  sealedSubtype: string | null;
  sealedCondition: string | null;
}): string {
  const cond = p.sealedCondition ?? 'mint';
  return p.tcgplayerProductId != null ? `p:${p.tcgplayerProductId}:${cond}` : `c:${p.cardId}:${p.sealedSubtype ?? ''}:${cond}`;
}

/**
 * SealedRestockNotifyService — «avísame cuando vuelva» de sellados, ENCENDIDO Y COMPLETO (rev v1.87⟨wishlist⟩,
 * API_CONTRACT §WSH.7, criterio 823; cierra D-WSH-1…4 y D-WSH-7).
 *
 *  (a) Agendado: el planificador lo corre cada 5 min (`SEALED_RESTOCK_NOTIFY_CRON`); el disparo manual se conserva. Con
 *      `sealed_restock_alerts = off` es no-op. Single-flight entre instancias por candado consultivo de Postgres (⛔ no la
 *      bandera en memoria que tenía: no cubría dos instancias).
 *  (c) Armado: una suscripción pendiente solo puede avisar DESPUÉS de haber visto su producto agotado (`armedAt`). Quien se
 *      apunta en una ficha con existencia no recibe «¡Volvió!» en el siguiente tick. Un agotarse-y-volver entre dos ticks
 *      (< 5 min) no avisa: aceptado y documentado.
 *  (d) Ventana y deduplicación: primera vez que una armada ve el producto de vuelta ⇒ `matchedAt`. Se envía cuando
 *      `matchedAt ≤ now − wishlist_mail_window_min` y el producto sigue vendible. Se agrupa POR CORREO: un correo con todas
 *      sus identidades listas, UNA línea por identidad aunque haya filas duplicadas; todas esas filas quedan `notifiedAt`.
 *  (e) Enlace: «Ver el producto» → `appUrl('sellado/{inventoryItemId}', 'es')` de la pieza vendible más barata (por P).
 *
 * «Vendible» = el MISMO seam del catálogo (`CatalogService.sellableByIds`): `listed` de plataforma con precio resuelto.
 */
@Injectable()
export class SealedRestockNotifyService {
  private readonly logger = new Logger(SealedRestockNotifyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    @Inject(MAIL_PORT) private readonly mail: MailPort,
    // `@Optional()` por las pruebas unitarias que construyen el servicio a mano (correo); en la app siempre se inyectan.
    @Optional() private readonly catalog?: CatalogService,
    @Optional() @Inject(WISHLIST_CLOCK) private readonly clock: WishlistClock = systemWishlistClock,
  ) {}

  async run(): Promise<SealedRestockNotifyResult> {
    if ((await this.settings.getString(SettingKey.SEALED_RESTOCK_ALERTS)) !== 'on') {
      this.logger.log('sealed-restock-notify: dial sealed_restock_alerts=off → no-op (feature-flagged).');
      return { job: JOB, enqueued: false, reason: 'SEALED_RESTOCK_ALERTS_OFF' };
    }
    const out = await this.prisma.$transaction(
      async (lockTx) => {
        const [{ locked }] = await lockTx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(${SEALED_RESTOCK_NOTIFY_LOCK_KEY}) AS locked`;
        if (!locked) return null;
        return this.matchAndNotify();
      },
      { timeout: 10 * 60_000, maxWait: 10_000 },
    );
    if (!out) {
      this.logger.warn('sealed-restock-notify ya en curso en otra instancia; no se lanza otro (candado consultivo).');
      return { job: JOB, enqueued: false, reason: 'ALREADY_RUNNING' };
    }
    return { job: JOB, enqueued: true, ...out };
  }

  private async matchAndNotify(): Promise<{ notified: number; armed: number; mails: number }> {
    const now = (this.clock ?? systemWishlistClock).now();
    const pending = await this.prisma.sealedRestockSubscription.findMany({
      where: { notifiedAt: null },
      include: { card: { select: { name: true } } },
    });
    if (pending.length === 0) return { notified: 0, armed: 0, mails: 0 };
    if (!this.catalog) throw new Error('SealedRestockNotifyService: CatalogService no inyectado (vendibilidad).');
    const { mailWindowMin } = await readWishlistDials(this.settings);

    // Identidades de sellado VENDIBLE ahora, con la pieza más barata por P.
    const listed = await this.prisma.inventoryItem.findMany({
      where: { productType: 'sealed', status: 'listed', ownerType: 'platform' },
      select: {
        id: true,
        tcgplayerProductId: true,
        cardId: true,
        sealedSubtype: true,
        sealedCondition: true,
        sealedProductName: true,
        card: { select: { name: true } },
      },
    });
    const priceById = new Map((await this.catalog.sellableByIds(listed.map((l) => l.id))).map((s) => [s.inventoryItemId, s.displayPriceCents]));
    const best = new Map<string, { inventoryItemId: string; price: number; name: string }>();
    for (const l of listed) {
      const P = priceById.get(l.id);
      if (P == null) continue;
      const k = sealedIdentityKey(l);
      const cur = best.get(k);
      if (!cur || P < cur.price) best.set(k, { inventoryItemId: l.id, price: P, name: l.sealedProductName ?? l.card.name });
    }

    // (c) armar · (d) primera vista de vuelta.
    const toArm = pending.filter((s) => s.armedAt == null && !best.has(sealedIdentityKey(s))).map((s) => s.id);
    const toMatch = pending.filter((s) => s.armedAt != null && s.matchedAt == null && best.has(sealedIdentityKey(s))).map((s) => s.id);
    if (toArm.length > 0) {
      await this.prisma.sealedRestockSubscription.updateMany({ where: { id: { in: toArm }, armedAt: null }, data: { armedAt: now } });
    }
    if (toMatch.length > 0) {
      await this.prisma.sealedRestockSubscription.updateMany({ where: { id: { in: toMatch }, matchedAt: null }, data: { matchedAt: now } });
    }

    // (d) listas para enviar: armadas, vistas de vuelta hace ≥ la ventana, y el producto SIGUE vendible.
    const cutoff = now.getTime() - mailWindowMin * 60_000;
    const ready = pending.filter(
      (s) => s.armedAt != null && s.matchedAt != null && s.matchedAt.getTime() <= cutoff && best.has(sealedIdentityKey(s)),
    );
    const byEmail = new Map<string, typeof ready>();
    for (const s of ready) byEmail.set(s.email, [...(byEmail.get(s.email) ?? []), s]);

    let notified = 0;
    let mails = 0;
    for (const [email, subs] of byEmail) {
      // CAS: solo las que siguen pendientes (el candado ya serializa; esto es defensa en profundidad).
      const claimed = await this.prisma.sealedRestockSubscription.updateMany({
        where: { id: { in: subs.map((s) => s.id) }, notifiedAt: null },
        data: { notifiedAt: now },
      });
      if (claimed.count === 0) continue;
      notified += claimed.count;
      const lines = new Map<string, RestockMailLine>();
      for (const s of subs) {
        const k = sealedIdentityKey(s);
        const b = best.get(k)!;
        if (!lines.has(k)) lines.set(k, { productName: b.name, inventoryItemId: b.inventoryItemId });
      }
      try {
        await this.sendRestockEmail(email, [...lines.values()]);
        mails += 1;
      } catch (e) {
        // ⛔ Sin reintento ni bucle: a lo sumo una vez (y ⛔ sin el correo en el log).
        this.logger.error(`sealed-restock-notify: fallo enviando un aviso de reposición: ${String(e)}`);
      }
    }
    this.logger.log(`sealed-restock-notify: ${toArm.length} armadas, ${notified} notificadas en ${mails} correo(s).`);
    return { notified, armed: toArm.length, mails };
  }

  /**
   * Correo bilingüe de reposición (DESIGN_SYSTEM §WSH-UX.8 (b)): `locale 'es'` fijo (el aviso de privacidad es un documento
   * en español), una línea por producto con «Ver el producto» → `sellado/{id}`. ⛔ Sin precio (puede cambiar) y ⛔ sin
   * enlace de baja (no se repite). S15-B1: el nombre entra como texto y lo escapa el esqueleto.
   */
  private async sendRestockEmail(email: string, lines: RestockMailLine[]): Promise<void> {
    const subject =
      lines.length === 1
        ? `¡Volvió! · Back in stock: ${lines[0].productName}`
        : `Volvieron ${lines.length} productos que esperabas · ${lines.length} products you were waiting for are back`;
    const title = '¡Volvió a existencia! · Back in stock';
    const intro =
      'Lo que nos pediste que te avisáramos ya está otra vez a la venta en TCG HUNT. · What you asked us to tell you about is on sale again at TCG HUNT.';
    const note = 'No te lo apartamos: se lo lleva quien pague primero. · We don’t hold it for you: whoever pays first gets it.';
    const noOrigin = 'Búscalo en TCG HUNT › Comprar › Sellado. · Look for it at TCG HUNT › Shop › Sealed.';
    const blocks = [headingRow(title, 22), spacerRow(16), proseRow(intro), spacerRow(16), ruleRow()];
    const text = [title, intro, ''];
    let anyLink = false;
    for (const l of lines) {
      const url = appUrl(`sellado/${l.inventoryItemId}`, 'es');
      blocks.push(spacerRow(16), cardLineRows({ title: l.productName, meta: 'Sellado · Sealed' }));
      text.push(l.productName);
      if (url) {
        anyLink = true;
        blocks.push(spacerRow(8), ctaRows(url, 'Ver el producto · See the product', 'ink'));
        text.push(`Ver el producto · See the product: ${url}`);
      }
      blocks.push(spacerRow(16), ruleRow());
    }
    blocks.push(spacerRow(16), proseRow(note));
    text.push('', note);
    if (!anyLink) {
      blocks.push(spacerRow(8), proseRow(noOrigin));
      text.push(noOrigin);
    }
    const html = mailShell({
      locale: 'es',
      title,
      preheader: `${title} — TCG HUNT`,
      blocks,
      footerWhy:
        '¿No lo pediste? Ignora este correo: no volverás a recibirlo por este producto. · ' +
        'Didn’t ask for this? Ignore this email: you won’t get it again for this product.',
    });
    await this.mail.send({ to: email, subject, text: text.join('\n'), html });
  }
}
