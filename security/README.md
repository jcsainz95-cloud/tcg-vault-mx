# security/ — Tooling de seguridad (SAST + DAST)  ·  Propiedad: devops

Este directorio contiene la **configuración e infraestructura** de las herramientas
de seguridad del proyecto. Es *config/infra*, **no** el playbook de ataque:

- La **metodología ofensiva** (qué se ataca, cómo, con qué payloads) vive en
  `docs/PENTEST_NOTES.md` (rol **pentester**).
- El **veredicto de seguridad** (qué se acepta, qué bloquea) vive en
  `docs/SECURITY_NOTES.md` (rol **seguridad**).
- El **runbook** (cómo se levanta staging, cómo corren los gates, procedimiento
  de prueba puntual autorizada contra prod) vive en `docs/DEVOPS_NOTES.md`.

Todo es **automatizable** y está cableado en CI (ver `.github/workflows/`).

---

## Estructura

```
security/
  README.md                 este archivo
  semgrep.yml               reglas SAST locales (money-out, webhook, XSS, SQLi, logs)
  gitleaks.toml             detección de secretos + allowlist de placeholders
  trivy.yaml                política de escaneo de deps/imágenes (HIGH/CRITICAL)
  .trivyignore              excepciones JUSTIFICADAS por CVE ID (hoy: NINGUNA activa — ver DEVOPS_NOTES §22.3)
  zap/
    baseline.conf           reglas ZAP (FAIL/WARN/IGNORE): ÚNICA fuente de política
  nuclei/
    templates.txt           selección de templates de nuclei para el stack
    ignore.txt              template-ids silenciados (con motivo escrito al lado)
  dast-selftest/
    canary.py               BLANCO deliberadamente vulnerable (NO es la app)
    www/                    ficheros que sirve el canario
  scripts/
    sast-semgrep.sh         Semgrep (registry + reglas locales)
    sast-gitleaks.sh        gitleaks (árbol e historial)
    audit-npm.sh            npm audit backend+frontend (gate high/critical)
    trivy-fs.sh             Trivy filesystem (deps)
    trivy-image.sh          Trivy sobre imágenes Docker construidas
    dast-zap-baseline.sh    ZAP baseline (pasivo) — gate de promoción a prod
    dast-zap-full.sh        ZAP full scan (activo) — cron / prueba autorizada
    dast-nuclei.sh          nuclei con la selección de templates
    dast-extra.sh           wrappers nikto / sqlmap / ffuf (dirigidos por pentester)
    dast-ephemeral.sh       ⭐ DAST contra un stack EFÍMERO levantado en el propio CI
    dast-selftest.sh        ⭐ ¿el candado sabe ponerse ROJO? (escanea el canario)
    dast-gate.py            ⭐ EL CANDADO: informes -> veredicto, con baseline.conf
  reports/                  salida de los escaneos (git-ignorada)
```

---

## SAST — análisis estático (corre en cada PR/push)

Todos son **no destructivos** y corren sin infra levantada.

```bash
# Semgrep: reglas OWASP + NestJS/React + reglas locales del proyecto
./security/scripts/sast-semgrep.sh

# gitleaks: ningún secreto real comiteado (usa la allowlist de placeholders)
./security/scripts/sast-gitleaks.sh
GITLEAKS_MODE=git ./security/scripts/sast-gitleaks.sh   # + historial

# npm audit en backend y frontend (falla en high/critical)
./security/scripts/audit-npm.sh

# Trivy sobre las dependencias del repo (falla en HIGH/CRITICAL)
./security/scripts/trivy-fs.sh

# Trivy sobre las imágenes Docker (requiere daemon Docker)
./security/scripts/trivy-image.sh
```

**En CI:** `.github/workflows/security-sast.yml` corre los cinco en cada PR/push
y **bloquea** el merge si hay hallazgos high/critical.

---

## DAST — análisis dinámico (contra una URL en vivo)

### ⭐ El barrido que SÍ corre: stack efímero de CI

> **P-77 (2026-09-10).** Hasta esta fecha el DAST de este repo **nunca escaneó nada**: apuntaba a
> `STAGING_BASE_URL`, un secret que nunca existió porque el dueño **nunca tuvo staging, solo
> producción**. El job detectaba la ausencia, imprimía «modo plantilla (no-op)» y salía en **verde**.
> `CLAUDE.md` autoriza como blanco «staging (o local)»: ahora el blanco se levanta en el propio runner.

```bash
./security/scripts/dast-ephemeral.sh up      # stack + salud + procedencia + seed + paridad del dial
./security/scripts/dast-ephemeral.sh scan    # ZAP (vitrina, araña AJAX) + nuclei (vitrina + API)
./security/scripts/dast-ephemeral.sh gate    # el candado: exit 0 verde / 1 ROJO
./security/scripts/dast-ephemeral.sh down    # apaga y borra volúmenes
```

**Cadencia:** semanal (lun 06:00 UTC) + `workflow_call` antes de publicar + manual. **No por push**:
el escaneo activo tarda demasiado para castigar el día a día.

**⚠️ Alcance declarado:** un stack efímero con datos sintéticos **no es producción** (otra config,
otros datos, otra superficie de red, sin CDN/WAF/TLS reales, sin enumeración de la API). **Nadie puede
citar este verde como "producción escaneada".** El párrafo completo: `docs/DEVOPS_NOTES.md` §44.4.

### ⭐ El candado se prueba a sí mismo

