# Financeiro — camada de domínio e persistência

O painel financeiro consulta esta camada sem migrar ou alterar `industrial-projects`. Nenhum registro é criado ao carregar o módulo ou consultar um armazenamento vazio. Fixtures de testes ficam somente em memória.

O formulário do projeto permite cadastrar o orçamento oficial e solicitar correções com justificativa, revisão e confirmação explícita. O histórico opcional mantém compatibilidade com os dados v1, sem migração automática. Fluxo e coordenação estão em [MANUAL-BUDGET.md](./MANUAL-BUDGET.md).

- `types.ts`: contratos independentes de React. Valores em **centavos inteiros de BRL**; datas de negócio em `YYYY-MM-DD`. `projectCode` deve ser o código Sankhya canônico (sem espaços nas extremidades, em maiúsculas). O chamador deve fornecer códigos reais da carteira; não se cria ou altera projeto nesta camada.
- `calculations.ts`: `calculateProjectFinancials(projectCode, data)` retorna todos os indicadores. `normalizeFinanceData` valida, elimina repetições idênticas e recalcula `updatedAmount`; este campo é uma projeção, nunca uma segunda fonte de ajustes. Ausência de orçamento explícito gera erro, em vez de presumir zero.
- `validation.ts`: valida JSON em tempo de execução, valores monetários, datas, transferências e consistência dos saldos dos pedidos.
- `repository.ts`: contrato assíncrono `FinanceRepository` (`load`/`save`) e adaptador `LocalStorageFinanceRepository`. Uma implementação HTTP/API/PostgreSQL poderá substituir o adaptador. O acesso ao navegador ocorre somente na chamada, em contexto cliente; não durante importação/SSR.

## Regras de cálculo

Orçamento atualizado = original aprovado + aumentos aprovados − reduções aprovadas − transferências de saída + transferências de entrada. Aprovação é informação externa, com referência obrigatória; não existe ação de aprovação no aplicativo. Transferência é **um registro**, identificado pelo mesmo ID externo estável, com `projectCode = sourceProjectCode` e destino distinto. Ambos precisam de orçamento registrado. Não criar dois ajustes espelhados.

SC aprovada só compromete se não possuir pedido convertido e nenhum pedido referenciar a SC. Mesmo pedido cancelado não reabre automaticamente uma SC convertida. Saldo de pedidos = total − faturado; pedidos cancelados não comprometem. Total realizado vem exclusivamente dos lançamentos efetivos, nunca do valor faturado do pedido.

Comprometido total = SCs aprovadas não convertidas + saldos abertos de pedidos. Disponível = orçamento atualizado − comprometido − realizado. Execução financeira = realizado / orçamento atualizado × 100; retorna `null` se o orçamento atualizado for zero ou negativo. Saldos negativos e execução acima de 100% são preservados.

## Identidade e persistência

IDs de ajuste e transação devem ser identidades externas estáveis. SC e pedido usam código/número por projeto e também identidade de origem. Custos usam ID da transação, identidade de origem e documento fiscal + linha/alocação + projeto. Quando o documento fiscal é apenas um número de nota (NUMNOTA), `documentEntryId` inclui a identidade interna da nota e do item/rateio para desambiguar documentos.

Repetições idênticas são descartadas. Registros que compartilham identidade com conteúdo diferente são rejeitados para reconciliação explícita, evitando decidir silenciosamente entre valores divergentes. Novas versões de registros devem substituir a versão anterior no snapshot, preservando a identidade. A importação de realizados possui prévia e comparação de conteúdo específicas, descritas abaixo.

A chave exclusiva é `industrial-project-finance:v1`, envelope `{ version: 1, data }`. `save` substitui explicitamente o snapshot financeiro completo após validação. Erros de leitura/gravação são propagados; JSON inválido ou versão desconhecida não são sobrescritos. Os repositórios compartilham um bloqueio de escrita; `saveIfCurrent` também verifica o snapshot esperado e precondições cadastrais. Limites e recuperação estão em [BUDGET-RECONCILIATION.md](./BUDGET-RECONCILIATION.md). Uma futura API deverá implementar concorrência e unicidade no banco.

