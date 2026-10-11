import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Prisma, SellRequestExpiryReason } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../modules/settings/settings.service';
import { SettingKey } from '../modules/settings/settings.constants';
import { MAIL_PORT, MailPort } from '../modules/mail/mail.port';
import {
  sellOfferReminderTemplate,
  sellRequestExpiredTemplate,
  sellRequestNotPursuedTemplate,
  sellRequestNotContinuedTemplate,
  buylistPortalUrl,
  OfferReminderKind,
  SellExpiredKind,
} from '../modules/buylist/buylist-mail.templates';
import { addBusinessDays, businessDaysSince } from '../common/business-days';
import { SELL_REQUEST_LIVE_ADJUSTMENT_STATES } from '../modules/buylist/buylist-reject.constants';
import { closeInboundShipment, InboundCloseResult, needsGuideCancelTask } from '../modules/shipments/inbound-close';
import { afterAutoCloseVia } from '../modules/shipments/label-auto-close';
import { INBOUND_ONLY } from '../modules/shipments/label-subject';
import { openGuideTaskIfCancelUnconfirmed } from '../modules/buylist/inbound-cancel-task';
import {
  GUIDE_DAY_MS,
  GuideClockDials,
  guideAnchorOf,
  guideCloseDueWhere,
  guideWarnDueWhere,
} from '../modules/buylist/guide-clock';
import { SpendAlertsService } from '../modules/spend-alerts/spend-alerts.service';
import { SpendMailService } from '../modules/spend-alerts/spend-mail.service';

/** 💰 rev BSD-1 (§BSD.7.5): una cancelación de Skydropx sin confirmar pasada esta ventana abre la tarea (regla 10). */
export const INBOUND_CANCEL_RECONCILE_MS = 60 * 60 * 1000;
/**
 * `BuylistSweepJobService` — **los plazos del ciclo de adquisición, en SIETE reglas**
 * (ARCHITECTURE §4.39j, criterios 16/113/121/123/138/142/156).
 *
 * ### ⚠️ NO ES UN JOB NUEVO
 * Las reglas nuevas entran al **mismo** `buylist-sweep`, con el **mismo** cron `'0 8 * * *'`. El
 * `toEqual` exhaustivo de `test/scheduler.spec.ts` **no se toca**: no hay nada que registrar. *Un
 * barrido más en el mismo pase es una query más, no un servicio más — y partirlo obligaría a razonar
 * sobre dos relojes.*
 *
 * | # | Regla | Efecto |
 * |---|---|---|
 * | 1 | `ofertada` con el plazo de aceptación vencido | `rechazada` + **correo 3a** + tarea de guía si la hubiera |
 * | 2 | `aceptada` con el plazo de envío vencido **y sin señal del vendedor** | `expirada`/`not_shipped` + **correo 3b** + **tarea «cancelar guía no usada»** |
 * | 3 | `ofertada` a **1 día hábil** de vencer, sin recordatorio | **correo 2a**, UNA vez |
 * | 4 | `aceptada` a **1 día hábil** de vencer, sin recordatorio y sin señal | **correo 2b**, UNA vez |
 * | 5 | Ajuste sin responder a 7 días (**legacy, sin cambio**) | `rechazada` |
 * | 6 | Abandono a 30 días — **RE-ANCLADO en `receivedAt`** | `abandonada` |
 * | 7 | `cotizada` que **nadie ofertó** en 7 días hábiles ⚠️ **GATEADA** | `expirada`/`no_offer` + **correo 4** + **anula la oferta pendiente** |
 * | 8 | 💰 rev BSD-1: `aceptada` **sin guía** a N días NATURALES del ancla (§BSD.7.1) | `expirada`/`not_continued` + **BSD-M1** + cierra la fila de entrada |
 * | 9 | 💰 rev BSD-1: la misma, `warn` días antes del cierre (§BSD.7.2) | **AG-23** al dueño, uno por ancla |
 * | 10 | 💰 rev BSD-1: guía de entrada cancelada en Skydropx sin confirmación tras 1 h (§BSD.7.5) | abre la tarea «cancelar guía no usada» |
 *
 * Orden dentro de `run()` (§BSD.7.6): 1, 2, recordatorios, 5, 6, 7, **9, 8, 10**.
 *
 * ### ⚠️ La regla 7 nace APAGADA (`buylist_no_offer_expiry_enabled`, seed `off`) — B-4
 * Es la única de las siete cuyo despliegue depende de un **paso operativo previo obligatorio** (el
 * censo/triage del paso 6 de M-46). Sin gate, la primera corrida tras el deploy manda correos
 * terminales a vendedores con solicitudes viejas. Ver el docblock de `expireUnofferedRequests`.
 *
 * ### ⚠️ La regla 2 solo expira si NO hubo NINGUNA de las dos señales
 * Ni el «ya lo mandé» del vendedor ni la confirmación del operador. *Un plazo del vendedor solo puede
 * vencer por algo que dependa del vendedor*: si deposita el día 3 y confirmamos el día 4, **no
 * expira** — se quedaría sin venta por una latencia **nuestra**, y encima ya gastamos la etiqueta.
 *
 * ### ⚠️ Días hábiles y fail-closed de calendario (§4.39k)
 * Si la tabla de festivos no cubre el rango, `business-days` **lanza**. Aquí se **captura, se loggea
 * `error` y NO se expira**. *Fallar hacia «no vence» es el único lado seguro*: degradar a «no hay
 * festivos» adelantaría vencimientos y **expiraría ofertas de gente que sí cumplió**.
 *
 * ### Correos
 * **Best-effort POST-COMMIT**: su fallo se loggea y **no revierte la transición** — lo contrario
 * dejaría filas colgadas de un servicio externo. **Un productor por correo, elegido en el call-site**
 * (nada de `switch (status)`).
 */
