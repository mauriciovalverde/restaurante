# Instagram Messenger

Aplicação web para enviar mensagens diretas (DM) do Instagram para os contatos que você
escolher: **um a um** (botão "Enviar" em cada contato) ou **em massa** (marque vários ou use
"Selecionar todos").

Usa a **API oficial de mensagens do Instagram (Meta)**, então funciona sem risco de bloqueio
da conta, desde que respeite as regras abaixo.

## Funcionalidades

- Lista as conversas da sua conta do Instagram (contatos que já falaram com você).
- Seleção individual por clique, "Selecionar todos" e busca por nome/@usuário.
- Envio individual ou em massa, com barra de progresso e botão para parar.
- Personalização com `{nome}` e `{usuario}` na mensagem.
- Intervalo configurável entre envios (`SEND_DELAY_MS`) para respeitar os limites da API.
- Indica quem está dentro da janela de 24h e quanto tempo falta para ela fechar.
- Histórico de envios com sucesso/erro por contato.
- **Modo demonstração** com contatos fictícios para testar sem token.

## Regras importantes da Meta

- A conta precisa ser **Profissional (Empresa ou Criador de conteúdo)**.
- Só é possível enviar mensagens para **quem conversou com você** — não dá para mandar DM para
  qualquer seguidor ou desconhecido.
- A resposta precisa ser enviada **até 24h depois da última mensagem do contato**. Fora dessa
  janela o contato aparece desabilitado.
- Envios promocionais em massa e repetitivos podem violar as políticas da Meta. Use para
  comunicação relevante com clientes que entraram em contato.

## Como rodar

```bash
cd instagram-messenger
npm install
cp .env.example .env   # e preencha INSTAGRAM_ACCESS_TOKEN
npm start              # http://localhost:3000
```

Para testar a interface sem conta conectada:

```bash
npm run demo
```

(Se `INSTAGRAM_ACCESS_TOKEN` estiver vazio, o modo demonstração também é ativado automaticamente.)

## Como obter o token de acesso

1. Converta seu Instagram para conta **Profissional** (Configurações → Tipo de conta).
2. Acesse <https://developers.facebook.com/apps>, crie um app do tipo **Empresa**.
3. Adicione o produto **Instagram** → "API setup with Instagram login".
4. Em "Generate access tokens", adicione sua conta do Instagram e gere o token com as permissões
   `instagram_business_basic` e `instagram_business_manage_messages`.
5. Em "Configurações avançadas" do Instagram no celular, ative
   **Permitir acesso às mensagens** (Configurações → Mensagens → Ferramentas conectadas).
6. Cole o token em `INSTAGRAM_ACCESS_TOKEN` no arquivo `.env`.

> Enquanto o app estiver em modo de desenvolvimento, ele funciona com a sua própria conta
> (adicionada como testadora). Para uso público é preciso passar pela revisão de app da Meta.

O token fica apenas no servidor (`.env`) e nunca é enviado ao navegador.

## Estrutura

```
instagram-messenger/
├── server.js          # Servidor Express + integração com a Graph API do Instagram
├── public/
│   ├── index.html     # Interface
│   ├── styles.css
│   └── app.js         # Seleção de contatos e envio individual/em massa
├── .env.example
└── package.json
```

## Endpoints internos

| Método | Rota            | Descrição                                           |
| ------ | --------------- | --------------------------------------------------- |
| GET    | `/api/account`  | Dados da conta conectada                            |
| GET    | `/api/contacts` | Contatos/conversas com status da janela de 24h      |
| POST   | `/api/send`     | Envia `{ recipientId, text }` para um contato       |
