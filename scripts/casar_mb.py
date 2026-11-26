#!/usr/bin/env python3
"""Fase 2 (piloto): casa discos e artistas da planilha com MusicBrainz e Wikidata.

Para cada disco da amostra:
  - procura o release-group (álbum) no MusicBrainz por título + artista;
  - procura o artista no MusicBrainz (preferindo Brasil) e lê área, datas e link do Wikidata;
  - no Wikidata, pega local de nascimento (pessoa) ou de formação (banda) e o estado (UF).

Uso: python3 scripts/casar_mb.py --amostra 500
Saída: data/catalogo/mb-piloto.json
"""
import argparse
import json
import os
import random
import re
import time
import unicodedata
import urllib.parse
import urllib.error
import urllib.request

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MB = "https://musicbrainz.org/ws/2/"
UA = "MusicBR-catalogo/0.1 (enriquecimento de acervo pessoal)"
_ultimo = [0.0]
CACHE_ARQ = os.path.expanduser("~/.cache/music-br/consultas.json")
_cache = {"d": None, "novos": 0}


def _cache_d():
    if _cache["d"] is None:
        try:
            _cache["d"] = json.load(open(CACHE_ARQ, encoding="utf-8"))
        except Exception:
            _cache["d"] = {}
    return _cache["d"]


def salvar_cache(forcar=False):
    if _cache["d"] is None or (not forcar and _cache["novos"] < 50):
        return
    os.makedirs(os.path.dirname(CACHE_ARQ), exist_ok=True)
    tmp = CACHE_ARQ + ".tmp"
    json.dump(_cache["d"], open(tmp, "w", encoding="utf-8"), ensure_ascii=False)
    os.replace(tmp, CACHE_ARQ)
    _cache["novos"] = 0


def norm(s):
    s = unicodedata.normalize("NFD", str(s or "")).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"\[[^\]]*\]|\([^)]*\)", " ", s)  # tira [EP], (Remaster) etc.
    return re.sub(r"[^a-z0-9]+", "", s)


FALHAS = {"n": 0}


class ErroConsulta(Exception):
    pass


def get(url, espera=1.25):
    """GET JSON respeitando ~1 req/s no MusicBrainz. Erro de rede/limite vira ErroConsulta (não "não achado")."""
    c = _cache_d()
    if url in c:
        return c[url]
    r = _get(url, espera)
    c[url] = r
    _cache["novos"] += 1
    salvar_cache()
    return r


def _get(url, espera):
    for t in range(6):
        if "musicbrainz.org" in url:
            falta = espera - (time.time() - _ultimo[0])
            if falta > 0:
                time.sleep(falta)
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=40) as r:
                _ultimo[0] = time.time()
                return json.load(r)
        except urllib.error.HTTPError as e:
            _ultimo[0] = time.time()
            if e.code in (503, 429, 502, 500):
                time.sleep(5 * (t + 1))
                continue
            if e.code == 404:
                return None
            raise
        except Exception:
            _ultimo[0] = time.time()
            time.sleep(3 * (t + 1))
    FALHAS["n"] += 1
    raise ErroConsulta(url)


def q(s):
    return '"' + str(s).replace('"', " ").replace("\\", " ") + '"'


def busca_album(d):
    titulo = re.sub(r"\s*\[[^\]]*\]\s*", " ", d["disco"]).strip()
    query = f"releasegroup:{q(titulo)}" + (f" AND artist:{q(d['artista'])}" if d["artista"] != "VA" else "")
    j = get(MB + "release-group/?" + urllib.parse.urlencode({"query": query, "fmt": "json", "limit": 5}))
    for rg in (j or {}).get("release-groups", []):
        if rg.get("score", 0) < 85 or norm(rg.get("title")) != norm(titulo):
            continue
        creditos = " ".join(c.get("name", "") + " " + c.get("artist", {}).get("name", "") for c in rg.get("artist-credit", []))
        if d["artista"] != "VA" and norm(d["artista"]) not in norm(creditos):
            continue
        ano_mb = (rg.get("first-release-date") or "")[:4]
        return {"mbid": rg["id"], "titulo": rg.get("title"), "primeiro_lancamento": rg.get("first-release-date"),
                "tipo": rg.get("primary-type"), "ano_confere": bool(d["ano"]) and ano_mb == str(d["ano"]),
                "artista_mbid": (rg.get("artist-credit") or [{}])[0].get("artist", {}).get("id")}
    return None


