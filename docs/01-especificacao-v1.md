# Especificação v1 · Sistema de acompanhamento de pedidos (PO)

Status: **validada pelo Victor em 18/09/2026, em construção.** Perguntas pra Julia seguem abertas (seção 10); o que ela responder ajusta a v1.
Decisões do Victor estão na seção 13.

---

## 1. O que é

Uma página web (link nos favoritos, abre no PC e no celular) que substitui a planilha "Pedidos Julia".
Ela importa o relatório do sistema de compras (segunda e quinta), organiza os pedidos por prazo,
guarda as observações e as ações, e manda um e-mail todo dia de manhã com o que vence e o que tem ação marcada.

Dados ficam numa planilha Google privada (fonte da verdade + backup). O app é só a tela.

---

## 2. O que eu entendi das planilhas (double check)

Tudo abaixo foi lido nos arquivos reais (CSV + PDF + prints). Onde eu não tenho certeza, está marcado `[confirmar]`.

### 2.1 Relatório do sistema (`relatorio_de_pedidos_de_compras-*.csv`)

16 colunas, separador `;`, valores entre aspas, decimal com vírgula, data `dd/mm/aaaa hh:mm`.

| Coluna do relatório | Entra no app? | Vira o quê |
|---|---|---|
| PO | sim | **chave única** do pedido |
| Fornecedor | sim | Fornecedor |
| Tipo PO | sim | Tag "Tipo" (normalizada, ver 2.4) |
| Time | sim | Tag "Time" (Decor, Cozinha, Textil, Moveis) |
| Envio PO | sim | Data de envio |
| Qtd Pecas | sim | Quantidade |
| Delivery Time | sim | **Data limite** |
| Lead Time WMS | sim | Prazo em dias úteis (usado pra conferir a data limite) |
| Valor PO | sim, escondida | Valor em R$ (formatado, só aparece se ela quiser) |
| Armazem, Campanha, Campanha ID | sim, escondidas | Filtros opcionais |
| Forma Pagamento, Lead Time BOB, Inicio/Final Campanha | não na v1 | ficam guardados no bruto, sem aparecer |

**Regra validada (14 de 14 linhas):** `Delivery Time = Envio PO + Lead Time WMS em dias úteis (seg a sex)`.
Ex.: PO 202895, envio 16/09 (quarta) + 15 úteis = 07/10. Bate.
O app usa isso pra recalcular e avisar se um relatório vier com data estranha.

### 2.2 Planilha "Pedidos Julia"

**Página 1 · PRIMEIRA REMESSA (505 linhas).** É a tabela principal.
Colunas: Fornecedor · Tipo · PO · Data Limite · Quantidade · Observação · Update · Data Finalização · Status.

- `Fornecedor`, `Tipo`, `PO`, `Data Limite`, `Quantidade` vêm do relatório (Data Limite = Delivery Time, confirmado no PO 202894 → 17/09).
- `Observação`, `Update`, `Data Finalização` são preenchidos à mão.
- `Status` é escolhido à mão numa lista (Atrasado / Em andamento / Finalizado). **Hoje ele não se atualiza sozinho**: 3 linhas têm "Finalizado" na observação e status "Em andamento" (POs 201772, 200706, 201072). No app o status é calculado.

**Página 2 · SEGUNDA REMESSA (35 linhas).** Mesmas colunas.
Vários POs aparecem nas duas páginas com quantidade **menor** na página 2:

| PO | Pág. 1 | Pág. 2 | Obs. pág. 2 |
|---|---|---|---|
| 202652 BUDDEMEYER | 99 | 43 | Enviar Ativo |
| 202682 OASIS | 9 | 4 | Quebrar |
| 200316 IND. RIO BRANCO | 12 | 8 | Ag. retorno fornecedor |
| 202712 LUCAT | 19 | 4 | Ativo Enviado - Report 21/09 |
| 202664 TECELAGEM MELLO | 140 | 8 | Previsão 09/10 |

Leitura: **página 2 = saldo de pedido entregue parcialmente** (o que faltou vira "segunda remessa", às vezes com um PO novo, o "PO Ativo"). `[confirmar]`

