# XkyHold — plano de adaptação a partir do BackMa

Data: 11/11/2026 · Origem analisada: BackMa v1.0.4 (`B-O-S-R/backma`, commit `20560d8`)

> **Ler primeiro.** As secções 1 a 8 são o plano inicial, de 11/11/2026, e ficam como registo. O que mudou desde então está nas secções 9 e 10, que prevalecem. As diferenças principais:
>
> - **Agendamento (5.4 e ponto 2 da secção 4):** a app **nunca inicia uma cópia sozinha**. Avisa quando está em atraso e o utilizador decide.
> - **Alojamento (5.1):** Cloudflare (Worker `xkyhold-site`, só ficheiros estáticos) em `xkyhold.xkyriver.com`, não GitHub Pages.
> - **Chave de recuperação:** incluída na versão 1 (o resumo em 5.3 não a menciona).
> - **Formato (5.3):** vale a especificação em [FORMAT.md](FORMAT.md).
> - **Interface (6):** feita como descrito, com uma diferença: não há pesquisa por nome no restauro.
> - **Questões em aberto (8):** repositório privado; domínio `xkyhold.xkyriver.com`; identidade visual limitada ao verde-água e ao ícone do xkyriver.com; português com "tu". Falta decidir a licença.

## 1. Decisões já tomadas

| Tema | Decisão |
|---|---|
| Tipo de app | PWA 100% no browser, site estático, sem servidor |
| Público | Aberto a qualquer conta Google |
| Destino | Só Google Drive na v1 (com interface para acrescentar outros) |
| Repositório | `xkyriver/xkyhold` (ainda não existe; pasta local vazia) |

## 2. O que o BackMa é hoje

App Windows (Go + Wails v2, frontend HTML/CSS/JS sem framework) que imita o Déjà Dup:

- **Motor:** `restic` e `rclone` como subprocessos; repositório `rclone:gdrive:<pasta>`.
- **Autenticação:** OAuth do Google feito pelo rclone.
- **Residência:** ícone no tray, arranque com o Windows, agendador em processo (1/2/3/7 dias).
- **Estado:** `config.json` em `%APPDATA%`; password do repositório no Credential Manager.
- **Ecrãs:** Overview, assistente (Pastas → Google Drive → Password), Restore (datas → navegar → escolher), Preferences, About.
- **Extras:** retenção "pelo menos N meses", "Reset account access", reconexão a um backup existente, pt-PT, instalador Inno Setup.

## 3. O que transita e o que não transita

| BackMa | XkyHold | Nota |
|---|---|---|
| Fluxo e textos da UI, i18n EN/pt-PT | Reaproveitado e reorganizado | Base de `frontend/i18n.js` |
| Máquina de estados do agendador (idle/running/erro, "próximo backup") | Portada para TypeScript | Lógica igual, gatilho diferente (ver 5.4) |
| Modelo de configuração (pastas, frequência, retenção) | Portado para IndexedDB | |
| restic (cifra, dedup, snapshots, restore, forget/prune) | **Motor novo em TypeScript** | Um browser não corre binários |
| rclone (OAuth + Drive) | Google Identity Services + Drive API v3 | |
| Credential Manager | Chave não extraível (WebCrypto) em IndexedDB | A password nunca é guardada |
| Tray, autostart, instalador, assinatura de código | Desaparecem | PWA instalável é opcional |
| Diálogos nativos de pastas | File System Access API | |

Consequência a reter: **os backups do XkyHold não são compatíveis com os repositórios restic do BackMa.** São produtos separados; não há migração de dados.

## 4. Limites da plataforma web (e como os tratamos)

1. **Browsers.** Escolher pastas do disco (`showDirectoryPicker`) só existe em Chrome/Edge/Brave/Opera no desktop. Firefox, Safari e telemóveis ficam em modo **só restauro** (descarregar ficheiros do backup), o que é um ganho face ao BackMa: recupera-se em qualquer dispositivo.
2. **Sem backup com o browser fechado.** Não há equivalente ao tray. O backup corre quando a app está aberta: arranca sozinho se estiver em atraso, e a app pode ser instalada como PWA e configurada para abrir no arranque da sessão (a confirmar na Fase 0 o comportamento atual no Chrome/Edge).
3. **Permissão das pastas.** O Chrome permite "permitir em todas as visitas"; sem isso, o utilizador confirma com um clique em cada sessão.
4. **Sessão Google.** Sem servidor não há refresh token: o token de acesso dura cerca de 1 hora e a renovação pode exigir um clique do utilizador. Backups longos têm de pausar e retomar sem perder trabalho. Se isto se revelar incómodo, a alternativa é um mini-backend (Cloudflare Worker) só para trocar tokens — fica fora da v1.
5. **Verificação Google.** O scope `drive.file` não é sensível (a app só vê o que ela própria criou), mas uma app External pública precisa de domínio verificado, página inicial e política de privacidade. A validar na Fase 0.

## 5. Arquitetura proposta

### 5.1 Stack

