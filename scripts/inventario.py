#!/usr/bin/env python3
"""Fase 1 do enriquecimento: inventário de faixas.

Para cada disco da planilha, acha a pasta no Drive (ESTILO/LETRA/ARTISTA/ANO - DISCO),
lista os arquivos e lê só o começo de cada música para extrair tags e duração.

Uso:
  python3 scripts/inventario.py --amostra 500           # piloto: 500 discos sorteados
  python3 scripts/inventario.py --amostra 500 --semente 7
Saída: data/catalogo/faixas-piloto.json  (e um resumo no terminal)
"""
import argparse
import json
import os
import random
import re
import sys
import time
import unicodedata
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from drive_sa import Drive, PASTA  # noqa: E402
import tags_audio  # noqa: E402

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PASTAS_ESTILO = {
    "MPB": "1c0kYehgW6xYqqFax2eJwupIkwXozHxgY",
    "ROCK-BRASIL": "1dB76xD88L8LFTx3CkJpFkFRuN3fq5SEG",
}
AUDIO = re.compile(r"\.(mp3|flac|m4a|aac|ogg|oga|opus|wav|wma)$", re.I)
CABECA = 65536  # bytes lidos do começo de cada arquivo


def norm(s):
    s = unicodedata.normalize("NFD", str(s or "")).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "", s)


class Localizador:
    """Acha a pasta de cada disco seguindo o caminho, com cache das listagens."""

    def __init__(self, drive):
        self.d = drive
        self.cache = {}

    def subpastas(self, pai):
        if pai not in self.cache:
            self.cache[pai] = self.d.filhos(pai, so_pastas=True)
        return self.cache[pai]

    def filho(self, pai, nomes):
        fs = self.subpastas(pai)
        for n in nomes:
            for f in fs:
                if f["name"] == n:
                    return f
        alvos = [norm(n) for n in nomes]
        for a in alvos:
            for f in fs:
                if norm(f["name"]) == a:
                    return f
        return None

    def disco(self, d):
        raiz = PASTAS_ESTILO.get(d["estilo"])
        if not raiz:
            return None, "estilo sem pasta"
        letra = self.filho(raiz, [d["letra"]])
        if not letra:
            return None, "letra não encontrada"
        # coletâneas (VA) não têm pasta de artista: ESTILO/--VA/ANO - DISCO
        art = self.filho(letra["id"], [d["artista"]]) or letra
        nomes = ([f'{d["ano"]} - {d["disco"]}'] if d["ano"] else []) + [d["disco"]]
        f = self.filho(art["id"], nomes)
        if f:
            return f, "ok"
        alvo = norm(d["disco"])
        for x in self.subpastas(art["id"]):
            n = norm(x["name"])
            if n.endswith(alvo) and (not d["ano"] or n.startswith(str(d["ano"]))):
                return x, "ok (aproximado)"
        return None, "disco não encontrado"


def ler_faixa(drive, arq):
    tam = int(arq.get("size") or 0)
    try:
        cabeca = drive.trecho(arq["id"], 0, CABECA - 1)

        def ler_fim(tipo, n):
            if tipo == "fim" and tam > 128:
                return drive.trecho(arq["id"], tam - n, tam - 1)
            if tipo == "tag" and tam > n:  # tag inteira + começo do áudio (limite de 8 MB)
                return drive.trecho(arq["id"], 0, min(tam - 1, n + 16383, 8 * 1024 * 1024))
            if tipo == "depois_tag" and tam > n:  # só o começo do áudio, logo depois de uma tag enorme
                return drive.trecho(arq["id"], n, min(tam - 1, n + 16383))
            return None

        t = tags_audio.ler(cabeca, tam, ler_fim)
        t["erro"] = None
    except Exception as e:  # um arquivo ruim não derruba o disco
        t = {"erro": str(e)[:200]}
    t.update({"id": arq["id"], "arquivo": arq["name"], "bytes": tam})
    if not t.get("titulo") and not t.get("erro"):  # sem título na tag: usa o nome do arquivo
        nome = re.sub(r"\.[a-z0-9]{2,4}$", "", arq["name"].split(" / ")[-1], flags=re.I)
        nome = re.sub(r"^\d{1,3}(\s*[-._)]\s*|\s+)", "", nome).strip()
        t["titulo"], t["titulo_origem"] = nome or None, "arquivo"
    if t.get("duracao"):
        t["duracao"] = round(t["duracao"], 1)
    return t