**Página 3.** Não é tabela, é um quadro de regras de logística:
- MILK RUN: lista de fornecedores + "preencher docs de coleta" + "colocar Milk Run nas obs".
- DUMAR (Transp. do Sul): fornecedores que ela coleta; entrega toda segunda; cada fornecedor tem prazo de NF ("NF até quarta", "só quinta").
- EXPRESSO ARAÚJO: entrega sempre quarta; NF até sexta; sem coleta.
- Transportadoras com e-mail (Cavichion, TMS, VPX).
- RAYZA TAPETES: entrega somente segunda.
- Regra geral: "agendar para a data limite e mandar e-mail perguntando quando podemos agendar; se tiver outra data, mandar no grupo da doca".

Leitura: **cada fornecedor tem uma regra logística** (transportadora, dia de entrega, prazo de NF, precisa coleta?). Isso vira cadastro de fornecedor no app, com cor.

**Página 4.** Lista de ~500 nomes. É a fonte da lista suspensa de "Fornecedor". Tem duplicados, variações de nome
(com e sem código no final) e **pessoas físicas com CPF no nome** (ver 8).

### 2.3 Padrões da coluna Observação

Ela escreve sempre as mesmas coisas, em texto livre:

- `Agendado dd/mm` · `Agendar dd/mm` · `Previsão dd/mm` · `Previsão semana dd/mm`
- `PO recebido` · `NF recebida` · `Ag. receber PO` · `Ag. retorno fornecedor` · `Ag. NF`
- `Ativo enviado - Report dd/mm` · `Preventivo enviado` · `Enviar Ativo` · `Enviar Preventivo`
- `Quebrar` · `Quebrado` · `Rastreio XXXX` · `Finalizado` · `Ver saldo em dd/mm`

Ou seja: **quase toda observação é uma etapa + uma data**. É exatamente o que o aviso precisa.
Proposta: manter o texto livre **e** adicionar dois campos pequenos: `Próxima ação` (lista curta, editável) e `Data da ação`.
O e-mail do dia usa a data da ação. `[confirmar com ela se aceita preencher a data]`

### 2.4 Tags "Tipo" estão inconsistentes

- Relatório usa: `now_crossdocking`, `ticket_active` (e provavelmente `now_pre_buy`, `repurchase`, `influencers`, `STORE`).
- Lista da página 1: now_crossdocking, STORE, now_pre_buy, special_actions, ticket_active, Estúdio, Recompra, Influenciadores.
- Lista da página 2: CB, EST, PB, RC, TK, AE, LOJA, NOW-CROSS, NOW-PB, now_pre_buy, now_crossdocking.

Proposta: o app guarda o código do relatório e mostra um **nome bonito + cor**, configurável por ela
(ex.: `now_crossdocking` → "Cross", `now_pre_buy` → "Pre-buy", `ticket_active` → "Ticket", `repurchase` → "Recompra", `influencers` → "Influenciadores"). Código novo que aparecer no relatório é criado automaticamente e ela renomeia depois.

### 2.5 Inconsistências encontradas (o app resolve)

| Problema na planilha | Como o app trata |
|---|---|
| PO 202572 aparece com dois fornecedores diferentes (RF18 na pág. 1, VIA STAR na pág. 2) | PO é chave única; importação avisa se o fornecedor mudou |
| Status não acompanha a data | Status calculado todo dia |
| Fornecedor com nome variado ("SULTAN ... LTDA" e "SULTAN ... LTDA - 000300") | Cadastro de fornecedor com "nomes alternativos" |
| Observação com data solta no texto | Campo de data da ação |
| Linha com status vazio (ex.: PO 202340, 202781) | Nunca fica vazio |

---

## 3. Rotina dela com o app

**Segunda e quinta (dia de emissão):**
1. Exporta o relatório do sistema (CSV).
2. Abre o app → aba Pedidos → "Importar relatório" → arrasta o arquivo.
3. O app mostra: "14 pedidos novos, 0 já existiam, 0 com aviso". Confirma.

**Todo dia de manhã:**
1. Recebe e-mail às 8h: atrasados, vencem em 2 dias, ações de hoje.
2. Abre o app na aba Dash e vai batendo as ações.
3. Ao editar um pedido, `Update` preenche sozinho com a data de hoje.

**Quando finaliza:** marca "Finalizar" → data de finalização = hoje, some da lista padrão (fica no histórico).

---

## 4. As 3 abas

### 4.1 Dash
- 4 números grandes: **Atrasados** · **Vencem em 2 dias** · **Ações hoje** · **Em andamento**.
- Lista "Hoje": pedidos com ação marcada pra hoje ou atrasada.
- Lista "Próximos 7 dias" por data.
- Gráfico simples: pedidos abertos por fornecedor (top 10) e por Time.

