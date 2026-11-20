# Edição do orçamento do projeto

O orçamento é editável diretamente no formulário. **Salvar projeto** grava o cadastro e o orçamento sem etapa adicional de revisão ou confirmação. A observação é opcional. Um valor vazio em projeto sem orçamento salva somente os dados cadastrais; zero informado explicitamente cadastra um orçamento de zero.

O **Log de alterações** aparece abaixo do campo, com data, valor anterior, novo valor e observação. Valores iguais ao orçamento atual não criam registros, mesmo se o usuário editar o campo e voltar ao valor anterior. Sem observação, o sistema registra uma descrição padrão. Fechar ou cancelar o formulário não grava alterações.

## Contrato compatível

`ProjectBudget.corrections` é uma coleção opcional no mesmo envelope financeiro v1. Cada entrada contém `previousAmount`, `newAmount`, `recordedAt` e `justification`; valores são centavos inteiros. `previousAmount: null` identifica primeiro cadastro manual, sem inferir aprovação a partir do orçamento legado. Registros antigos continuam legíveis sem campo novo, sem escrita no carregamento e sem criar histórico retroativo.

Cada alteração manual acrescenta uma entrada, mantendo as anteriores. A data é o instante real da confirmação, não uma data fictícia de aprovação externa. O histórico fica visível no formulário. As operações de reconciliação mantêm seu registro próprio e preservam a coleção de correções manuais; o histórico manual não pretende substituir a evidência de reconciliação.

Editar o orçamento não cria ajustes de aumento, redução ou transferência. Ajustes existentes continuam recalculando `updatedAmount` por `normalizeFinanceData`. Nenhuma edição altera autorização de execução, custos, SCs ou pedidos. A conversão monetária reutiliza `parseBrlCents`.

## Coordenação e falhas

`manual-project-budget.ts` separa o plano puro da gravação. O plano é uma cópia independente do formulário e dos snapshots lidos. O botão Salvar autoriza a gravação; o serviço revalida o pedido e compara ambas as fontes sob o Web Lock compartilhado. Conflitos exigem reabrir o formulário, sem substituir alterações feitas em outra aba. A estrutura de armazenamento existente é preservada sem expor detalhes de compatibilidade no formulário.

Se mudar apenas o orçamento, somente a chave financeira é escrita. Se mudar apenas o cadastro, somente a chave cadastral é escrita. Se mudarem ambos, incluindo a criação de um projeto com orçamento, o serviço reutiliza o registro transacional de `coordinated-storage.ts`: falhas anteriores ao commit mantêm ambas as fontes anteriores; falhas na sincronização posterior mantêm ambos os estados confirmados acessíveis pelos repositórios. A interface informa sincronização pendente e oferece retomada, sem repetir a correção nem duplicar seu histórico.

Somente o orçamento do projeto selecionado é substituído na estrutura financeira. Coleções e metadados não relacionados são preservados a partir do envelope bruto existente. O valor legado continua idêntico. A importação Excel não foi alterada e continua usando seus próprios critérios, fluxo de confirmação e relatório. Os limites do localStorage e do protocolo transacional permanecem os descritos em [PORTFOLIO-IMPORT.md](../projects/PORTFOLIO-IMPORT.md).
