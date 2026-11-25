#!/usr/bin/env python3
"""Baixa a aba MUSICBR da planilha (CSV público) e gera data/musicbr.json.

Formato do JSON (compacto, para o navegador carregar rápido):
  {
    "atualizado": "2026-11-25T18:00:00Z",
    "colunas": ["id", "estilo", "letra", "artista", "ano", "disco", "musicas"],
    "discos": [[...], ...]      # na ordem da planilha (última linha = inserção mais recente)
  }

O id de cada disco é um hash curto de estilo|artista|ano|disco, para o link
do disco continuar o mesmo mesmo que linhas sejam apagadas ou reordenadas.
"""
import csv
import hashlib
import io
import json
import os
import sys
import urllib.request
from datetime import datetime, timezone

PLANILHA = "1EnyOWiXYubgVPIHIgeGVZLnyxVsi5-eNJQmNxyDH7V0"
ABA_GID = "1366612687"  # MUSICBR
URL = f"https://docs.google.com/spreadsheets/d/{PLANILHA}/export?format=csv&gid={ABA_GID}"

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAIDA = os.path.join(RAIZ, "data", "musicbr.json")


def baixar() -> str:
    req = urllib.request.Request(URL, headers={"User-Agent": "music-br-atualizar"})
    with urllib.request.urlopen(req, timeout=120) as r:
        if "text/csv" not in r.headers.get("Content-Type", ""):
            sys.exit("A planilha não veio em CSV: ela precisa estar com 'Qualquer pessoa com o link: Leitor'.")
        return r.read().decode("utf-8")


def inteiro(v: str):
    v = (v or "").strip()
    return int(v) if v.isdigit() else None


def main():
    texto = baixar()
    linhas = list(csv.reader(io.StringIO(texto)))
    cab, dados = linhas[0], linhas[1:]
    esperado = ["Estilo", "Letra", "Nome do Artista", "Ano", "Nome do Disco", "Número de Músicas"]
    if [c.strip() for c in cab[:6]] != esperado:
        sys.exit(f"Cabeçalho inesperado na aba MUSICBR: {cab[:6]}")

    discos, vistos = [], {}
    for l in dados:
        l = (l + [""] * 6)[:6]
        estilo, letra, artista, ano, disco, n = (c.strip() for c in l)
        if not artista and not disco:
            continue
        base = hashlib.sha1(f"{estilo}|{artista}|{ano}|{disco}".lower().encode()).hexdigest()[:8]
        vistos[base] = vistos.get(base, 0) + 1
        did = base if vistos[base] == 1 else f"{base}-{vistos[base]}"
        discos.append([did, estilo, letra, artista, inteiro(ano), disco, inteiro(n)])

    novo = {"colunas": ["id", "estilo", "letra", "artista", "ano", "disco", "musicas"], "discos": discos}

    # Só troca a data se os discos mudaram (evita commit vazio todo dia).
    try:
        with open(SAIDA, encoding="utf-8") as f:
            antigo = json.load(f)
        if antigo.get("discos") == discos:
            print(f"Sem mudanças ({len(discos)} discos).")
            return
    except (FileNotFoundError, json.JSONDecodeError):
        pass

    novo = {"atualizado": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), **novo}
    with open(SAIDA, "w", encoding="utf-8") as f:
        json.dump(novo, f, ensure_ascii=False, separators=(",", ":"))
        f.write("\n")
    print(f"{len(discos)} discos gravados em data/musicbr.json")


if __name__ == "__main__":
    main()
