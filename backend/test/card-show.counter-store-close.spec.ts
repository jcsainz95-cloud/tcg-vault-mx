import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import type { Redis } from 'ioredis';
import {
  CARD_SHOW_COUNTER_STORE,
  RedisCardShowCounterStore,
  cardShowCounterStoreProvider,
} from '../src/modules/card-show/card-show-counter.store';
import { createConnection, createServer, type Server, type Socket } from 'node:net';
import { liveResources } from './integration/open-handles.teardown';

/**
 * Handles abiertos (2026-10-19, BACKEND_NOTES §Handles). El cliente ioredis del contador de la landing no
 * se cerraba nunca: cada `app.close()` dejaba un socket vivo y la integración no terminaba (CI la
 * cancelaba a las 6 h). Aquí se fija el cierre en el ENSAMBLAJE real (provider de fábrica + ciclo de
 * vida de Nest), sin Redis: el cliente apunta a un puerto cerrado y lo que se mide es que acabe `end`.
 */
describe('CARDSHOW · el contador Redis suelta su conexión al cerrar la app', () => {
  it('module.close() ⇒ onModuleDestroy del store ⇒ cliente en `end` (no reconecta)', async () => {
    const mod = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ ignoreEnvFile: true, load: [() => ({ REDIS_URL: 'redis://127.0.0.1:1' })] }),
      ],
      providers: [cardShowCounterStoreProvider],
    }).compile();
    const store = mod.get(CARD_SHOW_COUNTER_STORE);
    expect(store).toBeInstanceOf(RedisCardShowCounterStore);
    const client = (store as unknown as { client: Redis }).client;
    try {
      expect(client.status).not.toBe('end');

      await mod.close();

      // `disconnect()` deja el cliente en `end` al cerrarse el socket (evento asíncrono). Sin el cierre,
      // ioredis sigue en `connecting`/`reconnecting` para siempre: se espera como mucho 2 s.
      if (client.status !== 'end') {
        let timer: NodeJS.Timeout | undefined;
        await Promise.race([
          new Promise((r) => client.once('end', r)),
          new Promise((r) => {
            timer = setTimeout(r, 2000);
          }),
        ]);
        clearTimeout(timer);
      }
      expect(client.status).toBe('end');
    } finally {
      // Si el cierre falta (rojo), que el rojo no deje ESTE proceso de jest colgado reconectando.
      if (client.status !== 'end') client.disconnect();
    }
  });

  it('quit que no contesta en 1 s ⇒ disconnect (el apagado no se cuelga esperando a Redis)', async () => {
    jest.useFakeTimers();
    try {
      const fake = {
        defineCommand: jest.fn(),
        quit: jest.fn(() => new Promise<never>(() => undefined)),
        disconnect: jest.fn(),
      };
      const store = new RedisCardShowCounterStore(fake as unknown as Redis);
      const done = store.onModuleDestroy();
      await jest.advanceTimersByTimeAsync(1000);
      await done;
      expect(fake.quit).toHaveBeenCalledTimes(1);
      expect(fake.disconnect).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('quit que contesta ⇒ no hace falta disconnect', async () => {
    const fake = { defineCommand: jest.fn(), quit: jest.fn(async () => 'OK'), disconnect: jest.fn() };
    await new RedisCardShowCounterStore(fake as unknown as Redis).onModuleDestroy();
    expect(fake.quit).toHaveBeenCalledTimes(1);
    expect(fake.disconnect).not.toHaveBeenCalled();
  });
});

describe('candado open-handles.teardown · liveResources', () => {
  it('un setInterval con ref CUENTA; con unref NO; stdio NO', () => {
    const before = liveResources().filter((r) => r === 'Timeout').length;
    const ref = setInterval(() => undefined, 60_000);
    const unref = setInterval(() => undefined, 60_000);
    unref.unref();
    try {
      expect(liveResources().filter((r) => r === 'Timeout').length).toBe(before + 1);
    } finally {
      clearInterval(ref);
      clearInterval(unref);
    }
    expect(liveResources().filter((r) => r === 'Timeout').length).toBe(before);
    expect(liveResources().some((r) => /stdio/i.test(r))).toBe(false);
  });

  it('TD-HND-2 · un net.Server escuchando y un socket conectado CUENTAN (con su destino); al cerrarlos desaparecen', async () => {
    const server: Server = createServer((peer) => peer.on('error', () => undefined));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;
    let client: Socket | undefined;
    try {
      expect(liveResources()).toContain(`Server :${port}`);
      client = createConnection({ host: '127.0.0.1', port });
      await new Promise<void>((r) => client!.once('connect', () => r()));
      expect(liveResources()).toContain(`Socket -> 127.0.0.1:${port}`);
    } finally {
      client?.destroy();
      await new Promise<void>((r) => server.close(() => r()));
    }
    // `destroy`/`close` sueltan el handle en el mismo tick o el siguiente: se espera a lo sumo 1 s.
    const gone = () => !liveResources().some((l) => l.endsWith(`:${port}`));
    for (let i = 0; i < 20 && !gone(); i += 1) await new Promise((r) => setTimeout(r, 50));
    expect(liveResources().filter((l) => l.endsWith(`:${port}`))).toEqual([]);
  });
});
