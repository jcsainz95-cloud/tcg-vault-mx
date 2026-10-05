/**
 * sdx-own.census.spec.ts — 🔒 `C-OWN-1` (API_CONTRACT §M4-SHIP.19.30.1 (2), C-20): ⛔ NINGÚN endpoint, servicio ni job de
 * `backend/src` escribe `User.isOwner`. Solo la migración M-68 (marca inicial condicionada) y `prisma/set-owner.ts`.
 * Censo estático sobre el CÓDIGO (sin comentarios), con canarios sintéticos de las formas que debe cazar.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './helpers/strip-comments';

const SRC = join(__dirname, '..', 'src');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });
}

/** ¿El texto ESCRIBE `isOwner`? — en un `data: {…}` de Prisma o en SQL crudo (`SET "isOwner" =`). */
export function writesIsOwner(code: string): boolean {
  return /data\s*:\s*\{[^{}]*\bisOwner\b/.test(code) || /"isOwner"\s*=/.test(code) || /\bisOwner\s*=\s*(true|false)/.test(code);
}

describe('C-OWN-1 — nadie en `backend/src` escribe `isOwner`', () => {
  it('canarios: las formas de escritura se detectan; las lecturas no', () => {
    expect(writesIsOwner(`tx.user.update({ where: { id }, data: { isOwner: true } })`)).toBe(true);
    expect(writesIsOwner(`prisma.user.updateMany({ data: { name: 'x', isOwner: false } })`)).toBe(true);
    expect(writesIsOwner('$executeRaw`UPDATE "User" SET "isOwner" = true`')).toBe(true);
    expect(writesIsOwner(`select: { isOwner: true, role: true }`)).toBe(false);
    expect(writesIsOwner(`where: { isOwner: true }`)).toBe(false);
    expect(writesIsOwner(`return u.isOwner === true && u.role === 'super_admin'`)).toBe(false);
  });

  it('cero escritores en el código de producción', () => {
    const offenders = files(SRC).filter((f) => writesIsOwner(stripComments(readFileSync(f, 'utf8'))));
    expect(offenders).toEqual([]);
  });
});