- TypeScript + Vite, **Svelte 5** para a UI (leve, sem runtime pesado), CSS próprio com tema claro/escuro.
- Motor de backup num **Web Worker** (a UI nunca bloqueia).
- Testes: Vitest (motor, com Drive falso em memória, à imagem do "fake executor" do BackMa) + Playwright (fluxos).
- Alojamento estático: GitHub Pages a partir do próprio repositório, com domínio próprio (sugestão: `hold.xkyriver.com`). O OAuth exige uma origem estável.
- CI em GitHub Actions: lint, testes, build, deploy.

### 5.2 Módulos

```
src/engine/crypto     derivação de chave, cifra de blocos
src/engine/repo       formato do repositório: packs, índice, snapshots
src/engine/backup     percorrer pastas, detetar alterações, enviar
src/engine/restore    listar snapshot, descarregar e decifrar
src/engine/prune      retenção e limpeza de packs órfãos
src/storage/          interface Destination + implementação Google Drive
src/auth/             Google Identity Services
src/scheduler/        estado e "próximo backup" (portado do BackMa)
src/state/            configuração e cache em IndexedDB
src/ui/               ecrãs Svelte, i18n
```

### 5.3 Formato do repositório (pasta `XkyHold/<nome>` no Drive)

Especificação completa (rascunho, em inglês): [FORMAT.md](FORMAT.md). O resumo abaixo é a ideia inicial; onde diferirem, vale a especificação.

- **Cifra:** password → Argon2id (WASM) → chave que desembrulha a chave mestra; dados em AES-256-GCM. Ficheiro `config` com parâmetros e versão do formato.
- **Dados:** ficheiros partidos em blocos, identificados por hash do conteúdo (dedup), agrupados em **packs** de ~16 MB. Evita milhares de ficheiros pequenos no Drive e os limites de taxa da API.
- **Índice:** bloco → pack, cifrado, no Drive e em cache local.
- **Snapshots:** um manifesto cifrado por backup (árvore de ficheiros, tamanhos, datas, blocos).
- **Incremental:** ficheiros inalterados (tamanho + data de modificação) não são relidos.
- **Robustez:** envios retomáveis; um backup interrompido reaproveita os packs já enviados; verificação por amostragem após o envio.
- **Retenção:** apagar manifestos fora da janela e packs sem referências.

Este é o componente de maior risco: é um formato de backup novo, cifrado, onde um erro significa perda de dados. Tem de ter especificação escrita, testes de ida-e-volta com dados reais e versão de formato desde o primeiro dia.

### 5.4 Agendamento

Mesma lógica do BackMa (intervalo + último backup → próximo), mas o gatilho é "app aberta": ao abrir, se em atraso, arranca; enquanto aberta, temporizador. Aviso claro na página inicial quando o backup está atrasado. Wake Lock durante o backup e aviso ao fechar o separador a meio.

## 6. Interface — reorganização proposta

O BackMa é uma janela fixa de 460×560 com tudo atrás de links. No browser há espaço e hábitos diferentes:

- **Layout:** página responsiva com cartão central; navegação simples com três destinos — **Início**, **Restaurar**, **Definições**. "Acerca" passa para o rodapé.
- **Início:** estado em grande ("Último backup: hoje, 09:12"), próximo backup, espaço usado, botão principal "Fazer backup agora", progresso com ficheiro atual e possibilidade de pausar. Avisos acionáveis (pasta sem permissão, sessão Google expirada) como faixas com um botão, não como erros.
- **Assistente, nova ordem:** **1. Entrar com Google → 2. Pastas → 3. Password.** Começar pelo Google permite detetar logo um backup existente; nesse caso o caminho encurta para "password → restaurar", sem pedir pastas.
- **Restaurar:** linha de datas, navegação por pastas com caixas de seleção e pesquisa por nome. Destino: escrever numa pasta (Chrome/Edge) ou descarregar `.zip` (qualquer browser).
- **Definições:** backup automático e frequência, pastas, retenção, conta Google (trocar/desligar), idioma, tema.
- **Modo só restauro:** em browsers sem acesso a pastas, a app explica em uma frase e oferece apenas restaurar.
- **Mantém-se:** tom simples, sem jargão, EN + pt-PT, aviso de que a password não é recuperável.

## 7. Fases

| Fase | Conteúdo | Feito quando |
|---|---|---|
| **0. Fundação** | Criar `xkyriver/xkyhold`, esqueleto Vite/Svelte/TS, CI, deploy; projeto Google Cloud + cliente OAuth; protótipos descartáveis dos três riscos (permissão persistente de pastas, renovação de token, envio retomável para o Drive) | Página publicada faz login e envia um ficheiro de teste |
| **1. Motor** | Especificação do formato; crypto, repo, backup, restore, prune; testes com Drive falso | Backup e restauro de uma pasta real dão ficheiros idênticos byte a byte, nos testes |
| **2. Fluxo principal** | Assistente, Início, backup manual com progresso, pausa/retoma | Backup real para o Drive pela UI |
| **3. Restauro** | Navegador de snapshots, restauro para pasta e `.zip`, modo só restauro | Restauro feito num segundo browser/dispositivo |
| **4. Automático e definições** | Agendamento, avisos de atraso, retenção, definições, reconexão a backup existente, desligar conta | Paridade funcional com o BackMa |
| **5. Acabamento** | Design final, pt-PT, PWA instalável, acessibilidade, página inicial e política de privacidade, verificação Google | v1.0 pública |

