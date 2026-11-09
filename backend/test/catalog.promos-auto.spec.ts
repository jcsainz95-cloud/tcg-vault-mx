import {
  ALWAYS_SYNCED_PROMO_SETS,
  CatalogSyncService,
  selectSyncAllCandidates,
} from '../src/modules/catalog/catalog-sync.service';
import { PTCG_PROMO_GROUPS } from '../src/modules/catalog/promo-set-groups';
import { TCGCSV_IMPORTABLE_GROUPS } from '../src/modules/catalog/tcgcsv-importable-groups';
import { BusinessException } from '../src/common/business.exception';
import { ErrorCode } from '../src/common/error-codes';
import { PrismaService } from '../src/prisma/prisma.service';
import { PokemonTcgIoClient } from '../src/modules/catalog/pokemontcg-io.client';
import { SettingsService } from '../src/modules/settings/settings.service';
import { CatalogPriceSyncJobService } from '../src/jobs/catalog-price-sync.service';

/**
 * PROMOS-MASTERSET (descarga automatica, PMS-B1..B10) + AUTO-A (actor system, job que aguarda). Spec: docs/specs/PROMOS_MASTERSET.md §3,
 * docs/specs/AUTO_CATALOGO.md §A.
 */
const CUT = '2024/01/01';
const set = (id: string, releaseDate: string | null = '2020/01/01') => ({ id, name: id, releaseDate }) as any;

describe('PMS — seleccion: las 6 promos entran SIEMPRE (B1-B4, B10)', () => {
  const opts = { importedWithCards: new Set<string>(), force: false, fromReleaseDate: CUT, alwaysSynced: new Set(ALWAYS_SYNCED_PROMO_SETS) };

  it('B10 la lista del barrido sale de la MISMA constante que PTCG_PROMO_GROUPS', () => {
    expect([...ALWAYS_SYNCED_PROMO_SETS]).toEqual(PTCG_PROMO_GROUPS.map((g) => g.ptcgSetId));
    expect(ALWAYS_SYNCED_PROMO_SETS).toHaveLength(6);
  });
  it('B1 svp con releaseDate anterior al corte ⇒ entra', () => {
    expect(selectSyncAllCandidates([set('svp', '2023/01/01')], opts).queue.map((s) => s.id)).toEqual(['svp']);
  });
  it('B2 promo sin releaseDate ⇒ entra (no cae al cubo unknownDate)', () => {
    const r = selectSyncAllCandidates([set('swshp', null)], opts);
    expect(r.queue.map((s) => s.id)).toEqual(['swshp']);
    expect(r.unknownDate).toHaveLength(0);
  });
  it('B3 promo ya importada y force=false ⇒ se re-sincroniza', () => {
    const r = selectSyncAllCandidates([set('smp')], { ...opts, importedWithCards: new Set(['smp']) });
    expect(r.queue.map((s) => s.id)).toEqual(['smp']);
  });
  it('B4 set viejo NO promo anterior al corte ⇒ sigue fuera', () => {
    const r = selectSyncAllCandidates([set('base1', '1999/01/09')], opts);
    expect(r.queue).toHaveLength(0);
    expect(r.outOfRange).toHaveLength(1);
  });
});

function build(opts: { remote: any[]; importGroup?: jest.Mock; getSets?: jest.Mock }) {
  const prisma = {
    cardSet: { findMany: jest.fn(async () => []), findUnique: jest.fn(async () => null) },
  } as unknown as PrismaService;
  const client = { getSets: opts.getSets ?? jest.fn(async () => opts.remote) } as unknown as PokemonTcgIoClient;
  const settings = { getString: jest.fn(async () => CUT) } as unknown as SettingsService;
  const tcgcsv = { importGroup: opts.importGroup ?? jest.fn(async () => ({ setId: 's', created: 3, updated: 0, stamped: 0, noPrice: 0, skipped: [] })) };
  const svc = new CatalogSyncService(prisma, client, settings, { reconcile: jest.fn() } as any, undefined, undefined, tcgcsv as any);
  const importSet = jest.spyOn(svc as any, 'importSet').mockImplementation(async (s: any, o: any) => ({ outcome: o.force ? 'refreshed' : 'imported', cardsUpserted: 1, setId: s.id }));
  return { svc, tcgcsv, importSet, client };
}
const USER_SUPER = { kind: 'user' as const, id: 'u1', role: 'super_admin' as const };
const SYSTEM = { kind: 'system' as const, job: 'catalog-metadata-sync', attempt: 1 };
const REMOTE = () => [...ALWAYS_SYNCED_PROMO_SETS.map((id) => set(id)), set('sv8', '2025/01/01')];
async function run(svc: CatalogSyncService, actor: any, force = false) {
  const res = await svc.syncAll({ force, actor });
  await svc.awaitSyncAll(5_000).catch(() => undefined);
  return { res, summary: svc.getSyncStatus().summary! };
}

