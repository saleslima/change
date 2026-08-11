# Copom trocas — integração N-DIT (v9)

## Fluxo de troca (timeline em 3 passos)

1. O usuário solicita a troca informando o dia e uma ou mais equipes (A–E).
2. Todos os usuários ativos das equipes escolhidas recebem o pedido.
3. Cada interessado envia **contraproposta** escolhendo **somente um dia em que sua equipe está de serviço** (demais dias ficam foscos) e **já assina** (Passo 1 — interessado).
4. O solicitante recebe as propostas, escolhe uma e **assina** (Passo 1 — solicitante).
5. Com o Passo 1 concluído, os **supervisores** de cada equipe registram **ciente** e assinam (Passo 2).
6. Em seguida, os **chefes de operações** de cada equipe registram **ciente** e assinam (Passo 3).
7. Com os 3 passos ticados, o status fica **OK**. Caso contrário permanece **PENDENTE**, indicando o passo em aberto.

## Cadastro de usuários

Campos: nome completo, nome de guerra, posto/graduação (Sd PM até Cel PM), RE no formato `000000-0` (6 números + dígito ou A/B), e-mail, equipe e perfil.

Perfis e postos compatíveis:

- **Despachador**: Sd PM a Cb PM
- **Supervisor**: 3º Sgt PM a Subten PM
- **Chefe de Operações**: 2º Ten PM a Cap PM
- **Admin**: acesso administrativo (legado/CPF)

Login principal: **RE** + senha de 6 dígitos. CPF permanece aceito apenas para cadastros legados/admin.

## Equipes

Usuários são cadastrados nas equipes A–E. A lista do Admin permite alterar a equipe.

## Calendário operacional

Mostra Dia, Dia da semana, Equipe Dia e Equipe Noite. Marcações amarelas e ocorrências ficam no navegador.

## Como testar local

Execute `INICIAR_LOCALHOST.bat` (ou `python -m http.server 8080` na pasta) e abra `http://localhost:8080`.

## PWA

Cache: `civiloff-v9.0-fluxo-3-passos`. Publique em HTTPS (ou use localhost) para instalação.
