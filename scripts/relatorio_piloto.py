#!/usr/bin/env python3
"""Resume os pilotos de enriquecimento (faixas do Drive + MusicBrainz/Wikidata)."""
import collections
import json
import os
import statistics

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
pc = lambda a, b: f"{a}/{b} ({(100 * a / b if b else 0):.0f}%)"


def faixas():
    p = os.path.join(RAIZ, "data", "catalogo", "faixas-piloto.json")
    if not os.path.exists(p):
        return
    ds = json.load(open(p, encoding="utf-8"))["discos"]
    achados = [d for d in ds if d.get("pasta")]
    vazios = [d for d in achados if "vazia" in (d.get("status") or "")]
    com = [d for d in achados if d["faixas"]]
    fx = [f for d in com for f in d["faixas"]]
    ok = [f for f in fx if not f.get("erro")]
    conta = lambda k: sum(1 for f in ok if f.get(k))
    batem = sum(1 for d in com if len(d["faixas"]) == d.get("faixas_planilha"))
    durs = [f["duracao"] for f in ok if f.get("duracao")]
    print("=== FAIXAS (Drive) ===")
    print("discos sorteados:", len(ds))
    print("pasta achada no Drive:", pc(len(achados), len(ds)))
    print("  ainda vazia para a conta de serviço:", len(vazios))
    print("  status de quem não achou:", collections.Counter(d["status"] for d in ds if not d.get("pasta")).most_common())
    print("discos com faixas lidas:", len(com), "· faixas:", len(fx), "· com erro de leitura:", len(fx) - len(ok))
    print("nº de faixas igual ao da planilha:", pc(batem, len(com)))
    print("título na tag:", pc(sum(1 for f in ok if f.get("titulo") and f.get("titulo_origem") != "arquivo"), len(ok)),
          "· título só pelo nome do arquivo:", sum(1 for f in ok if f.get("titulo_origem") == "arquivo"))
    for k, rot in [("duracao", "duração"), ("artista", "artista na tag"), ("album", "álbum na tag"), ("ano", "ano na tag"),
                   ("faixa", "nº da faixa"), ("genero", "gênero na tag"), ("compositor", "compositor na tag")]:
        print(f"{rot}:", pc(conta(k), len(ok)))
    if durs:
        print(f"duração média: {statistics.mean(durs) / 60:.1f} min · total lido: {sum(durs) / 3600:.0f} h")
    print("formatos:", collections.Counter(f.get("formato") for f in ok).most_common())
    print("gêneros mais comuns nas tags:", collections.Counter(f["genero"] for f in ok if f.get("genero")).most_common(8))


def mb():
    p = os.path.join(RAIZ, "data", "catalogo", "mb-piloto.json")
    if not os.path.exists(p):
        return
    j = json.load(open(p, encoding="utf-8"))
    al, ar = j["albuns"], j["artistas"]
    validos = [v for v in ar.values() if not (v or {}).get("erro")]
    com = lambda f: sum(1 for v in validos if v and f(v))
    print("\n=== MUSICBRAINZ / WIKIDATA ===")
    print("álbuns casados:", pc(sum(1 for x in al if x["mb"]), len(al)), "· erros de consulta:", sum(1 for x in al if x.get("erro")))
    print("  com ano igual ao da planilha:", sum(1 for x in al if x["mb"] and x["mb"]["ano_confere"]))
    print("artistas (sem VA) achados:", pc(com(lambda v: True), len(validos)))
    print("  com Wikidata:", pc(com(lambda v: v.get("wikidata")), len(validos)))
    print("  com local de nascimento/formação:", pc(com(lambda v: v.get("lugar")), len(validos)))
    print("  com estado (UF):", pc(com(lambda v: v.get("uf")), len(validos)))
    print("  com área de origem (MusicBrainz):", pc(com(lambda v: v.get("area_inicio")), len(validos)))
    print("  UFs encontradas:", collections.Counter(v["uf"] for v in validos if v and v.get("uf")).most_common(12))


if __name__ == "__main__":
    faixas()
    mb()
