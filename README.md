# Lúmen Player (`rkd-player-module`)

## ✨ Sobre o projeto

**Lúmen Player** é um player de YouTube para desktop (Electron) e navegador, com interface em português (Brasil) e identidade visual **Lúmen**. O pacote npm chama-se `rkd-player-module` (versão 1.1.0).

O fluxo principal é Cinema: você salva canais na biblioteca modal, escolhe um canal para preencher o carrossel horizontal com vídeos públicos (sem autoplay) e inicia a reprodução ao clicar em uma miniatura. Há três temas escuros (Cyberpunk, Radar e Estação Espacial), visualizadores de áudio reativos, histórico local dos últimos 100 vídeos assistidos e armazenamento em JSON no disco — sem banco de dados externo e sem chave da YouTube Data API.

Licença do código: **MIT** (arquivo `LICENSE`). Os nomes e coordenadas de cidades do tema Radar usam GeoNames (CC BY 4.0); detalhes em [`RADAR-DATA-NOTICES.md`](RADAR-DATA-NOTICES.md).

## 🛠 Tecnologias utilizadas

| Tecnologia | Uso no projeto |
| --- | --- |
| **JavaScript (CommonJS e módulos de UI)** | Lógica do app, IPC, servidores locais e interface |
| **HTML e CSS** | Layout Cinema, diálogos, temas e estilos |
| **Node.js ≥ 22.12.0** | Runtime exigido em `package.json` (`engines.node`) |
| **Electron 44.3.0** | Janela desktop, IPC restrito, opacidade nativa e captura de áudio da própria janela |
| **Playwright 1.63.0** | Dependência de desenvolvimento para testes Electron/navegador |
| **Node.js test runner** (`node --test`) | Suite unitária em `tests/*.test.cjs` |
| **YouTube IFrame Player API** | Reprodução embutida (`player.js` / `space-player.js`) |
| **Web Audio API + Canvas 2D** | Análise de áudio e desenho dos visualizadores |
| **HTTP nativo do Node** | Servidores locais do Electron (`server.cjs`) e versão web (`web-server.cjs`) |
| **JSON em disco** | Persistência de biblioteca, histórico e preferências (`data/library.json`) |
| **OpenSky Network API** | Posições de aeronaves no tema Radar (acesso anônimo; sem chave no código) |
| **Natural Earth / GeoNames** | Mapa-base (`radar-map.json`) e cidades (`radar-cities.json`) |
| **Docker (`Dockerfile.web`)** | Imagem Node Alpine só da versão web (`node:22-alpine`) |

Não há framework de UI (React, Vue etc.), bundler de frontend nem instalador/empacotamento definidos no repositório — a execução é a partir do código-fonte com `npm`.

## 🚀 Funcionalidades mapeadas

Status: **COMPLETA** = implementada, coberta por testes adequados e esses testes passaram nesta verificação. **PARCIAL** = implementada pela metade, sem testes suficientes, ou com testes falhando / impossíveis de concluir neste ambiente.

