"""Lê tags e duração de MP3/FLAC a partir só do começo do arquivo (e, se preciso, do fim).

ler(cabeca, tamanho_total, ler_fim) -> dict com titulo, artista, album, ano, faixa,
genero, compositor, duracao (segundos), kbps, formato.
"""
import re
import struct

GENEROS_ID3V1 = ["Blues", "Classic Rock", "Country", "Dance", "Disco", "Funk", "Grunge", "Hip-Hop", "Jazz", "Metal",
                 "New Age", "Oldies", "Other", "Pop", "R&B", "Rap", "Reggae", "Rock", "Techno", "Industrial",
                 "Alternative", "Ska", "Death Metal", "Pranks", "Soundtrack", "Euro-Techno", "Ambient", "Trip-Hop",
                 "Vocal", "Jazz+Funk", "Fusion", "Trance", "Classical", "Instrumental", "Acid", "House", "Game",
                 "Sound Clip", "Gospel", "Noise", "AlternRock", "Bass", "Soul", "Punk", "Space", "Meditative",
                 "Instrumental Pop", "Instrumental Rock", "Ethnic", "Gothic", "Darkwave", "Techno-Industrial",
                 "Electronic", "Pop-Folk", "Eurodance", "Dream", "Southern Rock", "Comedy", "Cult", "Gangsta", "Top 40",
                 "Christian Rap", "Pop/Funk", "Jungle", "Native American", "Cabaret", "New Wave", "Psychadelic", "Rave",
                 "Showtunes", "Trailer", "Lo-Fi", "Tribal", "Acid Punk", "Acid Jazz", "Polka", "Retro", "Musical",
                 "Rock & Roll", "Hard Rock"]