@Injectable()
export class BuylistSweepJobService {
  private readonly logger = new Logger(BuylistSweepJobService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly settings?: SettingsService,
    // Mismo régimen que en `buylist`: `@Optional` para que los tests unitarios que construyen el
    // servicio a mano no truenen, y envío best-effort.
    @Optional() @Inject(MAIL_PORT) private readonly mail?: MailPort,
    // 💰 rev BSD-1: AG-23 (regla 9) y su correo al dueño; `ModuleRef` para el post-commit de la cancelación automática de la
    // guía de entrada (`afterAutoCloseVia`, §BSD.4.8). `@Optional()` por los unitarios que construyen a mano: sin ellos, AG-23
    // no se levanta y la cancelación queda sellada para el reintento (regla 10 / «Reintentar en Skydropx»).
    @Optional() private readonly alerts?: SpendAlertsService,
    @Optional() private readonly spendMail?: SpendMailService,
    @Optional() private readonly moduleRef?: ModuleRef,
  ) {}

  async run(now = new Date()): Promise<{
    rejected: number;
    abandoned: number;
    offersExpired: number;
    shipmentsExpired: number;
    remindersSent: number;
    notPursued: number;
    guideWarned: number;
    notContinued: number;
    cancelTasksOpened: number;
  }> {
    const rule1 = await this.expireUnansweredOffers(now);
    const rule2 = await this.expireUnshippedPackages(now);
    const reminders = (await this.sendAcceptReminders(now)) + (await this.sendShipReminders(now));
    const rule5 = await this.expireUnansweredAdjustments(now);
    const rule6 = await this.abandonUnreturned(now);
    const rule7 = await this.expireUnofferedRequests(now);
    // 💰 rev BSD-1 (§BSD.7.6): 9 antes que 8 (si ya toca cerrar, la ventana de la 9 no casa), y 10 al final.
    const dials = await this.guideClockDials();
    const rule9 = dials ? await this.isolated('regla 9', () => this.warnUnguidedAccepted(now, dials)) : 0;
    const rule8 = dials ? await this.isolated('regla 8', () => this.closeUnguidedAccepted(now, dials)) : 0;
    const rule10 = await this.isolated('regla 10', () => this.reconcileInboundCancellations(now));

    this.logger.log(
      `buylist-sweep: ${rule1} ofertas vencidas, ${rule2} envíos vencidos, ${reminders} recordatorios, ` +
        `${rule5} ajustes sin responder, ${rule6} abandonadas, ${rule7} sin oferta (no procederemos), ` +
        `${rule9} avisos AG-23, ${rule8} sin guía (no continuamos), ${rule10} tareas de cancelación abiertas.`,
    );
    return {
      // `rejected` conserva su nombre y su significado histórico (la regla 5) para no romper a
      // ningún lector del retorno del job; las cifras nuevas se añaden.
      rejected: rule5,
      abandoned: rule6,
      offersExpired: rule1,
      shipmentsExpired: rule2,
      remindersSent: reminders,
      notPursued: rule7,
      guideWarned: rule9,
      notContinued: rule8,
      cancelTasksOpened: rule10,
    };
  }

  // =========================================================================================
  // Reglas 1 y 2 — los dos plazos DEL VENDEDOR
  // =========================================================================================

  /** Regla 1 (D3): `ofertada` con `offerAcceptDeadlineAt` vencido ⇒ `rechazada` + correo 3a. */
  private async expireUnansweredOffers(now: Date): Promise<number> {
    // ⚠️ B-1: el predicado se declara UNA vez y lo llevan LAS DOS mitades (leer y escribir). Ver la
    // nota de `closeWithGuideTask`.
    const where: Prisma.SellRequestWhereInput = {
      status: 'ofertada',
      closedAt: null,
      offerAcceptDeadlineAt: { lte: now },
    };
    const rows = await this.prisma.sellRequest.findMany({
      where,
      include: { user: { select: { name: true, email: true, locale: true } } },
    });
    let n = 0;
    for (const req of rows) {
      const moved = await this.closeWithGuideTask(req.id, now, where, {
        status: 'rechazada',
        closedAt: now,
      });
      if (!moved) continue;
      n += 1;
      await this.sendMail(req.id, req.user, () =>
        sellRequestExpiredTemplate(
          { kind: 'no_response' as SellExpiredKind, folio: req.id, closedAt: now, portalUrl: buylistPortalUrl(req.id, req.user?.locale) },
          req.user?.name ?? '',
          req.user?.locale,
        ),
      );
    }
    return n;
  }

