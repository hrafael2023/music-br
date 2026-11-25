# Music BR

Acervo da planilha **MUSICBR-FILES** (aba `MUSICBR`): artistas, discos, anos e número de músicas, com dashboard, capas e player vindos do Google Drive.

**Site:** https://hrafael2023.github.io/music-br/

## Como funciona

- **Catálogo:** `scripts/atualizar.py` baixa a aba `MUSICBR` em CSV e gera `data/musicbr.json`. A planilha precisa continuar com acesso "Qualquer pessoa com o link: Leitor".
- **Atualização (manual):** o ícone de atualizar no topo do site dispara a Action [`Atualizar catálogo`](.github/workflows/atualizar.yml) (também dá pelo botão *Run workflow* na aba Actions). Não há agendamento. Se algo mudou, ela faz commit e o GitHub Pages republica. Na primeira vez, o site pede um token do GitHub (fine-grained, repositório `music-br`, permissão *Actions: Read and write*), guardado só naquele navegador.
- **Últimas inserções:** as 10 últimas linhas da aba `MUSICBR` (a planilha recebe discos novos no fim).
- **Capas e player:** vêm do Drive privado, pelo navegador de quem está logado com uma conta Google que tem acesso à pasta. O site segue o caminho `ESTILO/LETRA/ARTISTA/ANO - DISCO` e nunca torna arquivos públicos. Precisa de um ID de cliente OAuth em `assets/config.js` (veja abaixo).
- **Site:** HTML/CSS/JS puro (`index.html`, `assets/`), sem build.

## Configurar o login do Google (capas e player)

1. Em https://console.cloud.google.com crie um projeto e ative a **Google Drive API**.
2. Em *APIs e serviços → Tela de consentimento OAuth*, tipo **Interno** (se a conta for do Workspace) ou **Externo** em modo de teste, adicionando seu e-mail como usuário de teste. Escopo: `.../auth/drive.readonly`.
3. Em *Credenciais → Criar credenciais → ID do cliente OAuth*, tipo **Aplicativo da Web**, origem JavaScript autorizada `https://hrafael2023.github.io` (e `http://localhost:8765` para testes locais).
4. Copie o ID do cliente para `googleClientId` em `assets/config.js`.

## Versões

Cada ajuste publicado ganha um número novo (arquivo `VERSAO`, rodapé do site e tag `vX.Y` no git):

```bash
./scripts/nova-versao.sh 1.1
```

## Rodar localmente

```bash
python3 scripts/atualizar.py
python3 -m http.server 8765
```
