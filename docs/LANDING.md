# Landing page — plano para dar destaque ao XkyHold-lx

Data: 15/11/2026 · Estado: **plano aprovado pelo proprietário a 15/11/2026 (decisões P1–P5 na secção 6); nada implementado**

## 1. O problema

A página inicial (`/` e `/pt/`) fala só da XkyHold no browser. O XkyHold-lx aparece em dois sítios: uma ligação "For Linux" no rodapé e uma frase dentro de uma pergunta fechada do FAQ. Quem chega de um computador com Linux não fica a saber que existe uma app que guarda a pasta pessoal inteira.

Visto a 15/11/2026 em `index.html`: cabeçalho (How it works, Privacy, FAQ, PT, Open app), topo com um botão "Start your backup", faixa de quatro pontos, quatro cartões, três passos, o que a Google vê, perguntas, chamada final e rodapé. A página `/linux/` já existe e está completa (o que guarda, instalar, comparação lx/browser, perguntas).

## 2. Ideia

A página inicial passa a apresentar **o XkyHold como um produto com duas formas de usar**, lado a lado e com o mesmo peso: no browser (qualquer computador, sem instalar) e no Linux (a pasta pessoal inteira). A página `/linux/` continua a ser a página de detalhe e de transferência.

Está prevista uma terceira forma, o **XkyHold-wd para Windows** (ainda sem data). A página tem de a receber sem ser refeita: a secção das formas de usar, os botões do topo e a deteção do sistema do visitante são desenhados para duas entradas hoje e três amanhã (grelha que aceita um terceiro cartão, textos que não dizem "duas"). Enquanto o XkyHold-wd não existir, não aparece na página, nem como "em breve".

Não se cria uma página nova nem se muda o endereço da app. Mantém-se o estilo atual (`src/landing/landing.css`): mesmas cores, cartões, tipografia e tom.

## 3. O que muda, secção a secção

| Secção | Hoje | Proposta |
|---|---|---|
| **Cabeçalho** | How it works · Privacy · FAQ · PT · Open app | Acrescenta **Linux** como primeira ligação da navegação (para `/linux/`). Em ecrãs estreitos, onde a navegação desaparece, a ligação "Linux" fica visível ao lado de PT |
| **Topo (hero)** | Um título sobre pastas e o Drive; um botão "Start your backup"; pré-visualização da janela da app web | Título e texto que servem as duas formas. **Dois botões com o mesmo peso:** "Start in your browser" (`/app/`) e "Download for Linux" (`/linux/`). Por baixo: "Free. No account." (sai o "Nothing to install", que só é verdade no browser). A pré-visualização passa a mostrar as duas janelas, a da web e a do XkyHold-lx (com `.config`, `.ssh`, `Documents` na lista), sobrepostas |
| **Faixa** | Encrypted before upload · Your own Google Drive · Runs in your browser · Open source | "Runs in your browser" passa a "In your browser or on Linux" |
| **Secção nova: "Choose how to use XkyHold"** (logo a seguir à faixa; o título não diz quantas formas há) | Não existe | Dois cartões grandes lado a lado (um por baixo do outro no telemóvel). **No browser:** as pastas que escolhes; Chrome ou Edge para copiar, qualquer browser para restaurar; nada para instalar; botão "Start in your browser". **No Linux (XkyHold-lx):** a pasta pessoal inteira, com configurações, chaves, permissões e ligações; cópia automática opcional; Drive ou disco local; botão "Download for Linux" e ligação "See what it saves" para `/linux/`. Uma linha por baixo: as cópias feitas no Linux restauram-se em qualquer browser |
| **Simple on purpose** (quatro cartões) | Fala só da web | Fica, com dois ajustes de texto: o cartão "Reminds you, never decides for you" diz que no Linux a cópia automática é opcional |
| **How it works** | Três passos da web | Fica como está, com o subtítulo "In your browser" e uma ligação "On Linux: how to install" para `/linux/#install` |
| **What Google can and cannot see** | Fala do browser | Uma frase muda: "Your files go from your computer to your Drive and nowhere else" (vale para as duas) |
| **Perguntas** | A lx só aparece na pergunta sobre configurações e chaves | Três respostas passam a mencionar a lx: "Does it back up while I am away?" (no browser não; no Linux pode ser automática), "Does it back up my whole computer?" e a das configurações. Pergunta nova no topo: "Which one should I use?" |
| **Chamada final** | Um botão | Os mesmos dois botões do topo |
| **Rodapé** | "For Linux" entre as outras ligações | Fica |

## 4. Visitantes em Linux

Um script pequeno (ficheiro próprio, como o `landing-redirect.js`; a CSP não aceita código na página) acrescenta uma classe à página quando o visitante está num computador com Linux (não Android). Com essa classe:

