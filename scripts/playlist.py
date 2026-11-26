#!/usr/bin/env python3
"""Cria uma playlist a partir do catálogo enriquecido e grava em data/playlists.json.

As faixas vêm do inventário do Drive (data/catalogo/faixas-*.json) e os dados de artista
(estado, nascimento) do MusicBrainz/Wikidata (data/catalogo/mb-*.json). Cada faixa guarda o
id do arquivo no Drive, então o site toca direto, sem procurar a pasta.

Exemplos:
  python3 scripts/playlist.py --titulo "Anos 80" --anos 1980-1989 --n 30
  python3 scripts/playlist.py --titulo "30 min do Nordeste" --uf Bahia,Pernambuco,Ceará --minutos 30
  python3 scripts/playlist.py --apagar anos-80
"""
import argparse
import glob
import json
import os
import random
import re
import time
import unicodedata

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ARQ = os.path.join(RAIZ, "data", "playlists.json")


def norm(s):
    s = unicodedata.normalize("NFD", str(s or "")).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "", s)


def slug(s):
    s = unicodedata.normalize("NFD", str(s or "")).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")[:60] or "playlist"


def ler_playlists():
    try:
        return json.load(open(ARQ, encoding="utf-8"))
    except FileNotFoundError:
        return {"playlists": []}


def gravar_playlists(j):
    j["atualizado"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    with open(ARQ, "w", encoding="utf-8") as f:
        json.dump(j, f, ensure_ascii=False, indent=1)
        f.write("\n")


def acervo():
    """Todas as faixas conhecidas, com os dados do disco e do artista."""
    cat = json.load(open(os.path.join(RAIZ, "data", "musicbr.json"), encoding="utf-8"))
    discos = {l[0]: dict(zip(cat["colunas"], l)) for l in cat["discos"]}
    artistas = {}
    for p in sorted(glob.glob(os.path.join(RAIZ, "data", "catalogo", "mb-*.json"))):
        for nome, v in json.load(open(p, encoding="utf-8")).get("artistas", {}).items():
            if v and not v.get("erro"):
                artistas[norm(nome)] = v
    faixas, vistos = [], set()
    for p in sorted(glob.glob(os.path.join(RAIZ, "data", "catalogo", "faixas-*.json"))):
        for x in json.load(open(p, encoding="utf-8"))["discos"]:
            d = discos.get(x["disco_id"])
            if not d:
                continue  # disco saiu da planilha
            for f in x.get("faixas") or []:
                if f.get("erro") or not f.get("id") or f["id"] in vistos:
                    continue
                vistos.add(f["id"])
                artista = f.get("artista") if d["artista"] == "VA" and f.get("artista") else d["artista"]
                a = artistas.get(norm(artista)) or artistas.get(norm(d["artista"])) or {}
                faixas.append({
                    "arq": f["id"], "disco": d["id"], "titulo": f.get("titulo") or f.get("arquivo"),
                    "artista": artista, "dur": round(f["duracao"]) if f.get("duracao") else None,
                    "ano": d.get("ano"), "estilo": d.get("estilo"), "uf": a.get("uf"),
                    "nascimento": a.get("nascimento"), "lugar": a.get("lugar"),
                })
    return faixas


def escolher(faixas, a):
    pool = faixas
    if a.anos:
        ini, _, fim = a.anos.partition("-")
        ini, fim = int(ini), int(fim or ini)
        pool = [f for f in pool if f["ano"] and ini <= int(f["ano"]) <= fim]
    if a.uf:
        ufs = {norm(u) for u in a.uf.split(",")}
        pool = [f for f in pool if norm(f["uf"]) in ufs]
    if a.estilo:
        pool = [f for f in pool if norm(f["estilo"]) == norm(a.estilo)]
    if a.artista:
        alvo = {norm(x) for x in a.artista.split(",")}
        pool = [f for f in pool if norm(f["artista"]) in alvo]
    if a.titulo_tem:
        r = re.compile(a.titulo_tem, re.I)
        pool = [f for f in pool if r.search(f["titulo"] or "")]
    pool = [f for f in pool if f["dur"] and 60 <= f["dur"] <= 600]  # sem vinhetas nem faixas enormes
    random.Random(a.semente).shuffle(pool)
    out, por_artista, por_disco, total = [], {}, set(), 0
    for f in pool:
        k = norm(f["artista"])
        if por_artista.get(k, 0) >= a.max_por_artista or f["disco"] in por_disco:
            continue
        if a.minutos and total + f["dur"] > a.minutos * 60 + 90:
            continue
        out.append(f)
        por_artista[k] = por_artista.get(k, 0) + 1
        por_disco.add(f["disco"])
        total += f["dur"]
        if (a.minutos and total >= a.minutos * 60 - 60) or (not a.minutos and len(out) >= a.n):
            break
    if a.ordem == "ano":
        out.sort(key=lambda f: (f["ano"] or 9999))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--titulo")
    ap.add_argument("--descricao", default="")
    ap.add_argument("--pedido", default="", help="o pedido original, em texto livre")
    ap.add_argument("--id", help="endereço da playlist (padrão: tirado do título)")
    ap.add_argument("--anos", help="ex.: 1980-1985")
    ap.add_argument("--uf", help="estados separados por vírgula")
    ap.add_argument("--estilo")
    ap.add_argument("--artista", help="artistas separados por vírgula")
    ap.add_argument("--titulo-tem", help="expressão no nome da música")
    ap.add_argument("--n", type=int, default=30)
    ap.add_argument("--minutos", type=int)
    ap.add_argument("--max-por-artista", type=int, default=1)
    ap.add_argument("--ordem", choices=["aleatoria", "ano"], default="aleatoria")
    ap.add_argument("--semente", type=int, default=None)
    ap.add_argument("--apagar", metavar="ID")
    a = ap.parse_args()

    j = ler_playlists()
    if a.apagar:
        antes = len(j["playlists"])
        j["playlists"] = [p for p in j["playlists"] if p["id"] != a.apagar]
        gravar_playlists(j)
        print("apagada" if len(j["playlists"]) < antes else "não achei", a.apagar)
        return
    if not a.titulo:
        ap.error("--titulo é obrigatório")
    if a.semente is None:
        a.semente = int(time.time())
    faixas = escolher(acervo(), a)
    if not faixas:
        raise SystemExit("Nenhuma faixa atende a esse pedido com o catálogo atual.")
    pid = a.id or slug(a.titulo)
    existentes = {p["id"] for p in j["playlists"]}
    base, k = pid, 2
    while pid in existentes and not a.id:
        pid, k = f"{base}-{k}", k + 1
    pl = {
        "id": pid, "titulo": a.titulo, "descricao": a.descricao, "pedido": a.pedido,
        "criada": time.strftime("%Y-%m-%d"), "capa": {"tipo": "mosaico"},
        "faixas": [{k: f[k] for k in ("arq", "disco", "titulo", "artista", "dur")} for f in faixas],
    }
    j["playlists"] = [p for p in j["playlists"] if p["id"] != pid] + [pl]
    gravar_playlists(j)
    total = sum(f["dur"] or 0 for f in faixas)
    print(f"playlist '{a.titulo}' ({pid}): {len(faixas)} músicas, {total // 60} min")


if __name__ == "__main__":
    main()