def processar(drive, loc, d):
    inicio = time.time()
    pasta, status = loc.disco(d)
    out = {"disco_id": d["id"], "estilo": d["estilo"], "artista": d["artista"], "ano": d["ano"], "disco": d["disco"],
           "faixas_planilha": d["musicas"], "status": status, "pasta": pasta["id"] if pasta else None, "faixas": []}
    if not pasta:
        return out
    arquivos = drive.filhos(pasta["id"])
    # subpastas (CD1, CD2…) — um nível
    for sub in [a for a in arquivos if a["mimeType"] == PASTA]:
        for a in drive.filhos(sub["id"]):
            a["name"] = sub["name"] + " / " + a["name"]
            arquivos.append(a)
    musicas = sorted([a for a in arquivos if a["mimeType"] != PASTA and (a["mimeType"].startswith("audio/") or AUDIO.search(a["name"]))],
                     key=lambda a: a["name"].lower())
    out["capa"] = next((a["id"] for a in arquivos if a["mimeType"].startswith("image/")), None)
    if not arquivos:
        out["status"] = "pasta vazia para a conta de serviço (compartilhamento ainda propagando?)"
    with ThreadPoolExecutor(8) as ex:
        out["faixas"] = list(ex.map(lambda a: ler_faixa(drive, a), musicas))
    out["segundos"] = round(time.time() - inicio, 1)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--amostra", type=int, default=500)
    ap.add_argument("--semente", type=int, default=2026)
    ap.add_argument("--saida", default=os.path.join(RAIZ, "data", "catalogo", "faixas-piloto.json"))
    ap.add_argument("--refazer", action="store_true",
                    help="refaz só os discos do arquivo de saída sem pasta, sem faixas ou com faixa sem duração, e mescla")
    a = ap.parse_args()

    cat = json.load(open(os.path.join(RAIZ, "data", "musicbr.json"), encoding="utf-8"))
    discos = [dict(zip(cat["colunas"], l)) for l in cat["discos"]]
    random.Random(a.semente).shuffle(discos)
    discos = discos[: a.amostra]
    anterior = None
    if a.refazer and os.path.exists(a.saida):
        anterior = json.load(open(a.saida, encoding="utf-8"))
        refazer = {x["disco_id"] for x in anterior["discos"]
                   if not x.get("pasta") or not x["faixas"] or any(not f.get("duracao") for f in x["faixas"])}
        discos = [d for d in discos if d["id"] in refazer]
        print("refazendo", len(discos), "discos")

    drive, inicio = Drive(), time.time()
    loc = Localizador(drive)
    resultados = []
    for k, d in enumerate(discos, 1):
        try:
            r = processar(drive, loc, d)
        except Exception as e:
            r = {"disco_id": d["id"], "artista": d["artista"], "disco": d["disco"], "status": "erro: " + str(e)[:200], "faixas": []}
        resultados.append(r)
        if k % 25 == 0 or k == len(discos):
            ok = sum(1 for x in resultados if x["pasta"]) if resultados else 0
            print(f"{k}/{len(discos)} discos · {ok} achados · {sum(len(x['faixas']) for x in resultados)} faixas · {int(time.time() - inicio)}s", flush=True)

    if anterior:  # mescla: troca os discos refeitos, mantém o resto
        novos = {r["disco_id"]: r for r in resultados}
        resultados = [novos.get(x["disco_id"], x) for x in anterior["discos"]]
    os.makedirs(os.path.dirname(a.saida), exist_ok=True)
    with open(a.saida, "w", encoding="utf-8") as f:
        json.dump({"gerado": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "semente": a.semente, "discos": resultados},
                  f, ensure_ascii=False, indent=0)
    print("salvo em", os.path.relpath(a.saida, RAIZ))


if __name__ == "__main__":
    main()
