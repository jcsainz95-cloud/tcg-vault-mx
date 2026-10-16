import { parseFirstUtm, parseFutm } from './first-utm';

/**
 * §MKT.C / ARCHITECTURE §13.1 (B1, PV-M2) — `parseFirstUtm`: helper PURO de primer-toque.
 *
 * Regla: solo `utm_source|utm_medium|utm_campaign|utm_content`; cada valor se normaliza a MINÚSCULAS y
 * se acepta SOLO si cumple `^[a-z0-9._-]{1,64}$`; si no, ESE valor se descarta. Toda otra clave se ignora.
 *
 * ⚠️ OLA 1: el helper EXISTE y está probado, pero ⛔ NO se engancha a la creación de pedido/solicitud
 * (requiere el consentimiento de Fase 2). Las columnas `firstUtm*` quedan NULL hasta Fase 2.
 */
describe('parseFirstUtm (§MKT.C / §13.1 PV-M2)', () => {
  it('acepta los cuatro utm válidos y los mapea a source/medium/campaign/content', () => {
    expect(
      parseFirstUtm({
        utm_source: 'instagram',
        utm_medium: 'bio',
        utm_campaign: 'card-show_2026',
        utm_content: 'story.1',
      }),
    ).toEqual({ source: 'instagram', medium: 'bio', campaign: 'card-show_2026', content: 'story.1' });
  });

  it('normaliza a minúsculas un valor válido (CPC ⇒ cpc)', () => {
    expect(parseFirstUtm({ utm_medium: 'CPC' })).toEqual({ medium: 'cpc' });
  });

  it('descarta utm_content=juan@correo.com (el `@` no pasa la regex) — nunca se guarda PII', () => {
    expect(parseFirstUtm({ utm_content: 'juan@correo.com' })).toEqual({});
  });

  it('descarta un valor con <script> (los `<>` no pasan la regex)', () => {
    expect(parseFirstUtm({ utm_campaign: '<script>' })).toEqual({});
  });

  it('ignora una clave ajena (session_id, fbclid, token) — no viaja al resultado', () => {
    expect(
      parseFirstUtm({ session_id: 'cs_live_abc', fbclid: 'xyz', token: 'secreto', utm_source: 'google' }),
    ).toEqual({ source: 'google' });
  });

  it('descarta SOLO el valor inválido y conserva el válido en la misma entrada', () => {
    expect(parseFirstUtm({ utm_source: 'tiktok', utm_content: 'con espacio' })).toEqual({ source: 'tiktok' });
  });

  it('descarta un valor de más de 64 caracteres y acepta uno de exactamente 64', () => {
    const justUnder = 'a'.repeat(64);
    const over = 'a'.repeat(65);
    expect(parseFirstUtm({ utm_source: justUnder })).toEqual({ source: justUnder });
    expect(parseFirstUtm({ utm_campaign: over })).toEqual({});
  });

  it('descarta valores vacíos o solo espacios (la regex exige ≥1 carácter del alfabeto)', () => {
    expect(parseFirstUtm({ utm_source: '', utm_medium: '   ' })).toEqual({});
  });

  it('descarta valores no-string (arrays de query duplicada, números)', () => {
    expect(
      parseFirstUtm({ utm_source: ['a', 'b'] as unknown as string, utm_medium: 42 as unknown as string }),
    ).toEqual({});
  });

  it('devuelve {} ante entrada vacía, null o undefined', () => {
    expect(parseFirstUtm({})).toEqual({});
    expect(parseFirstUtm(null)).toEqual({});
    expect(parseFirstUtm(undefined)).toEqual({});
  });

  it('acepta tldos de acentos NO: `ñ`/`á` no están en [a-z0-9._-] ⇒ se descartan', () => {
    expect(parseFirstUtm({ utm_campaign: 'otoño', utm_source: 'canción' })).toEqual({});
  });

  it('parseFutm es un alias de parseFirstUtm (nombre del encargo = nombre del contrato)', () => {
    expect(parseFutm).toBe(parseFirstUtm);
    expect(parseFutm({ utm_source: 'x' })).toEqual({ source: 'x' });
  });
});
