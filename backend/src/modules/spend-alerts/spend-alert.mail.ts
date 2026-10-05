/**
 * spend-alert.mail.ts — 💰 los correos AL DUEÑO de la base de avisos: `AVG-1` (inmediato), `AVG-2` (lote «y N más») y `AVG-3`
 * (resumen de las 08:00 MX). API_CONTRACT §19.29.5 («Contenido», «Ids de correo»), §19.30.9 (SDX-I-8); DESIGN_SYSTEM §43.19.12,
 * §43.20.10.
 *
 * Patrón §R.1: plantillas LOCALES al módulo (el despacho inyecta el puerto global `MAIL_PORT` y renderiza aquí);
 * ⛔ `mail/mail.service.ts` no cambia. Son internos: ⛔ no entran en §R.3 ni en `C-AV-1`.
 *
 * ⛔ **Contenido (GAS-2, PS-153):** reciben `SpendAlertMailView` y `SpendAlertSummaryDTO` — nunca filas. Ningún dato del
 * cliente puede aparecer porque no está en los tipos.
 * 🔒 **Enlaces (SDX-I-8):** todo enlace sale de `appUrl` con una ruta `admin/…` hacia una PÁGINA del panel que exige sesión: el aviso, la lista y
 * la página de ajustes (`admin/m10`, donde está «¿Quién puede comprar guías?»). ⛔ Ningún `/api/`, ⛔ ninguna cadena de consulta,
 * ⛔ ningún token: los escáneres de correo siguen los enlaces y lo que sigan no debe hacer nada.
 */
import { MailMessage } from '../mail/mail.port';
import { greetingName, NameSourceLike } from '../mail/greeting-name';
import {
  appUrl,
  ctaRows,
  headingRow,
  mailShell,
  monoRow,
  proseRow,
  ruleRow,
  sectionLabelRow,
  smallPrintRow,
  spacerRow,
} from '../buylist/mail-shell';
import { SPEND_ALERT_CODE_OF, dayMx } from './spend-alerts.service';
import {
  MailLocale,
  SPEND_STOP_LINE_CODES,
  SpendAlertMailView,
  mailDay,
  mailMoney,
  mailTime,
  normalizeMailLocale,
  shortRefOf,
  spendAlertSentence,
  spendAlertTitle,
} from './spend-alert-text';

export interface SpendMailRecipient {
  email: string;
  name: string;
  nameSource?: NameSourceLike | null;
  locale?: string | null;
}

/** Lo que el resumen y `GET …/summary` dicen (el MISMO cuerpo: `summarizeSpendAlerts`, §19.29.7). */
export interface SpendAlertSummaryDTO {
  from: string;
  to: string;
  byKind: { code: string; immediate: number; digest: number; amountCents: number }[];
  mutedCount: number;
  labelSpendByPerson: { userId: string; name: string; cents: number; labels: number }[];
  costlyChoices: { count: number; overRecommendedCents: number; byPerson: { userId: string; name: string; count: number }[] };
}

/** Pie GASTO (§43.19.12) y la variante para la cuenta anterior del dueño en AG-21 (§43.20.10). */
function footerWhy(l: MailLocale, previousOwner = false): string {
  if (previousOwner) {
    return l === 'en'
      ? "You are receiving this email because this address belonged to the TCG HUNT owner's account until this change. Customer details aren't included in emails: they're in the panel."
      : 'Recibes este correo porque esta dirección era la de la cuenta del dueño de TCG HUNT hasta este cambio. Los datos del cliente no van en el correo: están en el panel.';
  }
  return l === 'en'
    ? "You are receiving this email because this address belongs to the TCG HUNT owner's account. Customer details aren't included in emails: they're in the panel."
    : 'Recibes este correo porque esta dirección es la de la cuenta del dueño de TCG HUNT. Los datos del cliente no van en el correo: están en el panel.';
}

function greeting(r: SpendMailRecipient, l: MailLocale): string {
  const n = greetingName({ name: r.name, nameSource: r.nameSource ?? null });
  if (l === 'en') return n ? `Hi ${n},` : 'Hi,';
  return n ? `Hola ${n}:` : 'Hola:';
}

/** Enlace al detalle del aviso (página del panel). */
export function spendAlertUrl(id: string, l: MailLocale): string | undefined {
  return appUrl(`admin/spend-alerts/${encodeURIComponent(id)}`, l);
}
function spendAlertsListUrl(l: MailLocale): string | undefined {
  return appUrl('admin/spend-alerts', l);
}
/** La página de ajustes (M10), donde está el interruptor `shipping_label_purchase` (Z.4). ⛔ No es un GET que actúe. */
function settingsPageUrl(l: MailLocale): string | undefined {
  return appUrl('admin/m10', l);
}

