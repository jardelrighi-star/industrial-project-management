# Importação da Carteira de Projetos

Disponível na Central de Importações, em **Importar Carteira de Projetos**. O arquivo é processado localmente com ExcelJS; não é enviado a serviços externos.

## Fluxo e layout

1. Selecionar `.xlsx` (até 30 MB; conteúdo ZIP até 60 MB, 2 mil partes, 20 abas, 20 mil linhas no total e 200 colunas por aba).
2. Conferir a aba, a linha e as colunas sugeridas pelo reconhecimento de cabeçalhos ou por um modelo salvo compatível. Casos ambíguos exigem escolha manual. A amostra permite verificar os valores efetivamente lidos. Linha 0 continua disponível para arquivos sem cabeçalho no modo manual.
3. Mapear obrigatoriamente COD_INDORAMA, nome e orçamento original aprovado em reais. Colunas opcionais: unidade, departamento, tipo, categoria, responsável, gerente, início, fim, prioridade, status operacional e avanço físico (escala 0–100). Uma coluna não pode alimentar dois campos. Alterar o mapeamento invalida a prévia. **Salvar modelo** guarda as escolhas com um nome definido pelo usuário, sem importar projetos; detalhes e compatibilidade estão em [PORTFOLIO-MAPPING-MODELS.md](./PORTFOLIO-MAPPING-MODELS.md).
4. Confirmar o mapeamento para gerar a prévia paginada, sem gravação. Conferir novos, existentes, duplicados, inválidos e motivos.
5. Confirmar explicitamente a quantidade de projetos novos válidos. Caso qualquer snapshot tenha mudado, a prévia é atualizada e exige nova confirmação.
6. Consultar relatório paginado de todos os importados e não importados, com linha, código, nome e motivo.

COD_INDORAMA é texto imutável. Textos com zeros à esquerda são preservados. Células numéricas só são aceitas como códigos novos quando possuem máscara explícita composta de zeros (`00000`, por exemplo). Números sem máscara são rejeitados, pois não comprovam os zeros originais. Espaços externos e minúsculas incompatíveis com o domínio financeiro são reportados, nunca corrigidos silenciosamente.

Projetos cadastrados são ignorados integralmente, mesmo com divergências ou células inválidas nos demais campos. Todas as ocorrências de um código repetido no arquivo são bloqueadas, inclusive quando uma delas é inválida ou já existente. Códigos com vínculos financeiros órfãos são rejeitados para reconciliação, sem substituir seus dados. Nenhum projeto ausente do arquivo é excluído.

O orçamento usa `parseBrlCents`, com a mesma conversão BRL e arredondamento de meio centavo para longe de zero já usados pelo financeiro. Falta de valor e negativos são inválidos; zero explícito na coluna mapeada é apresentado e só se torna orçamento aprovado após confirmação. Fórmulas e erros em campos mapeados de novos projetos são inconsistências; resultados em cache não são aceitos.

Novos projetos recebem `budget: 0` apenas para compatibilidade. A fonte oficial é `ProjectBudget.originalApprovedAmount`, em centavos inteiros. O orçamento atualizado continua derivado pelo domínio financeiro. Autorização de execução é um objeto opcional nos legados e obrigatório no candidato importado: `{ status: "pending", date: null, externalReference: null }`. Não são inferidas referências de aprovação. Campos opcionais ausentes ficam vazios; status operacional inicial Planejado e avanço 0. Nenhum orçamento estimado é criado.

## Persistência coordenada e limites

localStorage não possui transação física entre `industrial-projects` e `industrial-project-finance:v1`. O adaptador em `../coordinated-storage.ts` usa um registro único `industrial-project-management:transaction:v1` como ponto de commit atômico do lote completo, com snapshots anteriores e posteriores das duas chaves.

Antes do commit, toda falha deixa os dados anteriores intactos. Depois dele, ambos os repositórios leem os snapshots completos do registro transacional. As chaves antigas são espelhos de compatibilidade. Falha em qualquer espelho ou na limpeza do registro não é reportada como importação falhada: o lote já está confirmado e a interface informa a sincronização pendente. Não se deve reimportar o lote para recuperá-lo.

A recuperação é idempotente, sob o Web Lock compartilhado, e também antecede qualquer gravação normal. Leituras nunca iniciam recuperação nem regravam dados. Nenhuma nova escrita pode contornar uma recuperação que falhou. A interface oferece **Concluir sincronização pendente**. O registro é limpo com um tombstone JSON `null`; não se apagam chaves de usuário. Um novo carregamento da aplicação mantém a visão completa mesmo após fechamento durante a sincronização.

