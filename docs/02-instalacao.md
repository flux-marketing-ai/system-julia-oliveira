# Instalação · passo a passo

Leva uns 15 minutos, uma vez só. Precisa de uma conta Google (a que vai receber os e-mails).
Nada aqui exige programar: é copiar, colar e clicar.

O sistema tem duas partes:
- **O app** (o link que abre no navegador). Já está no ar: https://flux-marketing-ai.github.io/system-julia-oliveira/
- **A planilha** (onde os dados ficam guardados, na sua conta Google). É o que vamos criar agora.

---

## Parte 1 · Criar a planilha

1. Entre em https://sheets.new com a sua conta Google. Abre uma planilha em branco.
2. Dê um nome pra ela (canto superior esquerdo). Ex.: `Pedidos - dados`.
3. **Não compartilhe** essa planilha com ninguém e não use "Publicar na web". Ela é só sua.

## Parte 2 · Colar o script

4. No menu da planilha: **Extensões → Apps Script**. Abre uma aba nova com um editor.
5. Na esquerda, tem um arquivo chamado `Código.gs`. Apague tudo que está nele e cole o conteúdo do arquivo
   [`apps-script/Code.gs`](../apps-script/Code.gs) (abra o link, clique em "Raw", selecione tudo, copie).
6. Ainda na esquerda, clique no **+** ao lado de "Arquivos" → **Script**. Dê o nome `core` (vira `core.gs`).
   Apague o que vier dentro e cole o conteúdo de [`core.js`](../core.js) (mesmo processo: Raw, selecionar tudo, copiar).
7. Clique no ícone de **salvar** (disquete) ou Ctrl+S.
8. Configurar o fuso horário: clique na **engrenagem** (Configurações do projeto) na esquerda →
   marque "Mostrar o arquivo de manifesto appsscript.json" → volte no Editor, abra `appsscript.json`
   e confira que tem `"timeZone": "America/Sao_Paulo"`. Se estiver outro, troque. Salve.

## Parte 3 · Rodar a instalação (uma vez)

9. No topo do editor, ao lado de "Depurar", tem uma lista de funções. Escolha **`setup`** e clique em **Executar**.
10. O Google vai pedir autorização. Clique em **Revisar permissões** → escolha sua conta → vai aparecer
    "O Google não verificou este app" → clique em **Avançado** → **Acessar ... (não seguro)** → **Permitir**.
    Isso é normal: o script é seu, dentro da sua conta. Ele pede permissão pra ler a planilha e enviar e-mail pelo seu Gmail.
11. Ao terminar, volte na planilha. Vão existir abas novas: `pedidos`, `fornecedores`, `transportadoras`, `tags`, `config`, `log`.
    Na aba **`config`**, na linha `chaveAcesso`, está a sua **chave**. Copie ela (vai usar no passo 15).

## Parte 4 · Publicar o script como "app da web"

12. De volta no editor do Apps Script: botão azul **Implantar → Nova implantação**.
13. Clique na engrenagem ao lado de "Selecionar tipo" → **App da Web**. Preencha:
    - Descrição: `pedidos`
    - Executar como: **Eu**
    - Quem pode acessar: **Qualquer pessoa**
      (é assim que o app consegue falar com a planilha; ninguém entra sem a chave do passo 11)
14. **Implantar**. Copie o **URL do app da Web** (termina em `/exec`).

## Parte 5 · Ligar o app na planilha

15. Abra o app: https://flux-marketing-ai.github.io/system-julia-oliveira/ → aba **Configurações** → **Conexão com a planilha**.
    - Link do Apps Script: cole o URL do passo 14.
    - Chave de acesso: cole a chave do passo 11.
    - Link deste app: `https://flux-marketing-ai.github.io/system-julia-oliveira/`
16. **Testar e sincronizar**. Deve aparecer "Conectado e sincronizado" e, no canto superior direito, **Salvo** em verde.
17. Salve o link do app nos favoritos (e na tela inicial do celular, se quiser).

**Pra outra pessoa (ou outro aparelho) entrar sem digitar nada:** em Configurações → Conexão → **Gerar e copiar link de acesso**. Mande esse link por canal privado (WhatsApp direto, nunca grupo). Quem abre já entra conectado, e a chave some da barra de endereço na hora. Quem tem o link entra no sistema: não repasse.

## Como funciona o acesso (não tem login)

- Não existe usuário e senha. O que dá acesso é a **chave** (passo 11) junto com o link do Apps Script (passo 14). Os dois ficam guardados só no navegador de quem colou (ou abriu o link de acesso).
- O app sem chave abre vazio e mostra "Sem planilha" no canto. Ninguém lê nem grava nada na planilha sem a chave: o script confere em toda leitura e gravação.
- Não precisa ter conta Google nem acesso à planilha pra usar o app. A planilha é só o cofre dos dados.
- Cada aparelho (PC, celular) precisa da chave uma vez: cole em Configurações ou abra o link de acesso nele.
- Janela anônima não guarda a chave: fecha, perde.
- **Pra cortar o acesso de alguém** (ou se o link vazou): no editor do Apps Script → Configurações do projeto → Propriedades do script → mude o valor de `CHAVE`. A chave antiga para de funcionar em todo lugar na hora; quem deve continuar usando recebe a nova (cole em Configurações ou gere um link de acesso novo).

## Parte 6 · Avisos por e-mail