Un candado que no se puede poner rojo no es un candado. `security/dast-selftest/canary.py` es un blanco
con vulnerabilidades **plantadas**; se escanea con el mismo ZAP, la misma política y el mismo candado, y
se **exige** que el gate falle:

```bash
./security/scripts/dast-selftest.sh          # gate ROJO sobre el canario = OK
```

En CI, el job `dast` declara `needs: [selftest]`: si el candado no sabe cerrarse, **no se emite verde**.
Y `scripts/check-dast-gate-live.sh` (job `dast-gate-live` de `ci.yml`) comprueba lo mismo en cada push,
sin Docker, pasándole al candado un informe con un SQLi de manual y otro inexistente.

### El candado, sobre informes ya guardados

La política vive en **un solo sitio** (`security/zap/baseline.conf`, el mismo archivo que ZAP consume
con `-c`). `dast-gate.py` la lee y decide. `FAIL` bloquea; `WARN` se agrega; `IGNORE` no sale en el
informe pero **se cuenta al pie** — «silenciado» nunca es «invisible». Una regla no listada es `WARN`,
nunca `FAIL`: una firma nueva de ZAP no puede volver rojo un gate por sorpresa. **Sin informe = ROJO**
(un escáner que no corrió no es un verde).

```bash
python3 security/scripts/dast-gate.py --zap-json security/reports/zap-*.json
```

### Herramientas dirigidas y prueba puntual contra prod

**Todas exigen `TARGET_URL`.** Contra producción **no hay ni habrá cron**: solo el procedimiento de
prueba puntual autorizada de `docs/DEVOPS_NOTES.md` §14.3.

```bash
TARGET_URL=http://localhost:3010 ./security/scripts/dast-zap-full.sh
TARGET_URL=http://localhost:3010 ./security/scripts/dast-nuclei.sh
TARGET_URL=http://localhost:3010 ./security/scripts/dast-extra.sh nikto
TARGET_URL=http://localhost:3011/api/v1/cards?q= ./security/scripts/dast-extra.sh sqlmap
```

**En CI:**
- `.github/workflows/security-dast.yml` — ⭐ **el barrido real**: semanal, stack efímero, con autoprueba.
- `.github/workflows/e2e.yml` / `e2e-real.yml` — no corren DAST; levantan el stack para las suites E2E.
- `.github/workflows/deploy.yml` — su job `dast-staging` está **INERTE** (pipeline apagado + entorno
  inexistente). Marcado como tal; ver `docs/DEVOPS_NOTES.md` §44.6.

### Guardia anti-producción

Los scripts DAST detectan si `TARGET_URL` apunta a producción y **abortan con
exit 2** salvo que exportes `ALLOW_PROD_DAST=1`, que solo debe usarse **dentro
de la ventana de una prueba puntual autorizada por escrito** (procedimiento
completo en `docs/DEVOPS_NOTES.md` › Runbook de seguridad).

La guardia vive en **`security/scripts/_guard.sh`** (predicado único,
`dast_prod_guard`, sourceado por los 4 scripts `dast-*.sh`; el source es
obligatorio — si falta el archivo, el script aborta). Decide por **HOST**, no
por substring de la URL (P-21 cierre: antes `https://tcghunt.mx/staging-x`
bypaseaba la guardia por el "staging" del path; ya no):

- **Producción** = el host es (o es subdominio de) `tcgvaultmx.com` (dominio
  viejo — sigue contando como prod mientras viva el redirect 301), `tcghunt.mx`
  (dominio nuevo) o el placeholder histórico `tudominio.com`.
- **Exención de staging** = el **host** empieza con `staging.` (p. ej.
  `staging.tcghunt.mx`). Un "staging" en el path, la query o el userinfo
  NO exime.
- Hosts ajenos a esos dominios (`localhost`, hosts de compose como `backend`,
  previews) no disparan la guardia.

> El blanco del barrido semanal es `http://localhost:3010` / `:3011` — un host
> que **no** dispara la guardia, por diseño: es el stack efímero del propio
> runner, no un entorno remoto. Ver `docs/DEVOPS_NOTES.md` §44.

---

## Gates (resumen)

| Herramienta | Cuándo | Bloquea si |
|---|---|---|
| Semgrep | cada PR/push | findings de severidad ERROR |
| gitleaks | cada PR/push | secreto real fuera de allowlist |
| npm audit | cada PR/push | vuln **high/critical** |
| Trivy (fs + image) | cada PR/push | CVE **HIGH/CRITICAL** |
| **autoprueba del candado** | antes de cada barrido DAST + cada push (estática) | el canario vulnerable **pasa en verde** ⇒ el candado está inerte |
| **ZAP full + nuclei (stack efímero)** | **cron semanal (lun 06:00 UTC) + antes de publicar** | hallazgo de una regla `FAIL` de `baseline.conf`, o **ausencia de informe** |
| ZAP baseline + nuclei contra staging | ⛔ **INERTE** — no hay staging desplegado | — (ver §44.6) |

---

## Requisitos de herramientas

En CI ya vienen provistas por las actions/imágenes oficiales. En local:

- **semgrep**: `pip install semgrep` (o imagen `returntocorp/semgrep`).
- **gitleaks**: binario de releases (o `zricethezav/gitleaks`).
- **trivy**: binario de Aqua (o `aquasec/trivy`).
- **nuclei**: binario de ProjectDiscovery (o `projectdiscovery/nuclei`).
- **ZAP / nikto / sqlmap / ffuf**: vía Docker (imágenes referenciadas en los scripts).
