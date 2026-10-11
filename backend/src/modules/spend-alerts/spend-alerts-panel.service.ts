/**
 * spend-alerts-panel.service.ts — 💰 el PANEL de avisos (API_CONTRACT §19.29.9 con §19.30.2 (4)–(5), §19.31.8, §19.32.1).
 *
 * Ejes de la lista (§0-Q, `C-EQ-1`): `?kind=` (E, `SpendAlertKind` entero), `?severity=` (E), `?unseen=` (L, `true`), `?muted=`
 * (L, `true | false`; ausente ⇒ los dos). Vacío o espacios ⇒ sin filtro; fuera del dominio ⇒ `400 VALIDATION_ERROR {field,
 * allowed}` (`parseEnumFilter`). `?subjectUserId=` (uuid) y `?from=&to=` (días MX sobre `firstOccurredAt`) ⛔ no son §0-Q.
 * Orden `firstOccurredAt desc` (desempate `id`). `pageSize` ≤ 100, defecto 25.
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/business.exception';
import { parseEnumFilter } from '../../common/enum-filter';
import { SPEND_ALERT_KIND_VALUES, SPEND_ALERT_SEVERITY_VALUES } from '../../common/enum-values';
import { isOwnerAccount, OWNER_SELECT } from './owner';
import { dayMx, SpendAlertsService } from './spend-alerts.service';
import { ALERT_ROW_SELECT, loadAlertRefs, SpendAlertDTO, toSpendAlertDTO } from './spend-alert.view';
import { parseMxDayFilter, mxDaysRange } from './mx-day';
import { summarizeSpendAlerts } from './spend-summary';
import { SpendAlertSummaryDTO } from './spend-alert.mail';
import {
  SPEND_ALERTS_DEFAULT_PAGE_SIZE,
  SPEND_ALERTS_MAX_PAGE_SIZE,
  SPEND_ALERTS_SEEN_MAX_IDS,
} from './spend-alerts.constants';

/** `?unseen=` — clase L, dominio `true` (§19.29.9). */
export const SPEND_ALERT_UNSEEN_FILTER_VALUES = ['true'] as const;
/** `?muted=` — clase L, dominio `true | false` (§19.30.2 (5)); ausente ⇒ los dos. */
export const SPEND_ALERT_MUTED_FILTER_VALUES = ['true', 'false'] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function bad(field: string, message: string): never {
  throw BusinessException.badRequest('VALIDATION_ERROR', message, { field });
}

function parsePage(raw: unknown, field: string, def: number, max?: number): number {
  if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) return def;
  if (typeof raw !== 'string' || !/^\d+$/.test(raw.trim())) bad(field, `${field} must be a positive integer`);
  const n = parseInt((raw as string).trim(), 10);
  if (n < 1) bad(field, `${field} must be >= 1`);
  if (max !== undefined && n > max) bad(field, `${field} must be <= ${max}`);
  return n;
}

@Injectable()
export class SpendAlertsPanelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly alerts: SpendAlertsService,
  ) {}

  async list(raw: Record<string, unknown>): Promise<{ data: SpendAlertDTO[]; page: number; pageSize: number; total: number }> {
    const and: Prisma.SpendAlertWhereInput[] = [];
    const kind = parseEnumFilter('kind', raw.kind, SPEND_ALERT_KIND_VALUES);
    if (kind) and.push({ kind });
    const severity = parseEnumFilter('severity', raw.severity, SPEND_ALERT_SEVERITY_VALUES);
    if (severity) and.push({ severity });
    if (parseEnumFilter('unseen', raw.unseen, SPEND_ALERT_UNSEEN_FILTER_VALUES)) and.push({ seenAt: null });
    const muted = parseEnumFilter('muted', raw.muted, SPEND_ALERT_MUTED_FILTER_VALUES);
    if (muted) and.push({ muted: muted === 'true' });
    const subject = raw.subjectUserId;
    if (subject !== undefined && subject !== null && !(typeof subject === 'string' && subject.trim() === '')) {
      if (typeof subject !== 'string' || !UUID_RE.test(subject)) bad('subjectUserId', 'subjectUserId must be a uuid');
      and.push({ subjectUserId: subject as string });
    }
    const days = parseMxDayFilter({ from: raw.from, to: raw.to });
    if (days.range) and.push({ firstOccurredAt: days.range });
    const page = parsePage(raw.page, 'page', 1);
    const pageSize = parsePage(raw.pageSize, 'pageSize', SPEND_ALERTS_DEFAULT_PAGE_SIZE, SPEND_ALERTS_MAX_PAGE_SIZE);
    const where: Prisma.SpendAlertWhereInput = and.length ? { AND: and } : {};
    const [rows, total] = await Promise.all([
      this.prisma.spendAlert.findMany({
        where,
        select: ALERT_ROW_SELECT,
        orderBy: [{ firstOccurredAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.spendAlert.count({ where }),
    ]);
    const refs = await loadAlertRefs(this.prisma, rows);
    return { data: rows.map((r) => toSpendAlertDTO(r, refs)), page, pageSize, total };
  }

  async get(id: string): Promise<SpendAlertDTO> {
    const row = await this.prisma.spendAlert.findUnique({ where: { id }, select: ALERT_ROW_SELECT });
    if (!row) throw BusinessException.notFound();
    return toSpendAlertDTO(row, await loadAlertRefs(this.prisma, [row]));
  }

  /** `GET …/summary?from&to` — el MISMO cuerpo que el correo `AVG-3`. Sin `from` ni `to` ⇒ hoy (día MX); con uno solo ⇒ ese día. */
  async summary(raw: Record<string, unknown>, now: Date): Promise<SpendAlertSummaryDTO> {
    const days = parseMxDayFilter({ from: raw.from, to: raw.to });
    const today = dayMx(now);
    const from = days.from ?? days.to ?? today;
    const to = days.to ?? days.from ?? today;
    return summarizeSpendAlerts(this.prisma, { from, to, range: mxDaysRange(from, to) });
  }

  /** `POST …/seen` — ids 1..200 uuid; el dueño marca todo; un no dueño ni lo suyo ni AG-21 (`skipped`). */
  async seen(body: unknown, actorUserId: string, now: Date): Promise<{ updated: number; skipped: number; count: number }> {
    const ids = (body as { ids?: unknown } | null)?.ids;
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > SPEND_ALERTS_SEEN_MAX_IDS || !ids.every((x) => typeof x === 'string' && UUID_RE.test(x))) {
      bad('ids', `ids must be 1..${SPEND_ALERTS_SEEN_MAX_IDS} uuids`);
    }
    return this.prisma.$transaction(async (tx) => {
      const actor = await tx.user.findUnique({ where: { id: actorUserId }, select: OWNER_SELECT });
      const res = await this.alerts.markSeen(tx, ids as string[], actorUserId, isOwnerAccount(actor), now);
      return { ...res, count: res.updated };
    });
  }
}
