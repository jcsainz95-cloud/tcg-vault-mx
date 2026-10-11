#!/usr/bin/env bash
#
# check-vercel-deploy-branches.sh — «`main` y `production` NUNCA quedan
#                                     deshabilitadas en Vercel»          · devops
# =============================================================================
# DE DÓNDE VIENE (2026-10-05, PR #71)
# ---------------------------------------------------------------------------
# Vercel (plan gratuito) cortó: «Resource is limited - try again in 24 hours
# (more than 100, code: "api-deployments-free-per-day")». Medido con la API de
# eventos de GitHub: 104 pushes en las 24 h previas al primer corte, 101 de
# ellos a ramas `claude/*`. El *Ignored Build Step* (§40) CANCELA esos
# despliegues, pero cada uno se CREA primero (estado «Vercel is deploying your
# app» → «Canceled by Ignored Build Step») y cuenta para el cupo. Con el cupo
# agotado, una fusión a `production` TAMPOCO se publica.
#
# La palanca es `git.deploymentEnabled` (DEVOPS_NOTES §78). Y su trampa es la
# misma que la del §40, con el signo cambiado: una clave mal escrita
# (`"production": false`, `"*": false`, `deploymentEnabled: false`) NO da error
# en ningún sitio — producción deja de desplegarse y el sitio se queda
# congelado SIN QUE NADIE SE ENTERE. Este candado existe para eso.
#
# QUÉ COMPRUEBA, en cada fichero de configuración de Vercel del repo
# (`vercel.json`, `scripts/vercel.frontend-root.json` y, si existe,
# `frontend/vercel.json` — la que Vercel LEE, porque Root Directory = frontend):
#   1. Es JSON válido.
#   2. `git.deploymentEnabled`, si está, NO es `false` (eso apaga TODO).
#   3. Si es objeto: todos sus valores son booleanos; `main` y `production`
#      están EXPLÍCITAS y valen `true`.
#   4. Cada patrón que vale `false` empieza por un segmento LITERAL seguido de
#      `/` (p. ej. `claude/*`), y ese segmento no es `main` ni `production`.
#      `main` y `production` no llevan `/`, así que un patrón así no las puede
#      casar con NINGUNA semántica de glob — no dependemos de cuál use Vercel
#      (NO MEDIDO de primera mano, §78.4).
#   5. Segunda red: convierto cada patrón `false` a regex con la semántica MÁS
#      PERMISIVA posible (`*` y `**` casan también `/`, sin anclar el final) y
#      exijo que no case `main` ni `production`.
#   6. `ignoreCommand` sigue puesto (segunda capa, §40) y, ejecutado con `sh`,
#      construye `main`/`production`/variable vacía/ausente y cancela
#      `claude/loquesea` — los cinco casos del §40.3.
#   7. `vercel.json` y `scripts/vercel.frontend-root.json` son idénticos, y
#      `frontend/vercel.json` (si existe) lleva el MISMO `git` e `ignoreCommand`
#      (puede tener más claves, p. ej. redirecciones; esas no se juzgan aquí).
#
# Uso:  ./scripts/check-vercel-deploy-branches.sh [--root DIR]
# rc:   0 verde · 1 rojo · 2 no concluyente (falta node)
# Canario: ./scripts/check-vercel-deploy-branches-canary.sh [N]
# =============================================================================
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ "${1:-}" = "--root" ] && [ -n "${2:-}" ]; then ROOT_DIR="$(cd "$2" && pwd)"; fi
cd "$ROOT_DIR" || exit 2

command -v node >/dev/null 2>&1 || { echo "NO CONCLUYENTE: falta node para leer JSON." >&2; exit 2; }

ROJO=0
mal() { ROJO=1; printf '\033[1;31m  ✗ %s\033[0m\n' "$*"; }
bien() { printf '\033[1;32m  ✔ %s\033[0m\n' "$*"; }

FICHEROS=(vercel.json scripts/vercel.frontend-root.json)
[ -f frontend/vercel.json ] && FICHEROS+=(frontend/vercel.json)

for f in vercel.json scripts/vercel.frontend-root.json; do
  [ -f "$f" ] || mal "$f no existe (es una de las copias obligatorias, DEVOPS_NOTES §40.2/§78)"
done

# --- 1-5: estructura de git.deploymentEnabled (node, sin dependencias) --------
for f in "${FICHEROS[@]}"; do
  [ -f "$f" ] || continue
  printf '\n\033[1m== %s ==\033[0m\n' "$f"
  salida="$(node - "$f" <<'NODE'