### 4.2 Pedidos (a tabela)
- Colunas padrão: Status · Fornecedor · Tipo · PO · Data limite · Qtd · Próxima ação · Data da ação · Observação · Update.
- Colunas opcionais (liga/desliga): Time · Valor · Armazém · Campanha · Envio · Lead time · Finalização.
- Busca livre (fornecedor, PO, texto da observação).
- Filtros: status, fornecedor, tipo, time, transportadora, faixa de data.
- Ordenar por qualquer coluna. Padrão: data limite crescente.
- Edição na própria linha (observação, ação, data, finalizar).
- Cor da linha: vermelho = atrasado, amarelo = vence em ≤ 2 dias, cinza = finalizado.
- Chip colorido do fornecedor com a regra logística visível ao passar o mouse ("Dumar · entrega seg · NF até qua").
- Botões: Importar relatório · Novo pedido manual · Exportar CSV.
- **Saldo / segunda remessa:** em vez de outra aba, cada pedido tem "Qtd entregue" e "Saldo". Quando ela registra entrega parcial, o saldo fica em aberto na mesma linha, marcado com a tag "Saldo". Filtro "só saldos" reproduz a página 2. `[confirmar]`

### 4.3 Configurações
- **Avisos:** e-mail de destino, hora do envio, antecedência (2 dias por padrão), dias da semana, ligar/desligar.
- **Fornecedores:** nome, nomes alternativos, cor, transportadora, dia de entrega, prazo de NF, precisa coleta (sim/não), observação fixa. Importar a lista da página 3 e 4 de uma vez.
- **Transportadoras:** nome, e-mail, dia de entrega, regra.
- **Tags de Tipo:** código do relatório → nome exibido + cor.
- **Ações rápidas:** a lista curta de "Próxima ação" (Agendar, Agendado, Previsão, Enviar ativo, Enviar preventivo, Ag. NF, Ag. retorno...). Ela edita.
- **Status:** nomes e cores (Atrasado / Em andamento / Finalizado). Regra é fixa, nome e cor não.
- **Chave de acesso** (ver 8).
- **Mapeamento do relatório:** se o sistema mudar o nome de uma coluna, ela ajusta aqui sem chamar ninguém.

Tudo que ela configura fica na planilha (aba `config`), não no código. Ninguém precisa mexer no código pra ela mudar cor, nome ou tag.

---

## 5. Regras de negócio

**Status (calculado, nunca digitado):**
- `Finalizado` se tem data de finalização.
- `Atrasado` se data limite < hoje e não finalizado.
- `Em andamento` caso contrário.
- `[confirmar]` se "vence hoje" conta como em andamento (hoje eu assumo que sim; na planilha, 17/09 estava vermelho num print de 17/09 e amarelo em outro, então ela pode marcar à mão no fim do dia).

**Importação:**
- Reconhece as colunas pelo nome do cabeçalho (não pela posição). Aceita `;` ou `,`.
- PO já existe → não mexe em nada que ela escreveu; só atualiza data limite/quantidade se mudaram, e avisa.
- PO novo → cria com status calculado.
- PO que sumiu do relatório → não faz nada (relatório é só do dia da emissão).
- Fornecedor desconhecido → cria no cadastro, sem cor, pra ela completar depois.
- Data limite recalculada (Envio + Lead WMS úteis); se diferir do relatório, mostra aviso, mas usa a do relatório.

**Formatação:** datas `dd/mm/aaaa`, valores `R$ 1.234,56`, sempre. Nunca formato americano.

---

## 6. Avisos (e-mail diário)

Apps Script com gatilho de horário (roda no Google, com o app fechado). Todo dia útil na hora configurada:

```
Assunto: Pedidos · qui 18/09 · 3 atrasados · 5 vencem até sáb · 2 ações hoje

ATRASADOS (3)
  PO 202652 · BUDDEMEYER · limite 17/09 · Enviar Ativo
  ...
VENCEM EM ATÉ 2 DIAS (5)
  ...
AÇÕES DE HOJE (2)
  PO 201279 · MAISOFA · Agendar 23/09
  ...
Abrir o app: <link>
```

Sem nada pra avisar → não manda e-mail (ou manda "tudo em dia", ela escolhe).
WhatsApp fica fora da v1 (exige API paga).

