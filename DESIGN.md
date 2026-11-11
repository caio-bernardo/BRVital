---
version: alpha
name: BR Vital
description: >-
  Design system do BR Vital, app mobile-first de triagem e orientação
  hospitalar. Visual editorial e acolhedor: títulos serifados em vinho,
  superfícies brancas com contornos grossos e acento verde-saúde.
colors:
  primary: "#5A1E16"
  secondary: "#45B08C"
  tertiary: "#6A3FB5"
  neutral: "#F7F9F7"
  surface: "#FFFFFF"
  surface-page: "#E6ECE8"
  surface-map: "#EEF3EF"
  on-surface: "#2A2524"
  on-surface-muted: "#5C6660"
  on-secondary: "#FFFFFF"
  outline: "#CFDAD3"
  outline-map: "#8F9B94"
  danger: "#B3263A"
  warning: "#E8B923"
  warning-surface: "#FFF8DC"
typography:
  display:
    fontFamily: Bodoni Moda
    fontSize: 28px
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: 0.04em
  headline:
    fontFamily: Bodoni Moda
    fontSize: 20px
    fontWeight: 700
    lineHeight: 1.1
  question:
    fontFamily: Bodoni Moda
    fontSize: 22px
    fontWeight: 500
    lineHeight: 1.1
  ticket:
    fontFamily: Bodoni Moda
    fontSize: 40px
    fontWeight: 700
    letterSpacing: 0.12em
  body:
    fontFamily: Figtree
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: Figtree
    fontSize: 16px
    fontWeight: 600
    lineHeight: 1.45
  action:
    fontFamily: Figtree
    fontSize: 18px
    fontWeight: 600
    lineHeight: 1.45
  caption:
    fontFamily: Figtree
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.45
rounded:
  none: 0px
  sm: 6px
  md: 8px
  lg: 12px
  bubble-tail: 2px
  full: 999px
spacing:
  xs: 4px
  sm: 8px
  md: 12px
  base: 16px
  lg: 20px
  xl: 28px
  screen-max: 420px
components:
  screen:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.on-surface}"
    typography: "{typography.body}"
    padding: 20px 16px 32px
    width: 420px
  button-primary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.primary}"
    typography: "{typography.action}"
    rounded: "{rounded.sm}"
    padding: 14px 16px
  button-action:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.on-secondary}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    padding: 10px 16px
  button-action-large:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.on-secondary}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    padding: 14px
  button-quit:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.danger}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    padding: 8px 14px
  button-icon:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.primary}"
    rounded: "{rounded.md}"
    size: 40px
  option-pill:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.full}"
    padding: 10px 20px
  option-pill-hover:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.on-secondary}"
  input-field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.sm}"
    padding: 12px 14px
  input-search:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.full}"
    padding: 10px 14px
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.sm}"
    padding: 12px
  chat-bubble-ai:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.lg}"
    padding: 10px 14px
  chat-bubble-user:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.lg}"
    padding: 10px 14px
  notice-warning:
    backgroundColor: "{colors.warning-surface}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.none}"
    padding: 10px 14px
  ticket-code:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.primary}"
    typography: "{typography.ticket}"
    rounded: "{rounded.none}"
    padding: 6px 14px
---

# BR Vital

## Visão geral

O BR Vital ajuda pessoas em situação de urgência a decidir para onde ir e a
reduzir a espera: atendimento por IA, triagem rápida, mapa de hospitais e
senha de fila. A interface deve transmitir **calma, clareza e confiança**, e
não a frieza clínica típica de apps de saúde.

A personalidade vem do contraste entre dois mundos: títulos **serifados
(Bodoni Moda) em vinho** dão um tom editorial e humano; o corpo em **Figtree**
mantém a leitura simples e rápida. O verde-saúde marca tudo o que é
progresso ou ação positiva, enquanto vermelho e âmbar ficam reservados a
risco e atenção.

Princípios:

- **Mobile-first**: uma única coluna de no máximo 420px, centralizada sobre um
  fundo cinza-esverdeado mesmo no desktop.
- **Contorno antes de sombra**: hierarquia por bordas vinho de 2px, não por
  elevação.
- **Uma ação dominante por tela**: botão verde em pílula para a ação
  principal; vinho e branco para navegação e opções.
- **Acessível em estresse**: alvos grandes (≥40px), contraste alto, foco
  visível e movimento respeitando `prefers-reduced-motion`.

## Cores

A paleta é curta e semântica; cada cor tem um papel único.

- **Primária – Vinho (`#5A1E16`)**: títulos, bordas de componentes, rótulos de
  campos, botões de navegação e a senha. É a cor de marca e de estrutura.
- **Secundária – Verde-saúde (`#45B08C`)**: ação principal (botões "Enviar",
  "Ver", "Salvar"), foco, hospital recomendado, localização do usuário
  ("Você") e borda de resultado de baixo risco. Texto sobre ele é branco.
- **Terciária – Lilás (`#6A3FB5`)**: exclusivo da identidade da IA (ícone ✦
  do atendimento "Mega Brain VitalIA").
- **Neutra – Névoa (`#F7F9F7`)**: fundo das telas. O fundo da página fora da
  coluna é `#E6ECE8`; as quadras do mapa usam `#EEF3EF`.
- **Texto (`#2A2524`)** para conteúdo; **cinza (`#5C6660`)** para apoio, passos
  e saudação.
