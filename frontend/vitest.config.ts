import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    // Holgura por encima del `asyncUtilTimeout` (5s) de vitest.setup.ts: si una espera async
    // agota su presupuesto, el error debe ser la aserción de Testing Library (que dice QUÉ
    // elemento no apareció y pinta el DOM), no un "test timed out" opaco de vitest.
    testTimeout: 20_000,
    hookTimeout: 20_000,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // La suite unitaria corre contra los FIXTURES, y ahora lo declara. `config.useMocks` pasó a
    // ser opt-in explícito (fail-safe): antes venía encendido por defecto y un build que olvidara
    // apagarlo servía fixtures en silencio. Los tests que quieren la rama real siguen espiando
    // `apiRequest`/`config` como siempre.
    env: { NEXT_PUBLIC_USE_MOCKS: 'true' },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