/** **`AVG-1`** — un correo por aviso 🔴. */
export function spendAlertImmediateMail(v: SpendAlertMailView, r: SpendMailRecipient, opts: { previousOwner?: boolean } = {}): Omit<MailMessage, 'to'> {
  const l = normalizeMailLocale(r.locale);
  const en = l === 'en';
  const code = SPEND_ALERT_CODE_OF[v.kind];
  const title = spendAlertTitle(v, l);
  const sentence = spendAlertSentence(v, l);
  const sref = shortRefOf(v, l);
  // Asunto (§43.19.12, §43.20.10): `{título}: {ref corta}`; AG-21 solo el título; AG-22 `{título}: {persona}`.
  const subject =
    code === 'AG-21'
      ? title
      : code === 'AG-22'
        ? `${title}: ${(v.subjectName ?? '').trim() || (en ? 'an account with no name' : 'una cuenta sin nombre')}`
        : sref
          ? `${title}: ${sref}`
          : title;

  const rows: string[] = [];
  if (v.subjectName) rows.push(`${en ? 'Who' : 'Quién'}: ${v.subjectName}`);
  if (code !== 'AG-21' && code !== 'AG-22') {
    if (v.orderNumber) rows.push(`${en ? 'Order' : 'Pedido'}: ${v.orderNumber}`);
    if (v.folio) rows.push(`${en ? 'Shipment' : 'Envío'}: ${v.folio}`);
    if (v.amountCents !== null) rows.push(`${en ? 'Amount' : 'Monto'}: ${mailMoney(v.amountCents, l)}`);
  }
  rows.push(`${en ? 'When' : 'Cuándo'}: ${mailDay(dayMx(v.firstOccurredAt), l)} ${mailTime(v.firstOccurredAt)}`);

  const stopUrl = SPEND_STOP_LINE_CODES.has(code) ? settingsPageUrl(l) : undefined;
  const stop = stopUrl
    ? en
      ? `If you want to stop all label purchases now, change it in “Who can buy labels?”: ${stopUrl}`
      : `Si quieres frenar ya todas las compras de guías, cámbialo en «¿Quién puede comprar guías?»: ${stopUrl}`
    : null;
  const url = spendAlertUrl(v.id, l);
  const cta = en ? 'SEE THE ALERT' : 'VER EL AVISO';
  const blocks = [
    headingRow(title, 22),
    spacerRow(24),
    proseRow(greeting(r, l)),
    spacerRow(16),
    proseRow(sentence),
    spacerRow(24),
    ruleRow(),
    spacerRow(16),
    ...rows.map((t) => monoRow(t)),
    ...(stop ? [spacerRow(24), smallPrintRow(stop)] : []),
    spacerRow(32),
    ...(url ? [ctaRows(url, cta, 'accent')] : []),
  ];
  return {
    subject,
    html: mailShell({ locale: l, audience: 'staff', title, preheader: sentence.slice(0, 90), blocks, footerWhy: footerWhy(l, opts.previousOwner) }),
    text: [title, '', greeting(r, l), '', sentence, '', ...rows, ...(stop ? ['', stop] : []), ...(url ? ['', `${cta}: ${url}`] : []), '', footerWhy(l, opts.previousOwner)].join('\n'),
  };
}

/** Una línea del lote o del resumen: `{hora} · {título} · {ref corta} · {monto}`. */
function line(v: SpendAlertMailView, l: MailLocale): string {
  return [mailTime(v.firstOccurredAt), spendAlertTitle(v, l), shortRefOf(v, l), v.amountCents !== null ? mailMoney(v.amountCents, l) : null]
    .filter((x): x is string => !!x)
    .join(' · ');
}

/** **`AVG-2`** — el lote «y N avisos más» de una hora cerrada (`hourStart` = inicio de la hora de reloj). */
export function spendAlertBatchMail(items: SpendAlertMailView[], hourStart: Date, r: SpendMailRecipient): Omit<MailMessage, 'to'> {
  const l = normalizeMailLocale(r.locale);
  const en = l === 'en';
  const n = items.length;
  const h1 = mailTime(hourStart);
  const h2 = mailTime(new Date(hourStart.getTime() + 60 * 60 * 1000));
  const subject = en
    ? `${n === 1 ? '1 more spending alert' : `${n} more spending alerts`} between ${h1} and ${h2}`
    : `${n === 1 ? '1 aviso de gasto más' : `${n} avisos de gasto más`} entre las ${h1} y las ${h2}`;
  const title = en ? `And ${n} more alerts` : `Y ${n} avisos más`;
  const intro = en
    ? 'That hour there were more immediate alerts than we send one by one. Here they are together:'
    : 'En esa hora hubo más avisos inmediatos de los que te mandamos uno por uno. Aquí van juntos:';
  const lines = items.map((v) => ({ text: line(v, l), url: spendAlertUrl(v.id, l) }));
  const url = spendAlertsListUrl(l);
  const cta = en ? 'SEE THE ALERTS' : 'VER LOS AVISOS';
  const blocks = [
    headingRow(title, 22),
    spacerRow(24),
    proseRow(greeting(r, l)),
    spacerRow(16),
    proseRow(intro),
    spacerRow(16),
    ...lines.flatMap((x) => [monoRow(x.url ? `${x.text} — ${x.url}` : x.text)]),
    spacerRow(32),
    ...(url ? [ctaRows(url, cta, 'accent')] : []),
  ];
  return {
    subject,
    html: mailShell({ locale: l, audience: 'staff', title, preheader: subject, blocks, footerWhy: footerWhy(l) }),
    text: [title, '', greeting(r, l), '', intro, '', ...lines.map((x) => (x.url ? `${x.text} — ${x.url}` : x.text)), ...(url ? ['', `${cta}: ${url}`] : []), '', footerWhy(l)].join('\n'),
  };
}