Snapshots grandes (a partir de 500 mil caracteres) são compactados sem perda com DEFLATE/base64 antes da gravação, quando isso reduz seu tamanho. A representação física usa `storageEncoding: "deflate-base64-v1"`; `readCoordinatedValue` expande o conteúdo para o envelope financeiro v1 usado pelos serviços. Registros antigos continuam legíveis sem escrita no carregamento. A gravação coordenada também compacta os novos snapshots no registro transacional, preservando comparações e recuperação. O limite do navegador continua existindo; falta de espaço agora gera uma mensagem específica, sem sobrescrever o snapshot anterior. O teste com `COST_WORKBOOK_FIXTURE` valida o arquivo real sob uma cota simulada de 5 MiB, leitura posterior, deduplicação e recuperação transacional. Não modifica os dados do navegador nem o Excel.

Os testes cobrem regras financeiras e persistência com armazenamento em memória, sem escrever no localStorage real.

## Objetivo e fornecedor — preparação para Sankhya

`PurchaseRequisition.objective` e `PurchaseOrder.objective` descrevem o objetivo da contratação. `PurchaseOrder.supplier` e `ActualCost.supplier` identificam o fornecedor. Os quatro campos são `string` no contrato atual; `""` representa informação ainda não fornecida. Textos são preservados como recebidos, incluindo acentos. Valores `null`, numéricos ou objetos são rejeitados, sem conversão silenciosa.

`supplier` recebe NOMEPARC na importação de custos, enquanto `traceability` preserva sistema e identidade do registro. Na importação de SCs, `objective` recebe Observação. Na importação de pedidos, `supplier` recebe Fornecedor e `objective` reúne as observações distintas dos itens.

`parseFinanceData` aceita snapshots legados e preenche somente campos ausentes (`undefined`) com `""`, em cópias, antes da validação estrita. `normalizeFinanceData` aplica essa compatibilidade antes da deduplicação. A chave e o envelope v1 são mantidos: `load` devolve o modelo atualizado sem regravar o armazenamento; os novos campos são persistidos somente em um `save` explícito. Registros existentes continuam legíveis sem migração destrutiva.

Objetivo e fornecedor não participam das chaves de identidade nem dos cálculos. Duplicatas com metadados divergentes continuam sendo conflitos para reconciliação explícita; enriquecer um registro exige substituir sua versão anterior no snapshot. Um campo legado ausente e um campo vazio são equivalentes após normalização.

## Painel por projeto

`src/components/finance/FinanceProjectPanel.tsx` é integrado à aba Financeiro dos detalhes. Consulta somente `FinanceRepository.load`, filtra as tabelas pelo código Sankhya selecionado e utiliza `calculateProjectFinancials` para todos os indicadores. Não lê o orçamento do cadastro geral, não cria registros e não grava no armazenamento. A troca de projeto reinicia o carregamento e ignora respostas de consultas desmontadas.

Valores monetários são convertidos de centavos para BRL apenas na apresentação; datas de negócio são exibidas em DD/MM/YYYY sem conversão de fuso. A tabela Realizado apresenta as descrições opcionais de produto e ativo. O status da SC indica a existência de conversão registrada; aprovação é exibida separadamente, sem ações de aprovação.

Sem orçamento financeiro cadastrado, o painel permite visualizar custos e o total realizado (`calculateActualCostTotal`), mas mantém orçamento, comprometido, saldo disponível e execução percentual indisponíveis. Custos podem existir antes do orçamento; SCs, pedidos e ajustes continuam exigindo orçamento registrado. Com orçamento cadastrado, o indicador **Comprometido** e sua composição exibem os valores calculados, inclusive zero quando não houver compromissos registrados. Tabelas e demais indicadores de movimentações vazias mantêm seus estados sem registros. O painel trata carregamento e falhas de leitura com tentativa novamente, sem sobrescrever dados. No dashboard, o indicador também se chama **Comprometido**, somando os projetos cadastrados pelas mesmas regras do painel.

