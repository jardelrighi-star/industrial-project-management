# Cadastro e orçamento legado

`ProjectRepository` mantém a chave `industrial-projects` como array JSON sem migração no carregamento. Dados inválidos geram erro, sem exemplos, limpeza ou gravação automática. Chave ausente corresponde a carteira vazia na interface; um array vazio continua vazio.

`Project.budget` continua em reais e preserva o valor anterior para compatibilidade e reconciliação. Está congelado: formulário e repositório rejeitam alterações desse campo em projetos existentes. Novos projetos usam zero apenas como marcador legado sem aprovação; isso não cria orçamento financeiro. Demais campos e propriedades adicionais são preservados ao editar. Códigos existentes não são normalizados.

A fonte oficial de orçamento é `ProjectBudget.originalApprovedAmount`, em centavos, na camada financeira. Não há fallback para o legado. A interface consulta essa fonte no dashboard, cadastro, listagem e detalhes; ausência e falha são distintas de zero aprovado.

O formulário permite [cadastro e correção manual do orçamento financeiro](../finance/MANUAL-BUDGET.md), com revisão, confirmação e histórico. Os valores digitados não são atribuídos a `Project.budget`. Quando cadastro e orçamento mudam juntos, a gravação usa o mesmo protocolo transacional compartilhado da aplicação para impedir estados parciais.

A reconciliação de orçamentos fica em `../finance/budget-reconciliation.ts` e é acessível pelo menu Reconciliação. Somente uma confirmação explícita grava decisões. O cadastro não é regravado durante a reconciliação.

A importação exclusiva de novos projetos está documentada em [PORTFOLIO-IMPORT.md](./PORTFOLIO-IMPORT.md). Ela usa mapeamento explícito de Excel, autorização de execução pendente e um registro transacional compartilhado entre os repositórios. Esse registro é a fonte dos dois snapshots durante uma sincronização de compatibilidade pendente; leituras continuam sem gravação automática.
