# XkyHold — plano de abertura ao público

Data: 12/11/2026 · Estado de partida verificado nesse dia · Para execução por um agente (Claude Opus 5.5) com o proprietário a acompanhar

## 1. Para que serve este documento

O XkyHold está publicado em https://xkyhold.xkyriver.com e funciona, mas só a conta Google do proprietário consegue entrar, porque a app está em modo "Testing" na Google. Este plano leva-a até qualquer pessoa com uma conta Google a poder usar, sem avisos de app não verificada e com um contacto de suporte que funciona.

Foi escrito para ser executado por um agente que não acompanhou o desenvolvimento. Está tudo aqui ou nos ficheiros para onde aponta; não é preciso adivinhar.

**Está feito quando:**

1. Uma conta Google que nunca foi utilizador de teste entra em https://xkyhold.xkyriver.com, cria um backup, faz uma cópia e restaura um ficheiro, sem ver nenhum aviso da Google.
2. O ecrã de consentimento da Google mostra o nome "XkyHold" e o logótipo.
3. Um email enviado para `privacy@xkyhold.xkyriver.com` (contacto da privacidade e dos termos, decisão D2) chega ao proprietário.
4. O formato do repositório está congelado como versão 1 e a app tem a versão `1.0.0`.
5. O checkpoint do projeto reflete o novo estado.

## 2. Ler primeiro

Por esta ordem, antes de tocar em qualquer coisa:

1. O checkpoint do projeto (o proprietário indica o caminho; fica fora do repositório). Tem os acessos, as regras de trabalho e as armadilhas.
2. `CLAUDE.md` na raiz do repositório.
3. `docs/PLAN.md`: o aviso no topo e as secções 9 e 10.
4. `docs/OAUTH.md` e `docs/FORMAT.md`.

## 3. Regras que não se negociam

Vêm das decisões do proprietário e de problemas já encontrados. Cada uma tem a sua razão; se uma situação nova não estiver coberta, aplica a razão.

- **O proprietário publica.** O comando `npm run deploy` é corrido por ele. Nesta instalação o agente está impedido de publicar em produção; se o comando for recusado, não procures outro caminho: pede-lhe que o corra. *Razão: publicar é um ato dele, visível para fora.*
- **Nada muda na conta Google nem no Cloudflare sem um "sim" do proprietário para essa alteração concreta.** Um "sim" anterior não vale para a seguinte. Diz o que vais mudar, espera, faz, e confirma o resultado. *Razão: são contas pessoais dele e algumas alterações não se desfazem (ver etapa 5).*
- **Aceitar termos, políticas ou pedidos de verificação é sempre do proprietário.** Preparas o ecrã e paras.
- **Passos que precisam dele, um de cada vez.** Avisa antes de um diálogo do sistema ou de um teste que dependa dele, e espera pelo sinal.
- **Segredos nunca em chat nem em ficheiros versionados.** A password de teste vive em `.env.local`.
- **A app nunca age pelo utilizador.** Não acrescentes nada que arranque sozinho, recolha dados ou contacte terceiros. Sem estatísticas, em nenhuma circunstância.
- **Português com "tu"; interface em inglês e pt-PT.** Cada texto novo precisa de tradução, ou o teste `src/lib/i18n.test.ts` falha.
- **Commits sem linhas de atribuição ao agente**, com título e pontos, e sem caminhos do computador do proprietário em ficheiros do repositório.
- **Não regenerar os ficheiros `golden`** em `src/engine/`. Se um teste `golden` falhar, a alteração partiria backups existentes: recua.
- **Relata com exatidão.** Distingue sempre o que viste a funcionar do que só passou em testes automáticos, e o que não foi testado.

## 4. Estado de partida (verificado a 12/11/2026)

