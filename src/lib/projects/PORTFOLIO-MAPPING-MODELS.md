# Reconhecimento de cabeçalhos e modelos

Ao selecionar um Excel válido, o componente lê os modelos salvos e tenta aplicar uma correspondência única. O reconhecimento não grava projetos, orçamentos ou modelos. A geração de prévia e a confirmação final permanecem ações explícitas separadas.

## Detecção e ajustes

`portfolio-mapping-models.ts` reconhece nomes usuais dos campos, incluindo COD_INDORAMA, Nome do projeto, Orçamento aprovado, Unidade industrial, Responsável, datas, prioridade e status. A procura inicial percorre as primeiras 50 linhas de cada aba. Modelos salvos também procuram a linha original do modelo, permitindo reutilizar layouts com cabeçalho posterior à linha 50. Cabeçalhos fora dessas posições podem ser selecionados manualmente.

Correspondência é exata após normalizar somente os títulos: acentos, caixa, pontuação e espaços. Valores das células e códigos de projeto não são normalizados. Não se associa orçamento atualizado ou realizado ao orçamento original aprovado por similaridade aproximada. Múltiplos candidatos para campos obrigatórios impedem a detecção automática. Mais de uma aba/cabeçalho ou mais de um modelo compatível exige escolha do usuário.

As sugestões preenchem aba, linha e colunas, mas permanecem editáveis. A opção **Detectar automaticamente novamente** refaz a sugestão. Ajustar um campo manualmente desvincula a escolha do modelo salvo e invalida a prévia anterior, sem alterar o modelo. Um layout ajustado pode ser salvo com novo nome.

## Modelos por nomes de colunas

**Salvar modelo** exige nome com até 80 caracteres, os três campos obrigatórios e cabeçalhos textuais únicos em todas as colunas mapeadas. Arquivos sem cabeçalho continuam disponíveis para importação com mapeamento manual, mas não geram modelos de cabeçalho.

Um modelo armazena identificador, nome, aba/linha originais e a relação campo → título normalizado. Não salva números de colunas como identidade, linhas de projetos, códigos ou valores financeiros. Assim, colunas reordenadas são resolvidas novamente pelos nomes. Cabeçalhos obrigatórios ou opcionais mapeados que tenham sido removidos, renomeados ou duplicados tornam o modelo incompatível. Colunas extras não mapeadas não afetam a compatibilidade. Títulos personalizados são reutilizáveis após o usuário definir seu significado uma vez, mesmo quando não estão na lista de aliases automáticos.

O modelo incompatível selecionado limpa a prévia e deixa o mapeamento sem campos para confirmação; a interface apresenta o motivo. A prévia fica bloqueada até aplicar um modelo válido ou ajustar manualmente as colunas. Na seleção inicial do arquivo, modelos que não correspondem não são aplicados: a interface informa que houve reconhecimento por cabeçalhos ou solicita configuração manual.

`PortfolioMapping.expectedHeaders` registra os títulos esperados por campo quando o mapeamento possui cabeçalhos textuais únicos. `validatePortfolioMapping` verifica esses títulos e sua unicidade tanto ao preparar a prévia quanto ao revalidar a confirmação. Uma coluna renomeada não pode receber silenciosamente o papel da posição antiga. Mapeamentos posicionais manuais sem títulos continuam sujeitos às validações existentes dos campos obrigatórios e de cada linha.

## Persistência separada

`LocalStoragePortfolioModelRepository` usa exclusivamente `industrial-project-mapping-templates:v1`, envelope `{ version: 1, models: [...] }`. Carregamento não grava nada e não consulta as chaves cadastral/financeira. A inclusão é feita sob o bloqueio compartilhado, relendo o estado atual para preservar modelos adicionados em outra aba. Nomes ou identificadores repetidos são rejeitados; o usuário escolhe outro nome para um layout novo.

JSON inválido, versão desconhecida, campos obrigatórios ausentes ou cabeçalhos inconsistentes geram erro e preservam os bytes armazenados. Falha ao salvar mantém os modelos anteriores. Se a leitura dos modelos falhar, o arquivo Excel continua disponível com reconhecimento de cabeçalhos e ajustes manuais; a falha é exibida separadamente. Nenhum dado de projetos ou financeiro é escrito ao salvar um modelo.

## Validação

Testes cobrem reutilização após leitura do armazenamento, aliases e títulos personalizados, mudanças de ordem/aba/linha, alterações de cabeçalho, duplicidades, campos obrigatórios, ambiguidade de modelos, guarda da confirmação, corrupção, quota e gravações concorrentes. A planilha `references/carteira_capex_ficticia_teste.xlsx` é reconhecida na aba Carteira CAPEX, linha 1, com 13 campos e prévia de 10 projetos, sem confirmar importação. Os testes de persistência usam armazenamento exclusivamente em memória.