A recuperação aceita espelhos iguais ao estado anterior ou posterior. Se detectar alteração externa diferente de ambos, bloqueia a operação e preserva os dados para diagnóstico, sem rollback destrutivo. Navegadores sem Web Locks não podem confirmar gravações. O protocolo exige que os acessos ocorram pelos repositórios desta versão; versões antigas, edições diretas no localStorage, limpeza externa do armazenamento e falhas do próprio dispositivo não oferecem a mesma garantia. Para múltiplos clientes ou aplicações escrevendo por outros meios, a solução é uma API com transações em banco.

A importação somente acrescenta projetos e orçamentos. O envelope e as coleções financeiras existentes são preservados, sem regravar seus registros normalizados. Reconciliação e importação de custos permanecem usando os mesmos repositórios, agora compatíveis com o registro transacional. Gravações cadastrais da interface verificam o snapshot esperado para não apagar inadvertidamente projetos adicionados por outra aba.

## Falhas de leitura e reabertura do painel

Recolher ou reabrir o painel limpa mensagens anteriores, preservando o arquivo selecionado e os dados já lidos. Essa transição não inicia leitura ou validação de Excel. A verificação de recuperação do armazenamento continua independente da seleção de arquivo.

Um arquivo que falhou permanece em memória enquanto o componente está montado. Seu nome é exibido e a ação **Tentar ler este arquivo novamente** permite repetir a leitura sem procurar o arquivo outra vez. Cancelar o seletor não remove a seleção anterior. O controle nativo de arquivo é reiniciado para permitir selecionar a mesma cópia novamente; a referência ao `File` e o nome visível são mantidos separadamente. Recarregar completamente a página reinicia esse estado local, conforme as restrições do navegador.

`PortfolioWorkbookReadError` transporta uma mensagem pública deliberada e mantém a exceção original em `cause`. Exceções internas do ZIP ou ExcelJS não são exibidas na interface. Em desenvolvimento, o console recebe o nome do arquivo e o objeto da exceção original, incluindo stack trace. Em produção, esse registro técnico não é emitido. As validações existentes de extensão, tamanho e limites mantêm mensagens específicas e as mesmas regras.

Foi reproduzida uma incompatibilidade do ExcelJS com prefixos de namespace nos elementos de `xl/workbook.xml`: trocar somente `<workbook>` por `<x:workbook>` e aplicar o mesmo prefixo aos elementos filhos, com declaração válida do namespace, deixa o modelo interno indefinido nessa versão. O acesso `model.sheets = workbook.sheets` em `exceljs/lib/xlsx/xlsx.js:323` então lança o TypeError. A validação posterior do resultado da aplicação não consegue interceptar esse ponto, porque `xlsx.load` já rejeitou a Promise. O tratamento agora captura essa exceção, apresenta orientação para salvar uma nova cópia `.xlsx` e preserva o arquivo para nova tentativa. ExcelJS permanece como biblioteca principal; a compatibilidade em memória implementada posteriormente é descrita a seguir.

O arquivo `carteira_capex_ficticia_teste.xlsx` não estava disponível no workspace durante a correção inicial das mensagens; não foi possível determinar sua compatibilidade específica. Há um teste condicional que lê esse arquivo sem importar dados, lista suas abas e verifica a posição do cabeçalho com COD_INDORAMA. Ele procura a raiz, `references/` e `fixtures/`, ou o caminho explícito em `PORTFOLIO_WORKBOOK_FIXTURE`. Testes em memória verificam leitura válida, nomes das abas, cabeçalho na linha 2, preservação de zeros, ZIP inválido e a incompatibilidade de namespace descrita acima.

### Verificação posterior do arquivo fictício disponível

`references/carteira_capex_ficticia_teste.xlsx` foi disponibilizado posteriormente, com 6.797 bytes. O leitor atual falha antes de retornar suas abas: o XML real usa `x:workbook`, `x:sheets` e `x:worksheet` no namespace SpreadsheetML. A exceção original é `TypeError: Cannot read properties of undefined (reading 'sheets')` em `exceljs/lib/xlsx/xlsx.js:323:37`. Trata-se da incompatibilidade de prefixos já reproduzida, agora confirmada no arquivo fornecido.

