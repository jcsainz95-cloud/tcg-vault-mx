import { AdminService } from '../src/modules/admin/admin.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';
import { UploadsService } from '../src/modules/uploads/uploads.service';
import { MailMessage, MailPort } from '../src/modules/mail/mail.port';

/**
 * # ⭐⭐ `C-AV-2` — UN AVISO POR CICLO (criterio 205, sus tres mitades)
 *
 * > Se rechaza **dos veces seguidas** la misma identidad, con motivos distintos, **sin resubida**:
 * > **(a)** llega **UN** correo · **(b)** el motivo que se publica es el **NUEVO** · **(c)** el
 * > cliente **resube**, se rechaza otra vez y **entonces sí** llega el segundo.
 * > **Rojo con dos en (a), y rojo con cero en (c)** — *un sello que no se limpia es silencio
 * > permanente, y ése es el defecto peor.*
 *
 * ## Por qué `AV-1` es el caso delicado
 * Es **el único de los once sin guarda de motor**: `updateUserKyc` hace `upsert` y **no mira el
 * estado actual**, así que N rechazos seguidos escriben N decisiones válidas. *Hoy eso es inofensivo
 * por el motivo equivocado —porque no se manda nada—; en cuanto existe el correo son N correos en un
 * minuto.*
 */

function buildAdmin(opts: { user?: Record<string, unknown> | null; mail?: 'ok' | 'throwing' }) {
  const sent: MailMessage[] = [];
  /** La fila de `KycProfile`, con su sello. El `upsert` y el `updateMany` operan sobre ella. */
  const kyc: Record<string, unknown> = { userId: 'u1', kycStatus: 'pending', kycRejectionNoticeSentAt: null };
  const prisma: any = {
    kycProfile: {
      upsert: jest.fn().mockImplementation(async ({ update }) => {
        Object.assign(kyc, update);
        return { ...kyc };
      }),
      updateMany: jest.fn().mockImplementation(async ({ where, data }) => {
        // El `where` lleva `kycRejectionNoticeSentAt: null` ⇒ solo gana la PRIMERA reclamación.
        if (where.kycRejectionNoticeSentAt === null && kyc.kycRejectionNoticeSentAt != null) {
          return { count: 0 };
        }
        Object.assign(kyc, data);
        return { count: 1 };
      }),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue(
        opts.user === undefined
          ? { name: 'Ash', email: 'ash@pallet.mx', locale: 'es', anonymizedAt: null }
          : opts.user,
      ),
    },
  };
  const mail: MailPort = {
    send: jest.fn().mockImplementation(async (m: MailMessage) => {
      if (opts.mail === 'throwing') throw new Error('resend is down');
      sent.push(m);
      return {};
    }),
  };
  const svc = new AdminService(
    prisma as PrismaService,
    {} as PricingService,
    {} as PiiCryptoService,
    {} as UploadsService,
    mail,
  );
  /** Lo que hace `users.service.ts` al RESUBIR el INE: el mismo bloque que limpia el motivo. */
  const resubirIne = () => {
    kyc.kycStatus = 'pending';
    kyc.rejectionReason = null;
    kyc.reviewedAt = null;
    kyc.reviewedBy = null;
    kyc.kycRejectionNoticeSentAt = null;
  };
  return { svc, sent, kyc, resubirIne, prisma };
}