| Assunto | Estado |
|---|---|
| Site | https://xkyhold.xkyriver.com responde, com cabeçalhos de segurança, página `/privacy` (EN e PT) e manifesto |
| Código | `main` limpo e sincronizado; 135 testes a passar; CI verde |
| Google: público | Tipo External, estado **Testing**; um utilizador de teste (o proprietário) |
| Google: scope | Só `drive.file`, classificado pela Google como **não sensível** |
| Google: Branding | Nome `XkyHold`; email de suporte e de contacto = Gmail do proprietário; **sem** logótipo, **sem** página inicial, **sem** ligação de privacidade, **sem** domínios autorizados |
| Google: verificação | "Verification is not required since your app is in Testing status" |
| Google: publicar | O botão "Publish app" está desativado até a página Branding estar completa |
| Email | `xkyriver.com` usa o Cloudflare Email Routing (registos MX e SPF ativos). **`xkyhold.xkyriver.com` não tem registos MX**: hoje, um email para `support@xkyhold.xkyriver.com` é devolvido, e é esse o contacto que a página de privacidade indica |
| DNS | A zona `xkyriver.com` está no Cloudflare |
| Página inicial | `/` é a própria app. Num browser novo mostra o primeiro passo do assistente: um parágrafo e o botão "Continue with Google". O conteúdo é gerado por JavaScript; o HTML servido está vazio |
| Formato do repositório | Versão 1, ainda marcada como **rascunho** em `docs/FORMAT.md` |
| Versão da app | `0.1.0` em `package.json` |
| Licença | Nenhuma; repositório privado |

O que a Google exige, confirmado na documentação dela a 12/11/2026:

- Uma app que só pede scopes não sensíveis **não precisa de verificação de scopes**. Para o nome e o logótipo aparecerem no ecrã de consentimento precisa de **verificação da marca**, um processo mais leve.
- A verificação da marca exige: página inicial num domínio verificado, que identifique a app, **descreva o que ela faz e não seja só uma página de login**, com ligação para a política de privacidade; política de privacidade no mesmo domínio, igual à indicada no ecrã de consentimento, a dizer como os dados Google são acedidos, usados, guardados e partilhados; e posse de todos os domínios autorizados, provada na Google Search Console por um dono ou editor do projeto.
- Em "Testing", as autorizações expiram ao fim de 7 dias e só entram utilizadores de teste. Em "In production", entra qualquer conta Google.
- O limite de 100 utilizadores aplica-se a scopes sensíveis ou restritos por aprovar. Não se aplica a esta app, mas confirma-o na consola depois de publicar (etapa 5).

Fontes: https://support.google.com/cloud/answer/13463073 · https://support.google.com/cloud/answer/13464321 · https://support.google.com/cloud/answer/15549945 · https://developers.cloudflare.com/email-routing/setup/subdomains/

## 5. Decisões do proprietário, a pedir logo no início

Faz estas perguntas todas de uma vez, antes de começar, com a recomendação. O trabalho das etapas 1 e 2 que não depende delas pode avançar em paralelo.

| # | Decisão | Opções | Recomendação e porquê |
|---|---|---|---|
| D1 | Congelar o formato do repositório como versão 1 | Congelar agora · Rever primeiro | **Congelar agora.** Depois de haver utilizadores, mudar o formato obriga a manter dois. Os testes cobrem interrupções em todos os pontos e há dois repositórios de referência. Antes de congelar, a etapa 1 testa ficheiros grandes, que é a única dúvida real sobre o desenho |
| D2 | Email de suporte no ecrã da Google | Manter o Gmail · Criar um Google Group | **Manter o Gmail por agora.** O campo só aceita o email da conta ou um Google Group gerido por ela; não aceita `support@xkyhold.xkyriver.com`. Um grupo esconde o Gmail, mas o endereço visível seria `…@googlegroups.com` |
| D3 | Licença e visibilidade do repositório | Privado sem licença · Público com licença | **Público, com licença MIT ou AGPL-3.0.** Uma app que promete cifrar no computador do utilizador ganha confiança se o código puder ser lido. É decisão dele: se ficar privado, não se toca em nada |
| D4 | Página de termos de utilização | Com · Sem | **Com, curta.** Não é exigida pela Google, mas é o sítio certo para dizer que a app é gratuita, sem garantias, e que quem perde a password e a chave de recuperação perde a cópia |
| D5 | Listar o XkyHold em xkyriver.com | Sim · Não · Mais tarde | **Sim, no fim** (etapa 6). É outro repositório, com as suas regras, e é ele que o publica |
| D6 | Logótipo no ecrã da Google | O ícone atual · Outro | **O ícone atual**, exportado a 120×120 px |

