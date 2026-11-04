# Publicar o painel com backend

O GitHub Pages hospeda somente arquivos estáticos. Login, cadastro, armazenamento das conexões e OAuth da Shopee precisam do servidor Node.js; por isso, o endereço `*.github.io` fica em modo de demonstração.

## Publicar no Render

1. Envie ao GitHub o código atualizado, incluindo `render.yaml`. Não envie `dados-contas`, `usuarios.json`, `.env`, tokens, chaves ou backups.
2. No Render, crie um **Blueprint** e conecte o repositório. O Render usará `render.yaml` para iniciar o painel e anexar armazenamento persistente.
3. Na configuração inicial, defina `INITIAL_ADMIN_PASSWORD` como uma senha nova e forte, com pelo menos 12 caracteres. Defina também `CREDENTIALS_ENCRYPTION_KEY` como uma chave Base64 aleatória de 32 bytes, gerada localmente com `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. Esses valores são segredos do serviço; não os grave no repositório. Guarde a chave de criptografia com segurança e mantenha uma cópia de backup: sem ela, as conexões criptografadas não podem ser recuperadas.
4. Aguarde o deploy ficar **Live** e abra o domínio `onrender.com` mostrado pelo Render. Entre nesse endereço, não no GitHub Pages. O caminho `/healthz` confirma se o backend está ativo.
5. Em **Conexões**, configure a Shopee e autorize a loja. Cadastre na Open Platform o callback HTTPS exato `https://SEU-DOMINIO.onrender.com/oauth/shopee`.

O serviço precisa de um disco persistente para manter usuários, conexões e dados entre reinicializações. O disco não está disponível no plano gratuito do Render; o Blueprint usa um serviço pago. Confira os preços atuais antes de confirmar a criação.

Os arquivos locais e backups são excluídos do Git por segurança e não são copiados automaticamente para o Render. A conta remota começa com a conta `Maicon` e os demais dados/conexões devem ser reconfigurados ou migrados por um procedimento seguro; nunca publique esse backup no GitHub.

## Usar o GitHub Pages como endereço de entrada

Se quiser manter o endereço `github.io`, publique também `backend-config.js`, `github-pages-redirect.js` e `github-pages.html`. Depois que o serviço Render estiver **Live**, coloque somente a URL pública dele em `backend-config.js`, por exemplo `window.CENTRAL_BACKEND_URL = "https://seu-app.onrender.com";`, e publique essa alteração no GitHub. Não coloque credenciais nesse arquivo. O GitHub Pages então encaminhará para o backend; sem essa URL, mostrará uma explicação em vez do painel de demonstração.