# MPEG: kbps por (versão, camada) e taxa de amostragem
_KBPS = {
    (1, 1): [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
    (1, 2): [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
    (1, 3): [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
    (2, 1): [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
    (2, 2): [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
}
_KBPS[(2, 3)] = _KBPS[(2, 2)]
_HZ = {1: [44100, 48000, 32000], 2: [22050, 24000, 16000], 25: [11025, 12000, 8000]}


def _texto(dados, enc):
    try:
        if enc == 0:
            s = dados.decode("latin-1")
        elif enc == 1:
            s = dados.decode("utf-16")
        elif enc == 2:
            s = dados.decode("utf-16-be")
        else:
            s = dados.decode("utf-8")
    except UnicodeDecodeError:
        s = dados.decode("latin-1", "replace")
    return s.replace("\x00", " ").strip()


def _sincsafe(b):
    return (b[0] << 21) | (b[1] << 14) | (b[2] << 7) | b[3]


def _id3v2(b):
    """Devolve (frames, tamanho_total_da_tag)."""
    if len(b) < 10 or b[:3] != b"ID3":
        return {}, 0
    ver, flags = b[3], b[5]
    tam = _sincsafe(b[6:10]) + 10 + (10 if flags & 0x10 else 0)
    frames, pos, fim = {}, 10, min(len(b), tam)
    if flags & 0x40 and ver >= 3:  # cabeçalho estendido
        ext = _sincsafe(b[10:14]) if ver == 4 else struct.unpack(">I", b[10:14])[0] + 4
        pos += ext
    while pos + (6 if ver == 2 else 10) <= fim:
        if ver == 2:
            fid, ftam = b[pos:pos + 3].decode("latin-1", "replace"), int.from_bytes(b[pos + 3:pos + 6], "big")
            pos += 6
        else:
            fid = b[pos:pos + 4].decode("latin-1", "replace")
            ftam = _sincsafe(b[pos + 4:pos + 8]) if ver == 4 else struct.unpack(">I", b[pos + 4:pos + 8])[0]
            pos += 10
        if not fid.strip("\x00") or ftam <= 0 or pos + ftam > len(b):
            break
        corpo = b[pos:pos + ftam]
        pos += ftam
        if fid[0] == "T" and fid not in ("TXXX", "TXX"):
            frames[fid] = _texto(corpo[1:], corpo[0])
        elif fid in ("COMM", "COM") and len(corpo) > 4:
            frames.setdefault("COMM", _texto(corpo[4:].split(b"\x00", 1)[-1] if corpo[0] in (0, 3) else corpo[4:], corpo[0]))
    return frames, tam


def _genero(g):
    if not g:
        return None
    m = re.fullmatch(r"\(?(\d+)\)?(.*)", g)
    if m and m.group(1).isdigit():
        n = int(m.group(1))
        resto = m.group(2).strip()
        return resto or (GENEROS_ID3V1[n] if n < len(GENEROS_ID3V1) else None)
    return g


def _mpeg(b, inicio, tamanho_total):
    """Acha o primeiro quadro MPEG e calcula duração (Xing/Info/VBRI ou CBR)."""
    i = inicio
    while i < len(b) - 4:
        if b[i] == 0xFF and (b[i + 1] & 0xE0) == 0xE0:
            h = struct.unpack(">I", b[i:i + 4])[0]
            vbits, lbits, bri, sri = (h >> 19) & 3, (h >> 17) & 3, (h >> 12) & 15, (h >> 10) & 3
            if vbits != 1 and lbits != 0 and bri not in (0, 15) and sri != 3:
                versao = {3: 1, 2: 2, 0: 25}[vbits]
                camada = 4 - lbits
                kbps = _KBPS[(1 if versao == 1 else 2, camada)][bri]
                hz = _HZ[versao][sri]
                amostras = 1152 if (camada == 3 and versao == 1) or camada == 2 else (576 if camada == 3 else 384)
                mono = ((h >> 6) & 3) == 3
                lado = (17 if mono else 32) if versao == 1 else (9 if mono else 17)
                x = i + 4 + lado
                if b[x:x + 4] in (b"Xing", b"Info") and len(b) >= x + 12:
                    fl = struct.unpack(">I", b[x + 4:x + 8])[0]
                    if fl & 1:
                        quadros = struct.unpack(">I", b[x + 8:x + 12])[0]
                        dur = quadros * amostras / hz
                        bytes_ = struct.unpack(">I", b[x + 12:x + 16])[0] if fl & 2 else None
                        return dur, round((bytes_ or (tamanho_total - i)) * 8 / dur / 1000) if dur else kbps
                v = i + 36
                if b[v:v + 4] == b"VBRI" and len(b) >= v + 18:
                    quadros = struct.unpack(">I", b[v + 14:v + 18])[0]
                    dur = quadros * amostras / hz
                    return dur, round((tamanho_total - i) * 8 / dur / 1000) if dur else kbps
                return (tamanho_total - i) * 8 / (kbps * 1000), kbps
        i += 1
    return None, None


def _flac(b):
    if b[:4] != b"fLaC":
        return None
    out, pos = {"formato": "flac"}, 4
    while pos + 4 <= len(b):
        ultimo, tipo, tam = b[pos] & 0x80, b[pos] & 0x7F, int.from_bytes(b[pos + 1:pos + 4], "big")
        corpo = b[pos + 4:pos + 4 + tam]
        if tipo == 0 and len(corpo) >= 18:
            hz = (corpo[10] << 12) | (corpo[11] << 4) | (corpo[12] >> 4)
            amostras = ((corpo[13] & 0x0F) << 32) | struct.unpack(">I", corpo[14:18])[0]
            out["duracao"] = amostras / hz if hz else None
        elif tipo == 4 and len(corpo) >= 8:
            vtam = struct.unpack("<I", corpo[:4])[0]
            p = 4 + vtam
            n = struct.unpack("<I", corpo[p:p + 4])[0]
            p += 4
            for _ in range(n):
                if p + 4 > len(corpo):
                    break
                ctam = struct.unpack("<I", corpo[p:p + 4])[0]
                k, _, v = corpo[p + 4:p + 4 + ctam].decode("utf-8", "replace").partition("=")
                out.setdefault(k.upper(), v)
                p += 4 + ctam
        pos += 4 + tam
        if ultimo:
            break
    return {"formato": "flac", "duracao": out.get("duracao"), "titulo": out.get("TITLE"), "artista": out.get("ARTIST"),
            "album": out.get("ALBUM"), "ano": out.get("DATE"), "faixa": out.get("TRACKNUMBER"),
            "genero": out.get("GENRE"), "compositor": out.get("COMPOSER")}


def _id3v1(fim):
    if len(fim) < 128 or fim[-128:-125] != b"TAG":
        return {}
    t = fim[-128:]
    s = lambda a, z: t[a:z].split(b"\x00")[0].decode("latin-1", "replace").strip() or None
    faixa = t[126] if t[125] == 0 and t[126] else None
    g = t[127]
    return {"titulo": s(3, 33), "artista": s(33, 63), "album": s(63, 93), "ano": s(93, 97),
            "faixa": str(faixa) if faixa else None, "genero": GENEROS_ID3V1[g] if g < len(GENEROS_ID3V1) else None}


def ler(cabeca, tamanho_total, ler_fim=None):
    f = _flac(cabeca)
    if f:
        return f
    frames, tam_tag = _id3v2(cabeca)
    # tag ID3 maior que o pedaço lido (capa embutida grande antes do título): lê a tag inteira
    if tam_tag and tam_tag + 4 > len(cabeca) and ler_fim:
        cabeca = ler_fim("tag", tam_tag) or cabeca
        frames, tam_tag = _id3v2(cabeca)
    if tam_tag + 4 <= len(cabeca):
        dur, kbps = _mpeg(cabeca, tam_tag, tamanho_total)
    elif ler_fim:  # tag maior que tudo o que foi lido: busca só o trecho de áudio logo depois dela
        depois = ler_fim("depois_tag", tam_tag) or b""
        dur, kbps = _mpeg(depois, 0, tamanho_total - tam_tag)
    else:
        dur, kbps = None, None
    g = lambda *ks: next((frames[k] for k in ks if frames.get(k)), None)
    r = {"formato": "mp3", "titulo": g("TIT2", "TT2"), "artista": g("TPE1", "TP1"), "album": g("TALB", "TAL"),
         "ano": g("TDRC", "TYER", "TYE", "TDOR", "TORY"), "faixa": g("TRCK", "TRK"), "genero": _genero(g("TCON", "TCO")),
         "compositor": g("TCOM", "TCM"), "duracao": dur, "kbps": kbps}
    if frames.get("TLEN") and frames["TLEN"].isdigit() and not r["duracao"]:
        r["duracao"] = int(frames["TLEN"]) / 1000
    if not r["titulo"] and ler_fim:
        v1 = _id3v1(ler_fim("fim", 128) or b"")
        for k, v in v1.items():
            r[k] = r.get(k) or v
    return r