  /**
   * Regla 2 (D4 × D20): `aceptada` con `shipDeadlineAt` vencido **y sin ninguna de las dos señales**
   * ⇒ `expirada` + `not_shipped` + correo 3b + **tarea de guía muerta**.
   *
   * ⚠️ `sellerShippedDeclaredAt IS NULL` **está en el `where` DE LAS DOS MITADES** — la que lee y la
   * que escribe. Es el candado que impide expirarle la venta a quien sí cumplió, y **hasta v1.51.22
   * solo estaba en la que lee**: `declareShipped` no toca `status` ni `closedAt` y **no tiene guarda
   * de plazo a propósito**, así que un «ya lo mandé» que llegaba entre el `findMany` de las 08:00:00
   * y el `updateMany` de las 08:00:00.5 **no impedía nada** — la solicitud se cerraba `expirada` /
   * `not_shipped`, se sellaba `closedAt`, salía el correo de «no procederemos» y se abría la tarea de
   * cancelar una guía **de un paquete que iba físicamente en el correo**. Y `expirada` **no está en
   * `payableWhere()`**: a esa persona ya no se le podía pagar ni revivir la solicitud. Ver B-1.
   *
   * Y `shipDeadlineAt IS NULL` (sin guía capturada) **no entra**: una `aceptada` sin etiqueta **no
   * corre reloj**, porque la etiqueta depende de nosotros.
   */
  private async expireUnshippedPackages(now: Date): Promise<number> {
    const where: Prisma.SellRequestWhereInput = {
      status: 'aceptada',
      closedAt: null,
      shipDeadlineAt: { not: null, lte: now },
      sellerShippedDeclaredAt: null,
      shipmentConfirmedAt: null,
    };
    const rows = await this.prisma.sellRequest.findMany({
      where,
      include: { user: { select: { name: true, email: true, locale: true } } },
    });
    let n = 0;
    for (const req of rows) {
      const moved = await this.closeWithGuideTask(req.id, now, where, {
        status: 'expirada',
        expiredReason: SellRequestExpiryReason.not_shipped,
        closedAt: now,
      });
      if (!moved) continue;
      n += 1;
      await this.sendMail(req.id, req.user, () =>
        sellRequestExpiredTemplate(
          { kind: 'not_shipped' as SellExpiredKind, folio: req.id, closedAt: now, portalUrl: buylistPortalUrl(req.id, req.user?.locale) },
          req.user?.name ?? '',
          req.user?.locale,
        ),
      );
    }
    return n;
  }

  // =========================================================================================
  // Reglas 3 y 4 — el recordatorio (D23): UNO por plazo, UNA sola vez
  // =========================================================================================

  /**
   * ⚠️ **La condición de «una sola vez» vive en la BD, no en la memoria del job.** El barrido corre a
   * diario y la ventana de «falta 1 día hábil» dura más de una corrida: sin el sello, el vendedor
   * recibiría el mismo correo cada mañana y **un segundo recordatorio idéntico destruye la
   * credibilidad del primero**.
   *
   * El sello se escribe con `updateMany` + `count === 1` sobre `… IS NULL`, así que **dos corridas
   * concurrentes tampoco pueden mandarlo dos veces**: gana una y la otra ve `count = 0`.
   */
  private async sendReminders(
    kind: OfferReminderKind,
    now: Date,
    where: Prisma.SellRequestWhereInput,
    deadlineOf: (r: { offerAcceptDeadlineAt: Date | null; shipDeadlineAt: Date | null }) => Date | null,
    sealField: 'offerAcceptReminderSentAt' | 'shipReminderSentAt',
  ): Promise<number> {
    const rows = await this.prisma.sellRequest.findMany({
      where,
      include: {
        user: { select: { name: true, email: true, locale: true } },
        items: { select: { offerDecision: true } },
      },
    });
    let n = 0;
    for (const req of rows) {
      const deadline = deadlineOf(req);
      if (deadline == null) continue;
      // «Falta 1 día hábil» = el aviso sale cuando el plazo cae dentro del siguiente día hábil, y
      // todavía no venció (de eso se encargan las reglas 1 y 2).
      let due: boolean;
      try {
        due = deadline.getTime() > now.getTime() && addBusinessDays(now, 1) >= deadline;
      } catch (e) {
        // Fail-closed de calendario: sin tabla de festivos NO se manda nada. Un recordatorio con la
        // fecha mal calculada es peor que ninguno.
        this.logger.error(
          `buylist-sweep: recordatorio ${kind} omitido para ${req.id} (calendario): ${(e as Error).message}`,
        );
        continue;
      }
      if (!due) continue;
      const sealed = await this.prisma.sellRequest.updateMany({
        where: { id: req.id, [sealField]: null },
        data: { [sealField]: now },
      });
      if (sealed.count !== 1) continue; // otra corrida ganó: NO se manda un segundo correo.
      n += 1;
      await this.sendMail(req.id, req.user, () =>
        sellOfferReminderTemplate(
          {
            kind,
            folio: req.id,
            buyLineCount: req.items.filter((i) => i.offerDecision === 'buy').length,
            // SOLO el neto: es el único monto vinculante, y repetir la resta lo volvería una oferta
            // nueva (la propiedad que este ciclo más protege).
            netCents: req.offerNetCents ?? 0,
            deadlineAt: deadline,
            carrier: req.shipmentCarrier,
            trackingNumber: req.shipmentTrackingNumber,
            portalUrl: buylistPortalUrl(req.id, req.user?.locale),
          },
          req.user?.name ?? '',
          req.user?.locale,
        ),
      );
    }
    return n;
  }

