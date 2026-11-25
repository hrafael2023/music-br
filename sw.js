/* Service worker do Music BR (para o site poder ser instalado como app).
   Estratégia: rede primeiro — sempre pega a versão nova; a cópia guardada só é usada sem internet.
   Não guarda nada do Google (Drive, login): isso passa direto. */
var VERSAO = "v3.30";
var CACHE = "mbr-app-" + VERSAO;
var BASICO = ["./", "index.html", "manifest.webmanifest", "assets/icone.svg",
  "assets/icones/icone-192.png", "assets/icones/icone-512.png"];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(BASICO); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (nomes) {
    return Promise.all(nomes.filter(function (n) { return n.indexOf("mbr-app-") === 0 && n !== CACHE; })
      .map(function (n) { return caches.delete(n); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Google, fontes etc.: direto na rede
  e.respondWith(fetch(req).then(function (resp) {
    if (resp.ok && resp.type === "basic") {
      var copia = resp.clone();
      caches.open(CACHE).then(function (c) { c.put(req, copia); });
    }
    return resp;
  }).catch(function () {
    return caches.match(req, { ignoreSearch: req.mode === "navigate" }).then(function (r) {
      return r || caches.match("index.html");
    });
  }));
});
