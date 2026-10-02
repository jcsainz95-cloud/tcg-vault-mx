#!/usr/bin/env python3
# =============================================================================
# dast-gate.py — EL CANDADO del DAST: lee los informes y decide rojo/verde.
# Propiedad: devops.
# =============================================================================
# POR QUÉ ES UN SCRIPT Y NO UN `run:` DE YAML
# ---------------------------------------------------------------------------
# Un `run:` incrustado en un workflow no se puede ejecutar a mano, y un detector
# que nadie puede probar es exactamente el tipo de detector que se rompe en
# silencio (es la misma lección de scripts/stripe-test-key-preflight.sh). Este
# archivo se corre en local contra informes guardados:
#
#   python3 security/scripts/dast-gate.py \
#       --zap-json security/reports/zap.json \
#       --nuclei-jsonl security/reports/nuclei.jsonl \
#       --summary /tmp/resumen.md
#   echo $?     # 0 verde · 1 ROJO
#
# QUÉ DECIDE, Y CON QUÉ FUENTE DE VERDAD
# ---------------------------------------------------------------------------
# La política vive en UN solo sitio, `security/zap/baseline.conf`, el mismo
# archivo que ZAP consume con `-c`. Aquí NO se duplica ninguna decisión: se
# lee ese archivo y se aplica.
#
#   FAIL   -> bloquea (rojo). Sale en el informe con URL de ejemplo.
#   WARN   -> se reporta agregado, no bloquea.
#   IGNORE -> NO sale en el informe. Se cuenta en una sola línea al pie, con
#             el número de reglas silenciadas, para que "silenciado" nunca sea
#             lo mismo que "invisible".
#   (regla no listada) -> WARN. Nunca FAIL: una firma nueva de ZAP no puede
#             volver rojo un gate por sorpresa; se ve en el informe y se
#             clasifica a mano en baseline.conf.
#
# EL RUIDO ES EL COSTE REAL. Un informe exhaustivo que nadie lee se ignora en
# un mes y entonces tenemos un verde que no protege. Por eso el resumen es
# corto por diseño: lo bloqueante arriba con evidencia, lo demás agregado a
# una línea por regla, y lo silenciado contado pero no desplegado.
#
# MODO `--expect-red`: invierte el veredicto. Lo usa el job de autoprueba
# contra el canario vulnerable (security/dast-selftest/canary.py): ahí un
# gate VERDE es el fallo, porque significa que el candado no puede cerrarse.
#
# DOS HECHOS, DOS CANALES (techlead F1-1, 2026-09-11)
# ---------------------------------------------------------------------------
# Antes, `--report-only` forzaba exit 0 y el workflow derivaba «blocking» del
# outcome del paso ⇒ con report_only el gate de promoción de deploy.yml estaba
# abierto POR CONSTRUCCIÓN (blocking siempre 'false'). Ahora se separan:
#   · el HECHO «hay bloqueantes sí/no» se escribe SIEMPRE, pase lo que pase con
#     el exit code: en `$GITHUB_OUTPUT` como `blocking=true|false` (si existe) y
#     en el fichero de `--blocking-file` (si se pide);
#   · `--report-only` solo decide el EXIT CODE (0 aunque haya bloqueantes).
# Quien consuma el veredicto lee el hecho, no el color del paso. Lo comprueba
# scripts/check-dast-gate-live.sh (5-bis) en cada push.
#
# ALCANCE POR ORIGEN (`--scope-origin`, DEVOPS_NOTES §75, 2026-10-02)
# ---------------------------------------------------------------------------
# El primer `dast-release` bloqueante (run 36969283231, production 8fd637fb)
# salió ROJO por un 10020 cuya ÚNICA instancia era
# `https://js.stripe.com/v3/m-outer-….html`: el iframe de Stripe que la araña
# AJAX carga desde la vitrina. Esa cabecera la sirve Stripe, no nosotros: no
# hay nada que arreglar en nuestro código y no es un hallazgo sobre lo que
# auditamos.
#
# Por qué el filtro va AQUÍ y es una lista de NUESTROS orígenes (permitidos),
# no una lista de terceros (excluidos) ni una exclusión dentro de ZAP:
#   · Se decide POR INSTANCIA, no por alerta: un 10020 con una instancia en
#     js.stripe.com y otra en localhost:3010 sigue siendo FAIL (cuenta la
#     nuestra). Lo de fuera no puede tapar lo de dentro.
#   · Lo que NO es nuestro no desaparece: sale en el informe como «fuera de
#     alcance», con regla, acción y host. Silenciado nunca es invisible.
#   · Si con `--scope-origin` NO queda ni una instancia dentro de nuestros
#     orígenes, es ROJO («el escáner no vio nuestro origen»): un origen mal
#     declarado no puede convertir el barrido en un verde vacío.
#   · Sin `--scope-origin` no se filtra nada (comportamiento anterior; lo usa
#     la autoprueba del canario).
#   · Una exclusión dentro de ZAP no deja rastro en el informe y no se puede
#     probar sin levantar ZAP; esto se prueba con fixtures en
#     scripts/check-dast-gate-live.sh en cada push.
# =============================================================================
import argparse
import json
import os
import sys
from collections import OrderedDict
from urllib.parse import urlsplit

