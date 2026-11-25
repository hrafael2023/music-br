#!/bin/sh
# Troca o número da versão em todo o site: ./scripts/nova-versao.sh 1.1
# (VERSAO, rodapé e o ?v= dos arquivos, para o navegador baixar a versão nova)
set -e
cd "$(dirname "$0")/.."
NOVA="$1"
[ -n "$NOVA" ] || { echo "uso: $0 <versão>  (atual: $(cat VERSAO))"; exit 1; }
VELHA="$(cat VERSAO)"
sed -i '' -e "s/?v=$VELHA\"/?v=$NOVA\"/g" -e "s/>v$VELHA</>v$NOVA</g" index.html
echo "$NOVA" > VERSAO
echo "versão $VELHA → $NOVA"