## 8. Questões em aberto

1. Repositório público ou privado? (GitHub Pages gratuito pede público.)
2. Domínio: `hold.xkyriver.com` ou outro?
3. Licença do código.
4. Identidade visual: nova, ou alinhada com o site xkyriver.com?

## 9. Fase 0 — resultados dos protótipos (11/11/2026)

| Risco | Resultado |
|---|---|
| Login Google sem servidor | Funciona com Google Identity Services e só o scope `drive.file`, que também chega para `about.get` (identificar a conta). O token vive em memória: perde-se ao recarregar a página. |
| Permissão persistente de pastas | A pasta escolhida fica guardada em IndexedDB. Recarregar mantém a permissão; fechar todas as tabs da app retira-a e a app mostra "Allow". Se o utilizador escolher "permitir em todas as visitas" no aviso do Chrome, a pasta fica legível ao reabrir sem novo pedido. Não testado: reinício completo do Chrome. |
| Renovação do token ao fim de 1 hora | Indício favorável: com consentimento já dado, um novo pedido de token a partir de um clique conclui sem o utilizador ter de fazer nada no popup. Por testar: renovação a meio de um backup, sem clique. |
| Envio retomável para o Drive | Funciona a partir do browser. 12 MB em blocos de 2 MB: interrompido a meio, a sessão respondeu que tinha 2 MB e o envio continuou daí; tamanho e SHA-256 no Drive coincidem com os locais. O cabeçalho `Location` da sessão e o `Range` das respostas 308 são legíveis por CORS; os PUT dos blocos não precisam de token. Não testado: retoma depois de recarregar a página, nem ficheiros de vários GB. |

Consequência para a UI: o assistente deve explicar, no momento em que o Chrome pergunta, que "permitir em todas as visitas" é a opção que evita ter de autorizar de novo.

## 10. Estado em 11/11/2026

Provado contra o Google Drive real, com a pasta de teste `tmp` (2 ficheiros, 101 KB) e o repositório `XkyHold test`:

- Criar repositório com password e chave de recuperação.
- Backup; segundo backup sem alterações envia 0 bytes.
- Verificação ("Check"): descarrega, decifra e valida todos os ficheiros.
- Reabrir o backup depois de recarregar a página, pelo nome e password.
- Restauro para uma pasta local: ficheiros idênticos aos originais (`diff -r` sem diferenças).

Feito no código: fases 0 e 1 completas no essencial; da fase 2 existe um painel funcional, sem desenho final.

Por fazer, por ordem sugerida:

1. Guardar as chaves no browser (não extraíveis) para não pedir a password em cada visita.
2. Estrutura final da interface: assistente (Google → Pastas → Password → chave de recuperação), Início, Restaurar, Definições; pt-PT.
3. Motor num Web Worker; envio e descarga em paralelo.
4. Restauro seletivo (navegar no snapshot) e restauro em `.zip`; modo só restauro.
5. Agendamento ao abrir a app, retenção e limpeza (prune) com locks.
6. Alojamento, domínio, política de privacidade, publicação do cliente OAuth.

Por testar: botão "Sign in again and continue"; sessão Google a expirar a meio de um backup grande; ligações simbólicas; ficheiros de vários GB; reinício completo do Chrome com permissão persistente.

### Atualização (mesma data, ao fim do dia)

Feitos os pontos 1 e 2 da lista acima: as chaves ficam guardadas no browser (não extraíveis) e a interface tem assistente, Início, Restaurar (com navegação e seleção) e Definições, em inglês e pt-PT. A sessão Google sobrevive a recarregar a tab. Testado no Chrome com o repositório `XkyHold test 2`.

Notado: um backup de 101 KB demora 10 a 15 segundos, pelo número de pedidos sequenciais ao Drive. A tratar com o ponto 3 (Worker e paralelismo).

Feito também o ponto 3: o motor corre num Web Worker (`src/engine/worker.ts`), a página fala com ele por mensagens (`client.ts` / `host.ts`), os pacotes são enviados até três de cada vez e o restauro descarrega vários ficheiros e blocos em paralelo. O destino Drive abre com menos pedidos e repete operações em falhas temporárias. No Chrome, um backup sem alterações passou a demorar menos de 3 segundos. Por testar: um backup real com volume (centenas de MB), para ver os envios em paralelo a funcionar contra o Drive.

### Atualização (12/11/2026)

Feito o bloco de retenção e lembretes:

- **Decisão de produto:** o XkyHold nunca inicia uma cópia sozinho. Quem abre a app para restaurar um ficheiro, ou tem pouco tempo, não pode encontrar a ligação ocupada com algo que não pediu. Quando uma cópia está em atraso, a app avisa (no Início e, nos outros ecrãs, numa faixa com "Fazer cópia agora" e "Agora não") e o utilizador decide. Isto substitui o "arranca sozinho se estiver em atraso" da secção 5.4.
- Frequência do lembrete nas Definições: todos os dias (por omissão), a cada 2 ou 3 dias, todas as semanas, ou nunca.
- "Manter cópias": para sempre (por omissão), pelo menos 3, 6 ou 12 meses. As cópias mais antigas são removidas depois de cada nova cópia e o espaço é libertado (prune), com locks entre dispositivos.
- A limpeza é testada com uma falha em cada escrita e em cada remoção: o repositório continua sempre restaurável.

Por testar contra o Drive real: a remoção de cópias antigas (precisa de cópias com mais de 3 meses, ou de um teste dedicado).

Publicado em 12/11/2026 em https://xkyhold.xkyriver.com (Worker `xkyhold-site` no Cloudflare, só ficheiros estáticos, como o xkyriver.com). O deploy é feito pelo dono com `npm run deploy`. A origem de produção está autorizada no cliente OAuth e o login foi testado no site publicado. A app continua em modo "Testing" na Google: só contas listadas como utilizadores de teste conseguem entrar.

Por fazer para abrir a outras pessoas: publicar a app na consola Google ("In production"), verificar o domínio e a marca, criar a caixa `support@xkyhold.xkyriver.com`, e trocar o email de suporte do ecrã de consentimento.

Feito também a 12/11/2026: restauro em `.zip` e modo só restauro. O arquivo é escrito em fluxo (`src/engine/zip.ts`), sem compressão, com ZIP64 só quando necessário e com as datas originais dos ficheiros. O Worker escreve-o num ficheiro temporário no armazenamento privado da origem (OPFS), para não ter de caber em memória, e a página entrega-o ao browser como transferência; sem OPFS, fica em memória. Validado com Python `zipfile`, `unzip`, `7z` e `bsdtar`, e no Chrome com um ficheiro real. Em browsers sem acesso a pastas, o Restaurar mostra só "Transferir em .zip". Em desenvolvimento, `?restore-only` no endereço simula esse modo. Por testar: Safari, e arquivos de vários GB.

Testado num Firefox 158 real (12/11/2026), em modo invisível e com um perfil descartável, através de uma página de teste temporária que correu o motor verdadeiro com um destino em memória: o browser é detetado como "só restauro"; criar o repositório (Argon2id real, 550 ms), fazer a cópia, reabrir com a password e restaurar para `.zip` funcionam; o arquivo de 9,3 MB foi escrito no armazenamento privado (OPFS), lido de volta com o tamanho certo e validado com `unzip`. Ficou de fora o que depende da conta Google do proprietário: o login e o Drive no Firefox, e a transferência vista no ecrã.

A parte que faltava foi feita pelo proprietário a 12/11/2026, no site publicado e num Firefox com a conta Google dele: entrar, ligar a um backup existente com a password e transferir um `.zip` funcionou. O modo só restauro fica assim confirmado no Firefox. Por testar: Safari e telemóvel.

## 11. Abertura ao público (`LAUNCH.md`), a partir de 12/11/2026

### Decisões do proprietário (12/11/2026)

| # | Decisão |
|---|---|
| D1 | Congelar o formato como versão 1 (depois do teste 1.1) |
| D2 | Contacto na privacidade e nos termos: `privacy@xkyhold.xkyriver.com`. "User support email" na consola Google: o Gmail da conta |
| D3 | Repositório público, com as issues desligadas e depois de uma vistoria ao histórico. Licença AGPL-3.0-only |
| D4 | Termos de utilização curtos |
| D5 | Listar no xkyriver.com, no fim |
| D6 | Logótipo: o ícone atual. Mudado a 13/11/2026, a pedido do proprietário, antes de carregar o logótipo na Google: um cofre com uma porta e um X ao centro, desenhado em SVG a partir da imagem que ele deu |

### Etapa 1 — resultados dos testes

Relógio só de desenvolvimento: `?pretend-now=AAAA-MM-DD` no endereço (ou um instante ISO completo) adianta ou atrasa o relógio da página e do motor (lembretes, datas no ecrã, hora das cópias novas, retenção). Só é lido atrás de `import.meta.env.DEV`; confirmado que `pretend-now` não aparece em `dist/` depois de `npm run build`.

