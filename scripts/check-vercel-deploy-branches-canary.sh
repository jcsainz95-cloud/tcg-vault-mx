#!/usr/bin/env bash
#
# check-vercel-deploy-branches-canary.sh — «¿el candado de ramas de Vercel
#                                            muerde?»                    · devops
# =============================================================================
# El candado `check-vercel-deploy-branches.sh` protege contra el fallo
# silencioso más caro del proyecto: producción congelada sin que nadie se
# entere (DEVOPS_NOTES §40 y §78). Este canario reproduce, sobre una COPIA
# (O-8/O-9: el árbol vivo no se toca), cada forma conocida de romperlo y exige
# ROJO; y dos controles inversos que exigen VERDE. Cada caso se corre N veces
# y se reporta la proporción (O-3), aunque el candado es determinista.
#
#   m1  "production": false
#   m2  "main": false
#   m3  git.deploymentEnabled = false        (apaga TODAS las ramas)
#   m4  "*": false                           (glob que casa todo)
#   m5  "**": false
#   m6  "prod*": false                       (sin prefijo literal + "/")
#   m7  "production" omitida                 (exigimos que sea EXPLÍCITA)
#   m8  sin ignoreCommand                    (se pierde la segunda capa)
#   m9  ignoreCommand con el SIGNO al revés  (main cancela — la trampa del §40.1)
#   m10 frontend/vercel.json con "production": false (la copia que Vercel LEE)
#   m11 las dos copias del repo divergen
#   m12 JSON inválido
#   c1  (control) la configuración tal cual            ⇒ VERDE
#   c2  (control) frontend/vercel.json = copia + redirects ⇒ VERDE
#
# Uso:  ./scripts/check-vercel-deploy-branches-canary.sh [N]
# =============================================================================
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
N="${1:-3}"
FALLOS=0; PASADAS=0
ok()  { PASADAS=$((PASADAS+1)); printf '\033[1;32m  ✔ %s\033[0m\n' "$*"; }
mal() { FALLOS=$((FALLOS+1));  printf '\033[1;31m  ✗ %s\033[0m\n' "$*"; }

command -v node >/dev/null 2>&1 || { echo "NO CONCLUYENTE: falta node." >&2; exit 2; }

BASE="$(mktemp -d -t vercel-branches-canary-XXXXXX)"; trap 'rm -rf "$BASE"' EXIT

preparar() { # $1 = nombre del caso ⇒ deja la copia en $D
  D="$BASE/$1"; rm -rf "$D"; mkdir -p "$D/scripts" "$D/frontend"
  cp "$ROOT_DIR/scripts/check-vercel-deploy-branches.sh" "$D/scripts/" || return 1
  cp "$ROOT_DIR/vercel.json" "$D/vercel.json" || return 1
  cp "$ROOT_DIR/scripts/vercel.frontend-root.json" "$D/scripts/vercel.frontend-root.json" || return 1
  # frontend/vercel.json: se copia SOLO si existe en el árbol real (hoy no).
  [ -f "$ROOT_DIR/frontend/vercel.json" ] && cp "$ROOT_DIR/frontend/vercel.json" "$D/frontend/vercel.json"
  chmod +x "$D/scripts/check-vercel-deploy-branches.sh"
}

# Aplica una transformación JS a un JSON: $1 fichero · $2 cuerpo (recibe `c`)
mutar() {
  node -e '
    const fs=require("fs"); const f=process.argv[1];
    const c=JSON.parse(fs.readFileSync(f,"utf8"));
    (new Function("c", process.argv[2]))(c);
    fs.writeFileSync(f, JSON.stringify(c, null, 2) + "\n");
  ' "$1" "$2"
}
# Muta las DOS copias obligatorias igual (para que el rojo no venga de la paridad).
mutar_ambas() { mutar "$D/vercel.json" "$1" && mutar "$D/scripts/vercel.frontend-root.json" "$1"; }

correr() { "$D/scripts/check-vercel-deploy-branches.sh" >/dev/null 2>&1; echo $?; }

caso() { # $1 id · $2 descripción · $3 esperado(0 verde / 1 rojo) · $4 función que muta
  local id="$1" desc="$2" esp="$3" fn="$4" bien=0 i rc
  for i in $(seq 1 "$N"); do
    preparar "$id" || { mal "$id: no pude preparar la copia"; return; }
    "$fn"
    rc="$(correr)"
    [ "$rc" = "$esp" ] && bien=$((bien+1))
  done
  if [ "$bien" -eq "$N" ]; then ok "$id $desc → $([ "$esp" = 0 ] && echo VERDE || echo ROJO) $bien/$N"
  else mal "$id $desc → esperado rc=$esp, acertó $bien/$N"; fi
}

m1()  { mutar_ambas 'c.git.deploymentEnabled.production=false'; }
m2()  { mutar_ambas 'c.git.deploymentEnabled.main=false'; }
m3()  { mutar_ambas 'c.git.deploymentEnabled=false'; }
m4()  { mutar_ambas 'c.git.deploymentEnabled["*"]=false'; }
m5()  { mutar_ambas 'c.git.deploymentEnabled["**"]=false'; }
m6()  { mutar_ambas 'c.git.deploymentEnabled["prod*"]=false'; }
m7()  { mutar_ambas 'delete c.git.deploymentEnabled.production'; }
m8()  { mutar_ambas 'delete c.ignoreCommand'; }
m9()  { mutar_ambas 'c.ignoreCommand=c.ignoreCommand.replace("exit 1 ;; *) exit 0","exit 0 ;; *) exit 1")'; }
m10() { cp "$D/vercel.json" "$D/frontend/vercel.json"; mutar "$D/frontend/vercel.json" 'c.git.deploymentEnabled.production=false'; }
m11() { mutar "$D/scripts/vercel.frontend-root.json" 'c.git.deploymentEnabled["fix/*"]=false'; }
m12() { printf '{ "git": { "deploymentEnabled": { "main": true, \n' >"$D/vercel.json"; }
c1()  { :; }
c2()  { cp "$D/vercel.json" "$D/frontend/vercel.json"; mutar "$D/frontend/vercel.json" 'c.redirects=[{source:"/a",destination:"/b",permanent:true}]'; }

echo "Canario de check-vercel-deploy-branches.sh (N=$N por caso, sobre copias en $BASE)"
caso m1  '"production": false'                      1 m1
caso m2  '"main": false'                            1 m2
caso m3  'deploymentEnabled = false'                1 m3
caso m4  '"*": false'                               1 m4
caso m5  '"**": false'                              1 m5
caso m6  '"prod*": false'                           1 m6
caso m7  '"production" omitida'                     1 m7
caso m8  'sin ignoreCommand'                        1 m8
caso m9  'ignoreCommand con el signo al revés'      1 m9
caso m10 'frontend/vercel.json con production=false' 1 m10
caso m11 'copias divergentes'                       1 m11
caso m12 'JSON inválido'                            1 m12
caso c1  '(control) config tal cual'                0 c1
caso c2  '(control) frontend/vercel.json + redirects' 0 c2

echo
echo "Resultado: $PASADAS casos correctos, $FALLOS incorrectos."
[ "$FALLOS" -eq 0 ] && { echo "CANARIO VERDE: el candado muerde en todos los casos."; exit 0; }
echo "CANARIO ROJO: el candado NO muerde en algún caso. No te fíes de su verde."
exit 1
