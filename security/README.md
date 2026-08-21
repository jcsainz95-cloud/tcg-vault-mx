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
    baseline.conf           reglas ZAP (FAIL/WARN/IGNORE) para el gate de prod
  nuclei/
    templates.txt           selección de templates de nuclei para el stack
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

**Todos exigen `TARGET_URL`.** Apunta **siempre a staging** salvo prueba puntual
autorizada contra prod (ver más abajo y el runbook en `docs/DEVOPS_NOTES.md`).

```bash
# ZAP baseline (pasivo, rápido) — se corre en cada deploy a staging
TARGET_URL=https://staging.tudominio.com ./security/scripts/dast-zap-baseline.sh

# ZAP full scan (activo, intrusivo) — cron semanal / prueba autorizada
TARGET_URL=https://staging.tudominio.com ./security/scripts/dast-zap-full.sh

# nuclei con la selección de templates del stack
TARGET_URL=https://staging.tudominio.com ./security/scripts/dast-nuclei.sh

# Herramientas dirigidas (las orquesta el pentester)
TARGET_URL=https://staging.tudominio.com ./security/scripts/dast-extra.sh nikto
TARGET_URL=https://staging.tudominio.com/api/v1/cards?q= ./security/scripts/dast-extra.sh sqlmap
TARGET_URL=https://staging.tudominio.com ./security/scripts/dast-extra.sh ffuf
```

**En CI:**
- `.github/workflows/e2e.yml` — no corre DAST, pero deja el stack en pie para las suites E2E.
- `.github/workflows/deploy.yml` — tras desplegar a staging corre **ZAP baseline + nuclei**
  y **bloquea la promoción a producción** si hay hallazgos críticos.
- `.github/workflows/security-scheduled.yml` — **cron semanal** que corre el DAST completo
  (ZAP full + nuclei) contra staging.

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

---

## Gates (resumen)

| Herramienta | Cuándo | Bloquea si |
|---|---|---|
| Semgrep | cada PR/push | findings de severidad ERROR |
| gitleaks | cada PR/push | secreto real fuera de allowlist |
| npm audit | cada PR/push | vuln **high/critical** |
| Trivy (fs + image) | cada PR/push | CVE **HIGH/CRITICAL** |
| ZAP baseline + nuclei | deploy a staging | hallazgo **crítico** → no promociona a prod |
| ZAP full + nuclei | cron semanal | reporta; alarma a seguridad |

---

## Requisitos de herramientas

En CI ya vienen provistas por las actions/imágenes oficiales. En local:

- **semgrep**: `pip install semgrep` (o imagen `returntocorp/semgrep`).
- **gitleaks**: binario de releases (o `zricethezav/gitleaks`).
- **trivy**: binario de Aqua (o `aquasec/trivy`).
- **nuclei**: binario de ProjectDiscovery (o `projectdiscovery/nuclei`).
- **ZAP / nikto / sqlmap / ffuf**: vía Docker (imágenes referenciadas en los scripts).
