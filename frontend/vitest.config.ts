import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
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