## 6. Etapas

Executa por ordem. Cada etapa diz quem faz o quê e como se sabe que acabou. Não avances para a etapa 5 sem a 1 e a 2 fechadas: publicar na Google antes de a app estar pronta expõe utilizadores reais a problemas conhecidos.

### Etapa 1 — Testes que faltam antes de haver utilizadores

Objetivo: fechar as dúvidas listadas na secção 7 do checkpoint, pela ordem do risco para os dados de quem usar a app.

| # | Teste | Quem | Como | Passa quando |
|---|---|---|---|---|
| 1.1 | Ficheiros de vários GB | Proprietário escolhe a pasta; agente observa | Cópia de uma pasta com pelo menos um ficheiro acima de 4 GB e um total acima de 10 GB; depois "Verificar" e restaurar o ficheiro grande em `.zip` | A cópia termina, a memória do separador não cresce sem limite, "Verificar" passa e o `.zip` abre com `unzip -t` |
| 1.2 | Sessão Google a expirar a meio | Agente, com o proprietário a clicar | Durante a cópia de 1.1, que dura mais de uma hora, a sessão expira sozinha. Em alternativa, invalidar o token em `sessionStorage` | A app diz que a sessão expirou, oferece voltar a entrar, e a cópia seguinte reaproveita o que já foi enviado (bytes enviados muito abaixo do total) |
| 1.3 | Remoção de cópias antigas no Drive real | Agente | Acrescentar um relógio só de desenvolvimento (por exemplo `?now=2026-01-10`), gated por `import.meta.env.DEV` como o `?restore-only`, que chegue ao motor. Num repositório de teste novo: cópia "em janeiro", alterar ficheiros, cópia "hoje" com "Manter cópias: pelo menos 3 meses" | A cópia antiga desaparece do Restaurar, os packs que só ela usava vão para o lixo do Drive, e "Verificar" passa na cópia que ficou |
| 1.4 | Aviso de cópia em atraso | Agente | Com o mesmo relógio, abrir a app "dois dias depois" | O Início diz que está na altura de fazer uma cópia; noutro separador da app aparece a faixa com "Fazer cópia agora" e "Agora não"; "Agora não" esconde-a |
| 1.5 | Alterar a password | Agente, num repositório de teste | Definições → alterar; fechar; ligar de novo com a nova, e depois com a chave de recuperação | A antiga deixa de abrir, a nova e a chave de recuperação abrem |
| 1.6 | Windows | Proprietário | Chrome ou Edge em Windows: assistente, cópia de Documentos, restauro para pasta. É a plataforma dos utilizadores do BackMa e ainda não foi testada | Funciona de ponta a ponta; anotar qualquer texto ou comportamento estranho |
| 1.7 | Safari e telemóvel | Proprietário | Abrir o site, ligar a um backup existente, transferir um `.zip` | Funciona, ou a limitação fica escrita na app e na documentação |
| 1.8 | Dois computadores, um backup | Proprietário, se tiver dois à mão | Ligar o segundo ao mesmo backup e fazer uma cópia em cada um | As duas cópias aparecem nos dois; nenhuma parte um backup do outro |

Regras desta etapa:

