# Copom trocas PWA — acesso, usuários e turnos

PWA móvel para controle de folgas do Copom trocas, agora com acesso por CPF e senha, administração de usuários e cadastro de turnos.

## Acesso administrativo inicial

O sistema cria automaticamente o administrador inicial na primeira abertura conectada ao Firebase. Na versão 6.2, esse bootstrap usa a árvore compatível com as regras do PWA original, evitando a falha de inicialização causada pelo caminho novo não autorizado:

- Nome: `Sales`
- CPF: `225.097.818-20`
- E-mail: `stqcopomsp@gmail.com`
- Senha: `101010`
- Perfil: `Admin`

O CPF informado é válido e o campo aceita somente números, exibidos com a máscara `000.000.000-00`.

## Recursos adicionados

- Login por CPF e senha numérica de 6 dígitos.
- Botão administrativo com ícone de estrela, visível somente para perfil Admin.
- Perfis `Admin` e `Comum`.
- Cadastro de usuário com nome, CPF válido, e-mail, turno e perfil.
- Bloqueio de CPF e e-mail duplicados.
- Senhas aleatórias de 6 dígitos, com repetição permitida.
- Senhas armazenadas como hash PBKDF2; a senha em texto não é gravada no banco.
- Recuperação por e-mail com a mensagem `E-mail não possui cadastro.` quando não houver vínculo.
- Cadastro e exclusão de turnos.
- Lista dinâmica de turnos no cadastro de usuário.
- Interface responsiva para celular, tablet e desktop.

## Turnos iniciais

- T-01A — 05:30 às 11:30
- T-01B — 06:00 ao meio-dia
- T-02A — 11:30 às 05:30
- T-02B — meio-dia às 18:00
- T-03A — 17:30 às 23:30
- T-03B — 18:00 às 00:00
- T-04A — 23:30 às 05:30
- T-04B — 00:00 às 06:00

Os turnos são inseridos automaticamente caso ainda não existam.

## Configuração do envio de e-mail — EmailJS

Esta versão já vem com os identificadores informados para o EmailJS:

```text
Public Key: hM3Ta4FMcKReovWuI
Service ID: service_ajr1772
Template ID: template_w6zv5bj
Remetente: stqcopomsp@gmail.com
```

A aplicação continua estática e não utiliza Firebase Cloud Functions. O envio é realizado pelo EmailJS. A senha do Gmail não fica no PWA.

### Ajuste obrigatório do template `template_w6zv5bj`

No painel **EmailJS > Email Templates > template_w6zv5bj**, configure:

```text
To Email: {{to_email}}
From Name: Copom trocas
Reply-To: {{reply_to}}
Subject: {{subject}}
```

No corpo do e-mail, a opção mais simples e compatível é colocar apenas:

```text
{{message}}
```

O Copom trocas monta `message` completo com nome, CPF, senha, perfil e turno. Se preferir montar o layout manualmente no EmailJS, também estão disponíveis:

```text
{{to_email}}
{{email}}
{{to_name}}
{{name}}
{{password}}
{{passcode}}
{{cpf}}
{{profile}}
{{shift}}
{{purpose}}
{{app_name}}
{{from_email}}
{{subject}}
{{message}}
```

**Atenção:** o campo **To Email** do template precisa usar `{{to_email}}` (ou `{{email}}`). Somente enviar `to_email` pelo JavaScript não troca um destinatário que esteja fixo no painel do EmailJS.

Exemplo de corpo manual:

```text
Olá, {{to_name}}.

Seu acesso ao {{app_name}} foi atualizado.
CPF: {{cpf}}
Senha: {{password}}
Perfil: {{profile}}
Turno: {{shift}}

Por segurança, não compartilhe esta senha.
```

O código também envia `name`, `email`, `message` e `passcode`, para funcionar com templates do EmailJS que tenham sido criados a partir de modelos prontos.

## Firebase Realtime Database

Esta versão usa o Realtime Database do projeto `civilcop-ec5b1`. Publique o `database.rules.json` no console do Firebase (Realtime Database → Regras).

Caminhos usados:

```text
civiloff/v1/users
civiloff/v1/emailIndex
civiloff/v1/shifts
civiloff/v1/schedules/{userKey}
civiloff/v1/trocas/requests/{requestId}
civiloff/v1/trocas/inbox/{userKey}/{messageId}
civiloff/v1/trocas/documents/{requestId}
civiloff/devices/{deviceId}
civiloff/meta
```

Cada escala salva a âncora e as folgas (unitária/dupla) do **mês anterior**, **mês atual** e **mês posterior**.

## Aviso de segurança importante

Esta implementação respeita o pedido de não usar backend ou Cloud Functions, mas isso impõe uma limitação técnica: as operações de cadastro e redefinição são executadas pelo navegador. As regras incluídas validam o formato dos dados, porém não conseguem comprovar com segurança o perfil Admin em um fluxo de autenticação personalizado apenas com CPF e senha.

Para uso real com CPFs e dados pessoais, a arquitetura recomendada é um backend autenticado ou uma função server-side que valide as permissões e mantenha credenciais de envio fora do cliente. A versão atual é adequada como protótipo controlado, não como proteção definitiva de dados sensíveis.

## Publicação

Publique todos os arquivos desta pasta em hospedagem HTTPS, mantendo a estrutura. O PWA continuará funcionando offline após o primeiro carregamento, exceto para login, cadastro, sincronização e envio de e-mail, que exigem internet.