def busca_artista(nome, mbid=None):
    if not mbid:
        j = get(MB + "artist/?" + urllib.parse.urlencode({"query": f"artist:{q(nome)}", "fmt": "json", "limit": 5}))
        candidatos = [a for a in (j or {}).get("artists", []) if a.get("score", 0) >= 90 and a.get("country") in (None, "BR") and
                      (norm(a.get("name")) == norm(nome) or any(norm(x.get("name")) == norm(nome) for x in a.get("aliases", [])))]
        if not candidatos:
            return None
        candidatos.sort(key=lambda a: (a.get("country") != "BR", a.get("area", {}).get("name") != "Brazil", -a.get("score", 0)))
        mbid = candidatos[0]["id"]
    a = get(MB + f"artist/{mbid}?" + urllib.parse.urlencode({"inc": "url-rels", "fmt": "json"}))
    if not a:
        return None
    wd = next((r["url"]["resource"].rsplit("/", 1)[-1] for r in a.get("relations", [])
               if r.get("type") == "wikidata" and r.get("url")), None)
    return {"mbid": mbid, "nome": a.get("name"), "tipo": a.get("type"), "pais": a.get("country"),
            "area": (a.get("area") or {}).get("name"), "area_inicio": (a.get("begin-area") or {}).get("name"),
            "inicio": (a.get("life-span") or {}).get("begin"), "fim": (a.get("life-span") or {}).get("end"), "wikidata": wd}


WD_API = "https://www.wikidata.org/w/api.php?"
UF_CLASSE = "Q485258"  # estado do Brasil
_ent = {}


def entidades(ids):
    """Busca entidades do Wikidata (claims + rótulo pt/en), 50 por chamada, guardando em memória."""
    falta = [x for x in dict.fromkeys(ids) if x and x not in _ent]
    for i in range(0, len(falta), 50):
        j = get(WD_API + urllib.parse.urlencode({"action": "wbgetentities", "ids": "|".join(falta[i:i + 50]),
                                                  "props": "claims|labels", "languages": "pt|en", "format": "json"}))
        for qid, e in ((j or {}).get("entities") or {}).items():
            _ent[qid] = e
    return [_ent.get(x) for x in ids]


def _valores(e, prop):
    out = []
    for c in ((e or {}).get("claims") or {}).get(prop, []):
        v = ((c.get("mainsnak") or {}).get("datavalue") or {}).get("value")
        if isinstance(v, dict) and v.get("id"):
            out.append(v["id"])
        elif isinstance(v, dict) and v.get("time"):
            out.append(v["time"])
    return out


def _rotulo(e):
    l = (e or {}).get("labels") or {}
    return (l.get("pt") or l.get("en") or {}).get("value")