- Um problema que ponha dados em risco (cópia que parece boa e não restaura, limpeza que apaga a mais) **pára o plano**. Corrige, acrescenta um teste que o apanhe, e só depois continua.
- Um problema de conforto anota-se e segue.
- O relógio de desenvolvimento não pode existir no build de produção. Confirma procurando o nome do parâmetro em `dist/` depois de `npm run build`.
- 1.6, 1.7 e 1.8 dependem de equipamento do proprietário. Se não for possível, não inventes um substituto: regista como "não testado" e escreve a limitação na página inicial (etapa 2).

Fecha quando: cada linha tem um resultado escrito no fim de `docs/PLAN.md`.

### Etapa 2 — Preparar a app para estranhos

Objetivo: a app e o site passam a explicar-se sozinhos a quem chega sem contexto, e cumprem o que a Google exige da página inicial.

2.1 **Página inicial que não seja só um login.** Hoje, quem chega vê um parágrafo e um botão, e o HTML servido está vazio. Acrescenta conteúdo estático em `index.html`, visível antes de o JavaScript correr e mantido pela app enquanto não houver um backup configurado: o que o XkyHold faz, como funciona em três passos, o que a Google consegue e não consegue ver, que browsers fazem cópias e quais só restauram, as limitações assumidas (ficheiros pessoais, não sistema; sem permissões nem ligações simbólicas; a cópia só corre com a página aberta), e ligações para a privacidade e para os termos. Mantém o tom calmo da app; não é uma página de marketing. *Porquê estático: quem revê na Google e quem tem JavaScript bloqueado tem de conseguir ler.* A política de segurança em `public/_headers` não permite scripts nem estilos em linha.

2.2 **Termos de utilização** (se D4 for "com"): `public/terms.html`, no molde de `public/privacy.html`, em inglês e português. Gratuito, sem garantias; a responsabilidade pela password e pela chave de recuperação é de quem usa; a app pode mudar ou acabar, e os dados ficam sempre no Drive do utilizador. Ligação no rodapé e na página inicial.

2.3 **Privacidade.** Relê `public/privacy.html` contra o que a app faz hoje e atualiza a data. Tem de continuar a dizer como os dados Google são acedidos, usados, guardados e partilhados, e a manter a declaração de "Limited Use". Se a etapa 1 acrescentou alguma coisa guardada no browser, tem de constar.

2.4 **Contacto de suporte dentro da app**: uma ligação `mailto:` no rodapé ou nas Definições. Só depois de a etapa 3 estar feita, para não apontar para um endereço que devolve emails.

2.5 **Congelar o formato** (se D1 for "congelar"): em `docs/FORMAT.md`, tirar "draft" do título e do estado, e escrever a regra: a versão 1 não muda de forma incompatível; uma alteração incompatível é a versão 2, e a app tem de continuar a ler a 1. Não se mexe nos ficheiros `golden`.

2.6 **Versão `1.0.0`** em `package.json`; aparece sozinha no rodapé.

2.7 **Licença** (se D3 for "público"): ficheiro `LICENSE`, menção no `README.md` e no rodapé da página inicial. Antes de tornar o repositório público, percorre o histórico à procura de segredos (`git log -p` por `password`, `secret`, `token`, e o conteúdo de `.env.local`). Não deve haver nenhum; se houver, pára e fala com o proprietário. Tornar o repositório público é uma ação dele, ou tua com um "sim" explícito.

2.8 **Logótipo para a Google**: PNG de 120×120 px a partir de `public/favicon.svg`, guardado em `docs/` ou `public/`, com menos de 1 MB.

Verificação da etapa: `npm run check`, `npm test`, `npm run build`; ver a página inicial em modo claro e escuro e em largura de telemóvel; `npm run preview:prod` para confirmar que nada é bloqueado pela política de segurança (procurar "Refused" na consola). Depois o proprietário publica, e confirmas no site com `curl` que o HTML de `/` já traz o texto novo.

Fecha quando: o site publicado mostra a página inicial nova, `/privacy` e `/terms` respondem, e os testes passam.

### Etapa 3 — Caixa de correio de suporte

