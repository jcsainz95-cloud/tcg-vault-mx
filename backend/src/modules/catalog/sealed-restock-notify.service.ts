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
    // (g) v1.87.4: ANTES de leer las pendientes y de armar/emparejar, con el candado ya tomado.
    await this.reconcileOrphans();
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
   * (g) v1.87.4⟨wishlist⟩ (API_CONTRACT §WSH.7 (g), ARCHITECTURE §4.WSH (m)) — re-apunta las suscripciones PENDIENTES
   * HUÉRFANAS (su clave ya no la tiene ninguna pieza sellada) a su destino ÚNICO. El mapeo de las piezas cambia después de
   * apuntarse (`PUT /admin/pricing/sealed/items/:itemId/mapping`: mapear, re-mapear o desmapear, con o sin hermanas) y una
   * fila huérfana no casaría nunca. Se lee el ESTADO, no el evento: cubre cualquier escritor de `tcgplayerProductId`.
   *
   *  - Huérfana: `p:` sin ninguna pieza sellada con su `tcgplayerProductId`; `c:` sin ninguna pieza sellada de su
   *    `(cardId, sealedSubtype)` con `tcgplayerProductId IS NULL`. Una fila NO huérfana no se toca nunca.
   *  - Destino `D` = valores distintos de `tcgplayerProductId` de las piezas selladas de su `(cardId, sealedSubtype)`, con
   *    `NULL` contando como un valor. `|D| = 1` ⇒ se re-apunta; `|D| = 0` o `≥ 2` ⇒ intacta (no se adivina).
   *  - Re-apuntar reinicia `armedAt` y `matchedAt` (el armado viejo se ganó mirando la clave vieja: conservarlo podría mandar
   *    un «¡Volvió!» falso). El armado de esta misma corrida la evalúa ya con la clave nueva.
   *  - Choque (mismo correo y misma clave nueva que otra pendiente que no se re-apunta, o que otra re-apuntada más antigua por
   *    `(createdAt, id)`) ⇒ la re-apuntada se BORRA: una pendiente por correo e identidad.
   *  - Una transacción para borrados y re-apuntados. Log de tres cifras, ⛔ sin correos. ⛔ `pricing` no toca esta tabla.
   */
  private async reconcileOrphans(): Promise<void> {
    const out = await this.prisma.$transaction(async (tx) => {
      const orphans = await tx.$queryRaw<
        {
          id: string;
          email: string;
          cardId: string;
          sealedSubtype: string | null;
          sealedCondition: string;
          createdAt: Date;
          n: number;
          pid: number | null;
        }[]
      >`
        WITH orphan AS (
          SELECT s."id", s."email", s."cardId", s."sealedSubtype", s."sealedCondition"::text AS "sealedCondition", s."createdAt"
          FROM "SealedRestockSubscription" s
          WHERE s."notifiedAt" IS NULL AND (
               (s."tcgplayerProductId" IS NOT NULL AND NOT EXISTS (
                  SELECT 1 FROM "InventoryItem" ii
                  WHERE ii."productType"::text = 'sealed' AND ii."tcgplayerProductId" = s."tcgplayerProductId"))
            OR (s."tcgplayerProductId" IS NULL AND NOT EXISTS (
                  SELECT 1 FROM "InventoryItem" ii
                  WHERE ii."productType"::text = 'sealed' AND ii."cardId" = s."cardId"
                    AND ii."sealedSubtype" IS NOT DISTINCT FROM s."sealedSubtype" AND ii."tcgplayerProductId" IS NULL)))),
        dest AS (
          SELECT o."id",
                 (count(DISTINCT ii."tcgplayerProductId") + max(CASE WHEN ii."tcgplayerProductId" IS NULL THEN 1 ELSE 0 END))::int AS n,
                 min(ii."tcgplayerProductId") AS pid
          FROM orphan o
          JOIN "InventoryItem" ii ON ii."productType"::text = 'sealed' AND ii."cardId" = o."cardId"
                                 AND ii."sealedSubtype" IS NOT DISTINCT FROM o."sealedSubtype"
          GROUP BY o."id")
        SELECT o."id", o."email", o."cardId", o."sealedSubtype"::text AS "sealedSubtype", o."sealedCondition", o."createdAt",
               COALESCE(d.n, 0)::int AS n, d.pid
        FROM orphan o LEFT JOIN dest d ON d."id" = o."id"
        ORDER BY o."createdAt" ASC, o."id" ASC`;
      const movable = orphans.filter((o) => o.n === 1);
      const intact = orphans.length - movable.length;
      if (movable.length === 0) return { repointed: 0, deleted: 0, intact };

      const newKey = (o: (typeof movable)[number]) =>
        sealedIdentityKey({ tcgplayerProductId: o.pid, cardId: o.cardId, sealedSubtype: o.sealedSubtype, sealedCondition: o.sealedCondition });
      // Claves pendientes de esos correos que NO se re-apuntan en esta corrida (las que ganaron su `armedAt` con esa clave).
      const stay = await tx.sealedRestockSubscription.findMany({
        where: { notifiedAt: null, email: { in: [...new Set(movable.map((o) => o.email))] }, id: { notIn: movable.map((o) => o.id) } },
        select: { email: true, tcgplayerProductId: true, cardId: true, sealedSubtype: true, sealedCondition: true },
      });
      const taken = new Set(stay.map((s) => `${s.email}\u0000${sealedIdentityKey(s)}`));
      const toDelete: string[] = [];
      const toRepoint = new Map<number | null, string[]>();
      for (const o of movable) {
        // `movable` viene ordenado por (createdAt, id): la primera re-apuntada de un correo y clave es la que se queda.
        const k = `${o.email}\u0000${newKey(o)}`;
        if (taken.has(k)) {
          toDelete.push(o.id);
          continue;
        }
        taken.add(k);
        toRepoint.set(o.pid, [...(toRepoint.get(o.pid) ?? []), o.id]);
      }
      let deleted = 0;
      if (toDelete.length > 0) {
        deleted = (await tx.sealedRestockSubscription.deleteMany({ where: { id: { in: toDelete }, notifiedAt: null } })).count;
      }
      let repointed = 0;
      for (const [pid, ids] of toRepoint) {
        repointed += (
          await tx.sealedRestockSubscription.updateMany({
            where: { id: { in: ids }, notifiedAt: null },
            data: { tcgplayerProductId: pid, armedAt: null, matchedAt: null },
          })
        ).count;
      }
      return { repointed, deleted, intact };
    });
    this.logger.log(
      `sealed-restock-notify: reconciliación de mapeo — ${out.repointed} re-apuntadas, ${out.deleted} borradas por choque, ` +
        `${out.intact} huérfanas intactas.`,
    );
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