| # | Teste | Resultado |
|---|---|---|
| 1.1 | Ficheiros de vários GB | **Passou** (12/11/2026, Chrome do proprietário, `localhost:5173`, backup `XkyHold test 1-3`). Pasta de 10,5 GB de dados aleatórios: um ficheiro de 4,5 GB e seis de 1 GB. Cópia em 19 min (cerca de 8,5 MB/s): "8 ficheiros, 9.8 GB enviados". Memória dos processos do Chrome medida a cada 30 s: estável, entre 560 e 640 MB, sem crescer com os dados enviados. "Verificar" em 12 min: "8 ficheiros verificados (9.8 GB): estão todos intactos." Restauro do ficheiro de 4,5 GB em `.zip`: 9 min; `unzip -t` sem erros, ZIP64 (versão mínima 4.5), data original mantida e SHA-256 igual ao original. Problemas de conforto encontrados e corrigidos: o progresso ficava em "0 B" durante um ficheiro grande (`f1ba903`, com teste) e "1 ficheiros" no singular (`957124b`). Fica como limitação: a cópia temporária do `.zip` ocupa espaço no armazenamento do browser até ao restauro seguinte ou até a app voltar a abrir |
| 1.2 | Sessão Google a expirar a meio | **Passou depois de uma correção** (12/11/2026, mesmo backup). Um ficheiro novo de 3 GB, cópia começada às 18:41:40 e sessão a expirar naturalmente às 18:44:40: a cópia parou com "A tua sessão Google expirou." Problema: "Fazer cópia agora" não voltava a pedir a sessão (o backup continuava aberto) e falhava com a mesma mensagem; quem usa a app ficava sem caminho no Início. Corrigido em `8c2ce9f`: o botão abre a janela da Google sempre que não há sessão, e a mensagem diz que é preciso voltar a entrar e que nada se perde. Depois da correção, a cópia seguinte enviou 1.2 GB dos 2.8 GiB do ficheiro: o que fora enviado antes da expiração foi aproveitado. Restauro desse ficheiro em `.zip`: `unzip -t` sem erros e SHA-256 igual ao original. Não visto no browser: o clique no botão no estado exato "backup aberto, sessão expirada" com o código novo (testado depois de recarregar, onde o caminho é o mesmo) |
| 1.3 | Remoção de cópias antigas no Drive real | **Passou depois de uma correção** (12/11/2026, Chrome do proprietário, `localhost:5173`, backup `XkyHold test 1-3`, pasta de teste de 4,8 MB). Cópia com `?pretend-now=2026-06-01`, um ficheiro de 3 MB apagado, cópias "hoje" com "Pelo menos 3 meses". Primeira tentativa: a cópia de junho não foi removida, sem aviso. Causa vista no Drive: o lock da primeira cópia ficou ativo, porque a listagem do Drive logo após a escrita ainda não o mostrava e a libertação falhou em silêncio; a limpeza via esse lock e desistia. Sem risco para os dados. Corrigido em `f944c15` (a sessão lembra-se do que escreveu e apagou; as listagens frescas perguntam sempre ao Drive), com teste. Repetido às 17:38 com o código corrigido: "1 cópias antigas removidas" (singular corrigido em `726feb1`); no Drive, o snapshot de junho, o pack de 5 MB que só ele usava e os índices antigos foram para o lixo, e o que ainda era preciso foi reescrito num pack de 2 MB; os locks desta cópia foram libertados (o órfão da primeira tentativa sai ao fim de 24 h, como previsto). "Verificar" passou na cópia mais antiga que ficou (3 ficheiros, 1,9 MB, intactos) |
| 1.4 | Aviso de cópia em atraso | **Passou** (12/11/2026, Chrome do proprietário, `localhost:5173`, backup `XkyHold test 2`, última cópia às 02:58 desse dia). Com `?pretend-now=2026-11-15`: o Início diz "Está na altura de fazer uma cópia"; no Restaurar aparece a faixa "A última cópia de segurança foi há 3 dias." com "Fazer cópia agora" e "Agora não"; "Agora não" esconde-a. Sem o parâmetro, o Início diz "Os teus ficheiros estão seguros". Não foi carregado "Fazer cópia agora" |
| 1.5 | Alterar a password | **Passou** (12/11/2026, mesmo backup). Definições → Alterar palavra-passe, com a chave de recuperação como credencial atual e uma palavra-passe nova gerada na página (nunca escrita fora do separador): "A palavra-passe foi alterada." Depois de "Remover deste navegador": a palavra-passe antiga é recusada ("A palavra-passe ou a chave de recuperação não está correta."), a nova abre, e a chave de recuperação abre |
| 1.6 | Windows | **Passou, segundo o proprietário** (12/11/2026, Windows 11, Google Chrome, site publicado 1.0.0): assistente, primeira cópia de uma pasta de Documentos e restauro para uma pasta funcionaram, sem nada estranho a relatar. Não acompanhado pelo agente |
| 1.7 | Safari e telemóvel | **Passou, segundo o proprietário** (12/11/2026, iPhone 16e, site publicado 1.0.0): abrir o site, ligar a um backup existente e transferir um `.zip` funcionaram no Safari e no Chrome. No Chrome, o `.zip` não aparece em Transferências: fica na app Ficheiros, na pasta Chrome. A página inicial passou a dizê-lo. Android não testado. Não acompanhado pelo agente |
| 1.8 | Dois computadores, um backup | **Passou, segundo o proprietário** (relatado a 13/11/2026, Linux e Windows 11 com Google Chrome, site publicado 1.0.0, backup "Windows test"): as cópias de cada computador aparecem nos dois, sem avisos. Duas cópias começadas ao mesmo tempo também não deram problema. Não acompanhado pelo agente |

### Etapa 2 — feito