Objetivo: `privacy@xkyhold.xkyriver.com` entrega ao proprietário (era `support@` no plano original; mudou com a decisão D2). A página de privacidade e os termos já indicam este endereço, por isso hoje há um contacto publicado que não funciona; por isso esta etapa pode e deve correr cedo, em paralelo com as outras.

1. Pede o "sim" ao proprietário: vais acrescentar o subdomínio `xkyhold` ao Email Routing da zona `xkyriver.com`, o que cria registos DNS no subdomínio.
2. No painel do Cloudflare: Compute → Email Service → Email Routing → zona `xkyriver.com` → Settings → Subdomains → acrescentar `xkyhold.xkyriver.com`. Em alternativa, `npx wrangler email --help` (em beta; só se oferecer este caso de forma clara).
3. Quando os registos propagarem, cria a regra `privacy@xkyhold.xkyriver.com` → o endereço de destino que o proprietário indicar. Subdomínios só aceitam regras literais; não há "apanha-tudo".
4. Um endereço de destino novo tem de ser confirmado por email pelo proprietário.

Verificação: `dig +short MX xkyhold.xkyriver.com` devolve os servidores do Cloudflare; o proprietário envia um email de outra conta para o endereço e confirma que chegou. Confirma também, com `curl -I https://xkyhold.xkyriver.com/`, que o site continua a responder: o subdomínio serve o site e o email ao mesmo tempo.

Fecha quando: o email de teste chegou.

### Etapa 4 — Provar a posse do domínio

Objetivo: a Google reconhece que o proprietário é dono do domínio, condição da verificação da marca.

1. Na Google Search Console, com a conta dona do projeto `xkyhold`, acrescentar uma propriedade do tipo **Domínio** para `xkyriver.com`. Cobre todos os subdomínios e serve as outras apps dele.
2. A Search Console dá um registo TXT. Com o "sim" do proprietário, acrescenta-o à zona `xkyriver.com` no Cloudflare. Não removas nem alteres o TXT de SPF que já lá está.
3. Confirma na Search Console.

Verificação: a propriedade aparece como verificada; `dig +short TXT xkyriver.com` mostra os dois registos.

Fecha quando: a Search Console mostra o domínio verificado.

### Etapa 5 — Google: marca, publicação e verificação

Objetivo: qualquer conta Google entra, e o ecrã de consentimento mostra o nome e o logótipo.

Só com as etapas 1, 2 e 4 fechadas. Tudo na consola, em https://console.cloud.google.com/auth/overview?project=xkyhold, pelo browser do proprietário.

1. **Branding**, uma alteração de cada vez, com "sim":
   - Application home page: `https://xkyhold.xkyriver.com`
   - Application privacy policy link: `https://xkyhold.xkyriver.com/privacy`
   - Application terms of service link: `https://xkyhold.xkyriver.com/terms` (se existir)
   - Authorized domains: `xkyriver.com`
   - App logo: o PNG de 2.8. **Atenção:** a consola avisa que, depois de carregar um logótipo, a app tem de ser submetida a verificação. Carrega-o só neste momento.
   - User support email: conforme D2.
2. **Audience → Publish app.** Lê ao proprietário o que o diálogo diz antes de ele confirmar. A partir daqui qualquer conta Google entra.
3. **Confirma o que a consola diz depois de publicar**: o estado em Verification Center e o texto de "OAuth user cap" em Audience. O esperado é não haver limite de utilizadores, porque o scope não é sensível. Se a consola disser outra coisa, pára e relata o texto exato: a documentação pode ter mudado.
4. **Verification Center → submeter a verificação da marca.** A submissão e qualquer declaração são do proprietário. Se pedirem justificação: a app cria e lê apenas os seus próprios ficheiros no Drive do utilizador (`drive.file`), cifrados no browser, e não tem servidor.
5. **Esperar.** A Google responde por email para o contacto do programador; pode levar dias. Não fiques em ciclo à espera: regista no checkpoint que está pendente e o que fazer quando chegar a resposta. Se pedirem alterações, a causa mais provável é a página inicial; volta à etapa 2.1.