- no topo e na chamada final, "Download for Linux" passa a ser o botão principal e "Start in your browser" o secundário;
- na secção das duas formas, o cartão do Linux aparece primeiro.

Sem JavaScript, ou noutro sistema, a página mostra as duas formas com o mesmo peso. Ninguém é redirecionado para `/linux/`.

## 5. Fora da landing

- **Dentro da app web (`/app/`)**: quem já tem uma cópia configurada é levado direto para a app e nunca vê a landing. No passo das pastas, onde a app já explica que o browser não deixa escolher a pasta pessoal inteira, acrescentar em Linux uma linha: "No Linux, o XkyHold-lx guarda a pasta pessoal inteira" com ligação para `/linux/`. É o momento em que a pessoa sente a limitação.
- **Descrição e imagens de partilha**: a `<meta description>` e as imagens `og.png` / `og-pt.png` passam a mencionar o Linux.
- **`/linux/` e `/pt/linux/`**: sem mudanças de conteúdo; só confirmar que a navegação de volta para a página inicial está clara.
- **xkyriver.com** (decisão P4): o XkyHold-lx **não** tem entrada própria. O XkyHold fica como uma única entrada e as apps da família (browser, Linux e, mais tarde, Windows) aparecem dentro dela, como parte da stack/plataformas dessa entrada. Outro repositório (`src/apps.json`), deploy do proprietário.

## 6. Decisões do proprietário (15/11/2026)

P1, P2, P3 e P5: **sim**, como recomendado. P4: **não** a uma entrada própria no xkyriver.com. Nas palavras dele: a app deve ser considerada como stack da entrada XkyHold, porque virá também o XkyHold-wd para Windows; serão três apps com a mesma ideia de cópias de segurança e não quer inundar o xkyriver.com com apps muito semelhantes.

| # | Pergunta | Decisão |
|---|---|---|
| P1 | Uma página inicial com as formas de usar lado a lado, ou a página inicial passa a ser só um ecrã de escolha que manda para `/browser/` e `/linux/`? | **Lado a lado.** Mantém os endereços, não parte ligações existentes nem o que a Google verificou, e a escolha vê-se sem mais um clique |
| P2 | Visitantes em Linux veem o botão do Linux em primeiro lugar (secção 4)? | **Sim** |
| P3 | A app web mostra a linha sobre o XkyHold-lx no passo das pastas, em Linux (secção 5)? | **Sim** |
| P4 | No xkyriver.com, o XkyHold-lx tem entrada própria? | **Não.** O XkyHold fica como uma única entrada; o XkyHold-lx (e, mais tarde, o XkyHold-wd) aparece dentro dela, como stack dessa entrada. A recomendação apresentada era "sim, mais tarde"; o proprietário decidiu o contrário |
| P5 | O título do topo muda? Hoje: "Your folders, backed up. Readable only by you." | **Fica.** Serve todas as formas; só o parágrafo por baixo passa a falar do browser e do Linux |

## 7. Fases

| Fase | Conteúdo | Feito quando |
|---|---|---|
| **1. Textos** | Todos os textos novos e alterados, em inglês e em português ("tu"), numa lista para o proprietário ler antes de haver HTML | Textos aprovados pelo proprietário |
| **2. Página** | `index.html` e `pt/index.html` (têm de dizer o mesmo), `src/landing/landing.css`, o script da secção 4, a pré-visualização com as duas janelas | Visto pelo agente em pré-visualização local, em inglês e português, a 1366 px, 900 px e largura de telemóvel, em claro e escuro, com e sem a classe de Linux |
| **3. App e partilha** | A linha no passo das pastas (EN e pt-PT, com teste), `<meta description>`, `og.png` e `og-pt.png` | Visto no browser; testes e verificação de tipos a passar |
| **4. Produção** | `npm run preview:prod` (cabeçalhos reais) sem erros de CSP na consola; redirecionamentos da landing a funcionar como antes (português para `/pt/`, quem tem cópia para `/app/`) | **Deploy pelo proprietário**; depois, verificado no site |
| **5. xkyriver.com** | Na entrada XkyHold de `src/apps.json` (repositório `xkyriver.com`), acrescentar o Linux à stack/plataformas dessa entrada, de forma que um terceiro (Windows) entre depois sem redesenho; imagens de partilha se mudarem | Visto em pré-visualização local, EN e PT; **deploy pelo proprietário** |
| **6. Fecho** | `docs/PLAN.md` (secção nova), checkpoint | Registo atualizado |

## 8. Cuidados

- As duas landings (`/` e `/pt/`) têm de dizer o mesmo; as páginas `/linux/` não podem contradizer a página inicial.
- A página inicial é o endereço que a Google verificou para a marca: não muda de endereço, não deixa de explicar o que a app faz com o Drive e mantém as ligações para a privacidade e os termos.
- A página tem de continuar legível sem JavaScript.
- Nada de novo na CSP: sem código na página, sem pedidos a terceiros, sem tipos de letra externos.
- A landing não deve prometer, para o Linux, o que ainda não foi provado: os pacotes `.deb` e `.rpm` nunca foram instalados num Debian ou Fedora reais.