- 2.1 Página inicial com conteúdo estático em `index.html` (EN e pt-PT): o que a app faz, três passos, o que a Google vê e não vê, browsers, limitações, ligação para a privacidade. Legível sem JavaScript; a app mostra-a por baixo do primeiro passo do assistente, só na língua escolhida, e esconde-a quando há um backup configurado. Visto no browser em modo claro e escuro, em largura de telemóvel, e no build de produção servido pelo Wrangler com os cabeçalhos reais, sem erros na consola.
- 2.3 Privacidade revista: passa a listar a data e o tamanho da última cópia, o acesso temporário da Google guardado no separador e o último `.zip` no armazenamento privado do browser. "Remover deste navegador" passou a apagar também esse `.zip`; só fica a língua escolhida.
- 2.2 Termos de utilização em `public/terms.html` (EN e pt-PT), no molde da privacidade, com ligações no rodapé da app, na página inicial e na privacidade.
- 2.8 Logótipo para a Google: `docs/google-logo-120.png`, 120×120 px, 2,8 KB, exportado de `public/favicon.svg`. Carregar só na etapa 5.
- 2.7 Licença AGPL-3.0-only: `LICENSE` com o texto oficial da GNU, campo `license` no `package.json`, secção no `README.md`, ligação "Código-fonte" no rodapé da app e na página inicial. Histórico revisto (sem segredos); a frase sobre o cliente OAuth do BackMa saiu do `PLAN.md`. Issues desligadas no GitHub. Falta tornar o repositório público (com o "sim" do proprietário).

### Etapa 3 — caixa de correio

- 12/11/2026: subdomínio `xkyhold.xkyriver.com` acrescentado ao Email Routing da zona `xkyriver.com` (painel do Cloudflare, ao lado do `xkynext.xkyriver.com` que já existia). Regra `privacy@xkyhold.xkyriver.com` → Gmail do proprietário, criada com `wrangler email routing rules create`; o destino já estava confirmado. `dig MX xkyhold.xkyriver.com` devolve os três servidores do Cloudflare, o SPF está publicado, e `xkyhold.xkyriver.com` e `xkyriver.com` continuam a responder 200.
- **Fechada:** o proprietário enviou um email de teste de outra conta para `privacy@xkyhold.xkyriver.com` e confirmou que chegou ao Gmail (12/11/2026).
- 2.4 Ligação "Contacto" (`mailto:privacy@xkyhold.xkyriver.com`) no rodapé da app.

### Etapa 4 — posse do domínio

- **Fechada a 12/11/2026.** Na Google Search Console, com a conta dona do projeto `xkyhold`, foi criada uma propriedade do tipo Domínio para `xkyriver.com`. Verificação por registo TXT acrescentado à mão no Cloudflare (`@`, `google-site-verification=…`), ao lado do SPF, que não mudou; não se usou a autorização automática da Google ao Cloudflare. A Search Console mostra "Ownership verified" (método: Domain name provider). O registo tem de ficar no DNS.
- 2.5 Formato do repositório congelado como versão 1 em `docs/FORMAT.md` (decisão D1), depois do teste 1.1. Ficheiros `golden` intactos.
- 2.6 Versão `1.0.0` em `package.json`; aparece no rodapé ("XkyHold v1.0.0").

### Etapa 5 — Google

- 13/11/2026, Branding: página inicial `https://xkyhold.xkyriver.com`, privacidade `/privacy` e termos `/terms` gravados. O domínio autorizado (`xkyriver.com`) e o email de suporte (Gmail) já estavam certos. Logótipo `docs/google-logo-120.png` (o ícone novo) carregado e gravado.
- 13/11/2026, Audience: **app publicada pelo proprietário** ("Push to production?" → Confirm). Estado: "In production", tipo External. Aviso no topo: "Your app requires verification."
- OAuth user cap: a consola diz que o limite só se aplica a scopes sensíveis ou restritos não aprovados. Como o `drive.file` não é sensível, não há limite para o XkyHold (mostra "1 user / 100 user cap").
- Verification Center: "Data access status": não é precisa verificação, porque a app não pede scopes sensíveis nem restritos. "Branding status": a marca não é mostrada aos utilizadores enquanto não for verificada.
- 13/11/2026: o proprietário submeteu a verificação da marca ("Verify branding"). Minutos depois, o Verification Center mostra "Your branding has been verified and is being shown to users". **Marca verificada**; não ficou nada pendente na Google.
- 13/11/2026, teste com uma segunda conta: o proprietário usou uma conta Google Workspace de empresa e o acesso foi bloqueado pela política da organização. Ao aprovar a app na consola de administração do Workspace por ID de cliente, a consola só propôs os scopes de início de sessão e não o `drive.file`, que tem de ser acrescentado à mão ("Add more OAuth scopes"). Do lado do XkyHold está certo: em Data Access, o `drive.file` é o único scope declarado. A página inicial passou a avisar que, em contas de trabalho ou escola, o administrador pode ter de aprovar a app, e a página de privacidade diz o que aprovar (ID de cliente e scope).
- 13/11/2026, teste com uma conta Gmail pessoal, depois do deploy das notas para administradores: **passou, segundo o proprietário** ("Publicado e testado"). O ecrã de consentimento da Google mostrou o nome e o logótipo, sem avisos. **Etapa 5 fechada.**