  /** Regla 3 — recordatorio de ACEPTACIÓN. */
  private sendAcceptReminders(now: Date): Promise<number> {
    return this.sendReminders(
      'accept',
      now,
      {
        status: 'ofertada',
        closedAt: null,
        offerAcceptDeadlineAt: { not: null, gt: now },
        offerAcceptReminderSentAt: null,
      },
      (r) => r.offerAcceptDeadlineAt,
      'offerAcceptReminderSentAt',
    );
  }

  /** Regla 4 — recordatorio de ENVÍO. No se le recuerda a quien ya dijo «ya lo mandé». */
  private sendShipReminders(now: Date): Promise<number> {
    return this.sendReminders(
      'ship',
      now,
      {
        status: 'aceptada',
        closedAt: null,
        shipDeadlineAt: { not: null, gt: now },
        shipReminderSentAt: null,
        sellerShippedDeclaredAt: null,
      },
      (r) => r.shipDeadlineAt,
      'shipReminderSentAt',
    );
  }

  // =========================================================================================
  // Reglas 5 y 6 — las dos legacy (5 sin cambio, 6 RE-ANCLADA)
  // =========================================================================================

  /** Regla 5 — ajuste enviado sin respuesta a los 7 días naturales. **Sin cambio**, sin correo. */
  private async expireUnansweredAdjustments(now: Date): Promise<number> {
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
    // ⚠️ B-1: el MISMO predicado lee y escribe. `closedAt: null` **solo** dejaba pasar la respuesta al
    // ajuste que llegara entre las dos mitades: responder mueve `status` y `adjustmentSentAt`, no
    // `closedAt`, así que la escritura la pisaba con un `rechazada` que ya no era cierto.
    const where: Prisma.SellRequestWhereInput = {
      // §4.39c: el set del ajuste vivo sale de la constante, no de un literal.
      status: { in: [...SELL_REQUEST_LIVE_ADJUSTMENT_STATES] },
      closedAt: null,
      adjustmentSentAt: { not: null, lte: sevenDaysAgo },
    };
    const rows = await this.prisma.sellRequest.findMany({ where, select: { id: true } });
    let n = 0;
    for (const req of rows) {
      const res = await this.prisma.sellRequest.updateMany({
        where: { ...where, id: req.id },
        data: { status: 'rechazada', closedAt: now },
      });
      n += res.count;
    }
    return n;
  }

  /**
   * Regla 6 — abandono a 30 días. **⚠️ RE-ANCLADA en `receivedAt`**, no en `createdAt`.
   *
   * El abandono es *«nos mandaste las cartas y no respondiste»*, así que el reloj tiene que colgar de
   * **cuando llegaron**. Anclado en `createdAt` mataba `cotizada` que nadie había tocado — y ese
   * hueco lo cierra ahora la **regla 7**, con un correo que dice explícitamente que no procederemos,
   * en vez de un archivado silencioso.
   */
  private async abandonUnreturned(now: Date): Promise<number> {
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
    // ⚠️ B-1: el MISMO predicado lee y escribe. Sin `status` en la escritura, un `pagada` que
    // commiteara entre las dos mitades quedaba **abandonada con `closedAt`** — encima del SPEI.
    const where: Prisma.SellRequestWhereInput = {
      status: { in: ['recibida', 'verificacion', 'aprobada'] },
      closedAt: null,
      receivedAt: { not: null, lte: thirtyDaysAgo },
    };
    const rows = await this.prisma.sellRequest.findMany({ where, select: { id: true } });
    let n = 0;
    for (const req of rows) {
      const res = await this.prisma.sellRequest.updateMany({
        where: { ...where, id: req.id },
        data: { status: 'abandonada', closedAt: now },
      });
      n += res.count;
    }
    return n;
  }

