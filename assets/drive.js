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

  function chamar(url, comoBlob) {
    if (!conectado()) return Promise.reject(Object.assign(new Error("Conecte o Drive."), { semLogin: true }));
    return fetch(url, { headers: { Authorization: "Bearer " + token } }).then(function (r) {
      if (r.status === 401) { token = null; ls(function () { localStorage.removeItem(CHAVE_TOKEN); }); avisar(); throw Object.assign(new Error("O login expirou. Conecte de novo."), { semLogin: true }); }
      if (r.status === 403 || r.status === 404) throw Object.assign(new Error("Sem acesso a esse arquivo no Drive."), { semAcesso: true });
      if (!r.ok) throw new Error("O Drive respondeu " + r.status + ".");
      return comoBlob ? r.blob() : r.json();
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
      return acharFilho(letra.id, [d.artista]);
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
  var IMG_PREF = /(cover|folder|front|capa|frente)/i;
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
        var capa = imgs.find(function (f) { return IMG_PREF.test(f.name) && f.name.indexOf("/") < 0; }) ||
                   imgs.find(function (f) { return f.name.indexOf("/") < 0; }) || imgs[0] || null;
        return {
          pasta: pasta.id,
          capa: capa ? capa.id : null,
          faixas: faixas.map(function (f) { return { id: f.id, nome: f.name, tam: Number(f.size) || 0 }; })
        };
      });
    });
  }

  var memoDisco = {};
  function disco(d) {
    if (memoDisco[d.id]) return memoDisco[d.id];
    var salvo = ls(function () { return JSON.parse(localStorage.getItem(CHAVE_PASTA + d.id)); });
    // só vale o que foi achado (um "não achei" antigo pode ser de antes de a conta ter acesso à pasta)
    if (salvo && salvo.v && salvo.t > Date.now() - VALIDADE_PASTA) return (memoDisco[d.id] = Promise.resolve(salvo.v));
    memoDisco[d.id] = acharPastaDisco(d).then(function (p) { return p ? conteudo(p) : null; }).then(function (v) {
      if (v) ls(function () { localStorage.setItem(CHAVE_PASTA + d.id, JSON.stringify({ t: Date.now(), v: v })); });
      else { ls(function () { localStorage.removeItem(CHAVE_PASTA + d.id); }); delete memoDisco[d.id]; }
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

  var memoCapa = {};
  function capa(d) {
    if (memoCapa[d.id]) return memoCapa[d.id];
    memoCapa[d.id] = naFila(function () {
      return disco(d).then(function (info) {
        if (!info) { delete memoCapa[d.id]; return null; } // pasta não achada: tenta de novo da próxima vez
        if (!info.capa) return null;
        return chamar(API + "/" + info.capa + "?alt=media", true).then(function (b) { return URL.createObjectURL(b); });
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