## Importação de custos realizados do Sankhya

### Exportações diretas em .xlsx

A Central também aceita os relatórios `Exportação de Custo`, `SC_s_Pendentes` e `Pedidos_Pendentes` do Sankhya salvos como **Pasta de Trabalho do Excel (.xlsx)**. O leitor usa a aba `new sheet`, com cabeçalho na linha 3, e ignora a última linha de totalização quando ela contém fórmulas e está sem identificador. Os formatos do Painel Capex descritos nas seções seguintes continuam disponíveis.

- Custos usam `AD_PROJ_IHBL` para vincular o projeto cadastrado e `VLRTOT` para o realizado. Um código de projeto vazio, zerado ou ausente da carteira bloqueia a linha. A confirmação substitui o conjunto de realizados da carteira.
- SCs somam `Vlr Pendente` por `Cód. Projeto` e `Nr.Unico`. O grupo exige confirmação consistente em todos os itens.
- Pedidos somam `Vlr Pend` por projeto e `Nr.Unico Ped.`. Cada linha é um item e entra na soma mesmo quando tem os mesmos dados de outra linha. A coluna `SC` vincula o item ao `Nr.Unico` da solicitação do mesmo projeto. A regra de comprometimento exclui SCs vinculadas a pedidos. Um pedido legado com o mesmo número exibido e identidade indeterminada gera conflito para evitar duplicar saldo.

SCs e pedidos ausentes de uma carga ficam na base até que seu encerramento seja conciliado.

Referência examinada: `references/Painel Capex 20252.xlsx`, autorizada pelo usuário como equivalente ao nome com `(1)`. Aba **EXPORTAÇÃO DE CUSTOS**, cabeçalho na **linha 3**; dados a partir da linha 4. Processamento exclusivamente local, com ExcelJS e JSZip carregados sob demanda. Outras abas, nomes definidos, desenhos e vínculos externos são excluídos antes da leitura para evitar consumo desnecessário de memória. Fórmulas não são executadas; células com fórmulas/erros nos campos utilizados bloqueiam a leitura e pedem exportação de valores calculados. Limites: arquivo 30 MB, parte XML utilizada 40 MB, aba 100 mil linhas.

| Coluna | Destino |
| --- | --- |
| COD_INDORAMA | `projectCode`, comparado aos códigos cadastrados na carteira |
| VLRTOT | `amount`, convertido de reais para centavos inteiros |
| NUMNOTA | `fiscalDocument`, número da nota |
| NOMEPARC | `supplier` |
| DTENTSAI | `date`, data de negócio YYYY-MM-DD |
| DESCRPROD / DESCRATIVO | `description` / `assetDescription`, opcionais para compatibilidade com dados antigos |
| NUNOTA / ANO_PROJETO | `sankhya.internalNoteId` / `sankhya.projectYear` |
| CODPROJ / AD_PROJ_IHBL | `sankhya.codproj` / `sankhya.adProjIhbl`, somente rastreabilidade |

Empresa, produto, parceiro, centro de custo, operação e identificação também são preservados em `sankhya`, junto com arquivo, aba e linha. COD_INDORAMA é comparado como texto aparado, sem procurar correspondência em CODPROJ/AD_PROJ_IHBL, sem criar projetos e sem associações aproximadas. Códigos sem correspondência são inconsistências. Os códigos da carteira são passados pela página, não inferidos de orçamentos ou da própria planilha.

Valores numéricos e textos decimais são convertidos com arredondamento de meio centavo para longe de zero. Textos BRL com vírgula decimal e pontos de milhar são aceitos; texto composto por grupos de três dígitos separados por ponto é interpretado como milhar brasileiro. Zero é um valor explícito válido. Valores inválidos/fora do limite são inconsistências; negativos são sinalizados para reconciliação porque o modelo financeiro ainda não suporta estornos. Datas seriais respeitam os sistemas 1900/1904 e ignoram a fração de horário. O serial fictício 60 do sistema 1900 é rejeitado. DD/MM/YYYY e YYYY-MM-DD também são aceitos. Os estilos de célula são retirados para manter o serial original, evitando a conversão silenciosa do serial 60.