A inspeção independente do ZIP com parser XML sensível a namespaces confirmou as abas **Carteira CAPEX** e **Instruções**. Na primeira, há cabeçalho na linha 1 e exatamente 10 linhas de projetos. Colunas: COD_INDORAMA, Nome do projeto, Unidade industrial, Departamento, Tipo, Categoria, Responsável, Gerente, Data inicial, Data final planejada, Orçamento aprovado, Prioridade e Status. Na verificação inicial desse arquivo, o teste do importador falhou por compatibilidade, sem gravar dados. A correção descrita abaixo resolveu essa falha.

A correção foi implementada mantendo ExcelJS, conforme descrito abaixo. Não houve substituição da biblioteca nem alteração do arquivo original ou dos repositórios.

## Compatibilidade de namespaces implementada

`portfolio-xml-normalization.ts` valida o ZIP, seus tamanhos, CRC32, nomes de partes, XML e relacionamentos internos antes da leitura. Exige as partes OPC obrigatórias e os relacionamentos das abas. DTD, XML malformado, prefixos não declarados, caminhos que escapam do pacote, partes ausentes/duplicadas, volumes múltiplos e ZIP64 fora do formato limitado são rejeitados com mensagens públicas compreensíveis. Não são acessados relacionamentos externos.

A normalização usa `saxes` com resolução de namespaces e posições de tokens. Somente os nomes reais de elementos nos namespaces SpreadsheetML e de relacionamentos do pacote são adaptados nas partes consumidas pelo ExcelJS. Não há substituição global no documento. O conteúdo original entre os tokens não é serializado: textos, entidades, fórmulas, CDATA, comentários, atributos e seus valores permanecem intactos. Declarações de namespace existentes são mantidas; declarações padrão locais são acrescentadas apenas quando necessárias para preservar os nomes expandidos e o escopo de elementos estrangeiros. Declarações conflitantes ou escopos QName inseguros são rejeitados em vez de adivinhados.

Depois de editar uma parte, uma segunda validação compara a sequência completa de nomes expandidos dos elementos e atributos, valores dos atributos e eventos de conteúdo. Qualquer diferença além das declarações padrão necessárias cancela a operação. O ZIP preparado existe apenas em memória; as demais partes mantêm seu conteúdo descompactado e a lista de entradas é preservada, sem adicionar diretórios. Arquivos sem necessidade de normalização retornam o mesmo ArrayBuffer original, sem recompressão. Assinaturas digitais impedem a normalização, pois qualquer mudança no XML as invalidaria.

### Relacionamento absoluto da tabela no arquivo de referência

Após resolver os namespaces, o arquivo revelou outra incompatibilidade do ExcelJS 4.4.0: a tabela referencia `/xl/tables/table1.xml`, mas a biblioteca consulta literalmente `../tables/table1.xml`. Reescrever o atributo `Target` violaria a preservação dos relacionamentos exigida nesta etapa.

`portfolio-exceljs-compatibility.ts` mantém o XML original do relacionamento e aplica um adaptador somente à instância de leitura. Durante a reconciliação interna do ExcelJS, uma Proxy de consulta resolve o Target absoluto validado para a chave equivalente da tabela. Não há aliases enumeráveis, alteração de IDs, escrita em protótipos ou modificação da biblioteca instalada. O método e a coleção são restaurados em `finally`. O adaptador só é instalado quando há caminhos equivalentes que exigem essa compatibilidade; os demais arquivos usam a chamada normal a `xlsx.load`.

Esse ponto depende da rotina interna de reconciliação do ExcelJS: por isso a dependência foi fixada na versão já utilizada, **4.4.0**, e o adaptador verifica o contrato em execução, falhando explicitamente se ele não existir. Uma futura atualização da biblioteca deve executar os testes de tabela absoluta e de preservação antes de alterar essa versão.

### Resultado da leitura, sem importação

O teste real agora reconhece **Carteira CAPEX**, cabeçalho na **linha 1**, **13 colunas**, **10 linhas de projetos** e a aba **Instruções**. Também verifica a tabela `CarteiraProjetosTeste`, os relacionamentos inalterados e a igualdade do arquivo original antes/depois da leitura. Testes adicionais cobrem arquivos sem prefixos (mesmos bytes), dados com fórmulas e resultados em cache, tipos de célula, estilos, datas 1904, máscaras com zeros, hyperlinks, células mescladas, namespaces estrangeiros e entradas inválidas. Fórmulas e células com erro continuam bloqueadas pelas regras existentes de importação. Nenhuma confirmação de importação ou gravação de projetos é executada nesses testes.