## 9. Textos (fase 1, aprovados pelo proprietário a 15/11/2026: "Aprovo")

Só o que é novo ou muda; o resto da página fica igual. Português com "tu" e o vocabulário da página atual ("encriptado", "navegador", "o XkyHold"). Nada diz quantas formas há, e nada promete para o Linux o que não foi provado (o texto nomeia os formatos, não distribuições).

| Onde | Inglês | Português |
|---|---|---|
| Navegação (primeira ligação) | Linux | Linux |
| Topo: linha acima do título | Encrypted backups · In your browser or on Linux | Cópias encriptadas · No navegador ou no Linux |
| Topo: título (fica, P5) | Your folders, backed up. Readable only by you. | As tuas pastas, guardadas. Só tu as consegues ler. |
| Topo: parágrafo | XkyHold copies your folders to your own Google Drive, from your browser or with the app for Linux, which can also save your whole personal folder. Every file is encrypted on your computer before it leaves it, so Google keeps your backup but cannot read it. | O XkyHold copia as tuas pastas para o teu próprio Google Drive, a partir do navegador ou com a app para Linux, que também consegue guardar a pasta pessoal inteira. Cada ficheiro é encriptado no teu computador antes de sair dele, por isso a Google guarda a tua cópia mas não a consegue ler. |
| Topo e chamada final: botões | Start in your browser · Download for Linux | Começar no navegador · Descarregar para Linux |
| Topo: linha pequena | Free. No account. | Grátis. Sem conta. |
| Topo: janela do XkyHold-lx na pré-visualização | XkyHold-lx · Your files are safe · Last backup: Today, 18:16 · 233,236 files · 26 GB · Back up now · Documents, .config, .ssh | XkyHold-lx · Os teus ficheiros estão seguros · Última cópia: Hoje, 18:16 · 233 236 ficheiros · 26 GB · Fazer cópia agora · Documentos, .config, .ssh |
| Faixa (3.º ponto) | In your browser or on Linux | No navegador ou no Linux |
| Secção nova: título | Choose how to use XkyHold | Escolhe como usar o XkyHold |
| Secção nova: subtítulo | The same encrypted backups in your own Google Drive. Pick what suits this computer. | As mesmas cópias encriptadas no teu próprio Google Drive. Escolhe o que serve este computador. |
| Cartão do navegador: título | In your browser | No navegador |
| Cartão do navegador: pontos | The folders you choose · Nothing to install · Back up from Chrome or Edge on a computer; restore from any browser, even on a phone · A reminder when a backup is due | As pastas que escolheres · Nada para instalar · Cópias no Chrome ou no Edge num computador; restauro em qualquer navegador, até no telemóvel · Um lembrete quando está na hora de uma cópia |
| Cartão do navegador: botão | Start in your browser | Começar no navegador |
| Cartão do Linux: título | On Linux: XkyHold-lx | No Linux: XkyHold-lx |
| Cartão do Linux: pontos | Your whole personal folder, with settings, keys, permissions and links · Google Drive or a disk · A reminder, or automatic backups if you want them · AppImage, .deb and .rpm | A tua pasta pessoal inteira, com configurações, chaves, permissões e ligações · Google Drive ou um disco · Um lembrete, ou cópias automáticas se as quiseres · AppImage, .deb e .rpm |
| Cartão do Linux: botão e ligação | Download for Linux · See what it saves | Descarregar para Linux · Ver o que guarda |
| Por baixo dos cartões | Backups made on Linux can be restored in any browser. | As cópias feitas no Linux restauram-se em qualquer navegador. |
| "Simple on purpose": subtítulo | No settings to learn. Choose what to save once, and XkyHold reminds you when a backup is due. | Nada para aprender. Escolhes uma vez o que guardar, e o XkyHold lembra-te quando está na hora de uma cópia. |
| Cartão "Reminds you, never decides for you" | XkyHold tells you when a backup is due and never starts one unasked. On Linux, you can choose automatic backups. | O XkyHold avisa quando está na hora de uma cópia e nunca começa uma sem pedires. No Linux, podes escolher cópias automáticas. |
| "How it works": subtítulo e ligação | In your browser · On Linux: how to install → | No navegador · No Linux: como instalar → |
| "What Google can see": nota | There is no XkyHold server. Your files go from your computer to your Drive and nowhere else. | Não há servidor do XkyHold. Os teus ficheiros vão do teu computador para o teu Drive e para mais lado nenhum. |
| Pergunta nova (primeira) | **Which one should I use?** On Linux, XkyHold-lx: it saves your whole personal folder, with settings and keys, and can back up by itself. On any other computer, or one where you cannot install apps, XkyHold in your browser: it saves the folders you choose, with nothing to install. | **Qual devo usar?** No Linux, o XkyHold-lx: guarda a pasta pessoal inteira, com configurações e chaves, e pode fazer cópias sozinho. Em qualquer outro computador, ou num onde não podes instalar apps, o XkyHold no navegador: guarda as pastas que escolheres, sem nada para instalar. |
| "Is it free?" | Yes. No ads and no paid features. Your backup uses the space in your Google Drive, or on a disk with XkyHold-lx. | Sim. Sem anúncios nem funcionalidades pagas. A tua cópia usa o espaço do teu Google Drive, ou de um disco com o XkyHold-lx. |
| "Does it back up while I am away?" | In your browser, no: a backup runs only while the XkyHold page is open, and only when you start it; XkyHold reminds you when one is due. On Linux, XkyHold-lx can back up by itself, also with the window closed, if you turn on automatic backups. | No navegador, não: uma cópia só corre enquanto a página do XkyHold está aberta, e só quando a começas; o XkyHold lembra-te quando está na hora. No Linux, o XkyHold-lx pode fazer cópias sozinho, mesmo com a janela fechada, se ligares as cópias automáticas. |
| "Does it back up my whole computer?" | No. In your browser it backs up the folders you choose, such as documents, pictures or work, without file permissions or shortcuts (symbolic links). XkyHold-lx backs up your whole personal folder, permissions and links included, but not the system or the programs installed. | Não. No navegador guarda as pastas que escolheres, como documentos, fotografias ou trabalho, sem as permissões dos ficheiros nem atalhos (ligações simbólicas). O XkyHold-lx guarda a tua pasta pessoal inteira, com permissões e ligações, mas não o sistema nem os programas instalados. |
| "…whole personal folder, with settings and keys?" | Not in your browser: browsers do not let a web page read the settings, keys and other configuration files in your personal folder, and they do not keep file permissions. On Linux, XkyHold-lx saves your whole personal folder, with settings, keys and permissions. | No navegador, não: os navegadores não deixam uma página web ler as configurações, chaves e outros ficheiros de configuração da tua pasta pessoal, nem guardam as permissões dos ficheiros. No Linux, o XkyHold-lx guarda a tua pasta pessoal inteira, com configurações, chaves e permissões. |
| `<meta description>` | Free, encrypted backups to your own Google Drive: the folders you choose, from your browser, or your whole personal folder on Linux. Files are encrypted on your computer before they leave it. No account. | Cópias de segurança gratuitas e encriptadas no teu próprio Google Drive: as pastas que escolheres, no navegador, ou a pasta pessoal inteira no Linux. Os ficheiros são encriptados no teu computador antes de saírem dele. Sem conta. |
| `og:description` | Free, encrypted backups to your own Google Drive, in your browser or on Linux. | Cópias de segurança gratuitas e encriptadas no teu próprio Google Drive, no navegador ou no Linux. |
| App web, passo das pastas, só em Linux (P3) | On Linux, XkyHold-lx saves your whole personal folder, settings and keys included. | No Linux, o XkyHold-lx guarda a pasta pessoal inteira, incluindo configurações e chaves. |