describe('PMS — TCGCSV y permisos (B5-B9, AUTO A3/A5)', () => {
  it('B5 lista viva caida ⇒ 0 escrituras: ni promos ni TCGCSV', async () => {
    const { svc, tcgcsv, importSet } = build({ remote: [], getSets: jest.fn(async () => { throw new Error('503'); }) });
    await expect(svc.syncAll({ actor: SYSTEM })).rejects.toThrow('503');
    expect(importSet).not.toHaveBeenCalled();
    expect(tcgcsv.importGroup).not.toHaveBeenCalled();
  });
  it('promos se sincronizan aunque force=false y el resumen trae su estado', async () => {
    const { svc, importSet } = build({ remote: REMOTE() });
    const { summary } = await run(svc, USER_SUPER);
    expect(importSet.mock.calls.filter((c: any) => ALWAYS_SYNCED_PROMO_SETS.includes(c[0].id)).every((c: any) => c[1].force === true)).toBe(true);
    expect(summary.promos.sets.map((x) => x.setId).sort()).toEqual([...ALWAYS_SYNCED_PROMO_SETS].sort());
  });
  it('promo ausente en la lista viva ⇒ missing_remote, no es error', async () => {
    const { svc } = build({ remote: [set('sv8', '2025/01/01')] });
    const { summary } = await run(svc, USER_SUPER);
    expect(summary.promos.sets.every((x) => x.status === 'missing_remote')).toBe(true);
    expect(summary.setsFailed).toBe(0);
  });
  it('B6 grupo cubierto ⇒ covered sin error; B9 fallo de un grupo no aborta', async () => {
    const importGroup = jest.fn(async () => { throw BusinessException.conflict(ErrorCode.TCGCSV_GROUP_COVERED, 'cubierto'); });
    const { svc } = build({ remote: REMOTE(), importGroup });
    const { summary } = await run(svc, USER_SUPER);
    expect(summary.promos.tcgcsv[0]).toMatchObject({ groupId: TCGCSV_IMPORTABLE_GROUPS[0].groupId, status: 'covered' });
    const boom = jest.fn(async () => { throw BusinessException.retriable(ErrorCode.TCGCSV_IMPORT_FAILED, 'x'); });
    const b = build({ remote: REMOTE(), importGroup: boom });
    const r = await run(b.svc, USER_SUPER);
    expect(r.summary.promos.tcgcsv[0]).toMatchObject({ status: 'error', errorCode: ErrorCode.TCGCSV_IMPORT_FAILED });
    expect(r.summary.promos.sets).toHaveLength(6); // las promos se procesaron igual
  });
  it('B8/A5 actor user NO super_admin ⇒ skipped_needs_super_admin y NO se llama al import', async () => {
    const { svc, tcgcsv } = build({ remote: REMOTE() });
    const { summary } = await run(svc, { kind: 'user', id: 'u2', role: 'vault_operator' });
    expect(summary.promos.tcgcsv[0].status).toBe('skipped_needs_super_admin');
    expect(tcgcsv.importGroup).not.toHaveBeenCalled();
  });
  it('A3 actor system ⇒ importa SIN rol humano y pasa el actor system al import', async () => {
    const { svc, tcgcsv } = build({ remote: REMOTE() });
    const { summary } = await run(svc, SYSTEM);
    expect(tcgcsv.importGroup).toHaveBeenCalledWith(TCGCSV_IMPORTABLE_GROUPS[0].groupId, expect.objectContaining({ kind: 'system', job: 'catalog-metadata-sync' }));
    expect(summary.promos.tcgcsv[0]).toMatchObject({ status: 'imported', created: 3 });
    expect(svc.getSyncStatus()).toMatchObject({ lastTrigger: 'job', attempt: 1 });
  });
  it('sin actor (llamada interna sin identidad) ⇒ no corre TCGCSV', async () => {
    const { svc, tcgcsv } = build({ remote: REMOTE() });
    await run(svc, undefined);
    expect(tcgcsv.importGroup).not.toHaveBeenCalled();
  });
});

describe('AUTO-A — el job aguarda el barrido y lanza si termino mal; 6 intentos', () => {
  it('A1 job: fallo de pokemontcg.io ⇒ lanza (BullMQ reintenta); luego responde ⇒ termina OK', async () => {
    let calls = 0;
    const getSets = jest.fn(async () => { if (++calls <= 2) throw new Error('pokemontcg 503'); return REMOTE(); });
    const { svc } = build({ remote: [], getSets });
    const job = new CatalogPriceSyncJobService(svc);
    await expect(job.runMetadataImport({ attempt: 1 })).rejects.toThrow('503');
    await expect(job.runMetadataImport({ attempt: 2 })).rejects.toThrow('503');
    await expect(job.runMetadataImport({ attempt: 3, timeoutMs: 5_000 })).resolves.toBeDefined();
  });
  it('A1 mutacion: el job NO termina antes de que acabe el barrido (aguarda) - set fallido ⇒ lanza', async () => {
    const { svc, importSet } = build({ remote: REMOTE() });
    importSet.mockImplementation(async (s: any) => { if (s.id === 'sv8') throw new Error('boom'); return { outcome: 'refreshed', cardsUpserted: 1, setId: s.id }; });
    const job = new CatalogPriceSyncJobService(svc);
    await expect(job.runMetadataImport({ attempt: 1, timeoutMs: 5_000 })).rejects.toThrow(/errores/);
  });
  it('A2 intentos agotados (6) ⇒ AuditLog catalog.sync_exhausted', async () => {
    const { svc } = build({ remote: [], getSets: jest.fn(async () => { throw new Error('down'); }) });
    const audit = { log: jest.fn(async () => undefined) };
    const job = new CatalogPriceSyncJobService(svc, audit as any);
    await expect(job.runMetadataImport({ attempt: 5 })).rejects.toThrow();
    expect(audit.log).not.toHaveBeenCalled();
    await expect(job.runMetadataImport({ attempt: 6 })).rejects.toThrow();
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'catalog.sync_exhausted' }));
  });
});
