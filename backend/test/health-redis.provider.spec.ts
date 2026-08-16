import { ConfigService } from '@nestjs/config';
import {
  healthRedisProvider,
  HealthRedisClientProvider,
} from '../src/modules/health/health-redis.provider';
import { HEALTH_REDIS_CLIENT } from '../src/modules/health/health.service';

// Mock de ioredis: evitamos abrir sockets reales en tests unitarios.
const ping = jest.fn().mockResolvedValue('PONG');
const quit = jest.fn().mockResolvedValue('OK');
const disconnect = jest.fn();
const on = jest.fn();
const ctor = jest.fn();

jest.mock('ioredis', () => {
  return {
    __esModule: true,
    default: class {
      constructor(...args: unknown[]) {
        ctor(...args);
      }
      ping = ping;
      quit = quit;
      disconnect = disconnect;
      on = on;
    },
  };
});

describe('healthRedisProvider (token HEALTH_REDIS_CLIENT)', () => {
  const factory = healthRedisProvider as {
    provide: unknown;
    inject: unknown[];
    useFactory: (config: ConfigService) => unknown;
  };

  // Aislamiento de entorno: ConfigService.get('REDIS_URL') cae a process.env,
  // que en CI SÍ define REDIS_URL. Lo removemos para no filtrar esa variable a
  // los casos que afirman comportamiento "sin REDIS_URL"; los casos "con REDIS_URL"
  // construyen su propio ConfigService({ REDIS_URL }) y no dependen de process.env.
  let prevRedisUrl: string | undefined;
  beforeEach(() => {
    jest.clearAllMocks();
    prevRedisUrl = process.env.REDIS_URL;
    delete process.env.REDIS_URL;
  });
  afterEach(() => {
    if (prevRedisUrl !== undefined) process.env.REDIS_URL = prevRedisUrl;
    else delete process.env.REDIS_URL;
  });

  it('expone el token HEALTH_REDIS_CLIENT e inyecta ConfigService', () => {
    expect(factory.provide).toBe(HEALTH_REDIS_CLIENT);
    expect(factory.inject).toEqual([ConfigService]);
  });

  it('sin REDIS_URL: resuelve a null (health → skipped) y no crea cliente', () => {
    const config = new ConfigService({}); // sin REDIS_URL
    const client = factory.useFactory(config);
    expect(client).toBeNull();
    expect(ctor).not.toHaveBeenCalled();
  });

  it('con REDIS_URL: crea un cliente IORedis liviano con ping()', async () => {
    const config = new ConfigService({ REDIS_URL: 'redis://localhost:6379' });
    const client = factory.useFactory(config) as HealthRedisClientProvider;

    expect(client).toBeInstanceOf(HealthRedisClientProvider);
    expect(ctor).toHaveBeenCalledWith('redis://localhost:6379', {
      maxRetriesPerRequest: null,
      lazyConnect: true,
    });
    // Registra un handler de 'error' para no tumbar el proceso si Redis cae.
    expect(on).toHaveBeenCalledWith('error', expect.any(Function));

    await expect(client.ping()).resolves.toBe('PONG');
    expect(ping).toHaveBeenCalledTimes(1);
  });

  it('onModuleDestroy cierra la conexión con quit()', async () => {
    const config = new ConfigService({ REDIS_URL: 'redis://localhost:6379' });
    const client = factory.useFactory(config) as HealthRedisClientProvider;

    await client.onModuleDestroy();
    expect(quit).toHaveBeenCalledTimes(1);
  });

  it('onModuleDestroy hace fallback a disconnect() si quit() falla', async () => {
    quit.mockRejectedValueOnce(new Error('not connected'));
    const config = new ConfigService({ REDIS_URL: 'redis://localhost:6379' });
    const client = factory.useFactory(config) as HealthRedisClientProvider;

    await expect(client.onModuleDestroy()).resolves.toBeUndefined();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
