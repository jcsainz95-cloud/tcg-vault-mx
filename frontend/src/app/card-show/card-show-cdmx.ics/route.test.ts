/**
 * El `.ics` del Card Show que enlaza el correo de bienvenida (hoy 404) debe servir un VCALENDAR válido
 * con los dos días del evento en America/Mexico_City. Verifica estructura, cabeceras y coherencia de fechas.
 */
import { describe, expect, it } from 'vitest';
import { GET } from './route';
import { buildCardShowIcs } from './ics-builder';

describe('GET /card-show/card-show-cdmx.ics', () => {
  it('responde 200 con cabeceras de calendario', async () => {
    const res = GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/calendar; charset=utf-8');
    expect(res.headers.get('Content-Disposition')).toContain('card-show-cdmx.ics');
    expect(res.headers.get('Cache-Control')).toMatch(/max-age/);
  });

  it('el cuerpo es un VCALENDAR bien formado con CRLF', async () => {
    const body = await GET().text();
    expect(body.startsWith('BEGIN:VCALENDAR')).toBe(true);
    expect(body.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
    expect(body).toContain('\r\n');
    expect(body).toContain('VERSION:2.0');
    expect(body).toContain('BEGIN:VTIMEZONE');
    expect(body).toContain('TZID:America/Mexico_City');
  });

  it('tiene exactamente DOS VEVENT, balanceados', () => {
    const body = buildCardShowIcs();
    expect((body.match(/BEGIN:VEVENT/g) ?? []).length).toBe(2);
    expect((body.match(/END:VEVENT/g) ?? []).length).toBe(2);
  });

  it('el sábado 5 dic 2026 va 11:00–19:00 en hora de CDMX', () => {
    const body = buildCardShowIcs();
    expect(body).toContain('DTSTART;TZID=America/Mexico_City:20261205T110000');
    expect(body).toContain('DTEND;TZID=America/Mexico_City:20261205T190000');
  });

  it('el domingo 6 dic 2026 va 11:00–18:00 en hora de CDMX', () => {
    const body = buildCardShowIcs();
    expect(body).toContain('DTSTART;TZID=America/Mexico_City:20261206T110000');
    expect(body).toContain('DTEND;TZID=America/Mexico_City:20261206T180000');
  });

  it('cada DTEND es posterior a su DTSTART (fechas coherentes)', () => {
    const body = buildCardShowIcs();
    const starts = [...body.matchAll(/DTSTART;TZID=America\/Mexico_City:(\d{8})T(\d{6})/g)];
    const ends = [...body.matchAll(/DTEND;TZID=America\/Mexico_City:(\d{8})T(\d{6})/g)];
    expect(starts).toHaveLength(2);
    expect(ends).toHaveLength(2);
    for (let i = 0; i < starts.length; i++) {
      const start = Number(starts[i][1] + starts[i][2]);
      const end = Number(ends[i][1] + ends[i][2]);
      expect(end).toBeGreaterThan(start);
    }
  });

  it('lleva SUMMARY, LOCATION y DESCRIPTION del contenido, con comas escapadas', () => {
    const body = buildCardShowIcs();
    expect(body).toContain('SUMMARY:Card Show CDMX');
    // ⭐ R5b (JC 2026-10-17): la dirección exacta YA es pública (DATOS DEL EVENTO); el `.ics` lleva la
    // calle completa. La coma se escapa (`\,`) y la línea larga se pliega (RFC 5545), por eso se
    // comprueba un prefijo contiguo anterior al primer pliegue.
    expect(body).toContain('LOCATION:José del Castillo 3\\, esq. Av. Revolución');
    expect(body).toContain('DESCRIPTION:Entrada libre. TCG HUNT × Jakomi');
  });

  it('UIDs estables por día', () => {
    const body = buildCardShowIcs();
    expect(body).toContain('UID:card-show-cdmx-2026-sat@tcghunt.mx');
    expect(body).toContain('UID:card-show-cdmx-2026-sun@tcghunt.mx');
  });

  it('no filtra secretos de patrocinador (solo TCG HUNT / Jakomi)', () => {
    const body = buildCardShowIcs();
    expect(body.toLowerCase()).not.toContain('presented by');
  });
});