describe('⭐⭐ C-AV-2 — un aviso por ciclo (criterio 205)', () => {
  it('(a) DOS rechazos seguidos sin resubida ⇒ UN solo correo', async () => {
    const { svc, sent } = buildAdmin({});
    await svc.updateUserKyc('u1', 'rejected', undefined, undefined, 'admin1', 'Foto borrosa');
    expect(sent).toHaveLength(1);

    await svc.updateUserKyc('u1', 'rejected', undefined, undefined, 'admin1', 'Falta el reverso');
    expect(sent).toHaveLength(1); // ⇐ rojo con dos: ése es el defecto que el sello impide
  });

  it('(b) …y el MOTIVO que queda publicado es el NUEVO (el `upsert` lo sobrescribe)', async () => {
    const { svc, kyc } = buildAdmin({});
    await svc.updateUserKyc('u1', 'rejected', undefined, undefined, 'admin1', 'Foto borrosa');
    await svc.updateUserKyc('u1', 'rejected', undefined, undefined, 'admin1', 'Falta el reverso');
    expect(kyc.rejectionReason).toBe('Falta el reverso');
    // *La red de seguridad del mecanismo es la pantalla: el segundo motivo le llega por el portal,
    // aunque no le llegue por correo.*
  });

  it('(c) el cliente RESUBE ⇒ el siguiente rechazo SÍ manda el segundo correo', async () => {
    const { svc, sent, resubirIne } = buildAdmin({});
    await svc.updateUserKyc('u1', 'rejected', undefined, undefined, 'admin1', 'Foto borrosa');
    expect(sent).toHaveLength(1);

    resubirIne(); // §R.4.a mitad 1: la columna se suma al bloque que ya limpia el motivo
    await svc.updateUserKyc('u1', 'rejected', undefined, undefined, 'admin1', 'Sigue borrosa');
    expect(sent).toHaveLength(2); // ⇐ rojo con cero: silencio permanente es el defecto PEOR
  });

  it('§R.4.a mitad 2 — deshacer el rechazo (`verified`/`none`) también reinicia el ciclo', async () => {
    for (const deshacer of ['verified', 'none'] as const) {
      const { svc, sent, kyc } = buildAdmin({});
      await svc.updateUserKyc('u1', 'rejected', undefined, undefined, 'admin1', 'Foto borrosa');
      expect(sent).toHaveLength(1);

      await svc.updateUserKyc('u1', deshacer, undefined, undefined, 'admin1');
      // Lo que el aviso afirmaba dejó de ser verdad ⇒ el sello se limpia…
      expect(kyc.kycRejectionNoticeSentAt).toBeNull();
      // …y ⛔ deshacer NO manda ningún correo (pregunta 71: «no se manda nada»).
      expect(sent).toHaveLength(1);

      await svc.updateUserKyc('u1', 'rejected', undefined, undefined, 'admin1', 'Otra vez borrosa');
      expect(sent).toHaveLength(2);
    }
  });

  it('⛔ verificar NO manda correo, y tampoco lo manda volver a `none` (criterio 206 por exceso)', async () => {
    const { svc, sent } = buildAdmin({});
    await svc.updateUserKyc('u1', 'verified', undefined, undefined, 'admin1');
    await svc.updateUserKyc('u1', 'none', undefined, undefined, 'admin1');
    expect(sent).toHaveLength(0);
  });

  it('el correo lleva el motivo VERBATIM y ⛔ nada del expediente', async () => {
    const { svc, sent } = buildAdmin({});
    const motivo = 'La INE está vencida.';
    await svc.updateUserKyc('u1', 'rejected', undefined, undefined, 'admin1', motivo);
    expect(sent[0].to).toBe('ash@pallet.mx');
    expect(sent[0].text).toContain(motivo);
  });

  it('⛔ cuenta ANONIMIZADA ⇒ cero correos, y el sello NO se quema (§R.5.a)', async () => {
    const { svc, sent, kyc } = buildAdmin({
      user: { name: 'Ash', email: 'ash@pallet.mx', locale: 'es', anonymizedAt: new Date() },
    });
    await svc.updateUserKyc('u1', 'rejected', undefined, undefined, 'admin1', 'Foto borrosa');
    expect(sent).toHaveLength(0);
    expect(kyc.kycRejectionNoticeSentAt).toBeNull();
  });

  it('⭐ C-AV-10 — con el puerto LANZANDO siempre, el `PATCH` de KYC sigue aplicando la decisión', async () => {
    const { svc, kyc } = buildAdmin({ mail: 'throwing' });
    await expect(
      svc.updateUserKyc('u1', 'rejected', undefined, undefined, 'admin1', 'Foto borrosa'),
    ).resolves.toBeDefined();
    expect(kyc.kycStatus).toBe('rejected');
    expect(kyc.rejectionReason).toBe('Foto borrosa');
  });

  it('CANARIO: sin la limpieza del sello, (c) se pondría ROJO — y sin el sello, (a) también', async () => {
    // (i) Sello que NO se limpia al resubir ⇒ silencio permanente.
    const a = buildAdmin({});
    await a.svc.updateUserKyc('u1', 'rejected', undefined, undefined, 'admin1', 'Motivo uno');
    // …se omite `resubirIne()` a propósito: eso es el defecto.
    await a.svc.updateUserKyc('u1', 'rejected', undefined, undefined, 'admin1', 'Motivo dos');
    expect(a.sent).toHaveLength(1); // el segundo correo NO sale ⇒ (c) fallaría

    // (ii) Sin sello (se emula con una fila cuyo sello vuelve a `null` cada vez) ⇒ N correos.
    const b = buildAdmin({});
    await b.svc.updateUserKyc('u1', 'rejected', undefined, undefined, 'admin1', 'Motivo uno');
    b.kyc.kycRejectionNoticeSentAt = null; // ⇐ como si la columna no existiera
    await b.svc.updateUserKyc('u1', 'rejected', undefined, undefined, 'admin1', 'Motivo dos');
    expect(b.sent).toHaveLength(2); // ⇐ los «N correos en un minuto» que el sello impide
  });
});
