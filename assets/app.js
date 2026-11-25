/* Music BR — site estático que lê data/musicbr.json (gerado da planilha). */
(function () {
  "use strict";
  var CFG = window.MUSICBR || {};
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };
  var app = $("#app");
  var fmt = new Intl.NumberFormat("pt-BR");
  var n = function (x) { return fmt.format(x); };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function norm(s) { return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(); }
  function ls(fn) { try { return fn(); } catch (e) { return null; } }

  /* ---------- dados ---------- */
  var DB = { discos: [], porId: {}, artistas: {}, atualizado: null };
  var TIPOS = ["EP", "SINGLE", "DEMO", "BOOTLEG", "OST", "SPLIT", "MIXTAPE", "DELUXE", "BOX", "DVD"];

  function tipoDe(titulo) {
    var m = String(titulo).match(/\[([^\]]+)\]/g) || [];
    for (var i = 0; i < m.length; i++) {
      var t = m[i].slice(1, -1).toUpperCase();
      if (TIPOS.indexOf(t) >= 0) return t;
    }
    return "ÁLBUM";
  }

  function carregar() {
    return fetch("data/musicbr.json", { cache: "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error("Não consegui ler o catálogo (" + r.status + ").");
      return r.json();
    }).then(function (j) {
      DB.atualizado = j.atualizado;
      DB.discos = j.discos.map(function (l, i) {
        var d = { id: l[0], estilo: l[1], letra: l[2], artista: l[3], ano: l[4], disco: l[5], musicas: l[6] || 0, ordem: i };
        d.tipo = tipoDe(d.disco);
        d.busca = norm(d.artista + " " + d.disco);
        DB.porId[d.id] = d;
        (DB.artistas[d.artista] = DB.artistas[d.artista] || []).push(d);
        return d;
      });
    });
  }

  var memoStats = null;
  function stats() {
    if (memoStats) return memoStats;
    var s = { discos: DB.discos.length, musicas: 0, artistas: 0, anos: {}, decadas: {}, estilos: {}, tipos: {}, semAno: 0, min: 9999, max: 0, va: 0 };
    DB.discos.forEach(function (d) {
      s.musicas += d.musicas;
      var e = s.estilos[d.estilo] = s.estilos[d.estilo] || { discos: 0, musicas: 0 };
      e.discos++; e.musicas += d.musicas;
      s.tipos[d.tipo] = (s.tipos[d.tipo] || 0) + 1;
      if (d.artista === "VA") s.va++;
      if (d.ano) {
        var a = s.anos[d.ano] = s.anos[d.ano] || { discos: 0, musicas: 0 };
        a.discos++; a.musicas += d.musicas;
        var dec = Math.floor(d.ano / 10) * 10;
        var dd = s.decadas[dec] = s.decadas[dec] || { discos: 0, musicas: 0 };
        dd.discos++; dd.musicas += d.musicas;
        if (d.ano < s.min) s.min = d.ano;
        if (d.ano > s.max) s.max = d.ano;
      } else s.semAno++;
    });
    var arts = Object.keys(DB.artistas).map(function (nome) {
      var ds = DB.artistas[nome];
      return { nome: nome, discos: ds.length, musicas: ds.reduce(function (t, d) { return t + d.musicas; }, 0) };
    });
    s.artistas = arts.length;
    s.listaArtistas = arts;
    s.topDiscos = arts.filter(function (a) { return a.nome !== "VA"; }).sort(function (a, b) { return b.discos - a.discos || b.musicas - a.musicas; });
    s.topMusicas = arts.filter(function (a) { return a.nome !== "VA"; }).sort(function (a, b) { return b.musicas - a.musicas; });
    return (memoStats = s);
  }

  /* ---------- pedaços de HTML ---------- */
  function urlArtista(nome) { return "#/artista/" + encodeURIComponent(nome); }
  function urlDisco(d) { return "#/disco/" + d.id; }
  function iniciais(d) { return (d.artista.replace(/[^\p{L}\p{N} ]/gu, "").trim().split(/\s+/).slice(0, 2).map(function (p) { return p[0]; }).join("") || "♪"); }
  function capa(d) { return '<div class="capa" data-capa="' + d.id + '" data-ini="' + esc(iniciais(d)) + '"></div>'; }
  function selos(d) {
    return '<span class="selo estilo">' + esc(d.estilo) + "</span>" + (d.tipo !== "ÁLBUM" ? '<span class="selo">' + esc(d.tipo) + "</span>" : "");
  }
  function card(d, semArtista) {
    return '<a class="card-disco" href="' + urlDisco(d) + '">' + capa(d) +
      '<div class="t">' + esc(d.disco) + "</div>" +
      (semArtista ? "" : '<div class="a">' + esc(d.artista) + "</div>") +
      '<div class="y">' + (d.ano || "s/ ano") + " · " + n(d.musicas) + " faixas</div></a>";
  }
  function avisoDrive(texto) {
    if (!DriveBR.configurado()) {
      return '<div class="aviso-drive"><span>Capas e player vêm do Google Drive privado. O login do Google ainda não foi configurado neste site.</span></div>';
    }
    if (DriveBR.conectado()) return "";
    return '<div class="aviso-drive"><span>' + (texto || "Entre com a conta Google que tem acesso à pasta MUSICBR para ver as capas e ouvir os discos.") +
      '</span><button type="button" class="btn" data-conectar>Conectar Drive</button></div>';
  }

  // barras horizontais de uma série (um tom só)
  function hbar(linhas, chave, rot) {
    var max = Math.max.apply(null, linhas.map(function (l) { return l[chave]; })) || 1;
    return '<div class="hbar">' + linhas.map(function (l) {
      var nome = l.link ? '<a class="nome" href="' + l.link + '">' + esc(l.nome) + "</a>" : '<span class="nome">' + esc(l.nome) + "</span>";
      return nome + '<div class="trilho" data-tip="<b>' + esc(l.nome) + "</b><br>" + n(l[chave]) + " " + rot + '"><div class="b" style="width:' + (l[chave] / max * 100).toFixed(2) + '%"></div></div>' +
        '<span class="n">' + n(l[chave]) + "</span>";
    }).join("") + "</div>";
  }
  // colunas (por ano/década)
  function colunas(chaves, valor, rotulo, unidade, altura) {
    var vals = chaves.map(valor);
    var max = Math.max.apply(null, vals) || 1;
    var html = '<div class="colunas"' + (altura ? ' style="height:' + altura + 'px"' : "") + ">" + chaves.map(function (k, i) {
      return '<div class="c" data-tip="<b>' + esc(rotulo(k)) + "</b><br>" + n(vals[i]) + " " + unidade + '"><i style="height:' + (vals[i] / max * 100).toFixed(2) + '%"></i></div>';
    }).join("") + "</div>";
    var meio = chaves[Math.floor(chaves.length / 2)];
    return html + '<div class="eixo"><span>' + esc(rotulo(chaves[0])) + "</span><span>" + esc(rotulo(meio)) + "</span><span>" + esc(rotulo(chaves[chaves.length - 1])) + "</span></div>";
  }

  function kpis(s) {
    return '<div class="kpis">' +
      kpi(n(s.discos), "discos", n(s.tipos["ÁLBUM"] || 0) + " álbuns, " + n(s.discos - (s.tipos["ÁLBUM"] || 0)) + " EPs, singles e outros") +
      kpi(n(s.musicas), "músicas", "média de " + (s.musicas / s.discos).toFixed(1).replace(".", ",") + " por disco") +
      kpi(n(s.artistas), "artistas", n(s.va) + " coletâneas (VA)") +
      kpi(s.min + "–" + s.max, "anos de lançamento", n(s.semAno) + " discos sem ano") + "</div>";
    function kpi(v, r, sub) { return '<div class="kpi"><div class="v">' + v + '</div><div class="r">' + r + '</div><div class="s">' + sub + "</div></div>"; }
  }

  function decadasHTML(s, medida) {
    var ks = Object.keys(s.decadas).map(Number).sort(function (a, b) { return a - b; });
    return colunas(ks, function (k) { return s.decadas[k][medida]; }, function (k) { return "anos " + String(k).slice(-2) + " (" + k + ")"; }, medida === "discos" ? "discos" : "músicas", 180)
      .replace(/<div class="eixo">[\s\S]*<\/div>$/, '<div class="eixo">' + ks.map(function (k) { return "<span>" + String(k).slice(-2) + "</span>"; }).join("") + "</div>");
  }

  function estilosTiposHTML(s) {
    var est = Object.keys(s.estilos).map(function (k) { return { nome: k, discos: s.estilos[k].discos, link: "#/discos?estilo=" + encodeURIComponent(k) }; })
      .sort(function (a, b) { return b.discos - a.discos; });
    var tip = Object.keys(s.tipos).map(function (k) { return { nome: k === "ÁLBUM" ? "Álbum" : k, discos: s.tipos[k], link: "#/discos?tipo=" + encodeURIComponent(k) }; })
      .sort(function (a, b) { return b.discos - a.discos; });
    return '<div class="cartao painel"><h3>Por estilo</h3>' + hbar(est, "discos", "discos") +
      '<h3 style="margin-top:20px">Por tipo de lançamento</h3>' + hbar(tip, "discos", "discos") +
      '<p class="nota">Tipo lido da etiqueta no nome do disco, como [EP] ou [SINGLE].</p></div>';
  }

  /* ---------- páginas ---------- */
  function paginaInicio() {
    var s = stats();
    var ultimos = DB.discos.slice(-10).reverse();
    var top = s.topDiscos.slice(0, 10).map(function (a) { return { nome: a.nome, discos: a.discos, link: urlArtista(a.nome) }; });
    app.innerHTML =
      '<section class="secao"><div class="secao-topo"><h2>Últimas inserções</h2><span class="muted">as 10 linhas mais recentes da planilha</span>' +
      '<a class="mais" href="#/discos">ver todos os discos →</a></div>' + avisoDrive() +
      '<div class="grade-capas">' + ultimos.map(function (d) { return card(d); }).join("") + "</div></section>" +
      '<section class="secao"><div class="secao-topo"><h2>Resumo do acervo</h2><a class="mais" href="#/numeros">dashboard completo →</a></div>' +
      kpis(s) +
      '<div class="paineis tres"><div class="cartao painel"><h3>Discos por década de lançamento</h3>' + decadasHTML(s, "discos") +
      '<p class="nota">' + n(s.semAno) + ' discos sem ano não entram no gráfico.</p></div>' + estilosTiposHTML(s) + "</div>" +
      '<div class="cartao painel" style="margin-top:16px"><h3>Artistas com mais discos</h3>' + hbar(top, "discos", "discos") +
      '<p class="nota">Sem contar as coletâneas de vários artistas (VA, ' + n(s.va) + " discos).</p></div></section>";
    hidratarCapas();
  }

  function paginaNumeros(params) {
    var s = stats();
    var medida = params.get("m") === "musicas" ? "musicas" : "discos";
    var rot = medida === "discos" ? "discos" : "músicas";
    var anos = [];
    for (var a = s.min; a <= s.max; a++) anos.push(a);
    var topD = s.topDiscos.slice(0, 25).map(function (x) { return { nome: x.nome, v: x.discos, link: urlArtista(x.nome) }; });
    var topM = s.topMusicas.slice(0, 25).map(function (x) { return { nome: x.nome, v: x.musicas, link: urlArtista(x.nome) }; });
    var est = Object.keys(s.estilos).map(function (k) { return { nome: k, v: s.estilos[k][medida], link: "#/discos?estilo=" + encodeURIComponent(k) }; });
    app.innerHTML =
      '<section class="secao"><div class="secao-topo"><h2>Números do acervo</h2>' +
      '<div class="filtros" style="margin:0 0 0 auto"><label class="muted" for="medida">Medir por</label><select id="medida"><option value="discos">discos</option><option value="musicas">músicas</option></select></div></div>' +
      kpis(s) +
      '<div class="cartao painel"><h3>' + (medida === "discos" ? "Discos" : "Músicas") + " por ano de lançamento</h3>" +
      colunas(anos, function (k) { return (s.anos[k] || {})[medida] || 0; }, String, rot, 220) +
      '<p class="nota">Passe o mouse nas colunas para ver o número de cada ano. ' + n(s.semAno) + " discos estão sem ano.</p></div>" +
      '<div class="paineis" style="margin-top:16px"><div class="cartao painel"><h3>Por década</h3>' + decadasHTML(s, medida) + "</div>" +
      '<div class="cartao painel"><h3>Por estilo</h3>' + hbar(est, "v", rot) + "</div></div>" +
      '<div class="paineis" style="margin-top:16px"><div class="cartao painel"><h3>Top 25 artistas por discos</h3>' + hbar(topD, "v", "discos") + "</div>" +
      '<div class="cartao painel"><h3>Top 25 artistas por músicas</h3>' + hbar(topM, "v", "músicas") + "</div></div>" +
      '<div class="paineis" style="margin-top:16px">' + estilosTiposHTML(s) + tabelaDecadas(s) + "</div></section>";
    $("#medida").value = medida;
    $("#medida").onchange = function () { location.hash = "#/numeros" + (this.value === "musicas" ? "?m=musicas" : ""); };
  }
  function tabelaDecadas(s) {
    var ks = Object.keys(s.decadas).map(Number).sort(function (a, b) { return b - a; });
    return '<div class="cartao painel"><h3>Tabela por década</h3><table class="lista" style="box-shadow:none"><thead><tr><th>Década</th><th class="num">Discos</th><th class="num">Músicas</th></tr></thead><tbody>' +
      ks.map(function (k) { return '<tr><td><a href="#/discos?q=' + k + 's">' + k + "s</a></td><td class=\"num\">" + n(s.decadas[k].discos) + '</td><td class="num">' + n(s.decadas[k].musicas) + "</td></tr>"; }).join("") +
      '<tr><td class="muted">sem ano</td><td class="num">' + n(s.semAno) + '</td><td class="num"></td></tr></tbody></table></div>';
  }

  // "1977" → ano; "1970s", "70s", "anos 70" → década; o resto é texto (artista ou disco)
  function interpretar(q) {
    var f = { texto: [], ano: null, dec: null };
    var t = norm(q).replace(/anos\s+(\d{2})\b/g, "$1s");
    t.split(/\s+/).filter(Boolean).forEach(function (p) {
      var m;
      if (/^(19|20)\d\d$/.test(p)) f.ano = Number(p);
      else if ((m = p.match(/^((19|20)\d)0s$/))) f.dec = Number(m[1]) * 10;
      else if ((m = p.match(/^(\d)0s$/))) f.dec = (Number(m[1]) >= 3 ? 1900 : 2000) + Number(m[1]) * 10;
      else f.texto.push(p);
    });
    return f;
  }

  var POR_PAGINA = 100;
  function paginaDiscos(params) {
    var q = params.get("q") || "", estilo = params.get("estilo") || "", tipo = params.get("tipo") || "";
    var ordem = params.get("ordem") || "recentes", pag = Math.max(1, Number(params.get("p")) || 1);
    $("#q").value = q;
    var f = interpretar(q);
    var lista = DB.discos.filter(function (d) {
      if (estilo && d.estilo !== estilo) return false;
      if (tipo && d.tipo !== tipo) return false;
      if (f.ano && d.ano !== f.ano) return false;
      if (f.dec && !(d.ano >= f.dec && d.ano < f.dec + 10)) return false;
      for (var i = 0; i < f.texto.length; i++) if (d.busca.indexOf(f.texto[i]) < 0) return false;
      return true;
    });
    var cmp = {
      recentes: function (a, b) { return b.ordem - a.ordem; },
      artista: function (a, b) { return a.artista.localeCompare(b.artista, "pt-BR") || (a.ano || 0) - (b.ano || 0); },
      disco: function (a, b) { return a.disco.localeCompare(b.disco, "pt-BR"); },
      ano: function (a, b) { return (b.ano || 0) - (a.ano || 0) || a.artista.localeCompare(b.artista, "pt-BR"); },
      antigos: function (a, b) { return (a.ano || 9999) - (b.ano || 9999) || a.artista.localeCompare(b.artista, "pt-BR"); },
      faixas: function (a, b) { return b.musicas - a.musicas; }
    }[ordem] || function () { return 0; };
    lista.sort(cmp);
    var paginas = Math.max(1, Math.ceil(lista.length / POR_PAGINA));
    if (pag > paginas) pag = paginas;
    var parte = lista.slice((pag - 1) * POR_PAGINA, pag * POR_PAGINA);
    var musicas = lista.reduce(function (t, d) { return t + d.musicas; }, 0);
    var s = stats();
    function opt(v, r, atual) { return '<option value="' + esc(v) + '"' + (v === atual ? " selected" : "") + ">" + esc(r) + "</option>"; }
    app.innerHTML = '<section class="secao"><div class="secao-topo"><h2>' + (q ? "Busca: " + esc(q) : "Discos") + "</h2></div>" +
      '<div class="filtros">' +
      '<select id="f-estilo" aria-label="Estilo">' + opt("", "Todos os estilos", estilo) + Object.keys(s.estilos).sort().map(function (k) { return opt(k, k, estilo); }).join("") + "</select>" +
      '<select id="f-tipo" aria-label="Tipo">' + opt("", "Todos os tipos", tipo) + Object.keys(s.tipos).sort().map(function (k) { return opt(k, k === "ÁLBUM" ? "Álbum" : k, tipo); }).join("") + "</select>" +
      '<select id="f-ordem" aria-label="Ordem">' + opt("recentes", "Inseridos por último", ordem) + opt("artista", "Artista (A–Z)", ordem) + opt("disco", "Disco (A–Z)", ordem) +
      opt("ano", "Mais novos", ordem) + opt("antigos", "Mais antigos", ordem) + opt("faixas", "Mais faixas", ordem) + "</select>" +
      '<span class="total">' + n(lista.length) + " discos · " + n(musicas) + " músicas</span></div>" +
      (lista.length ? '<table class="lista"><thead><tr><th>Ano</th><th>Disco</th><th>Artista</th><th class="some">Estilo</th><th class="num">Faixas</th></tr></thead><tbody>' +
        parte.map(function (d) {
          return '<tr><td class="ano">' + (d.ano || "—") + '</td><td><a href="' + urlDisco(d) + '">' + esc(d.disco) + "</a></td>" +
            '<td><a href="' + urlArtista(d.artista) + '">' + esc(d.artista) + '</a></td><td class="some"><span class="selo estilo">' + esc(d.estilo) + '</span></td><td class="num">' + d.musicas + "</td></tr>";
        }).join("") + "</tbody></table>" + paginacao(pag, paginas)
        : '<div class="vazio">Nada encontrado. Tente só o nome do artista, ou um ano como 1977.</div>') + "</section>";

    function ir(mud) {
      var p = new URLSearchParams(params);
      Object.keys(mud).forEach(function (k) { if (mud[k]) p.set(k, mud[k]); else p.delete(k); });
      if (!("p" in mud)) p.delete("p");
      location.hash = "#/discos" + (p.toString() ? "?" + p : "");
    }
    $("#f-estilo").onchange = function () { ir({ estilo: this.value }); };
    $("#f-tipo").onchange = function () { ir({ tipo: this.value }); };
    $("#f-ordem").onchange = function () { ir({ ordem: this.value === "recentes" ? "" : this.value }); };
    $$(".paginas button[data-p]").forEach(function (b) { b.onclick = function () { ir({ p: b.dataset.p === "1" ? "" : b.dataset.p }); window.scrollTo(0, 0); }; });
  }
  function paginacao(atual, total) {
    if (total <= 1) return "";
    var ps = [1], i;
    for (i = Math.max(2, atual - 2); i <= Math.min(total - 1, atual + 2); i++) ps.push(i);
    ps.push(total);
    var html = '<nav class="paginas" aria-label="Páginas"><button data-p="' + (atual - 1) + '"' + (atual === 1 ? " disabled" : "") + ">← anterior</button>";
    var ult = 0;
    ps.forEach(function (p) {
      if (p - ult > 1) html += '<span class="muted">…</span>';
      html += '<button data-p="' + p + '"' + (p === atual ? ' aria-current="page"' : "") + ">" + p + "</button>";
      ult = p;
    });
    return html + '<button data-p="' + (atual + 1) + '"' + (atual === total ? " disabled" : "") + ">próxima →</button></nav>";
  }

  function paginaArtistas(params) {
    var s = stats();
    var letras = {};
    s.listaArtistas.forEach(function (a) {
      var l = norm(a.nome).charAt(0).toUpperCase();
      if (!/[A-Z]/.test(l)) l = "#";
      (letras[l] = letras[l] || []).push(a);
    });
    var todas = Object.keys(letras).sort(function (a, b) { return a === "#" ? -1 : b === "#" ? 1 : a.localeCompare(b); });
    var atual = params.get("l") || "A";
    if (!letras[atual]) atual = todas[0];
    var lista = letras[atual].sort(function (a, b) { return a.nome.localeCompare(b.nome, "pt-BR"); });
    app.innerHTML = '<section class="secao"><div class="secao-topo"><h2>Artistas</h2><span class="muted">' + n(s.artistas) + " no acervo</span></div>" +
      '<nav class="letras" aria-label="Letra inicial">' + todas.map(function (l) {
        return '<a href="#/artistas?l=' + encodeURIComponent(l) + '"' + (l === atual ? ' class="ativo"' : "") + ">" + l + "</a>";
      }).join("") + "</nav>" +
      '<div class="artistas">' + lista.map(function (a) {
        return '<a href="' + urlArtista(a.nome) + '">' + esc(a.nome) + "<span>" + a.discos + (a.discos === 1 ? " disco" : " discos") + "</span></a>";
      }).join("") + "</div></section>";
  }

  function paginaArtista(nome) {
    var ds = (DB.artistas[nome] || []).slice().sort(function (a, b) { return (a.ano || 9999) - (b.ano || 9999) || a.disco.localeCompare(b.disco, "pt-BR"); });
    if (!ds.length) { app.innerHTML = '<div class="vazio">Artista não encontrado.</div>'; return; }
    var mus = ds.reduce(function (t, d) { return t + d.musicas; }, 0);
    var anos = ds.filter(function (d) { return d.ano; }).map(function (d) { return d.ano; });
    var estilos = ds.map(function (d) { return d.estilo; }).filter(function (v, i, a) { return a.indexOf(v) === i; });
    app.innerHTML = '<div class="migalha"><a href="#/artistas?l=' + encodeURIComponent(ds[0].letra === "#" ? "#" : norm(nome).charAt(0).toUpperCase()) + '">Artistas</a> › ' + esc(nome) + "</div>" +
      '<div class="cab-artista"><h1>' + esc(nome) + '</h1><span class="muted">' + n(ds.length) + (ds.length === 1 ? " disco" : " discos") + " · " + n(mus) + " músicas" +
      (anos.length ? " · " + Math.min.apply(null, anos) + (Math.max.apply(null, anos) !== Math.min.apply(null, anos) ? "–" + Math.max.apply(null, anos) : "") : "") + " · " + estilos.map(esc).join(", ") + "</span></div>" +
      avisoDrive() + '<div class="grade-capas">' + ds.map(function (d) { return card(d, true); }).join("") + "</div>";
    hidratarCapas();
  }

  function paginaDisco(id) {
    var d = DB.porId[id];
    if (!d) { app.innerHTML = '<div class="vazio">Disco não encontrado. Ele pode ter sido apagado ou renomeado na planilha.</div>'; return; }
    var outros = (DB.artistas[d.artista] || []).filter(function (x) { return x !== d; })
      .sort(function (a, b) { return (a.ano || 9999) - (b.ano || 9999); }).slice(0, 12);
    app.innerHTML = '<div class="migalha"><a href="' + urlArtista(d.artista) + '">' + esc(d.artista) + "</a> › " + esc(d.disco) + "</div>" +
      '<div class="disco">' + capa(d) + "<div>" +
      "<h1>" + esc(d.disco) + '</h1><div class="artista"><a href="' + urlArtista(d.artista) + '">' + esc(d.artista) + "</a></div>" +
      '<div class="meta"><span>' + (d.ano || "sem ano") + "</span><span>" + n(d.musicas) + " faixas na planilha</span><span>" + selos(d) + "</span></div>" +
      '<div class="acoes" id="acoes"></div>' + avisoDrive("Entre com a conta Google que tem acesso à pasta MUSICBR para ouvir este disco.") +
      '<div id="faixas"></div></div></div>' +
      (outros.length ? '<section class="secao" style="margin-top:40px"><div class="secao-topo"><h2>Mais de ' + esc(d.artista) + '</h2><a class="mais" href="' + urlArtista(d.artista) + '">todos →</a></div><div class="grade-capas">' +
        outros.map(function (x) { return card(x, true); }).join("") + "</div></section>" : "");
    hidratarCapas();
    if (!DriveBR.conectado()) return;
    var box = $("#faixas");
    box.innerHTML = '<div class="muted">Procurando o disco no Drive…</div>';
    DriveBR.disco(d).then(function (info) {
      if (location.hash !== urlDisco(d)) return;
      if (!info) { box.innerHTML = '<div class="aviso-drive">Não achei a pasta deste disco no Drive (caminho esperado: ' + esc(d.estilo + "/" + d.letra + "/" + d.artista + "/" + (d.ano ? d.ano + " - " : "") + d.disco) + ").</div>"; return; }
      $("#acoes").innerHTML = (info.faixas.length ? '<button type="button" class="btn" id="tocar-tudo">▶ Ouvir o disco</button>' : "") +
        '<a class="btn sec" href="https://drive.google.com/drive/folders/' + info.pasta + '" target="_blank" rel="noopener">Abrir pasta no Drive ↗</a>';
      if (!info.faixas.length) { box.innerHTML = '<div class="aviso-drive">A pasta existe, mas não tem arquivos de áudio.</div>'; return; }
      box.innerHTML = '<ol class="faixas">' + info.faixas.map(function (f, i) {
        return '<li data-i="' + i + '" data-id="' + f.id + '"><span class="n">' + (i + 1) + "</span><span>" + esc(nomeFaixa(f.nome, d.artista)) + '</span><span class="tam">' + (f.tam ? (f.tam / 1048576).toFixed(1).replace(".", ",") + " MB" : "") + "</span></li>";
      }).join("") + "</ol>";
      $$("#faixas li").forEach(function (li) { li.onclick = function () { Player.tocar(d, info.faixas, Number(li.dataset.i)); }; });
      $("#tocar-tudo").onclick = function () { Player.tocar(d, info.faixas, 0); };
      Player.marcar();
    }).catch(function (e) { box.innerHTML = '<div class="aviso-drive">' + esc(e.message) + "</div>"; });
  }
  // "03 - Artista - Música.mp3" → "Música" (tira número, extensão e o nome do artista repetido)
  function nomeFaixa(nome, artista) {
    var t = nome.replace(/\.[a-z0-9]{2,4}$/i, "").replace(/^(.* \/ )?\d{1,3}(\s*[-.)_]\s*|\s+)/, "$1");
    if (artista) {
      var m = t.match(/^(.* \/ )?(.+?)\s+[-–]\s+(.+)$/);
      if (m && norm(m[2]) === norm(artista)) t = (m[1] || "") + m[3];
    }
    return t || nome;
  }

  /* ---------- capas do Drive ---------- */
  function hidratarCapas() {
    if (!DriveBR.conectado()) return;
    $$(".capa[data-capa]:not([data-ok])").forEach(function (el) {
      el.setAttribute("data-ok", "1");
      var d = DB.porId[el.dataset.capa];
      if (!d) return;
      DriveBR.capa(d).then(function (url) {
        if (!url) return;
        el.innerHTML = '<img alt="" src="' + url + '">';
        el.classList.add("ok");
      }).catch(function () { el.removeAttribute("data-ok"); });
    });
  }

  /* ---------- player ---------- */
  var Player = (function () {
    var audio = $("#audio"), box = $("#player"), fila = [], i = -1, disco = null, pedido = 0;
    function fmtT(s) { s = Math.floor(s || 0); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); }
    function marcar() {
      $$("#faixas li").forEach(function (li) {
        var atual = disco && fila[i] && li.dataset.id === fila[i].id;
        li.classList.toggle("atual", !!atual);
      });
    }
    function tocar(d, faixas, k) {
      disco = d; fila = faixas; ir(k);
    }
    function ir(k) {
      if (k < 0 || k >= fila.length) return;
      i = k;
      var f = fila[i], meu = ++pedido;
      box.hidden = false; document.body.classList.add("tocando");
      $("#pl-titulo").textContent = nomeFaixa(f.nome, disco.artista);
      $("#pl-sub").textContent = disco.artista + " — " + disco.disco;
      $("#pl-capa").innerHTML = capa(disco);
      DriveBR.capa(disco).then(function (u) { if (u) $("#pl-capa").innerHTML = '<div class="capa ok"><img alt="" src="' + u + '"></div>'; }, function () {});
      marcar();
      var li = $('#faixas li[data-id="' + f.id + '"]');
      if (li) li.classList.add("carregando-faixa");
      $("#pl-sub").textContent = "carregando… · " + disco.artista;
      DriveBR.audio(f.id).then(function (url) {
        if (li) li.classList.remove("carregando-faixa");
        if (meu !== pedido) return;
        $("#pl-sub").textContent = disco.artista + " — " + disco.disco;
        audio.src = url;
        audio.play().catch(function () {});
        if (fila[i + 1]) DriveBR.audio(fila[i + 1].id).catch(function () {}); // já baixa a próxima
        if ("mediaSession" in navigator) {
          navigator.mediaSession.metadata = new MediaMetadata({ title: nomeFaixa(f.nome, disco.artista), artist: disco.artista, album: disco.disco });
        }
      }).catch(function (e) {
        if (li) li.classList.remove("carregando-faixa");
        if (meu === pedido) $("#pl-sub").textContent = e.message;
      });
    }
    audio.addEventListener("play", function () { box.classList.add("tocando"); });
    audio.addEventListener("pause", function () { box.classList.remove("tocando"); });
    audio.addEventListener("ended", function () { if (i + 1 < fila.length) ir(i + 1); });
    audio.addEventListener("timeupdate", function () {
      $("#pl-t").textContent = fmtT(audio.currentTime);
      $("#pl-d").textContent = fmtT(audio.duration);
      if (audio.duration) $("#pl-pos").value = Math.round(audio.currentTime / audio.duration * 1000);
    });
    $("#pl-pos").addEventListener("input", function () { if (audio.duration) audio.currentTime = this.value / 1000 * audio.duration; });
    $("#pl-play").onclick = function () { if (audio.paused) audio.play().catch(function () {}); else audio.pause(); };
    $("#pl-ant").onclick = function () { if (audio.currentTime > 3) audio.currentTime = 0; else ir(i - 1); };
    $("#pl-prox").onclick = function () { ir(i + 1); };
    $("#pl-fechar").onclick = function () { audio.pause(); box.hidden = true; document.body.classList.remove("tocando"); };
    if ("mediaSession" in navigator) {
      navigator.mediaSession.setActionHandler("previoustrack", function () { ir(i - 1); });
      navigator.mediaSession.setActionHandler("nexttrack", function () { ir(i + 1); });
    }
    return { tocar: tocar, marcar: marcar };
  })();

  /* ---------- rotas ---------- */
  function rota() {
    var h = location.hash.replace(/^#\/?/, "");
    var partes = h.split("?"), caminho = partes[0], params = new URLSearchParams(partes[1] || "");
    var seg = caminho.split("/");
    $$(".menu a").forEach(function (a) { a.classList.toggle("ativo", a.dataset.rota === (seg[0] === "artista" ? "artistas" : seg[0] === "disco" ? "discos" : seg[0])); });
    if (seg[0] !== "discos") $("#q").value = "";
    if (seg[0] === "discos") paginaDiscos(params);
    else if (seg[0] === "artistas") paginaArtistas(params);
    else if (seg[0] === "artista") paginaArtista(decodeURIComponent(seg.slice(1).join("/")));
    else if (seg[0] === "disco") paginaDisco(seg[1]);
    else if (seg[0] === "numeros") paginaNumeros(params);
    else paginaInicio();
    document.title = (seg[0] === "artista" ? decodeURIComponent(seg.slice(1).join("/")) + " · " : seg[0] === "disco" && DB.porId[seg[1]] ? DB.porId[seg[1]].disco + " · " : "") + "Music BR";
  }
  window.addEventListener("hashchange", function () { rota(); if (!/^#\/discos/.test(location.hash)) window.scrollTo(0, 0); });

  $("#busca").addEventListener("submit", function (e) {
    e.preventDefault();
    var q = $("#q").value.trim();
    location.hash = "#/discos" + (q ? "?q=" + encodeURIComponent(q) : "");
  });

  /* ---------- Drive: botão do topo ---------- */
  var botao = $("#drive-btn");
  function atualizarBotao() {
    if (!DriveBR.configurado()) { botao.hidden = true; return; }
    botao.hidden = false;
    var on = DriveBR.conectado();
    botao.classList.toggle("on", on);
    $("#drive-txt").textContent = on ? "Drive conectado" : "Conectar Drive";
    botao.title = on ? "Clique para desconectar" : "Entrar com a conta Google para ver capas e ouvir os discos";
  }
  function conectar() {
    DriveBR.conectar().then(function () { rota(); }).catch(function (e) { alert(e.message); });
  }
  botao.onclick = function () { if (DriveBR.conectado()) { if (confirm("Desconectar do Google Drive?")) DriveBR.desconectar(); } else conectar(); };
  document.addEventListener("click", function (e) { if (e.target.closest("[data-conectar]")) conectar(); });
  DriveBR.aoMudar(atualizarBotao);
  atualizarBotao();

  /* ---------- dicas (tooltip) ---------- */
  var dica = $("#dica");
  document.addEventListener("mousemove", function (e) {
    var el = e.target.closest && e.target.closest("[data-tip]");
    if (!el) { dica.classList.remove("on"); return; }
    dica.innerHTML = el.getAttribute("data-tip");
    var x = Math.min(e.clientX + 14, window.innerWidth - dica.offsetWidth - 8);
    dica.style.left = x + "px"; dica.style.top = (e.clientY - dica.offsetHeight - 10) + "px";
    dica.classList.add("on");
  });

  /* ---------- tema ---------- */
  $("#tema").onclick = function () {
    var r = document.documentElement;
    var escuroAgora = r.dataset.tema ? r.dataset.tema === "escuro" : matchMedia("(prefers-color-scheme: dark)").matches;
    r.dataset.tema = escuroAgora ? "claro" : "escuro";
    ls(function () { localStorage.setItem("mbr-tema", r.dataset.tema); });
  };

  $("#link-planilha").href = CFG.planilha || "#";

  carregar().then(function () {
    if (DB.atualizado) {
      var dt = new Date(DB.atualizado);
      $("#atualizado").textContent = "dados de " + dt.toLocaleDateString("pt-BR") + " " + dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    }
    rota();
  }).catch(function (e) { app.innerHTML = '<div class="vazio">' + esc(e.message) + "</div>"; });
})();