const fs = require('fs');
const f = process.argv[2];
const out = [];
const bad = (m) => out.push('MAL ' + m);
const ok = (m) => out.push('OK  ' + m);
let cfg;
try { cfg = JSON.parse(fs.readFileSync(f, 'utf8')); }
catch (e) { console.log('MAL JSON inválido: ' + e.message); process.exit(0); }
const PROTEGIDAS = ['main', 'production'];
const de = cfg && cfg.git ? cfg.git.deploymentEnabled : undefined;
if (de === undefined) {
  bad('falta git.deploymentEnabled (sin él, cada push a claude/* crea un despliegue y gasta cupo)');
} else if (typeof de === 'boolean') {
  if (de === false) bad('git.deploymentEnabled = false ⇒ NINGUNA rama despliega, tampoco production');
  else bad('git.deploymentEnabled = true no filtra nada: se espera un objeto por rama');
} else if (typeof de !== 'object' || de === null || Array.isArray(de)) {
  bad('git.deploymentEnabled tiene un tipo inesperado: ' + JSON.stringify(de));
} else {
  for (const [k, v] of Object.entries(de)) {
    if (typeof v !== 'boolean') bad(`"${k}": ${JSON.stringify(v)} no es booleano`);
  }
  for (const p of PROTEGIDAS) {
    if (de[p] !== true) bad(`"${p}" debe estar EXPLÍCITA y valer true (vale ${JSON.stringify(de[p])})`);
    else ok(`"${p}": true`);
  }
  // Semántica de glob MÁS permisiva: * y ** casan cualquier cosa (también '/'),
  // ? un carácter, {a,b} alternativas; sin anclar el final.
  const permisiva = (pat) => {
    let r = '';
    for (let i = 0; i < pat.length; i++) {
      const c = pat[i];
      if (c === '*') r += '.*';
      else if (c === '?') r += '.';
      else if (c === '{') r += '(';
      else if (c === '}') r += ')';
      else if (c === ',') r += '|';
      else if (c === '[' || c === ']') r += c;
      else r += c.replace(/[.+^$()|\\/]/g, '\\$&');
    }
    try { return new RegExp('^' + r); } catch (e) { return null; }
  };
  for (const [k, v] of Object.entries(de)) {
    if (v !== false) continue;
    const m = /^([A-Za-z0-9._-]+)\//.exec(k);
    if (!m) { bad(`"${k}": false no empieza por un segmento literal + "/" (podría casar main/production)`); continue; }
    if (PROTEGIDAS.includes(m[1])) { bad(`"${k}": false cuelga de "${m[1]}/"`); continue; }
    const re = permisiva(k);
    if (!re) { bad(`"${k}" no se puede interpretar como patrón`); continue; }
    const casa = PROTEGIDAS.filter((p) => re.test(p));
    if (casa.length) { bad(`"${k}": false casaría ${casa.join(', ')} con glob permisivo`); continue; }
    ok(`"${k}": false — no puede casar main ni production`);
  }
}
if (typeof (cfg && cfg.ignoreCommand) !== 'string' || !cfg.ignoreCommand.trim()) {
  bad('falta ignoreCommand (segunda capa, DEVOPS_NOTES §40)');
}
console.log(out.join('\n'));
NODE
)"
  while IFS= read -r l; do
    [ -n "$l" ] || continue
    case "$l" in
      MAL*) mal "${l#MAL }" ;;
      OK*)  bien "${l#OK  }" ;;
    esac
  done <<<"$salida"

  # --- 6: el ignoreCommand de ESTE fichero, ejecutado de verdad ---------------
  cmd="$(node -e 'try{const c=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(typeof c.ignoreCommand==="string"?c.ignoreCommand:"")}catch(e){}' "$f")"
  if [ -n "$cmd" ]; then
    _caso() { # $1 descripción · $2 esperado · $3.. env
      local desc="$1" esp="$2"; shift 2
      env "$@" sh -c "$cmd" >/dev/null 2>&1; local got=$?
      if [ "$got" = "$esp" ]; then bien "ignoreCommand: $desc → $got"; else mal "ignoreCommand: $desc → $got (esperado $esp; 0 = CANCELA, 1 = CONSTRUYE)"; fi
    }
    _caso 'main construye'                1 VERCEL_GIT_COMMIT_REF=main
    _caso 'production construye'          1 VERCEL_GIT_COMMIT_REF=production
    _caso 'claude/loquesea cancela'       0 VERCEL_GIT_COMMIT_REF=claude/loquesea
    _caso 'variable vacía construye'      1 VERCEL_GIT_COMMIT_REF=
    _caso 'variable ausente construye'    1 -u VERCEL_GIT_COMMIT_REF
  fi
done

# --- 7: las copias no divergen --------------------------------------------------
printf '\n\033[1m== paridad entre copias ==\033[0m\n'
paridad="$(node - "${FICHEROS[@]}" <<'NODE'
const fs = require('fs');
const leer = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } };
const [raiz, copia, front] = process.argv.slice(2);
const a = leer(raiz), b = leer(copia);
const prof = (o) => JSON.stringify(o, (k, v) => (v && typeof v === 'object' && !Array.isArray(v))
  ? Object.fromEntries(Object.keys(v).sort().map((x) => [x, v[x]])) : v);
if (!a || !b) { console.log('MAL no se pudo leer alguna copia obligatoria'); process.exit(0); }
console.log(prof(a) === prof(b) ? 'OK  vercel.json == scripts/vercel.frontend-root.json'
  : 'MAL vercel.json y scripts/vercel.frontend-root.json DIVERGEN (son la misma config; §40.6)');
if (front) {
  const c = leer(front);
  if (!c) console.log('MAL frontend/vercel.json no se pudo leer');
  else {
    console.log(prof(c.git) === prof(a.git) ? 'OK  frontend/vercel.json lleva el mismo git.deploymentEnabled'
      : 'MAL frontend/vercel.json: su "git" difiere del de vercel.json');
    console.log(c.ignoreCommand === a.ignoreCommand ? 'OK  frontend/vercel.json lleva el mismo ignoreCommand'
      : 'MAL frontend/vercel.json: su ignoreCommand difiere del de vercel.json');
  }
}
NODE
)"
while IFS= read -r l; do
  [ -n "$l" ] || continue
  case "$l" in MAL*) mal "${l#MAL }" ;; OK*) bien "${l#OK  }" ;; esac
done <<<"$paridad"

echo
if [ "$ROJO" -eq 0 ]; then
  echo "VERDE: main y production siguen desplegando; claude/* no crea despliegues (si Vercel lee este fichero, §78)."
  exit 0
fi
echo "ROJO: NO publiques esta configuración de Vercel. Ver docs/DEVOPS_NOTES.md §78."
exit 1