| Funcionalidade | O que faz | Status |
| --- | --- | --- |
| Biblioteca de canais | Salva links de canal (`@handle`, `/channel/`, `/c/`, `/user/`), resolve ID canônico, busca, remove, exibe avatar/banner/inscritos e limita a 2.000 canais | COMPLETA |
| Migração de biblioteca legada | Converte registros antigos de vídeo em canais únicos; mantém falhas em `legacyVideos` e oferece “Tentar converter novamente” | COMPLETA |
| Recomendações e carrossel | Busca vídeos públicos do canal (feed/página), cache ~5 min / até 360 candidatos, sorteia até 16 miniaturas, sem autoplay ao só selecionar o canal | COMPLETA |
| Reprodução YouTube (Cinema) | Player embutido isolado (origem loopback separada), controles nativos do YouTube, seleção pelo carrossel | COMPLETA |
| Histórico de reprodução | Guarda até 100 vídeos assistidos (miniatura, título, data); clique/teclado reproduz e recarrega o carrossel do canal | COMPLETA |
| Curtidas locais | Botão de curtir no player marca entradas no histórico; não envia like à conta do YouTube | COMPLETA |
| Visualizador de áudio | Seis estilos (Barras, Ondas, Aurora, DNA, Constelação, Matriz LED) na barra de título, com captura do áudio da própria janela/aba | COMPLETA |
| Fundo Cyberpunk | Slideshow de capas do histórico / capa do vídeo em reprodução nos modais do tema Cyberpunk | COMPLETA |
| Versão web (HTTP + API) | Servidor `web-server.cjs`, ponte `web-bridge.js`, `/health`, persistência server-side e integração no navegador | COMPLETA |
| Persistência JSON | Lê/grava `library.json` com escrita atômica e backup se o arquivo estiver ilegível; pastas `data/`, `test-results/`, `work/` ignoradas pelo Git | COMPLETA |
| Nomes de cidades no Radar | Rótulos locais a partir de `radar-cities.json` (GeoNames), sem sobreposição no canvas | COMPLETA |
| Temas da interface | Três temas (Cyberpunk, Radar, Estação Espacial) com presets de cor do vídeo, visualizador e transparência | PARCIAL |
| Cor sobre o vídeo | Overlay com ~16% de opacidade (amarelo, azul, vermelho, rosa ou nenhum) | PARCIAL |
| Transparência da janela | Slider 0%–65% via opacidade nativa do Electron (oculto na web) | PARCIAL |
| Continuar ao minimizar | Preferência desktop para manter ou pausar ao minimizar a janela | PARCIAL |
| Fundo Radar (OpenSky ao vivo) | Mapa com aeronaves reais (~60 s), região padrão SP/RJ ou centrada na localização; canvas compartilhado com modais | PARCIAL |
| Localização do dispositivo (Radar) | No desktop Windows usa PowerShell; na web usa `geolocation` do navegador; coordenadas só em memória | PARCIAL |
| Fundo Estação Espacial (ISS) | Livestream da ISS (Sen) mutada atrás da UI; move-se para modais sem reiniciar | PARCIAL |

**Cobertura de testes (mapeamento resumido)**

| Área | Testes que cobrem |
| --- | --- |
| URLs, settings, store, canais | `npm test` → `tests/core.test.cjs` |
| Histórico e curtidas | `tests/history.test.cjs`; Electron: `test:history`, `test:history-playback` |
| Migração legado | `tests/migration.test.cjs`; também exercitada em `test:recommendations` |
| Recomendações / catálogo | `tests/recommendations.test.cjs`, `tests/recommendation-catalog.test.cjs`; Electron: `test:recommendations`, `test:channels` |
| Radar (lógica) | `tests/radar.test.cjs`, `tests/location.test.cjs` |
| Fundo Cyberpunk | `tests/cyberpunk-background.test.cjs`; `test:cyberpunk-background` |
| Cidades no mapa Radar | `test:radar-cities` |
| Servidor web | `tests/web-server.test.cjs`; `test:web` |
| Visualizador ao vivo | `test:visualizer` |
| OpenSky ao vivo / localização Windows / minimizar | `test:radar`, `test:radar-location`, `test:youtube`, trechos de `test:app` — nesta verificação falharam ou não concluíram |

## ▶️ Como executar o projeto

### Requisitos

1. **Node.js 22.12.0 ou mais recente** e **npm** (o `package.json` declara `"engines": { "node": ">=22.12.0" }`).
2. **Acesso à internet** para instalar dependências e carregar YouTube, metadados, miniaturas e (no tema Radar) a API OpenSky.
3. **Desktop (Electron):** sistema onde o Electron 44 rode; os scripts de teste usam Playwright. Em Linux headless, um display virtual (`xvfb-run`) costuma ser necessário para a janela.
4. **Web:** apenas Node.js (não precisa instalar Electron se for só `start:web`).
5. **Docker (opcional):** para a imagem definida em `Dockerfile.web`.

Não há script de empacotamento/instalador no repositório — a execução é a partir do código-fonte.

### Instalação

No diretório do projeto (raiz deste repositório, onde está o `package.json`):

```bash
npm ci
```