### Etapa 6 — fecho

- 13/11/2026, limpeza: o proprietário aceitou apagar no Drive as pastas de teste (`XkyHold test`, `XkyHold test 2`, `XkyHold test 1-3`, `XkyHold-test`, `Windows test`) e esvaziar o lixo; **feito pelo proprietário** a 13/11/2026 (não verificado pelo agente). **Etapa 6 fechada; LAUNCH concluído.**
- 13/11/2026, xkyriver.com (D5): o XkyHold entrou no showcase como terceira app no ar, em verde-lima; o marcador passou a "Module 05" e o contador a "03". Imagens de partilha refeitas. Visto em pré-visualização local a 1440 px, 900 px e largura de telemóvel (no telemóvel o rio mostra menos apps; o índice lista todas). Commit `430b07c` no repositório do site, publicado pelo proprietário a 13/11/2026 (versão 37c38ff7); verificado que https://xkyriver.com/ e /pt/ mostram o XkyHold.
- `docs/OAUTH.md` com o estado final da Google.

Critérios da secção 1 do `LAUNCH.md`: 1 (segunda conta, sem avisos) e 2 (nome e logótipo) cumpridos, segundo o proprietário; 3 (email para `privacy@`) e 4 (formato v1, app 1.0.0) cumpridos nas etapas 3 e 2; 5 (checkpoint) no fim desta etapa.
- 13/11/2026, depois do fecho: segundo o proprietário, a conta Workspace da empresa funcionou em tudo depois de o administrador acrescentar o `drive.file`. Apagou também a pasta `XkyHold` inteira do Drive (não só as subpastas de teste) e as pastas locais de teste.

## 12. Landing page (13/11/2026)

- Pedido do proprietário: uma landing page como a da XkyNext e a da XkySpan. Decidiu: a landing fica na raiz e a app passa para `/app/`; o destaque do topo é uma pré-visualização do ecrã de Início da app.
- `/` (EN) e `/pt/` (PT), em HTML estático com `src/landing/landing.css` e `landing.ts`; imagens de partilha `og.png` e `og-pt.png`. A app está em `/app/` (`app/index.html`). O manifesto mantém `id: "/"` e abre em `/app/`.
- `public/landing-redirect.js` corre antes da página: quem já tem um backup configurado neste browser vai para `/app/` (marca `xkyhold.returning` posta pela app, e, para browsers configurados antes disto, uma consulta ao IndexedDB só se a base já existir); em `/`, um dispositivo em português vai para `/pt/`, salvo se escolheu inglês (mesma chave `xkyhold.lang` da app).
- O login Google não muda: só depende da origem. O endereço da página inicial na Google continua a ser `https://xkyhold.xkyriver.com`, agora com a landing.
- Publicado pelo proprietário a 13/11/2026 (versão 50167dbc); verificado que `/`, `/pt/`, `/app/` e as imagens respondem no site.
- Visto pelo agente em pré-visualização local: EN e PT a 1366 px e no telemóvel, troca de língua, redirecionamento para a app pelas duas vias, `/app/` a abrir, e sem erros de CSP com os cabeçalhos de produção (`wrangler dev`). O proprietário entrou com a Google a partir de `/app/` no site publicado, sem problemas.
- 13/11/2026, a pedido do proprietário: a descrição longa saiu da app (`/app/`), que ficou só com o primeiro passo do assistente e uma ligação "O que é o XkyHold?" para a landing na língua da app. A nota sobre o Chrome no iPhone passou para as perguntas da landing.

## 13. Deixar pastas de fora (13/11/2026)

