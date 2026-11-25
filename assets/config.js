// Configuração do Music BR.
// googleClientId: ID de cliente OAuth (tipo "Aplicativo da Web") do Google Cloud,
// com https://hrafael2023.github.io como origem JavaScript autorizada e a
// Google Drive API ativada no projeto. Sem ele, o site mostra o catálogo,
// mas não as capas nem o player (que vêm do Drive privado).
window.MUSICBR = {
  // projeto "Music BR" no Google Cloud (modo de teste; usuários de teste na tela Audience)
  googleClientId: "947533376821-t8ahirf5nhogru7erin6uaq3ntk6aumd.apps.googleusercontent.com",
  planilha: "https://docs.google.com/spreadsheets/d/1EnyOWiXYubgVPIHIgeGVZLnyxVsi5-eNJQmNxyDH7V0/edit?gid=1366612687",
  pastaRaiz: "18CFCMDIMukogui3abxHT-wQY5UH_ERjI",
  // pasta de cada estilo dentro da raiz (coluna "Estilo" da planilha)
  pastas: {
    "MPB": "1c0kYehgW6xYqqFax2eJwupIkwXozHxgY",
    "ROCK-BRASIL": "1dB76xD88L8LFTx3CkJpFkFRuN3fq5SEG",
    "ROCK": "1RHEJ7mONZRGgPoT8rvWSz9UsR9d7GBt8",
    "JAZZ": "1NLxh3s45WO5N4j7u_pKIdkPyRdrjADfk"
  }
};