`npm ci` instala as versões fixadas em `package-lock.json` (Electron e Playwright como `devDependencies`). Se preferir, `npm install` também funciona, mas `npm ci` é o caminho reproduzível.

### Versão desktop (Electron)

```bash
npm start
```

Isso executa `node scripts/start.cjs`, que sobe o Electron com o app. Servidores locais bindam em `127.0.0.1` em portas livres. Dados padrão em `data/` (sessão Electron em `data/session/`).

Para isolar os dados em outra pasta:

```bash
export LUMEN_DATA_DIR="$PWD/work/demo-data"
npm start
```

No Windows, o launcher define `NODE_USE_SYSTEM_CA=1` quando ainda não estiver definido (confiança no store de certificados do sistema).

### Versão web (navegador)

```bash
npm run start:web
```

Abra `http://localhost:3000` (padrão: host `127.0.0.1`, porta `3000`). A biblioteca fica em `data/library.json` no servidor.

Variáveis úteis (todas opcionais):

| Variável | Padrão | Função |
| --- | --- | --- |
| `PORT` | `3000` | Porta HTTP |
| `LUMEN_HOST` | `127.0.0.1` | Endereço de bind |
| `LUMEN_DATA_DIR` | `<projeto>/data` | Diretório dos dados |
| `LUMEN_ALLOWED_HOSTS` | `localhost,127.0.0.1` | Hosts HTTP aceitos (lista separada por vírgula) |

Exemplo em outra porta:

```bash
PORT=3001 npm run start:web
```

Na web: transparência nativa e “Continuar ao minimizar” ficam desligados/forçados pelo servidor; o visualizador depende de compartilhar a aba com áudio; a geolocalização do Radar pede permissão do navegador em contexto seguro (`localhost` ou HTTPS). A API web não tem login — restrinja a porta a redes/usuários confiáveis.

### Container (só web)

O `Dockerfile.web` copia apenas `src/`, usa `node:22-alpine`, define `PORT=3000`, `LUMEN_HOST=0.0.0.0`, `LUMEN_DATA_DIR=/data` e inicia `node src/web-server.cjs`. Volume sugerido: `/data` (arquivo `library.json`). Endpoint `/health` responde readiness básico.

Exemplo local:

```bash
docker build -f Dockerfile.web -t lumen-web .
docker run --rm -p 8082:3000 -v lumen_player_data:/data lumen-web
```

Depois acesse `http://localhost:8082`. Se o host publicado não for `localhost`/`127.0.0.1`, configure `LUMEN_ALLOWED_HOSTS` incluindo esses nomes se ainda forem necessários.

### Arquivos e pastas relevantes

| Caminho | Papel |
| --- | --- |
| `data/library.json` | Canais, histórico, settings e `legacyVideos` (criado em runtime; não versionado) |
| `LUMEN_DATA_DIR` / `LUMEN_TEST_DIR` | Sobrescrevem dados do app e saída/isolamento de testes |
| `RADAR-DATA-NOTICES.md` | Atribuição GeoNames e regeneração via `scripts/import-radar-cities.cjs` |

Nada além disso precisa ser editado para subir o player; não há arquivo `.env` obrigatório no repositório.

### Testes (referência)

```bash
npm test                          # unitários (node --test)
npm run test:web                  # integração no Edge (Playwright)
npm run test:channels             # Electron — troca de canais
npm run test:recommendations      # Electron — carrossel / playback
npm run test:history              # Electron — histórico
npm run test:history-playback     # Electron — replay pelo histórico
npm run test:visualizer           # Electron — captura de áudio
npm run test:cyberpunk-background # Chromium — fundo Cyberpunk
npm run test:radar-cities         # Chromium — rótulos de cidades
npm run test:app                  # Electron — biblioteca / temas / persistência
npm run test:radar                # Electron — OpenSky ao vivo
npm run test:radar-location       # Electron — localização (foco Windows)
npm run test:youtube              # Electron — playback + minimizar
```

Os testes Electron costumam precisar de display (por exemplo `xvfb-run -a npm run test:channels` em Linux headless) e, em vários casos, de rede real.
