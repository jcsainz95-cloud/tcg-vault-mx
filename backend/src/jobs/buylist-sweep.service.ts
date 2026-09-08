import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma, SellRequestExpiryReason } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../modules/settings/settings.service';
import { SettingKey } from '../modules/settings/settings.constants';
import { MAIL_PORT, MailPort } from '../modules/mail/mail.port';
import {
  sellOfferReminderTemplate,
  sellRequestExpiredTemplate,
  sellRequestNotPursuedTemplate,
  buylistPortalUrl,
  OfferReminderKind,
  SellExpiredKind,
} from '../modules/buylist/buylist-mail.templates';
import { addBusinessDays, businessDaysSince } from '../common/business-days';
import { SELL_REQUEST_LIVE_ADJUSTMENT_STATES } from '../modules/buylist/buylist-reject.constants';

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
  ) {}

  async run(now = new Date()): Promise<{
    rejected: number;
    abandoned: number;
    offersExpired: number;
    shipmentsExpired: number;
    remindersSent: number;
    notPursued: number;
  }> {
    const rule1 = await this.expireUnansweredOffers(now);
    const rule2 = await this.expireUnshippedPackages(now);
    const reminders = (await this.sendAcceptReminders(now)) + (await this.sendShipReminders(now));
    const rule5 = await this.expireUnansweredAdjustments(now);
    const rule6 = await this.abandonUnreturned(now);
    const rule7 = await this.expireUnofferedRequests(now);

    this.logger.log(
      `buylist-sweep: ${rule1} ofertas vencidas, ${rule2} envíos vencidos, ${reminders} recordatorios, ` +
        `${rule5} ajustes sin responder, ${rule6} abandonadas, ${rule7} sin oferta (no procederemos).`,
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
   * ⚠️ **Residual conocido y aceptado:** el `findUnique` de la etiqueta sigue siendo read-then-write.
   * Su peor caso es **no abrir** una tarea operativa (fail-open sobre trabajo, no sobre dinero) y es
   * casi inalcanzable —`shipDeadlineAt` solo existe si la guía YA se capturó—, así que no justifica
   * partir la escritura en dos `updateMany`. Registrado en `docs/BACKEND_NOTES.md`.
   */
  private async closeWithGuideTask(
    id: string,
    now: Date,
    guard: Prisma.SellRequestWhereInput,
    data: Prisma.SellRequestUpdateManyMutationInput,
  ): Promise<boolean> {
    const row = await this.prisma.sellRequest.findUnique({
      where: { id },
      select: { shipmentTrackingNumber: true, guideCancellationDoneAt: true },
    });
    const res = await this.prisma.sellRequest.updateMany({
      // El predicado de la LECTURA, reafirmado en la ESCRITURA. `id` va después para que ningún
      // fragmento del llamador pueda pisarlo.
      where: { ...guard, id },
      data: {
        ...data,
        ...(row?.shipmentTrackingNumber != null && row.guideCancellationDoneAt == null
          ? { guideCancellationPendingAt: now }
          : {}),
      },
    });
    return res.count === 1;
  }

  /**
   * Envío **best-effort POST-COMMIT**: la transición ya está escrita cuando esto corre, y su fallo
   * **no la revierte** — lo contrario dejaría filas colgadas de un servicio externo.
   */
  private async sendMail(
    id: string,
    user: { name: string; email: string; locale: string | null } | null | undefined,
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