  // =========================================================================================
  // Regla 7 (D33/D38) — la solicitud que NADIE ofertó
  // =========================================================================================

  /**
   * ⚠️ **Cierra el hueco que abrió re-anclar la regla 6:** al mover el abandono a `receivedAt`,
   * **nada cerraba ya una `cotizada`** y el cliente podía esperar **indefinidamente** una respuesta
   * que nadie le debía formalmente. **El daño no es técnico —una cotización no compromete dinero— es
   * humano.**
   *
   * **NO contradice §P.13** aunque lo parezca: la regla 2 **le quita algo** a alguien que cumplió; la
   * regla 7 **no le quita nada** —nunca hubo oferta— y **lo libera de una espera abierta**. Y el
   * plazo que vence aquí **es NUESTRO** (el dial se llama `buylistOfferIssueDeadlineBusinessDays`).
   *
   * **⚠️ Ancla D38: `offerIssueClockStartedAt ?? createdAt`.** Cancelar una oferta enviada repone los
   * siete días completos: el vendedor **no paga por una corrección nuestra**.
   *
   * **⚠️ Anula la oferta pendiente EN LA MISMA transacción** (`offerState → cancelled`). Sin eso, el
   * súper-admin **autorizaría después sobre una solicitud TERMINAL**, mandando un correo vinculante a
   * alguien a quien acabamos de escribirle que no procederíamos.
   *
   * **`declinedBy` queda `null`**: lo cerró el barrido, no una persona — es el único discriminador
   * entre *«decidimos»* y *«dejamos vencer»*, y vive solo en la bitácora.
   *
   * ### ⚠️⚠️ B-4 — ESTA REGLA NACE APAGADA. El paso 6 de M-46 ahora tiene MECANISMO.
   * La migración exige, **en mayúsculas y declarándolo NO OPCIONAL**, un censo y triage humano de las
   * `cotizada` vivas **antes** de habilitar esta regla, «porque si no, la primera corrida del barrido
   * manda correos reales a vendedores con solicitudes viejas». Hasta v1.51.22 **lo único que separaba
   * el deploy de esos correos era ese comentario en un `.sql`**: no había flag, ni gate, ni kill
   * switch, y el cron `'0 8 * * *'` corre **la primera mañana**.
   *
   * Ahora la regla se lee detrás de `buylist_no_offer_expiry_enabled`, **`off` por defecto**. Se
   * enciende a mano DESPUÉS del triage. Las otras seis reglas **no** se gatean: ninguna de ellas
   * depende de un paso operativo previo, y apagar el barrido entero para proteger a una sería dejar
   * sin plazo a las cinco que sí están listas.
   *
   * ⚠️ **Sin `SettingsService` (tests unitarios que construyen el servicio a mano) la regla queda
   * APAGADA**, no encendida con el default de 7 días. Es el mismo lado seguro que el fail-closed de
   * calendario: *ante la duda, no se caduca y no sale correo.* Los tests que la ejercitan inyectan un
   * `settings` que devuelve `'on'`, y esa inyección es lo que **hace visible** que la regla está
   * gateada.
   */
  private async expireUnofferedRequests(now: Date): Promise<number> {
    // El gate va PRIMERO: apagado ⇒ ni siquiera se lee la tabla. Un barrido que no puede escribir no
    // tiene por qué barrer.
    if (!this.settings) return 0;
    const enabled = await this.settings.getString(SettingKey.BUYLIST_NO_OFFER_EXPIRY_ENABLED);
    // SOLO el string `'on'` enciende. `null`, `true`, `'ON'` o basura ⇒ APAGADO (fail-closed).
    if (enabled !== 'on') return 0;
    const days = await this.settings.getNumber(
      SettingKey.BUYLIST_OFFER_ISSUE_DEADLINE_BUSINESS_DAYS,
    );
    const rows = await this.prisma.sellRequest.findMany({
      where: { status: 'cotizada', closedAt: null },
      include: { user: { select: { name: true, email: true, locale: true } } },
    });
    let n = 0;
    for (const req of rows) {
      let elapsed: number;
      try {
        elapsed = businessDaysSince(req.offerIssueClockStartedAt ?? req.createdAt, now);
      } catch (e) {
        // Fail-closed de calendario (§4.39k): se loggea y NO se caduca. *Fallar hacia «no vence» es
        // el único lado seguro.*
        this.logger.error(
          `buylist-sweep: regla 7 omitida para ${req.id} (calendario): ${(e as Error).message}`,
        );
        continue;
      }
      if (elapsed < days) continue;
      const res = await this.prisma.sellRequest.updateMany({
        where: { id: req.id, status: 'cotizada', closedAt: null },
        data: {
          status: 'expirada',
          expiredReason: SellRequestExpiryReason.no_offer,
          closedAt: now,
          // La oferta preparada muere con la solicitud, en la MISMA escritura.
          ...(req.offerState === 'pending_authorization'
            ? {
                offerState: 'cancelled',
                offerCancelledAt: now,
                offerCancelReason: 'buylist-sweep: la solicitud caducó sin oferta emitida',
              }
            : {}),
          // Si hubiera guía (no debería: la caducidad mata ANTES de aceptar), la tarea se abre igual.
          ...(req.shipmentTrackingNumber != null && req.guideCancellationDoneAt == null
            ? { guideCancellationPendingAt: now }
            : {}),
        },
      });
      if (res.count !== 1) continue;
      n += 1;
      await this.sendMail(req.id, req.user, () =>
        sellRequestNotPursuedTemplate(
          { folio: req.id, portalUrl: buylistPortalUrl(req.id, req.user?.locale) },
          req.user?.name ?? '',
          req.user?.locale,
        ),
      );
    }
    return n;
  }

