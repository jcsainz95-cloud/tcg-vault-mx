import { ConfigService } from '@nestjs/config';
import { CardShowTokensService } from '../src/modules/card-show/card-show-tokens.service';
import { FORM_TOKEN_MAX_AGE_MS, LINK_TTL_LEAD_MS, LINK_TTL_SIGNUP_MS } from '../src/modules/card-show/card-show.constants';

function tokensWith(secrets: Record<string, string>): CardShowTokensService {
  const config = { get: (k: string) => secrets[k] } as unknown as ConfigService;
  return new CardShowTokensService(config);
}

const SECRETS = {
  CARD_SHOW_FORM_SECRET: 'form-secret-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  CARD_SHOW_LINK_SECRET: 'link-secret-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
};

/** §CARDSHOW.5 — token de formulario firmado + tiempo mínimo (L0-SEG-04). */
describe('CARDSHOW · token de formulario (§CARDSHOW.5)', () => {
  const svc = tokensWith(SECRETS);
  const t0 = 1_700_000_000_000;

  it('válido entre 2 s y 2 h ⇒ ok', () => {
    const tok = svc.issueFormToken('leads', t0);
    expect(svc.verifyFormToken(tok, 'leads', t0 + 3_000).status).toBe('ok');
  });

  it('POST < 2 s ⇒ too_fast (silencioso 0/0)', () => {
    const tok = svc.issueFormToken('leads', t0);
    expect(svc.verifyFormToken(tok, 'leads', t0 + 500).status).toBe('too_fast');
  });

  it('> 2 h ⇒ expired (400 FORM_EXPIRED)', () => {
    const tok = svc.issueFormToken('leads', t0);
    expect(svc.verifyFormToken(tok, 'leads', t0 + FORM_TOKEN_MAX_AGE_MS + 1).status).toBe('expired');
  });

  it('token de `players` usado en `leads` ⇒ invalid (400)', () => {
    const tok = svc.issueFormToken('players', t0);
    expect(svc.verifyFormToken(tok, 'leads', t0 + 3_000).status).toBe('invalid');
  });

  it('1 byte alterado ⇒ invalid', () => {
    const tok = svc.issueFormToken('leads', t0);
    const altered = tok.slice(0, -1) + (tok.slice(-1) === 'a' ? 'b' : 'a');
    expect(svc.verifyFormToken(altered, 'leads', t0 + 3_000).status).toBe('invalid');
  });

  it('sin token ⇒ invalid', () => {
    expect(svc.verifyFormToken(undefined, 'leads', t0).status).toBe('invalid');
    expect(svc.verifyFormToken('', 'leads', t0).status).toBe('invalid');
  });

  it('firmado con OTRO secreto ⇒ invalid (no se puede forjar)', () => {
    const other = tokensWith({ ...SECRETS, CARD_SHOW_FORM_SECRET: 'otro-secreto-zzzzzzzzzzzzzzzzzzzzzzzzzzzz' });
    const forged = other.issueFormToken('leads', t0);
    expect(svc.verifyFormToken(forged, 'leads', t0 + 3_000).status).toBe('invalid');
  });

  it('los dos secretos son DISTINTOS entre sí (un token de enlace no vale como de formulario)', () => {
    const link = svc.issueLinkToken('lead', 'id1', 'confirm', t0);
    expect(svc.verifyFormToken(link, 'leads', t0 + 3_000).status).toBe('invalid');
  });
});

/** §CARDSHOW.6 (C4) — token de enlace con propósito + de un solo uso. */
describe('CARDSHOW · token de enlace (§CARDSHOW.6)', () => {
  const svc = tokensWith(SECRETS);
  const t0 = 1_700_000_000_000;

  it('válido dentro del TTL ⇒ ok con kind/id/purpose', () => {
    const tok = svc.issueLinkToken('lead', 'row-1', 'confirm', t0);
    const r = svc.verifyLinkToken(tok, 'confirm', LINK_TTL_LEAD_MS, t0 + 1000);
    expect(r).toMatchObject({ status: 'ok', kind: 'lead', id: 'row-1', purpose: 'confirm' });
  });

  it('propósito ajeno (confirm usado en unsubscribe) ⇒ invalid', () => {
    const tok = svc.issueLinkToken('lead', 'row-1', 'confirm', t0);
    expect(svc.verifyLinkToken(tok, 'unsubscribe', LINK_TTL_LEAD_MS, t0 + 1000).status).toBe('invalid');
  });

  it('caducado (torneo 72 h) ⇒ expired', () => {
    const tok = svc.issueLinkToken('signup', 'row-1', 'confirm', t0);
    expect(svc.verifyLinkToken(tok, 'confirm', LINK_TTL_SIGNUP_MS, t0 + LINK_TTL_SIGNUP_MS + 1).status).toBe('expired');
  });

  it('1 bit alterado ⇒ invalid', () => {
    const tok = svc.issueLinkToken('lead', 'row-1', 'confirm', t0);
    const altered = tok.slice(0, -1) + (tok.slice(-1) === 'a' ? 'b' : 'a');
    expect(svc.verifyLinkToken(altered, 'confirm', LINK_TTL_LEAD_MS, t0 + 1000).status).toBe('invalid');
  });

  it('firmado con otro secreto ⇒ invalid', () => {
    const other = tokensWith({ ...SECRETS, CARD_SHOW_LINK_SECRET: 'otro-link-secreto-9999999999999999999999' });
    const forged = other.issueLinkToken('lead', 'row-1', 'confirm', t0);
    expect(svc.verifyLinkToken(forged, 'confirm', LINK_TTL_LEAD_MS, t0 + 1000).status).toBe('invalid');
  });
});