- **Linha (`#CFDAD3`)** para divisores finos de listas; `#8F9B94` para o traço
  das quadras do mapa.
- **Perigo – Rubi (`#B3263A`)**: pins de hospitais, mensagens de erro, risco
  alto e "Desistir desta senha".
- **Atenção – Raio (`#E8B923`)**: ícone ⚡ da triagem, risco moderado e borda
  de avisos, sobre fundo `#FFF8DC`.

Semáforo de risco no resultado da triagem: verde (baixo) → âmbar (moderado) →
rubi (alto), aplicado na borda esquerda de 4px.

## Tipografia

- **Bodoni Moda** (500/700): `h1` 28px com tracking 0.04em, `h2` 20px,
  pergunta da triagem 22px e a **senha** em 40px com tracking 0.12em. Sempre
  em vinho. Fallback: Georgia, serif.
- **Figtree** (400/600): todo o restante. Corpo 16px / 1.45; rótulos, botões
  e destaques em 600; botões principais em 18px. Fallback: system-ui.
- Legendas e textos de mapa ficam entre 11 e 13px, em cinza ou cor de texto.

Use serifa apenas para títulos, perguntas e a senha; nunca em texto corrido
ou botões de ação.

## Layout

- Coluna única de **420px máx.**, padding `20px 16px 32px`.
- Escala de espaçamento: 4 · 8 · 12 · 16 · 20 · 28px. Blocos empilhados
  separados por 12–16px; seções por 24–28px.
- Cabeçalho (`topo`): voltar/logo (36–40px) + título flexível + botão de menu,
  com 24px de respiro abaixo.
- Navegação por telas (`perfil`, `home`, `chat`, `triagem`, `mapa`, `senha`),
  uma visível por vez, com entrada suave (fade + 6px de deslize, 180ms).

## Elevação e profundidade

O sistema é **plano**: não usa sombras. Profundidade vem de:

1. contorno vinho de 2px em superfícies brancas sobre o fundo névoa;
2. divisores de 1px em `#CFDAD3` em listas;
3. no chat, o mascote em marca d'água (opacidade 0.22) atrás das bolhas.

Estados de foco usam `outline: 3px solid #45B08C` com offset de 2px.

## Formas

Três famílias de cantos, escolhidas pelo papel do elemento:

- **Pílula (999px)**: ações, opções de triagem, campo de busca e de chat.
  Significa "toque aqui".
- **Quase reto (6–8px)**: cartões, botões principais, campos de formulário e
  botões de ícone. Significa "container".
- **Reto (0)**: pergunta da triagem, senha, fila, rota e avisos — peças com
  aspecto de documento/ticket.
- **Bolhas de chat**: 12px com um canto de 2px na origem da fala (inferior
  esquerdo para a IA, inferior direito para o usuário).

## Componentes

- **Botão principal (`.principal`)**: branco, borda vinho 2px, ícone + texto
  18px/600 vinho, largura total. Ícones: ✦ lilás (IA), ⚡ âmbar (triagem).
- **Botão de ação (`.acao`)**: pílula verde, texto branco 600. Variante
  `.larga` ocupa 100% com padding 14px. Desabilitado a 60% de opacidade.
- **Desistir (`.desistir`)**: pílula branca com borda e texto rubi.
- **Botão de ícone (`.menu`, `.voltar`)**: 40×40px, borda vinho 2px, raio 8px.
- **Opção de triagem**: pílula branca com borda vinho; no hover/foco vira
  verde com texto branco.
- **Campos**: rótulo em vinho 600 acima; input/select brancos, borda vinho 2px,
  raio 6px. Busca e chat em pílula (borda 1.5–2px).
- **Cartão do mapa**: branco, borda vinho 2px, raio 6px, título 18px.
  Quadras `#EEF3EF` com traço `#8F9B94`; pins rubi (vinho no hover); "Você"
  em verde com anel.
- **Lista de hospitais**: itens separados por 1px `#CFDAD3`; nome em vinho
  forte, detalhe em cinza, "indicado" em verde 600, ação "Ver" à direita.
- **Bolhas de chat**: brancas com borda 2px; IA em vinho à esquerda, usuário
  em verde à direita; largura máx. 78%.
- **Resultado de triagem**: borda esquerda 4px (verde / âmbar / rubi) e
  recuo de 14px.
- **Aviso**: borda âmbar 2px, fundo `#FFF8DC`, destaque em vinho.
- **Senha e fila**: caixas retas brancas com borda vinho; código em Bodoni
  40px, fila com número em 22px.
- **Rota**: caixa reta branca com traço vinho de 3px e junções arredondadas.

## Do e Don't

**Faça**

- Use vinho para estrutura e títulos, verde para ação e rubi só para risco.
- Mantenha bordas de 2px e superfícies brancas sobre o fundo névoa.
- Garanta um único botão verde em destaque por tela.
- Preserve o foco visível e alvos de toque >= 40px.

**Não faça**

- Não adicione sombras, gradientes ou novas cores sem papel semântico.
- Não use lilás fora da identidade da IA, nem âmbar/rubi como decoração.
- Não use Bodoni Moda em texto corrido ou em botões.
- Não ultrapasse 420px de largura nem crie layouts multi-coluna.
- Não use texto branco sobre âmbar (contraste insuficiente); prefira
  `#2A2524`.
