# Reconciliação de orçamentos

`budget-reconciliation.ts` separa leitura, comparação, plano e confirmação. Nenhuma dessas operações escreve, exceto `confirmBudgetReconciliation`, invocada pela confirmação explícita da interface. A leitura usa os repositórios reais, nunca projetos de exemplo.

Situações: somente legado, somente financeiro, valores iguais, divergentes, ausência de aprovação registrada e legado inválido. Zero cadastral não representa aprovação: sem orçamento financeiro, requer a decisão específica `approve_zero`. Zero financeiro explícito é oficial. Frações de centavo, negativos e códigos incompatíveis são apresentados para verificação; não são arredondados nem renomeados.

Cada divergência pode permanecer pendente ou receber decisão individual: manter financeiro ou adotar legado como original aprovado. A segunda opção substitui explicitamente o original anterior, preservado em `ProjectBudget.reconciliation.previousOriginalAmount`. O registro opcional também contém valor legado, decisão e instante da confirmação. Dados financeiros v1 anteriores continuam legíveis sem escrita ou novos campos obrigatórios. Decisões já registradas e ainda compatíveis com as fontes são identificadas como conciliadas.

O original financeiro é a única fonte oficial. O atualizado é recalculado por `normalizeFinanceData` a partir do original e dos ajustes aprovados externamente. O plano mostra os valores antes/depois e o atualizado resultante. SCs, pedidos, realizados e ajustes não são substituídos por coleções vazias. O campo cadastral permanece congelado, inclusive quando diverge por decisão de manter o financeiro; sua divergência fica documentada, em vez de apagada.

## Gravação e recuperação

A decisão e o orçamento são persistidos juntos em um único `setItem` da chave financeira existente. A chave de projetos não é escrita. Isso evita uma transação entre chaves e elimina estados de migração parcial. Falha de leitura, validação, quota ou snapshot desatualizado aborta sem rollback de snapshots antigos. Gere outra prévia para consultar o estado persistido antes de tentar novamente. Repetir uma confirmação já gravada falha por snapshot diferente, sem duplicar registros.

Os escritores de ambos os repositórios compartilham um Web Lock. Sob o bloqueio, `saveIfCurrent` compara o snapshot financeiro e relê o cadastro antes de uma única gravação. O importador Sankhya também usa a gravação condicional para não sobrescrever uma reconciliação concorrente. No navegador, falta de Web Locks bloqueia gravações; leituras continuam disponíveis. Testes sem navegador usam uma fila local em memória. Não existe garantia contra alterações feitas diretamente no localStorage ou por versões antigas da aplicação que não respeitem o bloqueio; uma futura API deve substituir esse mecanismo por transações no servidor.

Dashboard e cadastro atualizam a leitura financeira após confirmação e em eventos `storage` de outras abas. Não existe migração automática, sincronização do legado, importação de carteira por Excel ou autorização de execução nesta etapa.

Atualização posterior: a [importação de novos projetos por Excel](../projects/PORTFOLIO-IMPORT.md) utiliza um registro transacional para cadastrar projetos e seus orçamentos juntos. Os repositórios consultam esse registro quando há sincronização pendente e exigem recuperação antes de outra escrita. A reconciliação mantém sua gravação exclusiva da chave financeira, após concluir qualquer sincronização já confirmada. A importação registra autorização de execução pendente, sem fluxo de aprovação.