  // =========================================================================================
  // 💰 rev BSD-1 — Reglas 8, 9 y 10: la `aceptada` SIN guía (API_CONTRACT §BSD.7)
  // =========================================================================================

  /**
   * Los dos diales de §BSD.9, leídos UNA vez por pasada. ⚠️ Sin `SettingsService` (unitarios que construyen a mano) las reglas
   * 8 y 9 quedan APAGADAS — el mismo lado seguro que la regla 7: *ante la duda, no se cierra y no sale correo.*
   */
  private async guideClockDials(): Promise<GuideClockDials | null> {
    if (!this.settings) return null;
    const [closeDays, warnDays] = await Promise.all([
      this.settings.getNumber(SettingKey.BUYLIST_GUIDE_CLOSE_CALENDAR_DAYS),
      this.settings.getNumber(SettingKey.BUYLIST_GUIDE_WARN_DAYS_BEFORE_CLOSE),
    ]);
    // Fail-closed ante un dial ilegible: un cierre con `NaN` días cerraría todo o nada sin que nadie lo decida.
    if (!Number.isInteger(closeDays) || closeDays < 1 || !Number.isInteger(warnDays) || warnDays < 0) {
      this.logger.error(`buylist-sweep: diales del cierre sin guía ilegibles (close=${closeDays}, warn=${warnDays}); reglas 8 y 9 omitidas`);
      return null;
    }
    return { closeDays, warnDays };
  }

  /** Una regla nueva que falla NO tumba las demás de la pasada (se loggea `error`; la siguiente pasada la reintenta). */
  private async isolated(name: string, run: () => Promise<number>): Promise<number> {
    try {
      return await run();
    } catch (e) {
      this.logger.error(`buylist-sweep: ${name} falló: ${e instanceof Error ? e.message : String(e)}`);
      return 0;
    }
  }

  /**
   * **Regla 8 (§BSD.7.1) — cierre a N días NATURALES sin guía.** `expirada` + `not_continued` + `closedAt` + `declinedBy = null`
   * (lo cerró el barrido), `closeInboundShipment(tx,'close')` en la MISMA transacción (I-BSD-1) y **BSD-M1** post-commit.
   *
   * ⚠️ El predicado (`guideCloseDueWhere`) es el MISMO en la lectura y en la escritura (B-1 del barrido): entre las dos puede
   * llegar una guía, un reclamo de compra, un «ya lo mandé» o una confirmación, y la escritura tiene que volver a preguntarlo.
   * Y la escritura corre DESPUÉS de tomar el candado de la solicitud (I-BSD-4): la compra de la guía de entrada lo toma
   * primero, así que su reclamo ya está commiteado (y su `labelProcessingSince` visible) cuando el `updateMany` lo pregunta.
   *
   * ⛔ No culpa al vendedor (§BSD.7.4): `not_continued` no entra en ninguna cifra de conducta (hoy solo `not_shipped`).
   */
  private async closeUnguidedAccepted(now: Date, d: GuideClockDials): Promise<number> {
    const where = guideCloseDueWhere(now, d);
    const rows = await this.prisma.sellRequest.findMany({
      where,
      select: { id: true, user: { select: { name: true, email: true, locale: true } } },
    });
    let n = 0;
    for (const req of rows) {
      const moved = await this.closeWithGuideTask(req.id, now, where, {
        status: 'expirada',
        expiredReason: SellRequestExpiryReason.not_continued,
        closedAt: now,
        declinedBy: null,
      });
      if (!moved) continue;
      n += 1;
      // BSD-M1 — el MISMO correo que «Declinar». Uno por solicitud: lo garantiza el `count === 1` de arriba.
      await this.sendMail(req.id, req.user, () =>
        sellRequestNotContinuedTemplate(
          { folio: req.id, portalUrl: buylistPortalUrl(req.id, req.user?.locale) },
          req.user?.name ?? '',
          req.user?.locale,
        ),
      );
    }
    return n;
  }

