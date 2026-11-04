# Configuração do aplicativo Shopee

## Tipo de aplicativo correto

Este projeto conecta uma loja Shopee existente ao painel usando a Shopee Open API e OAuth. Ele não oferece serviço de transporte nem calcula frete para lojas de terceiros.

Crie/configure um aplicativo padrão de integração/Open API da Shopee. Não selecione o tipo SPI **Seller Logistics**. Os campos **Live Host URL**, **Service Function Path Mapping** e **Logistics Channel** pertencem ao SPI Seller Logistics; não preencha esses campos com a URL do painel ou com rotas internas do aplicativo. Se esses campos aparecem obrigatoriamente, volte e selecione o tipo de aplicativo correto.

## Revisão do aplicativo padrão

| Campo | Valor |
|---|---|
| Live Version URL | `PENDENTE: URL HTTPS pública do painel depois da publicação` |
| Test Username | Crie uma conta de teste separada no painel |
| Test Password | Defina uma senha temporária fora do repositório |
| Brief Introduction | Central de gestão de marketplaces. O usuário entra ou cria uma conta e autoriza a própria loja Shopee pelo fluxo OAuth oficial. O painel consulta dados da loja conectada e permite preparar rascunhos; os rascunhos não são publicados automaticamente. |
| Screenshot | Captura do painel publicado com dados pessoais e tokens ocultos |

O painel e o backend usam o mesmo servidor Node.js. Depois de publicar em uma hospedagem compatível com Node.js e HTTPS:

1. Configure `HOST=0.0.0.0`, a variável `PORT` fornecida pela hospedagem e `PUBLIC_BASE_URL` com a origem pública, sem caminho, por exemplo `https://seu-app.exemplo.com`.
2. Cadastre no aplicativo Shopee o Redirect URI exato `https://seu-app.exemplo.com/oauth/shopee`.
3. Use a URL pública do painel em **Live Version URL**. Não use `localhost`, `127.0.0.1` nem o endereço do GitHub Pages como backend.

O endereço público ainda precisa ser fornecido pela hospedagem; não é possível determinar ou inventar o domínio antes de publicar o servidor.

Há uma configuração inicial de hospedagem no [DEPLOY-RENDER.md](./DEPLOY-RENDER.md). O serviço também atende `/healthz` para verificar se o backend está ativo. No Render, o servidor usa automaticamente o domínio HTTPS atribuído ao serviço.

## Rotas OAuth do aplicativo

| Função | Método e rota |
|---|---|
| Iniciar autorização da loja | `GET /api/oauth/shopee/iniciar` |
| Receber retorno OAuth | `GET /oauth/shopee` |

O usuário inicia a autorização em **Conexões** no painel. O callback OAuth identifica a conta pela informação de estado temporária; não compartilhe tokens ou chaves no formulário, em capturas de tela ou no repositório.

Na conexão Shopee do painel, selecione **Teste (sandbox)** somente quando o Partner ID, a Partner Key e a loja forem credenciais/loja de teste. Para credenciais Live, selecione **Live (produção)**. O Partner ID identifica o aplicativo; não é o Shop ID da loja. O endereço de teste da Open API é diferente do endereço Live.

No servidor, Partner Keys, secrets, API keys e tokens OAuth são armazenados com AES-256-GCM; o painel continua usando os valores normalmente sem recebê-los de volta no navegador. No uso local, a chave é criada em `dados-contas/.credentials-encryption-key`: mantenha esse arquivo junto dos dados e fora do Git. Se ele for perdido, credenciais já criptografadas não podem ser recuperadas. Em hospedagem, configure `CREDENTIALS_ENCRYPTION_KEY` como segredo persistente do serviço.

## Se o objetivo mudar para oferecer frete

O tipo SPI **Seller Logistics** é outro produto: requer uma URL pública de cotação, uma implementação de preço e prazo reais e suporte ao fluxo de atualização de rastreamento. O projeto atual não implementa esse serviço. Não use as rotas OAuth ou `/api/shopee/envios` como cotação de frete.
