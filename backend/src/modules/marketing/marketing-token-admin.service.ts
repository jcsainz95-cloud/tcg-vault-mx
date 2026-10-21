/**
 * marketing-token-admin.service.ts — 🔒 acceso del analista: EMITIR, LISTAR y REVOCAR el token `marketing-reader`
 * (API_CONTRACT §MKT.G.6, D-MKT-PANEL-3; ARCHITECTURE §13.7). La puerta que lo valida es otra
 * (`MarketingTokenService.verify`, en cada llamada de `aggregates` y sin caché ⇒ revocar surte efecto en la
 * SIGUIENTE llamada, sin desplegar).
 *
 * - El CLARO se genera aquí, se devuelve UNA vez (respuesta del POST) y ⛔ no se guarda, ni se loguea, ni va a la
 *   bitácora. En BD solo el hash. ⛔ Ninguna vista lleva `token` ni `tokenHash` (ni un prefijo).
 * - Emitir y revocar escriben `AuditLog` (`marketing.token.issue` / `marketing.token.revoke`) en la MISMA
 *   transacción que el cambio: si la bitácora falla, no queda un token emitido sin rastro.
 * - Revocar es idempotente: ya revocado ⇒ la misma vista (mismo `revokedAt`) y SIN nueva bitácora. La fila se
 *   queda (la referencia `MarketingAccessLog.tokenId`), por eso no hay DELETE.
 */
import { Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BusinessException } from '../../common/business.exception';
import { generateClearToken, hashToken } from './token-crypto';
import { parseTokenLabel } from './marketing-token-label';

/** Caducidad del token (PV-B3): 12 meses. */
export const MARKETING_TOKEN_TTL_MS = 365 * 24 * 60 * 60 * 1000;

export type MarketingApiTokenStatus = 'active' | 'revoked' | 'expired';

/** Vista de un token (listado y revocación). ⛔ Sin `token` ni `tokenHash`. */
export interface MarketingApiTokenView {
  id: string;
  label: string;
  status: MarketingApiTokenStatus;
  createdAt: string;
  createdByUserId: string | null;
  expiresAt: string;
  revokedAt: string | null;
  revokedByUserId: string | null;
  lastUsedAt: string | null;
}

/** Respuesta del POST: la ÚNICA que lleva el claro. */
export interface MarketingApiTokenIssued {
  id: string;
  label: string;
  token: string;
  createdAt: string;
  expiresAt: string;
}

export interface TokenActor {
  id: string;
  role?: Role;
}

/** `select` de la vista: enumera columnas ⇒ `tokenHash` no puede colarse por un `select` implícito. */
const VIEW_SELECT = {
  id: true,
  label: true,
  createdAt: true,
  createdByUserId: true,
  expiresAt: true,
  revokedAt: true,
  revokedByUserId: true,
  lastUsedAt: true,
} as const;

type ViewRow = {
  id: string;
  label: string;
  createdAt: Date;
  createdByUserId: string | null;
  expiresAt: Date;
  revokedAt: Date | null;
  revokedByUserId: string | null;
  lastUsedAt: Date | null;
};

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

export function toTokenView(row: ViewRow, now: Date): MarketingApiTokenView {
  const status: MarketingApiTokenStatus = row.revokedAt
    ? 'revoked'
    : row.expiresAt.getTime() <= now.getTime()
      ? 'expired'
      : 'active';
  return {
    id: row.id,
    label: row.label,
    status,
    createdAt: row.createdAt.toISOString(),
    createdByUserId: row.createdByUserId,
    expiresAt: row.expiresAt.toISOString(),
    revokedAt: iso(row.revokedAt),
    revokedByUserId: row.revokedByUserId,
    lastUsedAt: iso(row.lastUsedAt),
  };
}

@Injectable()
export class MarketingTokenAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Todos los tokens, del más nuevo al más viejo, sin paginar. */
  async list(now = new Date()): Promise<MarketingApiTokenView[]> {
    const rows = await this.prisma.marketingApiToken.findMany({ orderBy: { createdAt: 'desc' }, select: VIEW_SELECT });
    return rows.map((r) => toTokenView(r, now));
  }

  /** Emite un token. El claro sale SOLO en el valor de retorno. 422 si `label` no pasa (`details.field='label'`). */
  async issue(rawLabel: unknown, actor: TokenActor, ip: string | undefined, now = new Date()): Promise<MarketingApiTokenIssued> {
    const label = parseTokenLabel(rawLabel);
    const token = generateClearToken();
    const expiresAt = new Date(now.getTime() + MARKETING_TOKEN_TTL_MS);
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.marketingApiToken.create({
        data: { label, tokenHash: hashToken(token), createdByUserId: actor.id, createdAt: now, expiresAt },
        select: { id: true, label: true, createdAt: true, expiresAt: true },
      });
      await this.audit.log(
        {
          actorUserId: actor.id,
          actorRole: actor.role ?? null,
          action: 'marketing.token.issue',
          entityType: 'MarketingApiToken',
          entityId: created.id,
          after: { label: created.label, expiresAt: created.expiresAt.toISOString() },
          ip,
        },
        tx,
      );
      return created;
    });
    return { id: row.id, label: row.label, token, createdAt: row.createdAt.toISOString(), expiresAt: row.expiresAt.toISOString() };
  }

  /** Revoca al momento. Idempotente. 404 si no existe. */
  async revoke(id: string, actor: TokenActor, ip: string | undefined, now = new Date()): Promise<MarketingApiTokenView> {
    const row = await this.prisma.$transaction(async (tx) => {
      // Solo la PRIMERA revocación cambia la fila (`revokedAt: null` en el where) ⇒ carrera segura y sin 2ª bitácora.
      const changed = await tx.marketingApiToken.updateMany({
        where: { id, revokedAt: null },
        data: { revokedAt: now, revokedByUserId: actor.id },
      });
      const current = await tx.marketingApiToken.findUnique({ where: { id }, select: VIEW_SELECT });
      if (!current) throw BusinessException.notFound('NOT_FOUND', 'Token not found');
      if (changed.count === 1) {
        await this.audit.log(
          {
            actorUserId: actor.id,
            actorRole: actor.role ?? null,
            action: 'marketing.token.revoke',
            entityType: 'MarketingApiToken',
            entityId: id,
            after: { revokedAt: iso(current.revokedAt) },
            ip,
          },
          tx,
        );
      }
      return current;
    });
    return toTokenView(row, now);
  }
}
