#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
dast-zap-policy.py — la política que recibe ZAP, separada de la que lee el candado. devops.
==========================================================================================
DEVOPS_NOTES §96.7. `security/zap/baseline.conf` tiene DOS lectores con gramáticas distintas:

  · `dast-gate.py --policy` (el candado): acepta claves `<regla>-<sub>` (p. ej. `10055-6`,
    el `alertRef` del JSON) para clasificar sub-alertas una a una.
  · ZAP con `-c` (el escáner): `zap_common.load_config` mete TODA clave en `config_dict` y
    `get_af_output_summary` hace `int(id)` sobre cada una. Una clave `10055-3` revienta
    ZAP en el arranque — `ValueError: invalid literal for int() with base 10: '10055-3'`
    (`/zap/zap_common.py:708`) — rc=1 en 33 s, SIN informe. Medido: job 114278597979,
    run 38074441197, sha 00535194.

Este script es la frontera entre los dos:

  for-zap <entrada> <salida>   copia la política dejando SOLO lo que ZAP sabe leer
                               (comentarios, líneas vacías, claves enteras y OUTOFSCOPE).
                               Lo que quita lo dice por stderr, una línea por clave.
  check <fichero>              emula el lector de ZAP (load_config + int(id)) línea a
                               línea y sale 1 si el fichero lo haría reventar.

La emulación copia la lógica de `docker/zap_common.py` de zaproxy (rama main, leída el
2026-10-10). No sustituye a arrancar el ZAP de verdad: eso lo hace
`scripts/check-zap-conf.sh --real` contra la imagen fijada por digest.
"""
import re
import sys

# `zap_conf_lvls` de zap_common.py.
ZAP_LEVELS = ("PASS", "IGNORE", "INFO", "WARN", "FAIL")


def _es_entero(clave):
    """Lo mismo que acepta `int(id)` de Python… pero sin el `int(' 10')` permisivo:
    ZAP ya hace `rstrip()` y `split('\\t')`, así que una clave con espacios es otra cosa."""
    return re.fullmatch(r"[0-9]+", clave) is not None


def _ignorable(line):
    # Idéntico a zap_common.load_config: `startswith('#')` SIN strip previo.
    return line.startswith("#") or len(line.strip()) == 0


def emular_zap(lines):
    """Devuelve la lista de errores que ZAP daría con estas líneas (vacía = ZAP arranca)."""
    errores = []
    config_dict = {}
    for n, line in enumerate(lines, 1):
        if _ignorable(line):
            continue
        if line.count("\t") < 2:
            errores.append("línea %d: menos de 3 campos separados por TAB (ZAP: «Unexpected "
                           "number of tokens»): %r" % (n, line.rstrip("\n")))
            continue
        key, val, _opt = line.rstrip().split("\t", 2)
        if val == "OUTOFSCOPE":
            continue
        if val not in ZAP_LEVELS:
            errores.append("línea %d: nivel %r no soportado por ZAP %s" % (n, val, ZAP_LEVELS))
            continue
        config_dict[key] = (n, val)
    # get_af_output_summary: `int(id)` sobre CADA clave de config_dict.
    for key, (n, _val) in config_dict.items():
        try:
            int(key)
        except ValueError:
            errores.append("línea %d: clave %r — ZAP hace int(id) y revienta "
                           "(ValueError: invalid literal for int())" % (n, key))
    return errores


def for_zap(entrada, salida):
    with open(entrada, encoding="utf-8") as fh:
        lines = fh.readlines()
    out = ["# GENERADO por security/scripts/dast-zap-policy.py desde %s — NO editar.\n" % entrada,
           "# Solo claves que ZAP sabe leer. La política completa (con sub-alertas\n",
           "# <regla>-<sub>) la lee dast-gate.py --policy del original. DEVOPS_NOTES §96.7.\n"]
    quitadas = []
    for line in lines:
        if _ignorable(line) or line.count("\t") < 2:
            # Las mal formadas se dejan pasar A PROPÓSITO: que `check` las cace y
            # que ZAP las rechace en voz alta, no que el filtro las esconda.
            out.append(line)
            continue
        key, val, _opt = line.rstrip().split("\t", 2)
        if val == "OUTOFSCOPE" or _es_entero(key):
            out.append(line)
        else:
            quitadas.append(key)
    with open(salida, "w", encoding="utf-8") as fh:
        fh.writelines(out)
    for k in quitadas:
        sys.stderr.write("dast-zap-policy: '%s' no va a ZAP (sub-alerta: la decide dast-gate.py)\n" % k)
    return 0


def check(path):
    with open(path, encoding="utf-8") as fh:
        errores = emular_zap(fh.readlines())
    if errores:
        sys.stderr.write("✗ %s haría reventar a ZAP en el arranque:\n" % path)
        for e in errores:
            sys.stderr.write("    %s\n" % e)
        return 1
    print("✓ %s: ZAP lo lee sin reventar (emulación de zap_common.load_config + int(id))" % path)
    return 0


def main(argv):
    if len(argv) == 4 and argv[1] == "for-zap":
        return for_zap(argv[2], argv[3])
    if len(argv) == 3 and argv[1] == "check":
        return check(argv[2])
    sys.stderr.write("Uso: %s for-zap <entrada> <salida> | check <fichero>\n" % argv[0])
    return 64


if __name__ == "__main__":
    sys.exit(main(sys.argv))