/** **`AVG-3`** — el resumen del día MX `day` (`summary` = `summarizeSpendAlerts` de ese día; ⛔ la plantilla no suma, GAS-4). */
export function spendDigestMail(
  day: string,
  summary: SpendAlertSummaryDTO,
  immediates: SpendAlertMailView[],
  r: SpendMailRecipient,
  titleOfCode: (code: string, l: MailLocale) => string,
): Omit<MailMessage, 'to'> {
  const l = normalizeMailLocale(r.locale);
  const en = l === 'en';
  const d = mailDay(day, l);
  const subject = en ? `Spending summary for ${d}` : `Resumen de gasto del ${d}`;
  const title = en ? `What cost us money on ${d}` : `Lo que nos costó dinero el ${d}`;
  const sec: string[] = [];
  const txt: string[] = [];
  if (immediates.length > 0) {
    const label = en ? 'Immediate' : 'Lo inmediato';
    sec.push(sectionLabelRow(label), ...immediates.map((v) => monoRow(line(v, l))), spacerRow(16));
    txt.push(label, ...immediates.map((v) => line(v, l)), '');
  }
  const byKindLabel = en ? 'By alert' : 'Por tipo';
  const byKind = summary.byKind.map(
    (k) => `${k.code} · ${titleOfCode(k.code, l)} · ${en ? 'immediate' : 'inmediatos'} ${k.immediate} · ${en ? 'summary' : 'del resumen'} ${k.digest} · ${mailMoney(k.amountCents, l)}`,
  );
  sec.push(sectionLabelRow(byKindLabel), ...byKind.map((t) => monoRow(t)), spacerRow(16));
  txt.push(byKindLabel, ...byKind, '');
  if (summary.mutedCount > 0) {
    const m = summary.mutedCount;
    const t = en
      ? `There ${m === 1 ? 'was also 1 switched-off alert' : `were also ${m} switched-off alerts`}: they sent no email and they're in the panel.`
      : `Además hubo ${m === 1 ? '1 aviso apagado' : `${m} avisos apagados`}: no mandaron correo y están en el panel.`;
    sec.push(proseRow(t), spacerRow(16));
    txt.push(t, '');
  }
  const spendLabel = en ? 'Label spend by person' : 'Gasto en guías por persona';
  const spend = summary.labelSpendByPerson.map((p) => `${p.name} · ${p.labels} ${en ? 'labels' : 'guías'} · ${mailMoney(p.cents, l)}`);
  if (spend.length > 0) {
    sec.push(sectionLabelRow(spendLabel), ...spend.map((t) => monoRow(t)), spacerRow(16));
    txt.push(spendLabel, ...spend, '');
  }
  if (summary.costlyChoices.count > 0) {
    const who = summary.costlyChoices.byPerson.map((p) => `${p.name} ${p.count}`).join(', ');
    const t = en
      ? `${summary.costlyChoices.count} labels above the recommended option or with a negative margin, ${mailMoney(summary.costlyChoices.overRecommendedCents, l)} over: ${who}.`
      : `${summary.costlyChoices.count} guías por encima de la recomendada o con margen negativo, ${mailMoney(summary.costlyChoices.overRecommendedCents, l)} de más: ${who}.`;
    sec.push(proseRow(t), spacerRow(16));
    txt.push(t, '');
  }
  const note = en ? "These figures match what you'll see in the panel for that day." : 'Las cifras son las mismas que verás en el panel para ese día.';
  const url = spendAlertsListUrl(l);
  const cta = en ? 'SEE THE DAY IN THE PANEL' : 'VER EL DÍA EN EL PANEL';
  const blocks = [headingRow(title, 22), spacerRow(24), proseRow(greeting(r, l)), spacerRow(16), ...sec, smallPrintRow(note), spacerRow(32), ...(url ? [ctaRows(url, cta, 'ink')] : [])];
  return {
    subject,
    html: mailShell({ locale: l, audience: 'staff', title, preheader: subject, blocks, footerWhy: footerWhy(l) }),
    text: [title, '', greeting(r, l), '', ...txt, note, ...(url ? ['', `${cta}: ${url}`] : []), '', footerWhy(l)].join('\n'),
  };
}