Saem: o botão "See how it works ↓" do topo (dá lugar aos dois botões; "How it works" continua na navegação) e o "Nothing to install" da linha pequena (só é verdade no navegador; passa para o cartão do navegador).

## 10. Registo

- **Fase 2 feita a 15/11/2026.** `index.html` e `pt/index.html` com os textos aprovados (mesma estrutura nas duas línguas): ligação "Linux" na navegação (e, em ecrãs estreitos, ao lado de PT/EN), dois botões no topo e na chamada final, pré-visualização com a janela da web e a do XkyHold-lx sobrepostas, secção "Choose how to use XkyHold" com uma grelha que aceita mais cartões, ajustes em "Simple on purpose", "How it works", na nota da Google e nas perguntas. `public/landing-os.js` (ficheiro próprio, sem código na página) põe a classe `os-linux` em computadores com Linux (não Android nem ChromeOS); com ela, o botão e o cartão do Linux vêm primeiro e o do navegador fica secundário. **Visto** em `vite preview`, EN e PT, a 1366 px, 900 px e 375 px, com e sem a classe: ordem certa, sem deslocamento horizontal, cabeçalho numa linha. Corrigido no teste: a barra da janela pequena a 900 px; o cabeçalho e as janelas desenhadas no telemóvel (lá escondem-se os separadores e o selo, decorativos). Sem JavaScript, todo o texto está na página; nenhum código na página nem anfitriões novos. **Nota:** a landing só tem tema escuro (`color-scheme: dark`), por isso não há versão clara para ver.
