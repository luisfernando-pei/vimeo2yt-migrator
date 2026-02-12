#!/bin/bash

# Script para execução diária da migração Vimeo → YouTube
# Recomendado: agendar no crontab para rodar a cada X horas

set -e

# Configurações
NODE_ENV="${NODE_ENV:-prod}"
LOG_DIR="./logs"
DATA_DIR="./data"
DATE=$(date +%Y%m%d_%H%M%S)
LOG_FILE="${LOG_DIR}/daily-migrate-${DATE}.log"

# Criar diretórios se não existirem
mkdir -p "${LOG_DIR}" "${DATA_DIR}"

# Função de log
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "${LOG_FILE}"
}

log "=== Iniciando migração diária ==="
log "Ambiente: ${NODE_ENV}"
log "Log file: ${LOG_FILE}"

# Verificar se há jobs pendentes antes de fetch
log "Verificando status atual..."
STATUS=$(NODE_ENV=${NODE_ENV} node src/cli.js status 2>/dev/null || echo "{}")
log "Status atual: ${STATUS}"

# Fetch novos candidatos do WordPress
log "Buscando novos candidatos do WordPress..."
NODE_ENV=${NODE_ENV} node src/cli.js fetch >> "${LOG_FILE}" 2>&1
FETCH_RESULT=$?

if [ $FETCH_RESULT -ne 0 ]; then
    log "⚠️  Fetch falhou ou não há novos candidatos"
else
    log "✅ Fetch concluído"
fi

# Executar migração
log "Iniciando worker de migração..."
NODE_ENV=${NODE_ENV} node src/cli.js migrate >> "${LOG_FILE}" 2>&1
MIGRATE_RESULT=$?

if [ $MIGRATE_RESULT -eq 0 ]; then
    log "✅ Migração concluída com sucesso"
else
    log "⚠️  Migração finalizada (pode haver erros - verifique o log)"
fi

# Status final
log "Status final:"
NODE_ENV=${NODE_ENV} node src/cli.js status >> "${LOG_FILE}" 2>&1

log "=== Migração diária finalizada ==="

# Retornar código de erro se migrate falhou
exit $MIGRATE_RESULT