RISK = {"0": "Info", "1": "Bajo", "2": "Medio", "3": "Alto"}


def load_policy(path):
    """Lee baseline.conf (mismo formato que consume ZAP con -c)."""
    pol = {}
    if not os.path.exists(path):
        return pol
    with open(path, "r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            parts = line.split("\t") if "\t" in line else line.split()
            if len(parts) < 2:
                continue
            rule, action = parts[0].strip(), parts[1].strip().upper()
            if action in ("FAIL", "WARN", "IGNORE"):
                pol[rule] = action
    return pol


_DEFAULT_PORT = {"http": 80, "https": 443}


def origin_of(url):
    """`esquema://host:puerto` normalizado (minúsculas, puerto por defecto explícito)."""
    try:
        u = urlsplit((url or "").strip())
        if not u.scheme or not u.hostname:
            return None
        port = u.port or _DEFAULT_PORT.get(u.scheme.lower())
        return "%s://%s:%s" % (u.scheme.lower(), u.hostname.lower(), port)
    except ValueError:
        return None


def load_zap_split(paths, scope):
    """Como load_zap, pero separa por ORIGEN de cada instancia.

    Devuelve (dentro, fuera, instancias_dentro) o (None, None, 0) si no hay
    informe. Con `scope` vacío todo es «dentro» (sin filtrado).
    `dentro`/`fuera`: [(ruleid, nombre, riesgo, n, uri_ejemplo)].
    """
    existentes = [p for p in (paths or []) if p and os.path.exists(p)]
    if not existentes:
        return None, None, 0
    dentro, fuera, n_dentro = [], [], 0
    for path in existentes:
        with open(path, "r", encoding="utf-8") as fh:
            doc = json.load(fh)
        for site in doc.get("site", []) or []:
            site_name = site.get("@name") or ""
            for a in site.get("alerts", []) or []:
                rule = str(a.get("pluginid") or a.get("alertRef") or "?").split("-")[0]
                name = a.get("alert") or a.get("name") or "(sin nombre)"
                risk = RISK.get(str(a.get("riskcode")), "?")
                insts = a.get("instances") or []
                try:
                    total = int(a.get("count") or len(insts) or 1)
                except ValueError:
                    total = len(insts) or 1
                if not scope:
                    uri = next((i["uri"] for i in insts if i.get("uri")), "")
                    dentro.append((rule, name, risk, total, uri))
                    n_dentro += total
                    continue
                # Instancia sin uri -> se juzga por el sitio. Alerta sin
                # instancias -> una «instancia» con el uri del sitio.
                uris = [i.get("uri") or site_name for i in insts] or [site_name]
                ins = [u for u in uris if origin_of(u) in scope]
                out = [u for u in uris if origin_of(u) not in scope]
                if ins:
                    dentro.append((rule, name, risk, len(ins), ins[0]))
                    n_dentro += len(ins)
                if out:
                    fuera.append((rule, name, risk, len(out), out[0]))
    return dentro, fuera, n_dentro


def load_nuclei(path, ignore_ids):
    if not path or not os.path.exists(path):
        return None
    hits = []
    with open(path, "r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                d = json.loads(line)
            except ValueError:
                continue
            tid = d.get("template-id", "?")
            if tid in ignore_ids:
                continue
            sev = ((d.get("info") or {}).get("severity") or "info").lower()
            hits.append((tid, sev, (d.get("info") or {}).get("name") or tid,
                         d.get("matched-at") or d.get("host") or ""))
    return hits


def load_ignore_ids(path):
    ids = set()
    if path and os.path.exists(path):
        with open(path, "r", encoding="utf-8") as fh:
            for line in fh:
                line = line.split("#")[0].strip()
                if line:
                    ids.add(line)
    return ids


def publicar_bloqueantes(hay, path):
    """Escribe el HECHO «hay bloqueantes» separado del exit code.

    Va a `$GITHUB_OUTPUT` (blocking=true|false) cuando el gate corre en Actions
    y a `path` si se pidió `--blocking-file`. Se llama ANTES de decidir el exit
    code, en todos los modos: el hecho no depende de `--report-only` ni de
    `--expect-red`.
    """
    val = "true" if hay else "false"
    if path:
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(val + "\n")
    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a", encoding="utf-8") as fh:
            fh.write("blocking=%s\n" % val)


def anotar(titulo, lineas):
    """Publica un digest como ANOTACIÓN de GitHub.

    Por qué no basta con el step summary y el artefacto: los dos viven detrás de
    una descarga. Las anotaciones salen en la portada del run y en la API de
    checks, así que el resultado del barrido es legible SIN abrir logs ni bajar
    un zip — que es la diferencia entre un informe que se lee y uno que no.
    Fuera de Actions no imprime nada (no ensucia la salida local).
    """
    if not os.environ.get("GITHUB_ACTIONS"):
        return
    cuerpo = "%0A".join(x.replace("\n", " ").replace("%", "%25").replace("\r", "")
                        for x in lineas)[:3500]
    print("::notice title=%s::%s" % (titulo.replace("::", ":"), cuerpo))


def main():
    p = argparse.ArgumentParser(description="Candado del DAST: informes -> veredicto.")
    p.add_argument("--zap-json", action="append", default=[],
                   help="Informe -J de ZAP. Repetible (un blanco por informe).")
    p.add_argument("--nuclei-jsonl")
    p.add_argument("--policy", default="security/zap/baseline.conf")
    p.add_argument("--nuclei-ignore", default="security/nuclei/ignore.txt")
    p.add_argument("--summary", help="Ruta del resumen markdown a escribir.")
    p.add_argument("--target", default="(sin declarar)")
    p.add_argument("--label", default="DAST")
    p.add_argument("--nuclei-fail-severity", default="high,critical")
    p.add_argument("--expect-red", action="store_true",
                   help="Autoprueba: invierte el veredicto (verde => fallo).")
    p.add_argument("--report-only", action="store_true",
                   help="Solo afecta al EXIT CODE: nunca sale distinto de 0. El hecho "
                        "«blocking» se publica igual (GITHUB_OUTPUT / --blocking-file).")
    p.add_argument("--scope-origin", action="append", default=[],
                   help="Origen PROPIO (esquema://host[:puerto][/...]); repetible. Si se da, "
                        "solo las instancias de ZAP en estos orígenes deciden el veredicto; "
                        "el resto sale como «fuera de alcance» (DEVOPS_NOTES §75).")
    p.add_argument("--blocking-file",
                   help="Fichero donde escribir el hecho «true|false» (hay bloqueantes), "
                        "independiente del exit code.")
    args = p.parse_args()

    pol = load_policy(args.policy)
    scope = {o for o in (origin_of(x) for x in args.scope_origin) if o}
    if args.scope_origin and not scope:
        print("::error title=--scope-origin ilegible::%s" % " ".join(args.scope_origin))
        return 2
    zap, zap_fuera, zap_dentro_n = load_zap_split(args.zap_json, scope)
    nuc = load_nuclei(args.nuclei_jsonl, load_ignore_ids(args.nuclei_ignore))
    nuc_fail_sev = {s.strip().lower() for s in args.nuclei_fail_severity.split(",") if s.strip()}

    L = []
    A = L.append
    A("## %s — veredicto" % args.label)
    A("")
    A("Blanco: `%s`" % args.target)
    A("")

    blocking = []
    missing_input = []

    # ---- ZAP -----------------------------------------------------------------
    if zap is None:
        missing_input.append("informe de ZAP (`%s`)" % (", ".join(args.zap_json) or "no indicado"))
        A("🔴 **No hay informe de ZAP.** Un gate sin informe NO es un verde: es un gate que no corrió.")
        A("")
    elif scope and zap_dentro_n == 0:
        missing_input.append("instancias de ZAP dentro de nuestros orígenes (%s)" % ", ".join(sorted(scope)))
        A("🔴 **El informe de ZAP no trae NI UNA instancia en nuestros orígenes** (%s). "
          "O el escáner no vio la app, o el alcance está mal declarado: en los dos casos NO es un verde."
          % ", ".join("`%s`" % o for o in sorted(scope)))
        A("")
    if zap is not None and not (scope and zap_dentro_n == 0):
        fails, warns, ignored = [], [], []
        for rule, name, risk, n, uri in zap:
            action = pol.get(rule, "WARN")
            (fails if action == "FAIL" else ignored if action == "IGNORE" else warns).append(
                (rule, name, risk, n, uri))
        blocking.extend(fails)

        A("### ZAP")
        A("")
        if fails:
            A("| Regla | Hallazgo | Riesgo | Casos | Ejemplo |")
            A("|---|---|---|---|---|")
            for rule, name, risk, n, uri in sorted(fails, key=lambda x: -x[3]):
                A("| 🔴 `%s` | %s | %s | %d | `%s` |" % (rule, name, risk, n, (uri or "-")[:110]))
            A("")
        else:
            A("- ✅ sin hallazgos de reglas **FAIL** (%d reglas bloqueantes en política)"
              % sum(1 for v in pol.values() if v == "FAIL"))
            A("")
        if warns:
            agg = OrderedDict()
            for rule, name, risk, n, _ in warns:
                k = (rule, name, risk)
                agg[k] = agg.get(k, 0) + n
            A("<details><summary>Avisos (%d reglas, no bloquean)</summary>" % len(agg))
            A("")
            A("| Regla | Hallazgo | Riesgo | Casos |")
            A("|---|---|---|---|")
            for (rule, name, risk), n in agg.items():
                A("| `%s` | %s | %s | %d |" % (rule, name, risk, n))
            A("")
            A("</details>")
            A("")
        if ignored:
            names = sorted({"`%s`" % r for r, _, _, _, _ in ignored})
            A("- 🔇 %d hallazgo(s) de %d regla(s) **silenciada(s)** por política: %s "
              "— el porqué de cada una está en `security/zap/baseline.conf`."
              % (sum(x[3] for x in ignored), len(names), ", ".join(names)))
            A("")

    if zap_fuera:
        A("<details><summary>Fuera de alcance: %d hallazgo(s) en orígenes de TERCEROS "
          "(no deciden el veredicto)</summary>" % sum(x[3] for x in zap_fuera))
        A("")
        A("Alcance propio: %s. Ver `docs/DEVOPS_NOTES.md` §75." % ", ".join("`%s`" % o for o in sorted(scope)))
        A("")
        A("| Regla | Acción en política | Hallazgo | Riesgo | Casos | Ejemplo |")
        A("|---|---|---|---|---|---|")
        for rule, name, risk, n, uri in zap_fuera:
            A("| `%s` | %s | %s | %s | %d | `%s` |" % (rule, pol.get(rule, "WARN"), name, risk, n, (uri or "-")[:110]))
        A("")
        A("</details>")
        A("")

    # ---- nuclei --------------------------------------------------------------
    if nuc is None:
        A("### nuclei")
        A("")
        A("- ⚠️ sin informe de nuclei (no bloquea por sí solo; ZAP es el candado).")
        A("")
    else:
        bad = [h for h in nuc if h[1] in nuc_fail_sev]
        A("### nuclei")
        A("")
        if bad:
            A("| Template | Severidad | Dónde |")
            A("|---|---|---|")
            for tid, sev, name, where in bad:
                A("| 🔴 `%s` | %s | `%s` |" % (tid, sev, (where or "-")[:110]))
            A("")
            blocking.extend([(t, n, s, 1, w) for t, s, n, w in bad])
        else:
            A("- ✅ sin hallazgos `%s` (%d hallazgos de menor severidad)"
              % (args.nuclei_fail_severity, len(nuc)))
            A("")

    red = bool(blocking) or bool(missing_input)
    # El hecho, ANTES de cualquier decisión sobre el exit code (F1-1).
    publicar_bloqueantes(red, args.blocking_file)

    A("---")
    A("")
    if args.expect_red:
        ok = red
        A("**Autoprueba del candado (`--expect-red`).** Se escaneó un blanco con "
          "vulnerabilidades PLANTADAS (`security/dast-selftest/canary.py`). "
          "Lo que se afirma aquí no es que la app esté sana: es que **el gate sabe ponerse rojo**.")
        A("")
        A("- Veredicto del gate sobre el canario: **%s**" % ("🔴 ROJO" if red else "🟢 VERDE"))
        A("- Autoprueba: **%s**" % ("✅ OK — el candado cierra" if ok else
                                    "🔴 FALLO — el candado NO puede cerrarse; el DAST no protege nada"))
        A("")
        sys.stdout.write("\n".join(L) + "\n")
        if args.summary:
            with open(args.summary, "w", encoding="utf-8") as fh:
                fh.write("\n".join(L) + "\n")
        dig = ["Canario: %s" % args.target,
               "Gate sobre el canario: %s" % ("ROJO (correcto)" if red else "VERDE (FALLO)")]
        for rule, name, risk, n, _uri in (zap or []):
            dig.append("%-6s %-6s %-5s x%-4d %s" % (pol.get(rule, "WARN"), rule, risk, n, name[:70]))
        anotar("Autoprueba del candado DAST — %s" % ("OK" if ok else "FALLO"), dig)
        if not ok:
            print("::error title=El candado del DAST no puede ponerse rojo::"
                  "El canario con vulnerabilidades plantadas pasó el gate en VERDE. "
                  "El escáner, la política o este script están inertes: el DAST semanal no protege nada.")
            return 1
        return 0

    A("**Veredicto: %s**" % ("🔴 ROJO — hay hallazgos bloqueantes" if red
                             else "🟢 VERDE — sin hallazgos bloqueantes"))
    A("")
    A("_Alcance declarado: este barrido corre contra un stack EFÍMERO de CI con datos "
      "sintéticos. NO es producción (otra config, otros datos, otra superficie de red). "
      "Ver `docs/DEVOPS_NOTES.md` §44.4._")
    sys.stdout.write("\n".join(L) + "\n")
    if args.summary:
        with open(args.summary, "w", encoding="utf-8") as fh:
            fh.write("\n".join(L) + "\n")

    # Digest legible sin abrir logs ni bajar artefactos.
    dig = ["Blanco: %s" % args.target,
           "Veredicto: %s" % ("ROJO" if red else "VERDE")]
    if zap is not None:
        agg = OrderedDict()
        for rule, name, risk, n, _uri in zap:
            k = (pol.get(rule, "WARN"), rule, name, risk)
            agg[k] = agg.get(k, 0) + n
        for (act, rule, name, risk), n in sorted(agg.items(), key=lambda kv: (kv[0][0] != "FAIL", -kv[1])):
            dig.append("%-6s %-6s %-5s x%-4d %s" % (act, rule, risk, n, name[:70]))
    if zap_fuera:
        dig.append("fuera de alcance (terceros, no deciden): %s" % ", ".join(
            "%s %s x%d %s" % (pol.get(r, "WARN"), r, n, (origin_of(u) or "?"))
            for r, _nm, _rk, n, u in zap_fuera)[:600])
    if nuc:
        dig.append("nuclei: %d hallazgo(s)" % len(nuc))
    anotar("DAST %s — %s" % (args.label[:60], "ROJO" if red else "VERDE"), dig)

    if red and not args.report_only:
        for m in missing_input:
            print("::error title=DAST sin informe::Falta el %s. No se puede declarar verde." % m)
        if blocking:
            print("::error title=DAST bloqueante::%d hallazgo(s) de reglas FAIL. Ver el resumen del run."
                  % len(blocking))
        return 1
    if red and args.report_only:
        print("::warning::report-only: habría bloqueado, pero se pidió solo medir.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
