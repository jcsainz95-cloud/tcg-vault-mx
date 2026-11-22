/**
 * §FICHA-CLIENTE — candados de SUPERFICIE: roles/guards de las 5 rutas nuevas y «las notas no salen de su módulo».
 */
import 'reflect-metadata';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { Role } from '@prisma/client';
import { AdminCustomerFileController } from '../src/modules/admin/customer-file.controller';
import { NotSupplierTargetGuard } from '../src/common/guards/not-supplier-target.guard';

describe('AdminCustomerFileController — roles y guards', () => {
  it('ambos roles de equipo (y nadie más) + NotSupplierTargetGuard, en la clase', () => {
    const roles = Reflect.getMetadata('roles', AdminCustomerFileController) as Role[];
    expect([...roles].sort()).toEqual([Role.super_admin, Role.vault_operator].sort());
    const guards = (Reflect.getMetadata('__guards__', AdminCustomerFileController) ?? []) as unknown[];
    expect(guards).toContain(NotSupplierTargetGuard);
    // ningún verbo estrecha ni ensancha el rol de la clase
    for (const m of ['getOverview', 'listNotes', 'createNote', 'updateNote', 'deleteNote']) {
      expect(Reflect.getMetadata('roles', (AdminCustomerFileController.prototype as any)[m])).toBeUndefined();
    }
  });
});

describe('las notas no salen de su módulo (§1b Seguridad)', () => {
  const root = join(__dirname, '..', 'src');
  const walk = (d: string): string[] =>
    readdirSync(d).flatMap((f) => {
      const p = join(d, f);
      return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
    });
  // Únicos ficheros que pueden nombrar `customerNote` / `CustomerNote`: el servicio, el controlador, el módulo y el borrado de cuenta.
  const ALLOWED = ['modules/admin/customer-notes.service.ts', 'modules/admin/customer-file.controller.ts', 'modules/admin/admin.module.ts', 'modules/admin/admin.service.ts', 'common/error-codes.ts'];

  it('ningún otro fichero de src/ toca la tabla de notas (rutas de cliente, correos, exportaciones, medición, logs)', () => {
    const offenders = walk(root)
      .filter((f) => /customerNote|CustomerNote/.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(root.length + 1))
      .filter((f) => !ALLOWED.includes(f));
    expect(offenders).toEqual([]);
  });

  it('el servicio de notas no escribe a logs ni a medición, y `admin.service` solo vacía el texto al anonimizar', () => {
    const svc = readFileSync(join(root, 'modules/admin/customer-notes.service.ts'), 'utf8');
    expect(svc).not.toMatch(/Logger|console\.|dataLayer|fbq|logger\./);
    const admin = readFileSync(join(root, 'modules/admin/admin.service.ts'), 'utf8');
    const uses = admin.split('\n').filter((l) => /customerNote/.test(l) && !l.trim().startsWith('//'));
    expect(uses).toHaveLength(1);
    expect(uses[0]).toContain("updateMany({ where: { userId: id }, data: { body: '' } })");
  });

  it('la lista blanca de lectura de notas no incluye clientRequestId/userId/deletedAt', () => {
    const svc = readFileSync(join(root, 'modules/admin/customer-notes.service.ts'), 'utf8');
    const sel = svc.slice(svc.indexOf('const NOTE_SELECT'), svc.indexOf('type NoteRow'));
    expect(sel).not.toMatch(/clientRequestId|userId|deletedAt/);
  });
});