def wikidata(qids):
    """Local de nascimento (P19) ou de formação (P740), data de nascimento (P569) e a UF (subindo por P131)."""
    out = {}
    itens = dict(zip(qids, entidades(qids)))
    lugares = {q: (_valores(e, "P19") or _valores(e, "P740") or [None])[0] for q, e in itens.items()}
    entidades([x for x in lugares.values() if x])
    # sobe "localizado em" (P131) até achar um estado, no máximo 6 níveis, um nível por rodada para todos
    atual = {q: [l] for q, l in lugares.items() if l}
    uf = {}
    for _ in range(6):
        proximos = {}
        for q, nivel in atual.items():
            for x in nivel:
                if UF_CLASSE in _valores(_ent.get(x), "P31"):
                    uf[q] = x
                    break
            else:
                proximos[q] = [p for x in nivel for p in _valores(_ent.get(x), "P131")]
        atual = {q: v for q, v in proximos.items() if v and q not in uf}
        if not atual:
            break
        entidades([x for v in atual.values() for x in v])
    for q, e in itens.items():
        r = {}
        if lugares.get(q):
            r["lugar"] = _rotulo(_ent.get(lugares[q]))
        if q in uf:
            r["uf"] = _rotulo(_ent.get(uf[q]))
        nasc = _valores(e, "P569")
        if nasc:
            r["nascimento"] = nasc[0].lstrip("+")[:10]
        out[q] = r
    salvar_cache(True)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--amostra", type=int, default=500)
    ap.add_argument("--semente", type=int, default=2026)
    ap.add_argument("--saida", default=os.path.join(RAIZ, "data", "catalogo", "mb-piloto.json"))
    ap.add_argument("--so-wikidata", action="store_true", help="refaz só a etapa do Wikidata usando o arquivo de saída")
    a = ap.parse_args()
    if a.so_wikidata:
        salvo = json.load(open(a.saida, encoding="utf-8"))
        return finalizar(a, salvo["albuns"], salvo["artistas"])
    cat = json.load(open(os.path.join(RAIZ, "data", "musicbr.json"), encoding="utf-8"))
    discos = [dict(zip(cat["colunas"], l)) for l in cat["discos"]]
    random.Random(a.semente).shuffle(discos)  # mesma amostra do inventário
    discos = discos[: a.amostra]

    inicio, albuns, artistas = time.time(), [], {}
    for k, d in enumerate(discos, 1):
        try:
            alb, erro = busca_album(d), None
        except ErroConsulta:
            alb, erro = None, "consulta falhou"
        albuns.append({"disco_id": d["id"], "artista": d["artista"], "disco": d["disco"], "ano": d["ano"], "mb": alb, "erro": erro})
        if d["artista"] != "VA" and d["artista"] not in artistas:
            try:
                artistas[d["artista"]] = busca_artista(d["artista"], alb and alb.get("artista_mbid"))
            except ErroConsulta:
                artistas[d["artista"]] = {"erro": "consulta falhou"}
        if k % 25 == 0 or k == len(discos):
            ok = sum(1 for x in albuns if x["mb"])
            print(f"{k}/{len(discos)} discos · {ok} álbuns casados · {sum(1 for v in artistas.values() if v)}/{len(artistas)} artistas · {int(time.time() - inicio)}s", flush=True)

    salvar_cache(True)
    gravar(a, albuns, artistas)  # se o Wikidata falhar, o MusicBrainz já está salvo
    finalizar(a, albuns, artistas)


def gravar(a, albuns, artistas):
    os.makedirs(os.path.dirname(a.saida), exist_ok=True)
    json.dump({"gerado": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "semente": a.semente,
               "albuns": albuns, "artistas": artistas}, open(a.saida, "w", encoding="utf-8"), ensure_ascii=False, indent=0)


def finalizar(a, albuns, artistas):
    qids = sorted({v["wikidata"] for v in artistas.values() if v and v.get("wikidata")})
    wd = wikidata(qids)
    for v in artistas.values():
        if v and v.get("wikidata"):
            v.update(wd.get(v["wikidata"], {}))
    gravar(a, albuns, artistas)

    n_art = len(artistas)
    com = lambda f: sum(1 for v in artistas.values() if v and not v.get("erro") and f(v))
    print("\n=== resumo ===")
    print(f"consultas que falharam (não contam como 'não achado'): {FALHAS['n']}")
    print(f"álbuns casados no MusicBrainz: {sum(1 for x in albuns if x['mb'])}/{len(albuns)} (erro: {sum(1 for x in albuns if x.get('erro'))})")
    print(f"  com ano igual ao da planilha: {sum(1 for x in albuns if x['mb'] and x['mb']['ano_confere'])}")
    print(f"artistas (sem VA) no MusicBrainz: {com(lambda v: True)}/{n_art}")
    print(f"  com link Wikidata: {com(lambda v: v.get('wikidata'))}")
    print(f"  com local de nascimento/formação: {com(lambda v: v.get('lugar'))}")
    print(f"  com estado (UF) brasileiro: {com(lambda v: v.get('uf'))}")
    print(f"  com área de origem no MusicBrainz: {com(lambda v: v.get('area_inicio'))}")
    print("salvo em", os.path.relpath(a.saida, RAIZ))


if __name__ == "__main__":
    main()