Verificação imediata, sem esperar pela marca: o proprietário entra com uma **segunda conta Google**, que nunca foi utilizador de teste, numa janela privada, cria um backup, faz uma cópia de uma pasta pequena e restaura um ficheiro. Anota o que o ecrã da Google mostra: enquanto a marca não for verificada, é possível que não mostre o nome nem o logótipo, mas não deve haver bloqueio nem aviso de app não verificada.

Fecha quando: a segunda conta completou o ciclo, e a verificação da marca está aprovada ou registada como pendente.

O que não se desfaz: uma app publicada pode voltar a "Testing", mas quem já a autorizou fica com a autorização. Antes de publicar, confirma com o proprietário que as etapas 1 e 2 estão mesmo fechadas.

### Etapa 6 — Fecho

1. **Limpeza de testes**: com o "sim" do proprietário, as pastas de teste no Drive dele (`XkyHold/XkyHold test`, `XkyHold/XkyHold test 2`, `XkyHold-test` e as que a etapa 1 criou) e os `.zip` de teste nas transferências. A app não apaga repositórios; é ele que o faz no Drive.
2. **xkyriver.com** (se D5 for "sim"): acrescentar o XkyHold a `src/apps.json` no repositório desse site, seguindo o `CLAUDE.md` de lá (texto em EN e pt-PT, correr `npm run og`). É o proprietário que publica.
3. **Documentação**: `docs/OAUTH.md` com o estado final; `docs/PLAN.md` com os resultados; o checkpoint atualizado, com o que ficou pendente (a resposta da Google, limitações por testar).
4. **Memória do agente**, se a tiveres: atualizar a entrada do projeto.

## 7. Dependências e ordem

```
Decisões (5) ──┬─> Etapa 1 (testes) ──┐
               ├─> Etapa 2 (app) ─────┼─> Etapa 5 (Google) ─> Etapa 6 (fecho)
               ├─> Etapa 3 (email) ───┤
               └─> Etapa 4 (domínio) ─┘
```

As etapas 1 a 4 podem avançar em paralelo. A 2.4 espera pela 3. A 5 espera pela 1, 2 e 4. Dentro da 5, a verificação da marca é a única espera que não depende de ninguém do projeto.

## 8. Quando parar e perguntar

- Um teste da etapa 1 mostra perda ou corrupção de dados.
- A consola Google mostra um texto, um custo ou um requisito que este plano não prevê (por exemplo, uma avaliação de segurança paga). Não deve acontecer com `drive.file`.
- Uma alteração no Cloudflare afetaria o site `xkyriver.com` ou o email que já lá funciona.
- Aparece qualquer pedido de pagamento.
- Um passo exige uma palavra-passe, um código ou aceitar termos.
- O histórico do git contém algo que não devia ser público.

Em todos estes casos: descreve o que viste, com o texto exato, diz o que recomendas, e espera.

## 9. Como relatar

No fim de cada etapa, um relatório curto ao proprietário, em português:

1. O que ficou feito e onde (commit, endereço, ecrã da consola).
2. O que viste a funcionar, o que só passou em testes automáticos, e o que não foi testado.
3. O que precisa dele a seguir, numa frase.

No fim do plano, o mesmo para o conjunto, e o checkpoint atualizado.

## 10. Comandos de referência

```bash
npm run dev            # servidor de desenvolvimento, porta 5173 obrigatória
npm run check && npm test && npm run build
npm run preview:prod   # build de produção local, com os cabeçalhos reais
npm run deploy         # só o proprietário

dig +short MX xkyhold.xkyriver.com
dig +short TXT xkyriver.com
curl -sI https://xkyhold.xkyriver.com/ | head -20
curl -s https://xkyhold.xkyriver.com/ | head -40
```