- Pedido do proprietário: escolher subpastas que não entram no backup (ex.: `home` sem `Downloads` e `Videos`).
- Em Definições (e no assistente), cada pasta tem "Deixar de fora…": abre a lista das subpastas, navegável a qualquer profundidade, e desmarca-se o que fica de fora. Não abre um segundo seletor do sistema: lê a pasta pela autorização que já existe. A lista "De fora: …" aparece por baixo da pasta e a contagem de ficheiros atualiza-se.
- Guardado no browser, no registo da pasta (`leaveOut`, caminhos relativos). O formato do repositório não muda: as pastas de fora simplesmente não entram nos snapshots novos; as cópias antigas ficam como estavam (`docs/FORMAT.md` 10.1).
- Testes: o motor deixa de fora a qualquer profundidade, volta a incluir quando se desmarca, e não confunde um ficheiro com o mesmo nome; a contagem ignora as pastas de fora; a lista de caminhos não guarda subpastas de uma pasta já de fora. 148 testes a passar.
- Visto pelo agente no browser (pasta de teste no armazenamento privado do browser, sem Google): desmarcar Downloads, Videos e Documents/Old, contagem e lista atualizadas. Dados de teste apagados depois. Não testado: uma cópia real no Drive com pastas de fora.
- Confirmado pelo proprietário: o Chrome recusa escolher a própria pasta pessoal (`home`) no seletor ("can't open this folder because it contains system files"). Escolhem-se as pastas dentro dela (Documents, Pictures…); o "Deixar de fora…" serve para subpastas dessas.
- 13/11/2026: o passo das pastas (assistente e Definições) passou a explicar, por baixo de "Adicionar pasta…", que o navegador não deixa escolher a pasta pessoal inteira por ter ficheiros de sistema, e que se escolhem as pastas dentro dela.
- 13/11/2026: o proprietário viu que o Chrome também recusa `~/Documents`. A causa não é o conteúdo da pasta: o Chrome trata como sensíveis as pastas especiais do sistema (a pasta pessoal, Documentos e Ambiente de trabalho, segundo a configuração XDG), mas aceita as pastas dentro delas. A dica e a mensagem de erro deixaram de sugerir "Documentos" e a pré-visualização da landing mostra Música em vez de Documentos.
- 13/11/2026, a pedido do proprietário: o seletor de pastas do browser só escolhe uma pasta de cada vez, o que é pesado com muitas pastas dentro de Documentos. As "Pastas a guardar" ganharam uma zona onde se arrastam várias pastas de uma vez a partir do gestor de ficheiros (`getAsFileSystemHandle`). Ficheiros soltos não entram (a app diz quantos), o que o browser recusar é contado, e pastas repetidas não se duplicam. Visto pelo agente com um largar simulado no browser; **por testar com um arrastar real a partir do Nautilus**, e se o Chrome lembra a autorização destas pastas entre visitas.
- 13/11/2026, a pedido do proprietário (a lista de pastas ficava enorme depois de arrastar muitas): **"Nova pasta…"** cria uma pasta que só existe na cópia (ex.: "Documents"), com a sua própria zona para arrastar e "Adicionar pasta…". Aparece fechada, com o resumo "Documents · 6 pastas · N ficheiros · tamanho"; abre-se para ver, remover ou deixar subpastas de fora. No backup é uma raiz cujo tree tem uma entrada por pasta agrupada, por isso o Restaurar mostra `Documents/Personal`, etc. O formato não muda (nota em `docs/FORMAT.md`, secção 9). Dentro da mesma pasta não pode haver dois nomes iguais, e uma pasta solta não pode ter o nome de uma pasta criada. Ler uma pasta agrupada que falhe faz falhar a cópia (como uma pasta escolhida), em vez de a deixar de fora em silêncio. 157 testes a passar. Visto pelo agente com pastas de teste no armazenamento privado do browser e um largar simulado; **por testar com o Nautilus e com uma cópia real no Drive** (e ver o Restaurar).
- 13/11/2026, a pedido do proprietário (para todos os utilizadores): dentro de uma pasta criada no XkyHold passa a ser possível pôr **ficheiros**, com "Adicionar ficheiros…" (seletor do browser, vários de uma vez) ou arrastando-os. Serve para ficheiros soltos dentro de pastas que o Chrome não deixa escolher inteiras (ex.: a raiz de Documentos). Não resolve pastas de dados de programas (ex.: `~/.local/share/...`), que o Chrome bloqueia também por dentro; a `~/Audio` do proprietário é um atalho para uma dessas. Os ficheiros ficam fixos: ficheiros novos ao lado não entram sozinhos, e a app diz isso. Um ficheiro agrupado que desapareça é saltado e contado, como qualquer ficheiro; uma pasta agrupada ilegível continua a fazer falhar a cópia. Ficheiros largados fora de uma pasta criada não entram, com uma frase a explicar onde os pôr. Formato sem alterações (nota em `docs/FORMAT.md`, secção 9). 160 testes a passar. Visto pelo agente com um largar simulado; **por testar: o seletor de vários ficheiros e o arrastar a partir do Nautilus, e uma cópia real**.
- 13/11/2026: dentro de uma pasta criada, a app avisa que pastas e ficheiros novos ao lado dos escolhidos não entram sozinhos, e que para entrarem devem ficar dentro de uma das pastas escolhidas (o Chrome não dá acesso à pasta de cima, por isso a app nem consegue detetar o que é novo).
- 13/11/2026, decisão do proprietário: o XkyHold assume o público de ficheiros pessoais. A landing ganhou a pergunta "Guarda a pasta pessoal inteira, com configurações e chaves?": não, porque os navegadores não deixam ler configurações e chaves e o XkyHold não guarda permissões; para isso, uma ferramenta instalada no computador, como o Déjà Dup (sem dizer que serve para o sistema inteiro). Um programa de linha de comandos para a pasta pessoal inteira fica como ideia, só se houver procura.
- 13/11/2026, a pedido do proprietário (a sessão Google expirou no último passo do assistente): o aviso de sessão expirada tem agora um botão "Entrar de novo". No assistente, depois de entrar, repete o passo que falhou, com tudo o que já foi escolhido (nome, pastas, palavra-passe). No aviso geral da app e em Restaurar, volta a ligar à Google; a cópia não recomeça sozinha. Não foi visto no browser (precisa de uma sessão Google a expirar); verificação de tipos e testes a passar.