### Substituição dos custos realizados

A prévia mostra o total legível, o total válido, as inconsistências e quantos lançamentos anteriores serão substituídos. Use uma exportação completa. Na confirmação, cada linha válida vira um lançamento identificado pela posição na planilha. A carga substitui todos os custos realizados da carteira, inclusive os de projetos ausentes da exportação.

A confirmação revalida os projetos e o estado do armazenamento. Uma prévia desatualizada exige nova confirmação. Arquivos sem linhas válidas preservam os custos anteriores. A gravação preserva as demais coleções financeiras. A futura importação incremental dependerá de um identificador estável por item ou rateio.

### Avaliação dos custos realizados

Na aba Financeiro do projeto, o gestor pode reconhecer ou contestar uma linha identificável de Realizado. A contestação exige motivo e aparece em **Análise de custos**. O analista pode validar o custo com justificativa ou concordar com a contestação e rejeitar o custo, com observação opcional. A conclusão aparece em **Relatórios** e na tabela de realizados do projeto. Valores corrigidos entram pela nova exportação Sankhya. O total realizado continua mostrando os valores importados, inclusive enquanto houver divergências.

O histórico de avaliações é gravado no mesmo snapshot financeiro, separado das linhas substituídas na importação. O vínculo provisório usa empresa, nota interna, produto e centro de custo. Quando essa combinação se repete, a avaliação pode ser vinculada à versão exata dos dados da linha, desde que ela seja distinta das demais. Linhas com os mesmos dados exigem uma sequência de item ou rateio para avaliação individual. A conclusão do analista se aplica à versão contestada. Uma versão corrigida volta para avaliação. Lançamentos ausentes mantêm o histórico em **Análise de custos**.

O nome é informado na ação, e o histórico é local ao navegador. O fluxo entre usuários em dispositivos diferentes requer autenticação e persistência compartilhada.

## Importação de SCs

**Importar SCs do Sankhya**, na Central de Importações, usa a aba **SC PENDENTE**, cabeçalho nas primeiras 30 linhas. Campos: `Nrº Projeto` (código exato do cadastro), `SC`, `Vlr. Nota` (reais convertidos em centavos), `Confirmada`, `Observação` (objetivo) e `Nro. Pedido`. Projetos precisam estar cadastrados e possuir orçamento financeiro. Não há busca por centro de resultado nem criação automática de projetos ou orçamentos.

Regra confirmada pelo usuário: **Sim** corresponde a `approved`, comprometendo apenas enquanto não houver conversão em pedido; **Não** corresponde a `pending`, exibida como **Planejada**, sem comprometimento. Outros valores de confirmação são inconsistências, sem aprovação presumida. Pedido vazio ou composto somente de zeros indica ausência de pedido vinculado. Pedido informado impede a dupla contagem, inclusive antes da importação do pedido em si.

O leitor reutiliza o isolamento de uma única aba de `sankhya-workbook.ts`. Fórmulas das colunas utilizadas são lidas somente pelo resultado salvo, com aviso explícito na prévia para revisar e recalcular/salvar o Excel se necessário. Fórmulas não são executadas. Erros ou resultados ausentes bloqueiam a linha; erros de fórmulas em colunas não utilizadas, como Contrato, não bloqueiam outras SCs. O importador de custos mantém a política anterior de rejeitar fórmulas.

