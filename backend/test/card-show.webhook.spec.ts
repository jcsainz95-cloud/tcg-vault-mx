import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { CardShowWebhookService } from '../src/modules/card-show/card-show-webhook.service';
import { MemoryCardShowCounterStore } from '../src/modules/card-show/card-show-counter.store';

const SECRET_B64 = Buffer.from('a-very-secret-signing-key-32bytes-min!!').toString('base64');
const config = {
  get: (k: string) => (k === 'CARD_SHOW_RESEND_WEBHOOK_SECRET' ? `whsec_${SECRET_B64}` : undefined),
} as unknown as ConfigService;

function sign(id: string, ts: string, body: string): string {
  const secretBytes = Buffer.from(SECRET_B64, 'base64');
  const sig = createHmac('sha256', secretBytes).update(`${id}.${ts}.${body}`).digest('base64');
  return `v1,${sig}`;
}

/** §CARDSHOW.10 (C6) — corte por webhooks de Resend, con firma verificada. */
describe('CARDSHOW · webhook de Resend (C6)', () => {
  const now = 1_700_000_000_000;
  const ts = String(Math.floor(now / 1000));

  it('firma válida ⇒ acepta; 1 byte alterado ⇒ rechaza; sin secreto ⇒ rechaza (fail-closed)', () => {
    const store = new MemoryCardShowCounterStore(() => now);
    const svc = new CardShowWebhookService(store, config);
    const body = JSON.stringify({ type: 'email.bounced' });
    const good = sign('msg_1', ts, body);
    expect(svc.verifySignature(body, { id: 'msg_1', timestamp: ts, signature: good }, now)).toBe(true);
    expect(svc.verifySignature(body, { id: 'msg_1', timestamp: ts, signature: good.slice(0, -1) + 'A' }, now)).toBe(false);

    const noSecret = new CardShowWebhookService(store, { get: () => undefined } as unknown as ConfigService);
    expect(noSecret.verifySignature(body, { id: 'msg_1', timestamp: ts, signature: good }, now)).toBe(false);
  });

  it('≥ 2 complained en 24 h ⇒ corta; solo un humano reabre', async () => {
    const store = new MemoryCardShowCounterStore(() => now);
    const svc = new CardShowWebhookService(store, config);
    expect((await svc.handleEvent('email.complained', now)).cutNow).toBe(false); // 1.ª
    const second = await svc.handleEvent('email.complained', now); // 2.ª ⇒ corte
    expect(second.cutNow).toBe(true);
    expect(await svc.isCut()).toBe(true);
    await svc.reopen();
    expect(await svc.isCut()).toBe(false);
  });

  it('≥ 10 bounced en 24 h ⇒ corta', async () => {
    const store = new MemoryCardShowCounterStore(() => now);
    const svc = new CardShowWebhookService(store, config);
    let cut = false;
    for (let i = 0; i < 10; i += 1) cut = (await svc.handleEvent('email.bounced', now)).cutNow || cut;
    expect(cut).toBe(true);
    expect(await svc.isCut()).toBe(true);
  });

  it('eventos benignos (delivered) ⛔ no cortan', async () => {
    const store = new MemoryCardShowCounterStore(() => now);
    const svc = new CardShowWebhookService(store, config);
    expect((await svc.handleEvent('email.delivered', now)).cutNow).toBe(false);
    expect(await svc.isCut()).toBe(false);
  });
});
