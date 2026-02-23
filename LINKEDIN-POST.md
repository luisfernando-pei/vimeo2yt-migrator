🚀 Como migrei 500 vídeos (3TB) do Vimeo para YouTube gastando R$ 0,00

Há 2 meses descobri que precisava migrar 500 vídeos do Vimeo para YouTube.

O desafio? 
* 3TB de dados
* Quota YouTube limitada (6 uploads/dia)
* Orçamento zero para infraestrutura

A solução que construí:

1️⃣ VM Oracle Cloud (4 CPUs + 24GB RAM) - 100% GRÁTIS
2️⃣ Sistema Node.js com:
   • SQLite para controle de fila (retomável)
   • Rate limiting automático por quota
   • Download paralelo + upload otimizado
   • Resume de uploads parciais

Resultado:
✅ 500 vídeos migrados
✅ Zero custo de infraestrutura
✅ 16 dias (vs 3 meses estimados)
✅ Código open source: [link GitHub]

Aprendizados:
* Oracle Always Free é subestimado
* Automação + arquitetura resistente = escalabilidade
* Quotas APIs precisam de gestão inteligente

#CloudComputing #NodeJS #YouTubeAPI #OracleCloud #Automação #DevOps