18. Ainda em Configurações → **Avisos por e-mail**: coloque seu e-mail, o horário, os dias da semana e a antecedência.
19. Clique em **Enviar e-mail de teste agora**. Se chegar, está pronto. A partir daí o e-mail sai sozinho todo dia, no horário, mesmo com o app fechado e o computador desligado (roda no Google).

---

## Uso no dia a dia

- **Segunda e quinta:** exporte o relatório do sistema em CSV → aba Pedidos → **Importar relatório** → arraste o arquivo → Confirmar.
  Pedido que já existe não é duplicado, e o que você escreveu (observação, ação, datas) nunca é apagado pela importação.
- **Todo dia:** o e-mail chega; a aba Dash mostra o mesmo em tela, com a lista "Hoje" pra ir marcando.
- **Editar:** clique direto na célula (observação, próxima ação, data da ação, entregue). Salva sozinho. "Salvo" em verde no canto = gravou na planilha.
- **Várias linhas de uma vez:** marque as caixinhas à esquerda (a do cabeçalho marca todas as visíveis; Shift + clique marca uma faixa). Aparece uma barra escura com: Finalizar, Reabrir, mover de remessa, aplicar próxima ação + data, exportar em Excel, excluir.
- **Finalizar:** botão ✓ na linha. Some da lista padrão (filtro "Abertos"), fica no histórico (filtro "Finalizados"). Errou? "Reabrir".
- **Período:** o botão de calendário no topo vale pra todas as abas. Atalhos (hoje, ontem, últimos 7/14/60/90 dias, este mês, mês passado, próximos 7/14/30 dias) ou uma faixa no calendário (clique no início e no fim). "Aplicar em" escolhe se o período olha a data limite ou o envio do PO.
- **Exportar:** botão "Exportar" → Excel (.xlsx, abre direto, datas e valores já formatados) ou CSV. Sai só o que está filtrado na tela; em Configurações → Dados sai tudo.
- **Segunda remessa:** o seletor "1ª remessa | 2ª remessa | Todas" no topo da tabela. Um pedido vai pra 2ª remessa de dois jeitos: você digita a quantidade "Entregue" (ligue a coluna no botão Colunas) e o saldo fica em aberto na 2ª, com a tag "Saldo"; ou clica "→ 2ª" na linha (item similar, BO, etc.). "← 1ª" desfaz.
- **Fornecedor novo no relatório:** entra sozinho em Configurações → Fornecedores, sem cor. Complete transportadora, dia de entrega e prazo de NF quando quiser. Isso aparece ao passar o mouse no nome dele na tabela.
- **Tag nova no relatório:** entra sozinha em Configurações → Tags de tipo, com o código. Dê nome e cor.
- **O relatório mudou de formato:** na importação o app avisa "coluna nova" e pergunta se adiciona ou ignora. Se uma coluna importante sumiu ou mudou de nome, ele pede pra você apontar qual é. Fica salvo.

## Se algo der errado

| Sintoma | O que fazer |
|---|---|
| Canto direito mostra **Sem planilha** | Configurações → Conexão: falta link ou chave. |
| **Erro ao gravar** (vermelho) | O app guarda a alteração e tenta de novo sozinho a cada 30 s. Se persistir, aparece uma faixa no topo dizendo o motivo: sem internet (amarela), chave recusada, ou o Google não respondeu (vermelha). Nesse último caso: **aguarde alguns minutos e tente novamente; se continuar, fale com um dev.** |
| **N pendentes** (amarelo) por mais de 2 minutos | Aparece uma faixa no topo com o número de alterações guardadas só no navegador. **Não feche o navegador limpando os dados** até virar "Salvo" em verde. Botões na faixa: "Tentar agora" e "Baixar cópia (CSV)" pra ter um backup do que está na tela. Se fechar a aba com pendência, o navegador avisa antes. |
| **Erro ao ler** | Mostra a última cópia guardada. Mesmos motivos acima. |
| Mudei o script e parou | Depois de editar o código, precisa **Implantar → Gerenciar implantações → editar (lápis) → Versão: Nova → Implantar**. O link continua o mesmo. |
| E-mail não chega | 1) Olhe a pasta de **spam** e marque "Não é spam"; adicione o remetente aos contatos ("remetente confiável"). 2) Configurações → Avisos: está ligado? dia da semana marcado? 3) "Enviar e-mail de teste". 4) Aba `log` na planilha mostra cada envio. |
| Quero começar do zero no navegador | Configurações → Dados → Limpar cache. Os dados continuam na planilha. |

## Quem envia o e-mail

O e-mail sai da conta Google que publicou o script (quem fez a Parte 4). Ele chega com o nome "Sistema de Pedidos" e, ao responder, vai pro e-mail de destino configurado.
Pra sair de outra conta, essa conta precisa abrir o Apps Script da planilha, fazer a própria implantação (Parte 4) e rodar `instalarGatilho` uma vez; e a conta antiga precisa apagar o gatilho dela (relógio na esquerda do editor), senão o e-mail chega em dobro.

## Segurança, em uma linha

O código é público (GitHub), os dados não: ficam na sua planilha privada. Quem não tem a chave não lê nem grava nada.
A chave fica só no seu navegador. Pra trocar (e derrubar quem tinha a antiga): editor do Apps Script → Configurações do projeto → Propriedades do script → `CHAVE`.
