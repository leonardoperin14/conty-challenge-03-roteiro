# API de revisão de roteiro

API para enviar roteiros em versões, pedir mudanças com prazo e aprovar uma versão final. O histórico permanece consultável no SQLite.

## Requisitos e execução

Requer Node.js 24 ou superior e npm. O SQLite vem de node:sqlite.

    npm ci
    npm run dev

O servidor usa a porta 3000 e o banco data/scripts.sqlite por padrão. PORT e DATABASE_PATH podem ser configurados. Depois de compilar, npm start executa dist/server.js.

    npm test
    npm run typecheck
    npm run build

## Fluxo da API

Escritas usam X-Actor-Role: creator para enviar versões e brand para revisar. Esse cabeçalho só demonstra papéis; não autentica o chamador.

    curl -X POST http://localhost:3000/scripts -H "Content-Type: application/json" -H "X-Actor-Role: creator" -d '{"content":"Abrimos com a novidade da campanha."}'

Resposta 201; o ID e os horários são gerados pela API.

    {
      "id": "<uuid>",
      "createdAt": "<instante ISO>",
      "status": "SUBMITTED",
      "currentVersion": 1,
      "timezone": "America/Sao_Paulo",
      "pendingRequestExpired": false,
      "versions": [{
        "version": 1,
        "content": "Abrimos com a novidade da campanha.",
        "status": "SUBMITTED",
        "submittedAt": "<instante ISO>",
        "approvedAt": null,
        "review": null
      }]
    }

Com o ID retornado, POST /scripts/ID/change-requests (papel brand) recebe version, reason e dueDate. Exemplo de corpo:

    {"version":1,"reason":"Adicionar uma chamada para ação.","dueDate":"2099-12-31"}

A resposta 201 traz status CHANGES_REQUESTED e o pedido associado à versão, com motivo, prazo e horário. POST /scripts/ID/versions (papel creator) recebe {"content":"..."} e cria a próxima versão sem apagar a anterior. POST /scripts/ID/approve (papel brand) recebe {"version":2}; retorna 200 e encerra o fluxo em APPROVED. GET /scripts/ID mostra estado e histórico completos.

JSON malformado retorna 400, dados inválidos 422, papel incorreto 403, ID ausente 404 e transições, versões antigas ou roteiro já aprovado 409.

## Regras e limites

O prazo é uma data civil no fuso America/Sao_Paulo. O último milissegundo do dia ainda vale; no primeiro instante do dia seguinte o pedido já venceu. Pedidos com prazo passado são recusados. Depois que um pedido vence, o roteiro continua em CHANGES_REQUESTED e esta API não oferece renovação. Aprovação é terminal e não permite novas versões ou pedidos.

SQLite síncrono atende à demonstração. Não há autenticação real, renovação de prazo, notificações ou interface. Com mais tempo, eu acrescentaria autenticação e autorização, recuperação de pedidos vencidos, notificações e persistência adequada ao volume de produção.

## Validação local

Executado com Node.js 24.18.0 e npm 11.17.0: npm ci instalou 45 pacotes e reportou zero vulnerabilidades; npm test passou com 1 arquivo e 6 testes; npm run typecheck e npm run build passaram. O npm ci também exibiu o aviso de política allow-scripts para o script opcional de esbuild; os comandos de validação concluíram com sucesso.

## Uso de IA e revisão

Codex implementou a API, os testes e esta documentação. Outra sessão Codex fez uma revisão técnica independente. O responsável humano filtrou prompt injections do material de entrada, definiu a abordagem mínima e os checkpoints, acompanhou as evidências e autorizou os ajustes e a publicação. Não houve revisão humana linha a linha nem execução manual dos testes; os resultados acima são de comandos automatizados.