A identidade da SC é por projeto e número, com identidade de origem `sankhya-sc-v1`. Arquivo, aba e linha são preservados em `sankhya`; dados antigos sem esses campos continuam válidos. Reimportações com mesmo conteúdo não gravam novamente, independentemente de nome de arquivo, posição ou horário. Alterações de valor, confirmação, objetivo ou pedido de SCs dessa mesma origem aparecem como **Atualizar**, com valores anteriores visíveis antes da confirmação. Registros divergentes de outra origem e todas as linhas com SC repetida no mesmo projeto são bloqueados, sem somar ou sobrescrever silenciosamente.

Somente novas SCs e atualizações válidas são gravadas após confirmação. SCs ausentes na nova planilha são mantidas; uma exportação de SCs em aberto não fornece evidência suficiente para excluir, rejeitar ou encerrar os registros ausentes. Custos realizados, pedidos, orçamentos, ajustes e outras SCs são preservados. Confirmação revalida o snapshot e a presença dos projetos, incluindo nova consulta sob o bloqueio de escrita. Falhas de armazenamento preservam o estado anterior.

## Importação de pedidos

**Importar pedidos do Sankhya** usa a aba **PENTENDES DE ENTREGA** (grafia original), cabeçalho na linha 3. Campos usados: `Cód. Projeto`, `Nr. Pedido`, `Fornecedor`, `Produto`, `Observação` e **Vlr Pend**. O usuário confirmou Vlr Pend como compromisso em aberto; **Valor Corrigido não é usado**. Projeto deve existir com orçamento financeiro. SCs e pedidos compartilham o leitor `sankhya-table.ts`, usando apenas resultados salvos de fórmulas, com aviso na prévia. Fórmulas não são executadas; erros em colunas não utilizadas, como Valor Corrigido ou Status, não bloqueiam a leitura.

Itens são agrupados por número do pedido e projeto e somados em centavos inteiros. Mesma numeração em projetos diferentes mantém saldos separados. Grupo com fornecedor divergente, item inválido ou itens indistinguíveis é bloqueado por inteiro, sem importar saldo parcial. Itens indistinguíveis têm fornecedor, produto, observação e saldo iguais; sem sequência de item, não é seguro concluir se são duplicatas ou itens legítimos. Item com projeto não identificável também bloqueia outros grupos do mesmo pedido, evitando atualizar um saldo incompleto. A prévia mostra linhas originais, quantidade de itens, fornecedor, observações, saldo atual/proposto, vínculo com SC e motivos de bloqueio.

A exportação não informa total contratado nem valor faturado. Pedidos importados recebem `status: "pending_delivery"`, `totalAmount: null`, `invoicedAmount: null`, e `openBalance` igual à soma de Vlr Pend. A validação só permite totais desconhecidos com esse status e proveniência explícita: `sankhya.balanceField`, arquivo, aba e itens com produto, observação, saldo e linha. Soma dos itens deve coincidir com o saldo do pedido. Registros anteriores com totais conhecidos mantêm as regras de saldo e faturamento existentes. A interface exibe **Não informado** nos totais desconhecidos; não infere faturamento a partir de entrega ou do status de atraso da planilha.

O saldo de pedidos importados compõe `uninvoicedOrderBalance` (nome interno preservado) e o comprometido. Uma SC já convertida não volta a comprometer ao importar o pedido. Quando há exatamente uma SC do mesmo projeto com `convertedOrderNumber` igual ao pedido, seu código também é apresentado como vínculo no pedido. Múltiplas SCs convertidas continuam excluídas individualmente do comprometido, sem inventar vínculo único. Custos realizados são calculados exclusivamente dos lançamentos importados, sem criar custos com base em entrega.

Identidade `sankhya-order-v1` por projeto e número. Reimportação com mesmo conteúdo ignora arquivo, posição, ordem dos itens e horário. Alterações dessa origem são apresentadas como atualização e substituem o saldo anterior somente após confirmar. Pedidos de outras origens não são sobrescritos. Ausência na nova exportação não prova faturamento ou cancelamento: pedidos ausentes são mantidos. Gravações revalidam snapshot e projetos sob bloqueio compartilhado, preservando SCs, custos, orçamentos, ajustes e pedidos não selecionados.
