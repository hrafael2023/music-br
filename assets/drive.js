/* Music BR — acesso ao Google Drive (privado) pelo navegador.
 *
 * Quem abre o site entra com a conta Google (botão "Conectar Drive"); o site
 * recebe um token só de leitura (drive.readonly) e acha a pasta de cada disco
 * seguindo o caminho ESTILO/LETRA/ARTISTA/ANO - DISCO. Nada fica público:
 * só quem tem acesso à pasta no Drive vê as capas e ouve as faixas.
 */
(function () {
  "use strict";
  var CFG = window.MUSICBR || {};
  var API = "https://www.googleapis.com/drive/v3/files";
  var ESCOPO = "https://www.googleapis.com/auth/drive.readonly";
  var CHAVE_TOKEN = "mbr-token";
  var CHAVE_PASTA = "mbr-p:";
  var VALIDADE_PASTA = 14 * 864e5; // 14 dias

  var token = null, expira = 0, cliente = null, ouvintes = [], pedindo = null;

  function ls(fn) { try { return fn(); } catch (e) { return null; } }

  (function lerToken() {
    var t = ls(function () { return JSON.parse(localStorage.getItem(CHAVE_TOKEN)); });
    if (t && t.exp > Date.now() + 60e3) { token = t.token; expira = t.exp; }
  })();

  function avisar() { ouvintes.forEach(function (f) { try { f(conectado()); } catch (e) {} }); }
  function configurado() { return !!CFG.googleClientId; }
  function conectado() { return !!token && expira > Date.now() + 30e3; }

  function carregarGIS() {
    if (window.google && google.accounts && google.accounts.oauth2) return Promise.resolve();
    return new Promise(function (ok, erro) {
      var s = document.createElement("script");
      s.src = "https://accounts.google.com/gsi/client";
      s.async = true; s.onload = ok; s.onerror = function () { erro(new Error("Não consegui carregar o login do Google.")); };
      document.head.appendChild(s);
    });
  }

  function iniciarCliente() {
    if (cliente) return;
    cliente = google.accounts.oauth2.initTokenClient({
      client_id: CFG.googleClientId,
      scope: ESCOPO,
      callback: function () {} // trocado a cada pedido
    });
  }

  // Precisa ser chamado num clique (o Google abre um popup).
  function conectar() {
    if (!configurado()) return Promise.reject(new Error("O login do Google ainda não foi configurado (assets/config.js)."));
    if (pedindo) return pedindo;
    pedindo = carregarGIS().then(function () {
      iniciarCliente();
      return new Promise(function (ok, erro) {
        cliente.callback = function (r) {
          if (r.error) return erro(new Error(r.error_description || r.error));
          token = r.access_token;
          memoFilhos = {}; memoDisco = {}; memoCapa = {}; // outra conta pode ver outras pastas
          expira = Date.now() + (Number(r.expires_in) || 3600) * 1000;
          ls(function () { localStorage.setItem(CHAVE_TOKEN, JSON.stringify({ token: token, exp: expira })); });
          avisar(); ok();
        };
        cliente.error_callback = function (e) { erro(new Error(e && e.type === "popup_closed" ? "Login cancelado." : "Login não concluído.")); };
        cliente.requestAccessToken({ prompt: "" });
      });
    });
    pedindo.then(limpa, limpa);
    function limpa() { pedindo = null; }
    return pedindo;
  }

  function desconectar() {
    if (token && window.google && google.accounts) ls(function () { google.accounts.oauth2.revoke(token, function () {}); });
    token = null; expira = 0;
    ls(function () { localStorage.removeItem(CHAVE_TOKEN); });
    avisar();
  }

  // Deixa o script do Google pronto para o clique não ser bloqueado como popup.
  if (configurado()) carregarGIS().then(iniciarCliente, function () {});

  // modo: falso = JSON, true = Blob, "buffer" = ArrayBuffer; extras = cabeçalhos a mais (ex.: Range)
  function chamar(url, modo, extras) {
    if (!conectado()) return Promise.reject(Object.assign(new Error("Conecte o Drive."), { semLogin: true }));
    var cab = { Authorization: "Bearer " + token };
    for (var k in extras || {}) cab[k] = extras[k];
    return fetch(url, { headers: cab }).then(function (r) {
      if (r.status === 401) { token = null; ls(function () { localStorage.removeItem(CHAVE_TOKEN); }); avisar(); throw Object.assign(new Error("O login expirou. Conecte de novo."), { semLogin: true }); }
      if (r.status === 403 || r.status === 404) throw Object.assign(new Error("Sem acesso a esse arquivo no Drive."), { semAcesso: true });
      if (!r.ok) throw new Error("O Drive respondeu " + r.status + ".");
      return modo === "buffer" ? r.arrayBuffer() : modo ? r.blob() : r.json();
    });
  }

  function listar(q, campos) {
    var tudo = [];
    function pagina(tok) {
      var p = new URLSearchParams({
        q: q, pageSize: "1000", fields: "nextPageToken,files(" + (campos || "id,name,mimeType") + ")",
        supportsAllDrives: "true", includeItemsFromAllDrives: "true", orderBy: "name"
      });
      if (tok) p.set("pageToken", tok);
      return chamar(API + "?" + p).then(function (r) {
        tudo = tudo.concat(r.files || []);
        return r.nextPageToken ? pagina(r.nextPageToken) : tudo;
      });
    }
    return pagina();
  }

  var PASTA = "application/vnd.google-apps.folder";
  function esc(s) { return String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'"); }
  function norm(s) { return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, ""); }

  var memoFilhos = {};
  function subpastas(pai) {
    if (!memoFilhos[pai]) memoFilhos[pai] = listar("'" + pai + "' in parents and mimeType = '" + PASTA + "' and trashed = false")
      .catch(function (e) { delete memoFilhos[pai]; throw e; });
    return memoFilhos[pai];
  }

  // Acha a subpasta pelo nome exato; se não houver, pelo nome normalizado (sem acento/pontuação).
  function acharFilho(pai, nomes) {
    var alvo = nomes.map(norm);
    return subpastas(pai).then(function (fs) {
      for (var i = 0; i < nomes.length; i++) {
        var f = fs.find(function (x) { return x.name === nomes[i]; });
        if (f) return f;
      }
      for (var j = 0; j < alvo.length; j++) {
        var g = fs.find(function (x) { return norm(x.name) === alvo[j]; });
        if (g) return g;
      }
      return null;
    });
  }

  function acharPastaDisco(d) {
    var raiz = (CFG.pastas || {})[d.estilo];
    if (!raiz) return Promise.resolve(null);
    var nomesDisco = d.ano ? [d.ano + " - " + d.disco, d.disco] : [d.disco];
    return acharFilho(raiz, [d.letra]).then(function (letra) {
      if (!letra) return null;
      // coletâneas (VA) não têm pasta de artista: ESTILO/--VA/ANO - DISCO
      return acharFilho(letra.id, [d.artista]).then(function (art) { return art || letra; });
    }).then(function (art) {
      if (!art) return null;
      return acharFilho(art.id, nomesDisco).then(function (f) {
        if (f) return f;
        // último recurso: pasta do artista cujo nome termina com o nome do disco
        var alvo = norm(d.disco);
        return subpastas(art.id).then(function (fs) {
          return fs.find(function (x) { var n = norm(x.name); return n.slice(-alvo.length) === alvo && (!d.ano || n.indexOf(String(d.ano)) === 0); }) || null;
        });
      });
    });
  }

  var AUDIO = /\.(mp3|flac|m4a|aac|ogg|oga|opus|wav|wma)$/i;
  function natural(a, b) { return a.name.localeCompare(b.name, "pt-BR", { numeric: true, sensitivity: "base" }); }

  function conteudo(pasta) {
    var campos = "id,name,mimeType,size";
    return listar("'" + pasta.id + "' in parents and trashed = false", campos).then(function (fs) {
      var subs = fs.filter(function (f) { return f.mimeType === PASTA; });
      return Promise.all(subs.map(function (s) {
        return listar("'" + s.id + "' in parents and trashed = false", campos).then(function (xs) {
          return xs.map(function (x) { x.name = s.name + " / " + x.name; return x; });
        });
      })).then(function (extra) {
        var arquivos = fs.filter(function (f) { return f.mimeType !== PASTA; });
        var todos = [].concat.apply(arquivos, extra);
        var faixas = todos.filter(function (f) { return /^audio\//.test(f.mimeType) || AUDIO.test(f.name); }).sort(natural);
        var imgs = todos.filter(function (f) { return /^image\//.test(f.mimeType); });
        // imagem da pasta (só é usada se a música não tiver capa embutida):
        // prefere frente/folder/cover; descarta verso, contra-capa, CD, encarte
        var pontos = function (f) {
          var n = f.name.toLowerCase(), p = 0;
          if (/(back|verso|tras|contra|inlay|tray|booklet|encarte|interno|inside|\bcd\b|disc|label|selo)/.test(n)) p -= 10;
          if (/(front|frente)/.test(n)) p += 6;
          if (/(folder|cover|capa)/.test(n)) p += 4;
          if (f.name.indexOf("/") >= 0) p -= 2;
          return p;
        };
        var capa = imgs.slice().sort(function (a, b) { return pontos(b) - pontos(a); })[0] || null;
        return {
          pasta: pasta.id,
          capa: capa ? capa.id : null,
          faixas: faixas.map(function (f) { return { id: f.id, nome: f.name, tam: Number(f.size) || 0 }; })
        };
      });
    });
  }

  var memoDisco = {};
  // só guarda pasta achada e com faixas: pasta vazia pode ser compartilhamento do Drive ainda propagando
  function util(v) { return !!(v && v.faixas && v.faixas.length); }
  function disco(d) {
    if (memoDisco[d.id]) return memoDisco[d.id];
    var salvo = ls(function () { return JSON.parse(localStorage.getItem(CHAVE_PASTA + d.id)); });
    // só vale o que foi achado (um "não achei" antigo pode ser de antes de a conta ter acesso à pasta)
    if (salvo && util(salvo.v) && salvo.t > Date.now() - VALIDADE_PASTA) return (memoDisco[d.id] = Promise.resolve(salvo.v));
    memoDisco[d.id] = acharPastaDisco(d).then(function (p) { return p ? conteudo(p) : null; }).then(function (v) {
      if (util(v)) ls(function () { localStorage.setItem(CHAVE_PASTA + d.id, JSON.stringify({ t: Date.now(), v: v })); });
      else { ls(function () { localStorage.removeItem(CHAVE_PASTA + d.id); }); setTimeout(function () { delete memoDisco[d.id]; }, 0); }
      return v;
    }, function (e) { delete memoDisco[d.id]; throw e; });
    return memoDisco[d.id];
  }

  // fila simples: no máximo N downloads de capa ao mesmo tempo
  var fila = [], ativos = 0, MAX = 4;
  function naFila(fn) {
    return new Promise(function (ok, erro) { fila.push([fn, ok, erro]); puxar(); });
  }
  function puxar() {
    while (ativos < MAX && fila.length) {
      var it = fila.shift(); ativos++;
      it[0]().then(it[1], it[2]).then(fim, fim);
    }
    function fim() { ativos--; puxar(); }
  }

  /* ---------- capa embutida na música (ID3 APIC/PIC ou FLAC PICTURE) ----------
     Lê só a tag do começo do arquivo (Range) e devolve um Blob da imagem — preferindo a "frente". */
  function trecho(id, ini, fim) {
    return chamar(API + "/" + id + "?alt=media", "buffer", { Range: "bytes=" + ini + "-" + fim }).then(function (ab) { return new Uint8Array(ab); });
  }
  function ss(b, i) { return (b[i] << 21) | (b[i + 1] << 14) | (b[i + 2] << 7) | b[i + 3]; } // inteiro "syncsafe"
  function u32(b, i) { return ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3]; }
  function latin(b, ini, fim) { var s = ""; for (var i = ini; i < fim; i++) s += String.fromCharCode(b[i]); return s; }
  // fim de texto terminado em zero (1 byte em latin-1/utf-8; 2 bytes em utf-16)
  function fimTexto(b, i, enc) {
    if (enc === 1 || enc === 2) { while (i + 1 < b.length && !(b[i] === 0 && b[i + 1] === 0)) i += 2; return i + 2; }
    while (i < b.length && b[i] !== 0) i++;
    return i + 1;
  }
  function imagemId3(b) {
    var ver = b[3], pos = 10, tam = ss(b, 6) + 10, fim = Math.min(b.length, tam), achadas = [];
    if (b[5] & 0x40 && ver >= 3) pos += ver === 4 ? ss(b, 10) : u32(b, 10) + 4;
    while (pos + (ver === 2 ? 6 : 10) <= fim) {
      var id, ft;
      if (ver === 2) { id = latin(b, pos, pos + 3); ft = (b[pos + 3] << 16) | (b[pos + 4] << 8) | b[pos + 5]; pos += 6; }
      else { id = latin(b, pos, pos + 4); ft = ver === 4 ? ss(b, pos + 4) : u32(b, pos + 4); pos += 10; }
      if (!/^[A-Z0-9]{3,4}$/.test(id) || ft <= 0 || pos + ft > b.length) break;
      if (id === "APIC" || id === "PIC") {
        var c = pos, enc = b[c++], mime;
        if (id === "PIC") { mime = latin(b, c, c + 3).toLowerCase() === "png" ? "image/png" : "image/jpeg"; c += 3; }
        else { var z = c; while (z < pos + ft && b[z] !== 0) z++; mime = latin(b, c, z) || "image/jpeg"; c = z + 1; }
        if (mime.indexOf("/") < 0) mime = "image/" + mime.toLowerCase().replace("jpg", "jpeg");
        var tipo = b[c++];
        c = fimTexto(b, c, enc);
        if (c < pos + ft) achadas.push({ tipo: tipo, blob: new Blob([b.slice(c, pos + ft)], { type: mime }) });
      }
      pos += ft;
    }
    return escolher(achadas);
  }
  function imagemFlac(b) {
    var pos = 4, achadas = [];
    while (pos + 4 <= b.length) {
      var ultimo = b[pos] & 0x80, tipo = b[pos] & 0x7f, tam = (b[pos + 1] << 16) | (b[pos + 2] << 8) | b[pos + 3];
      var c = pos + 4;
      if (tipo === 6 && c + tam <= b.length) {
        var ptipo = u32(b, c), ml = u32(b, c + 4), mime = latin(b, c + 8, c + 8 + ml), dl = u32(b, c + 8 + ml);
        var ini = c + 8 + ml + 4 + dl + 16, n = u32(b, ini);
        achadas.push({ tipo: ptipo, blob: new Blob([b.slice(ini + 4, ini + 4 + n)], { type: mime || "image/jpeg" }) });
      }
      pos = c + tam;
      if (ultimo) break;
    }
    return escolher(achadas);
  }
  function escolher(achadas) { // 3 = capa (frente); senão a primeira imagem
    var f = achadas.filter(function (a) { return a.tipo === 3; })[0] || achadas[0];
    return f && f.blob.size > 1000 ? f.blob : null;
  }
  function capaEmbutida(faixa) {
    var LIMITE = 4 * 1024 * 1024;
    var ultimo = Math.max(0, Math.min(faixa.tam || LIMITE, 262144) - 1);
    return trecho(faixa.id, 0, ultimo).then(function (b) {
      if (latin(b, 0, 4) === "fLaC") {
        var img = imagemFlac(b);
        if (img || b.length < 262144) return img;
        return trecho(faixa.id, 0, Math.min(LIMITE, (faixa.tam || LIMITE)) - 1).then(imagemFlac);
      }
      if (latin(b, 0, 3) !== "ID3") return null;
      var tam = ss(b, 6) + 10;
      if (tam <= b.length) return imagemId3(b);
      return trecho(faixa.id, 0, Math.min(tam, LIMITE) - 1).then(imagemId3); // capa grande: lê a tag inteira
    }).catch(function () { return null; });
  }

  // capas já baixadas ficam guardadas no navegador (Cache Storage), para não baixar de novo
  var CACHE_CAPAS = "mbr-capas-v1";
  function capaGuardada(id) {
    if (!window.caches) return Promise.resolve(null);
    return caches.open(CACHE_CAPAS).then(function (c) { return c.match("/capa/" + id); })
      .then(function (r) { return r ? r.blob() : null; }).catch(function () { return null; });
  }
  function guardarCapa(id, blob) {
    if (!window.caches || !blob) return;
    caches.open(CACHE_CAPAS).then(function (c) { return c.put("/capa/" + id, new Response(blob, { headers: { "Content-Type": blob.type } })); }).catch(function () {});
  }

  var memoCapa = {};
  function capa(d) {
    if (memoCapa[d.id]) return memoCapa[d.id];
    memoCapa[d.id] = naFila(function () {
      // 1º capa já guardada; 2º capa embutida na 1ª música; 3º imagem da pasta
      return capaGuardada(d.id).then(function (salva) {
        if (salva) return URL.createObjectURL(salva);
        return disco(d).then(function (info) {
          if (!util(info)) { delete memoCapa[d.id]; if (!info || !info.capa) return null; } // pasta não achada: tenta de novo depois
          var embutida = info.faixas && info.faixas[0] ? capaEmbutida(info.faixas[0]) : Promise.resolve(null);
          return embutida.then(function (blob) {
            if (blob) return blob;
            return info.capa ? chamar(API + "/" + info.capa + "?alt=media", true) : null;
          }).then(function (blob) {
            if (!blob) return null;
            guardarCapa(d.id, blob);
            return URL.createObjectURL(blob);
          });
        });
      });
    }).catch(function (e) { delete memoCapa[d.id]; throw e; });
    return memoCapa[d.id];
  }

  var memoAudio = {}, ordemAudio = [];
  function audio(id) {
    if (memoAudio[id]) return memoAudio[id];
    memoAudio[id] = chamar(API + "/" + id + "?alt=media", true).then(function (b) { return URL.createObjectURL(b); })
      .catch(function (e) { delete memoAudio[id]; throw e; });
    ordemAudio.push(id);
    while (ordemAudio.length > 6) { // guarda só as últimas faixas na memória
      var velho = ordemAudio.shift();
      var p = memoAudio[velho]; delete memoAudio[velho];
      if (p) p.then(function (u) { setTimeout(function () { URL.revokeObjectURL(u); }, 60e3); }, function () {});
    }
    return memoAudio[id];
  }

  window.DriveBR = {
    configurado: configurado,
    conectado: conectado,
    conectar: conectar,
    desconectar: desconectar,
    aoMudar: function (f) { ouvintes.push(f); },
    disco: disco,
    capa: capa,
    audio: audio
  };
})();