---

## 7. Dados (planilha Google, privada)

Uma planilha, 6 abas. Ela pode abrir e ler, mas não precisa editar lá.

| Aba | O que guarda |
|---|---|
| `pedidos` | uma linha por PO, todas as colunas (do relatório + dela) |
| `fornecedores` | cadastro com regra logística e cor |
| `transportadoras` | nome, e-mail, dia, regra |
| `tags` | código → nome, cor, tipo (Tipo / Time / Ação / Status) |
| `config` | e-mail, hora, antecedência, chave, mapeamento de colunas |
| `log` | quem importou o quê e quando; mudanças de status (auditoria simples) |

Backup: histórico de versões do Google Sheets (nativo) + botão "Exportar tudo (CSV)" no app.

---

## 8. Segurança

1. Planilha privada na conta Google dela (ou do Victor). Nunca "publicar na web".
2. Apps Script como "web app": só responde se receber a **chave de acesso**. Ela cola a chave uma vez em Configurações; fica só no navegador dela. Sem chave = tela vazia.
3. Repositório público **sem** dado, sem chave, sem link da planilha. Os CSVs reais não entram no repositório.
4. HTTPS ponta a ponta (GitHub Pages + Google).
5. **LGPD:** a lista de fornecedores tem pessoas físicas com CPF no nome (ex.: "FERNANDA MASSONI COSTA 372315…"). O app guarda o nome como veio, mas não expõe em lugar público. Recomendo que ela confirme com a empresa se pode usar ferramenta externa pra esse dado. `[confirmar]`

---

## 9. Tecnologia

- **Front:** `index.html` + `app.js` + `style.css` + `core.js` (HTML + CSS + JS puro, sem framework, sem build). Roda em qualquer navegador. O `core.js` (regras: datas úteis, status, importação, texto do e-mail) é o mesmo arquivo usado no Apps Script, então tela e e-mail nunca discordam.
- **Hospedagem:** GitHub Pages deste repositório. Atualização = commit.
- **Dados:** Google Sheets via Apps Script (web app). Cache local no navegador pra abrir rápido e funcionar sem internet por alguns minutos.
- **Avisos:** Apps Script, gatilho diário.
- **Testes:** `tests/` (regras puras, Apps Script com planilha simulada, tela real em Chrome headless).
- Custo: zero.

---

## 10. Perguntas pra Julia (respondidas em 18/09/2026, por áudio)

| # | Pergunta | Resposta da Julia | O que mudou no app |
|---|---|---|---|
| 1 | Segunda remessa = saldo de entrega parcial? Aba separada? | Sim: entrega parcial, item similar, ou "qualquer BO" que impeça entregar tudo junto. **Prefere separado, como na planilha.** | Seletor "1ª remessa / 2ª remessa / Todas" dentro da aba Pedidos (mantém as 3 abas). Vai pra 2ª sozinho ao registrar entrega parcial, ou pelo botão "→ 2ª". |
| 2 | "Vence hoje" é atrasado? | **Não, em andamento.** | Já era assim. Confirmado. |
| 3 | Relatório sempre no mesmo formato? | **Sim, sempre.** Ela usa só as colunas C F H I K O (Tipo PO, PO, Fornecedor, Time, Qtd Peças, Delivery Time). | Time vira coluna padrão. Detecção de coluna nova fica como segurança. |
| 4 | Lead Time BOB e Forma Pagamento? | **Não usa nenhum dos dois.** | Saem da lista de colunas (ficam guardados, invisíveis). |
| 5 | Página 3? | Só uma página com fornecedores pra saber **de qual grupo cada um é**. | Campo "Grupo / transportadora" no cadastro de fornecedor. |
| 6 | Quem usa? | **Só ela.** | Uma chave, sem multiusuário. |
| 7 | E-mail? | Enviou (corporativo). **Não vai pro repositório**: ela cola em Configurações, fica na planilha privada. | — |

Ainda em aberto (não travam nada): feriado conta como dia útil no lead time? Ativo/Preventivo (só pra nomear ação). Importar histórico a partir de alguma data?

Perguntas originais, pra registro:

1. **Página 2 (segunda remessa) é o saldo de pedidos entregues parcialmente?** Se sim, pode virar campo "saldo" na mesma linha, ou ela prefere aba separada?
2. "Vence hoje" é atrasado ou em andamento?
3. A observação pode virar "ação + data"? Ela topa preencher a data da ação (é o que dispara o aviso)?
4. O relatório sempre sai com essas 16 colunas e nesse formato (`;` e aspas)? Ela exporta em CSV ou Excel?
5. O relatório traz só os pedidos emitidos no dia, ou todos os abertos?
6. O que são `Lead Time BOB` e `Forma Pagamento` (105, 30/60/90)? Ela usa?
7. O que é "Ativo" e "Preventivo" ("Enviar Ativo", "Preventivo enviado")? Só pra eu nomear direito na lista de ações.
8. Dá pra confirmar a regra: data limite = envio + lead time em dias úteis? Feriado conta?
9. Página 3: a regra é por fornecedor (cada fornecedor tem uma transportadora fixa) ou muda por pedido?
10. Quem mais usa a planilha? Só ela? (Define se precisa de mais de uma chave.)
11. E-mail pra receber o aviso e horário.
12. A empresa permite ferramenta externa (Google Sheets pessoal) com dado de fornecedor e valor de PO?

---

## 11. Fora da v1 (anotado, não construído)

- WhatsApp como canal de aviso.
- Múltiplos usuários com permissão diferente.
- Anexar NF / XML ao pedido (a chave de XML solta na página 3 sugere que ela lida com isso).
- Integração direta com o sistema de compras (sem exportar CSV).
- Histórico de alterações por campo (a v1 tem só log de import e status).

---

## 12. Próximos passos

1. Victor valida este documento e ajusta.
2. Julia responde as 12 perguntas (pode ser áudio).
3. Construção da v1 (esqueleto já pode começar com as colunas confirmadas).
4. Teste com o relatório real de uma segunda ou quinta.
5. Ela usa uma semana em paralelo com a planilha; ajustes; desliga a planilha.

---

## 13. Decisões do Victor (18/09/2026)

Validação item a item. O que mudou em relação ao rascunho:

**Rotina e edição**
- Frequência dos avisos configurável no app: dias da semana, horário, antecedência, e-mail(s) de destino.
- Envio automático não exige nada externo: o Apps Script roda no Google e envia pelo Gmail da própria conta, com gatilho de horário. Limite de 100 e-mails/dia na conta gratuita, ela usa 1.
- Edição salva sozinha (sem botão salvar) e grava na planilha na hora. Indicador "salvo / pendente" na tela. Sem internet, guarda na fila e reenvia. **Nunca pode haver divergência entre app e planilha**: a planilha é a fonte da verdade, o navegador é cache.
- Processo de edição o mais curto possível: finalizar = 1 clique na linha. Sem confirmação, com "reabrir" se errar.

**Dash**
- 4 números grandes + percentuais macro (ex.: % atrasados sobre abertos, % finalizados no período).
- Lista "Hoje" vira bloco lateral discreto, estilo lista de tarefas (marcar como feito).
- Gráficos com seletor de métrica (pedidos / peças / valor) e de recorte (abertos / atrasados / todos).
- **Filtro de período global**: escolhido uma vez, vale em todas as abas e não reseta ao trocar de aba (fica salvo no navegador).

**Tabela**
- Se o sistema de compras mudar nome ou quantidade de colunas do relatório, a importação detecta a coluna desconhecida e **oferece adicionar como coluna nova** (ela aceita ou ignora). Sem chamar ninguém.
- Ligar/desligar coluna: chips na própria aba, um clique.
- Filtros com visual neutro (cinza). Cor só nas tags dentro da célula, pra não virar confete.
- Saldo na mesma linha (Qtd entregue / Saldo): aprovado pra testar.
- Página 2 da planilha tem dado bugado; usar só o que é legível como base.

**Regras**
- "Vence hoje" = em andamento, destacado em amarelo. Julia confirma depois.
- LGPD: sistema de uso exclusivo da Julia, planilha privada. Sem bloqueio.

**Nomenclatura (Victor, 18/09):** usar o que já existe. Tags aparecem com o código do relatório (now_crossdocking, STORE, Decor…); ela renomeia se quiser.

**Próximos passos**
- v1 construída e no ar em 18/09 (ver README). Falta: Julia instalar a planilha (docs/02-instalacao.md) e testar com relatório real.
- Teste com relatório real: Julia ou o próprio Victor.
- Perguntar à Julia se precisa importar histórico a partir de alguma data (a planilha atual tem 505 linhas na página 1).