  /**
   * **Regla 9 (§BSD.7.2) — AG-23 al dueño**, `warn` días antes del cierre. `dedupKey = ag23:<id>:<ancla ISO>` ⇒ UNO por ancla
   * aunque el barrido corra varias veces (re-emitir re-ancla ⇒ puede volver a avisar). `facts` = `{ sellRequestId, closesAt,
   * offerGrossCents }` y nada más (⛔ PII del vendedor, GAS-2). El correo sale por la tubería de avisos (solo el dueño;
   * silenciable, BSD-1.1 C-7). La marca de M5 y del tablero es DERIVADA (`guideDueSoon`) y no depende de esto.
   * @returns los avisos NUEVOS (una repetición no cuenta).
   */
  private async warnUnguidedAccepted(now: Date, d: GuideClockDials): Promise<number> {
    if (!this.alerts) return 0;
    const where = guideWarnDueWhere(now, d);
    if (!where) return 0; // aviso efectivo 0 = sin aviso
    const rows = await this.prisma.sellRequest.findMany({
      where,
      select: { id: true, inboundGuideClockStartedAt: true, acceptedAt: true, offerGrossCents: true },
    });
    let n = 0;
    for (const r of rows) {
      const anchor = guideAnchorOf(r);
      if (!anchor) continue;
      const closesAt = new Date(anchor.getTime() + d.closeDays * GUIDE_DAY_MS);
      const alerts = this.alerts;
      const raised = await this.prisma.$transaction((tx) =>
        alerts.raise(
          tx,
          {
            kind: 'buylist_guide_due',
            severity: 'immediate',
            dedupKey: `ag23:${r.id}:${anchor.toISOString()}`,
            facts: { sellRequestId: r.id, closesAt: closesAt.toISOString(), offerGrossCents: r.offerGrossCents ?? 0 },
          },
          now,
        ),
      );
      if (!raised?.created) continue;
      n += 1;
      // Outbox: el correo inmediato post-commit (⛔ nunca lanza; lo que quede `pending` lo recoge `spend-watch`).
      if (this.spendMail) await this.spendMail.dispatchImmediate(raised.id);
    }
    return n;
  }

  /**
   * **Regla 10 (§BSD.7.5) — reconciliación de cancelaciones.** Fila de entrada `cancelado` cuya guía se canceló en Skydropx
   * hace más de 1 h sin confirmación (`providerCancelConfirmedAt IS NULL`), con la solicitud sin tarea abierta ⇒ se abre la
   * tarea «cancelar guía no usada» (criterio 139). Cubre un proceso que murió entre el commit y el `cancel`.
   * ⛔ No reabre una tarea ya cerrada (`guideCancellationDoneAt`).
   */
  private async reconcileInboundCancellations(now: Date): Promise<number> {
    const rows = await this.prisma.shipmentRequest.findMany({
      where: {
        ...INBOUND_ONLY,
        status: 'cancelado',
        providerCanceledAt: { not: null, lte: new Date(now.getTime() - INBOUND_CANCEL_RECONCILE_MS) },
        providerCancelConfirmedAt: null,
        sellRequest: { is: { guideCancellationPendingAt: null, guideCancellationDoneAt: null } },
      },
      select: { sellRequestId: true },
    });
    let n = 0;
    for (const r of rows) {
      if (!r.sellRequestId) continue;
      const opened = await this.prisma.sellRequest.updateMany({
        where: { id: r.sellRequestId, guideCancellationPendingAt: null, guideCancellationDoneAt: null },
        data: { guideCancellationPendingAt: now },
      });
      n += opened.count;
    }
    return n;
  }

  // =========================================================================================
  // Utilidades compartidas
  // =========================================================================================

