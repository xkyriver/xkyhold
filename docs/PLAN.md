# XkyHold — plano de adaptação a partir do BackMa

Data: 11/11/2026 · Origem analisada: BackMa v1.0.4 (`B-O-S-R/backma`, commit `20560d8`)

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
- **Autenticação:** OAuth do Google feito pelo rclone, cliente Internal da Linkare.
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
