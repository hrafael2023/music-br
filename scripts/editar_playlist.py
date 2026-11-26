#!/usr/bin/env python3
"""Edita data/playlists.json a pedido do site (Action "Editar playlist").

  python3 scripts/editar_playlist.py --acao apagar --id anos-80
  python3 scripts/editar_playlist.py --acao capa --id anos-80 --capa '{"tipo":"disco","disco":"15b42586"}'
"""
import argparse
import json
import sys

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from playlist import ler_playlists, gravar_playlists  # noqa: E402

TIPOS = {"mosaico", "texto", "disco"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--acao", choices=["apagar", "capa"], required=True)
    ap.add_argument("--id", required=True)
    ap.add_argument("--capa", default="")
    a = ap.parse_args()
    j = ler_playlists()
    pl = next((p for p in j["playlists"] if p["id"] == a.id), None)
    if not pl:
        print("playlist não existe (talvez já apagada):", a.id)
        return
    if a.acao == "apagar":
        j["playlists"] = [p for p in j["playlists"] if p["id"] != a.id]
    else:
        capa = json.loads(a.capa)
        if capa.get("tipo") not in TIPOS:
            raise SystemExit("tipo de capa inválido")
        if capa["tipo"] == "disco" and capa.get("disco") not in {f["disco"] for f in pl["faixas"]}:
            raise SystemExit("esse disco não está na playlist")
        pl["capa"] = {"tipo": capa["tipo"], **({"disco": capa["disco"]} if capa["tipo"] == "disco" else {})}
    gravar_playlists(j)
    print("ok:", a.acao, a.id)


if __name__ == "__main__":
    main()