  /**
   * Cierra una solicitud **y abre la tarea de guía muerta si había etiqueta** — las **dos mitades de
   * D22 en la misma escritura**. *Una etiqueta comprada y olvidada es dinero tirado que nadie ve*, y
   * que sea cancelable no sirve si nadie avisa.
   *
   * ### ⚠️⚠️ B-1 — `guard` NO ES OPCIONAL, Y ES EL PARÁMETRO ENTERO DE ESTE MÉTODO
   * `guard` es **el predicado con el que el llamador LEYÓ la fila**, reafirmado aquí en el `where` de
   * la escritura. **La escritura de un barrido tiene que llevar el predicado de su lectura**, porque
   * entre las dos hay una ventana en la que el mundo cambia y el barrido escribe **sobre lo que ya no
   * es cierto**. Hasta v1.51.22 el `where` era `{ id, closedAt: null }` **y nada más**: bastaba con
   * que la transición que ganaba la carrera **no tocara `closedAt`** —y ninguna de las del ciclo vivo
   * lo toca— para que el barrido la pisara. El caso medido: el vendedor declara enviado medio segundo
   * después del `findMany`, y la fila termina `expirada`/`not_shipped`, **terminal**, con correo de
   * «no procederemos», con la tarea de cancelar una guía que va en el correo, y **fuera de
   * `payableWhere()`** ⇒ imposible de pagar y de revivir.
   *
   * **La asimetría era el síntoma:** la regla 7 SÍ reafirmaba `status: 'cotizada'` en su propio
   * `where` (sigue haciéndolo, inline, porque su `data` es condicional a la fila leída). Las reglas
   * 1, 2, 5 y 6 no. Ahora las seis llevan el mismo régimen.
   *
   * **`count === 1` es el veredicto, no un detalle:** `false` ⇒ la fila se movió y **no se manda
   * correo ni se cuenta**. Es el mismo patrón del sello del recordatorio.
   *
   * 💰 **rev BSD-1 — el residual de read-then-write se CIERRA.** Todo corre en UNA transacción bajo el candado de la solicitud
   * (y luego el de su fila de entrada, I-BSD-4): la lectura de la etiqueta ya no puede quedar vieja. La tarea se abre en una
   * segunda escritura (por id) porque depende de lo que devuelve `closeInboundShipment`, que corre DESPUÉS del cambio de estado
   * (§BSD.4.8). Lo usan las reglas 1, 2 y 8 (la 1 nunca tiene fila de entrada: ⇒ `NO_ROW`, conducta de hoy).
   * @returns el resultado de `closeInboundShipment` si la fila se movió; `null` si no (⇒ ni correo ni cuenta).
   */
  private async closeWithGuideTask(
    id: string,
    now: Date,
    guard: Prisma.SellRequestWhereInput,
    data: Prisma.SellRequestUpdateManyMutationInput,
  ): Promise<InboundCloseResult | null> {
    const closed = await this.prisma.$transaction(async (tx) => {
      // 💰 rev BSD-1 (I-BSD-4): PRIMERO la solicitud y después la fila de entrada. Con el candado ya tomado, el `updateMany`
      // de abajo lee el estado COMMITEADO de la fila de entrada (un reclamo de compra que ganó el candado ya es visible).
      await tx.$queryRaw`SELECT id FROM "SellRequest" WHERE id = ${id} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "ShipmentRequest" WHERE "sellRequestId" = ${id} FOR UPDATE`;
      const row = await tx.sellRequest.findUnique({
        where: { id },
        select: { shipmentTrackingNumber: true, guideCancellationDoneAt: true },
      });
      const res = await tx.sellRequest.updateMany({
        // El predicado de la LECTURA, reafirmado en la ESCRITURA. `id` va después para que ningún
        // fragmento del llamador pueda pisarlo.
        where: { ...guard, id },
        data,
      });
      if (res.count !== 1) return null;
      // 💰 rev BSD-1 (I-BSD-1, §BSD.7.3): la fila de entrada sale con la solicitud, EN ESTA transacción: `solicitado|guia ⇒
      // cancelado` y la guía viva de Skydropx sellada para cancelarse post-commit.
      const inbound = await closeInboundShipment(tx, id, 'close', now);
      // La tarea «cancelar guía no usada» SOLO con guía manual o guía de Skydropx que ya se movió (`live`). Con guía manual,
      // bit a bit como hoy (criterio 549): `guideCancellationPendingAt = now` si no estaba cerrada.
      if (row && needsGuideCancelTask(row, inbound)) {
        await tx.sellRequest.updateMany({ where: { id }, data: { guideCancellationPendingAt: now } });
      }
      return inbound;
    });
    // POST-commit (§BSD.4.8): la guía sellada se cancela en Skydropx, best-effort (⛔ nunca lanza); si Skydropx no la confirmó,
    // la tarea «cancelar guía no usada» se abre ya (BSD-B14), no a la hora (regla 10).
    if (closed?.outcome === 'sealed' && closed.shipmentId) {
      await afterAutoCloseVia(this.moduleRef, [closed.shipmentId]);
      await openGuideTaskIfCancelUnconfirmed(this.prisma, id, closed.shipmentId, now);
    }
    return closed;
  }

  /**
   * Envío **best-effort POST-COMMIT**: la transición ya está escrita cuando esto corre, y su fallo
   * **no la revierte** — lo contrario dejaría filas colgadas de un servicio externo.
   */
  private async sendMail(
    id: string,
    // v1.80.9: `email` anulable en el schema; el `!user?.email` de abajo ya omite con aviso (§M6-U.8 (a) E-4).
    user: { name: string; email: string | null; locale: string | null } | null | undefined,
    build: () => { to: string; subject: string; html: string; text: string },
  ): Promise<void> {
    try {
      if (!this.mail || !user?.email) {
        this.logger.warn(
          `buylist-sweep mail skipped for ${id}: ${this.mail ? 'no recipient email' : 'MAIL_PORT unavailable'}`,
        );
        return;
      }
      await this.mail.send({ ...build(), to: user.email });
    } catch (e) {
      this.logger.error(
        `buylist-sweep mail failed for ${id}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}
