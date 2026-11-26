"""Acesso ao Google Drive com a conta de serviço do Music BR (somente leitura).

A chave fica fora do repositório, em ~/.config/music-br/conta-servico.json
(ou no caminho da variável MUSICBR_CHAVE). Nunca coloque a chave no git.
"""
import base64
import json
import os
import threading
import time
import urllib.parse
import urllib.request
from urllib.error import HTTPError

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding

CHAVE = os.environ.get("MUSICBR_CHAVE", os.path.expanduser("~/.config/music-br/conta-servico.json"))
ESCOPO = "https://www.googleapis.com/auth/drive.readonly"
API = "https://www.googleapis.com/drive/v3/files"
PASTA = "application/vnd.google-apps.folder"


def _b64(b):
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


class Drive:
    def __init__(self, chave=CHAVE):
        with open(chave) as f:
            self._sa = json.load(f)
        self._pk = serialization.load_pem_private_key(self._sa["private_key"].encode(), password=None)
        self._token, self._expira = None, 0
        self._trava = threading.Lock()

    def token(self):
        with self._trava:
            if self._token and time.time() < self._expira - 120:
                return self._token
            agora = int(time.time())
            cab = _b64(json.dumps({"alg": "RS256", "typ": "JWT"}).encode())
            corpo = _b64(json.dumps({
                "iss": self._sa["client_email"], "scope": ESCOPO, "aud": self._sa["token_uri"],
                "iat": agora, "exp": agora + 3600,
            }).encode())
            assinatura = self._pk.sign(f"{cab}.{corpo}".encode(), padding.PKCS1v15(), hashes.SHA256())
            jwt = f"{cab}.{corpo}.{_b64(assinatura)}"
            dados = urllib.parse.urlencode({"grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer", "assertion": jwt}).encode()
            with urllib.request.urlopen(urllib.request.Request(self._sa["token_uri"], data=dados), timeout=30) as r:
                j = json.load(r)
            self._token, self._expira = j["access_token"], agora + int(j.get("expires_in", 3600))
            return self._token

    def _pedido(self, url, cabecalhos=None, tentativas=5):
        for t in range(tentativas):
            req = urllib.request.Request(url, headers={"Authorization": "Bearer " + self.token(), **(cabecalhos or {})})
            try:
                with urllib.request.urlopen(req, timeout=60) as r:
                    return r.read()
            except HTTPError as e:
                if e.code in (429, 500, 502, 503, 504) or (e.code == 403 and b"rateLimit" in e.read()):
                    time.sleep(min(60, 2 ** t + 0.5))
                    continue
                raise
            except Exception:
                if t == tentativas - 1:
                    raise
                time.sleep(2 ** t)
        raise RuntimeError("Drive não respondeu depois de várias tentativas: " + url)

    def listar(self, q, campos="id,name,mimeType,size"):
        tudo, pagina = [], None
        while True:
            p = {"q": q, "pageSize": "1000", "fields": f"nextPageToken,files({campos})",
                 "supportsAllDrives": "true", "includeItemsFromAllDrives": "true"}
            if pagina:
                p["pageToken"] = pagina
            j = json.loads(self._pedido(API + "?" + urllib.parse.urlencode(p)))
            tudo += j.get("files", [])
            pagina = j.get("nextPageToken")
            if not pagina:
                return tudo

    def filhos(self, pai, so_pastas=False):
        q = f"'{pai}' in parents and trashed = false"
        if so_pastas:
            q += f" and mimeType = '{PASTA}'"
        return self.listar(q)

    def trecho(self, arquivo_id, inicio, fim):
        """Bytes [inicio, fim] do arquivo (sem baixar o resto)."""
        return self._pedido(f"{API}/{arquivo_id}?alt=media", {"Range": f"bytes={inicio}-{fim}"})
