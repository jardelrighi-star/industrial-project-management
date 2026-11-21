# Piloto online

O modo online usa o Supabase Auth e um snapshot transacional no PostgreSQL para a carteira, o financeiro, as avaliações de custos, os modelos de importação e o plano de aquisições. O servidor compara a versão do snapshot na gravação para evitar que uma atualização sobrescreva outra. O aplicativo local continua disponível sem `NEXT_PUBLIC_APP_MODE=online`.

## Configurar a base

1. Crie um projeto de homologação no Supabase e execute [a migração SQL](../supabase/migrations/202611200001_online_pilot.sql) pelo SQL Editor ou pelo procedimento de migrações do projeto.
2. Crie as contas do piloto em **Authentication → Users**. Use e-mail e senha e desabilite a inscrição pública. Cada conta precisa uma associação explícita à carteira.
3. Crie a carteira e a associação de administrador no SQL Editor. Substitua o e-mail antes de executar.

```sql
do $$
declare
  admin_id uuid;
  new_workspace_id uuid;
begin
  select id into strict admin_id from auth.users
    where email = 'administrador@empresa.example';
  insert into public.ipm_workspaces (name)
    values ('Piloto industrial') returning id into new_workspace_id;
  insert into public.ipm_workspace_state (workspace_id) values (new_workspace_id);
  insert into public.ipm_memberships (workspace_id, user_id, role)
    values (new_workspace_id, admin_id, 'admin');
end $$;
```

4. Associe gestores e analistas. Use o ID da carteira criada, o e-mail da conta e os códigos Sankhya exatos dos projetos aos quais ela terá acesso. O piloto admite uma carteira por conta.

```sql
insert into public.ipm_memberships (workspace_id, user_id, role, project_codes)
select 'ID-DA-CARTEIRA'::uuid, id, 'manager', array['CODIGO-DO-PROJETO']
from auth.users
where email = 'gestor@empresa.example';
```

Use `analyst` para o analista. O administrador cadastra projetos, importa planilhas e reconcilia orçamentos. Gestores avaliam custos e mantêm o plano de aquisições nos projetos atribuídos. Analistas decidem as contestações nos projetos atribuídos. As decisões registram o ID e o e-mail da conta autenticada.

Para habilitar o time de **Compras**, aplique [a migração do perfil Compras](../supabase/migrations/202611200002_buyer_role.sql) e use `buyer` no cadastro de membros. Os usuários desse perfil informam a previsão de geração do pedido para SCs sem pedido dos projetos atribuídos. Os administradores também podem acessar a seção.

## Configurar o Next.js

Copie [o exemplo de variáveis](../.env.example) para `.env.local` e preencha os valores do Supabase. Na hospedagem, configure as mesmas quatro variáveis no ambiente de homologação e gere um novo build. Somente `NEXT_PUBLIC_APP_MODE` é destinado ao cliente. A chave secreta é usada no servidor para consultar a associação e acessar o snapshot. As tabelas têm RLS habilitada e os papéis públicos do Supabase ficam sem acesso direto.

```powershell
npm ci
npm run build
npm run start
```

Use uma URL HTTPS para o piloto publicado. No modo online, a confirmação das importações grava no PostgreSQL. As planilhas de referência e os backups locais ficam fora do Git. A base online começa vazia. Para aproveitar dados gravados no navegador, prepare uma migração explícita antes de encerrar o ambiente local.

## Validar antes de liberar dados reais

- Entre como administrador e importe a carteira e as planilhas de homologação.
- Abra o app em outra sessão como gestor. Confira os projetos permitidos e conteste um custo.
- Abra uma sessão como analista, decida a contestação e confira a decisão como gestor.
- Reimporte o arquivo, confirme os valores e verifique que o histórico e os vínculos entre SC e pedido foram preservados.
- Verifique que um gestor ou analista sem acesso ao projeto fica sem os seus dados e que gravações concorrentes preservam as alterações confirmadas.
