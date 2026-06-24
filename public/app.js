const estado = {
  receitas: [],
  categorias: [],
  selecionada: "",
  autenticado: false,
  imagemVersao: Date.now(),
};

const els = {
  formFiltros: document.querySelector("#formFiltros"),
  busca: document.querySelector("#busca"),
  ingrediente: document.querySelector("#ingrediente"),
  categoria: document.querySelector("#categoria"),
  lista: document.querySelector("#listaReceitas"),
  detalhe: document.querySelector("#detalheReceita"),
  statusLista: document.querySelector("#statusLista"),
  totalReceitas: document.querySelector("#totalReceitas"),
  btnLimpar: document.querySelector("#btnLimpar"),
  menuConta: document.querySelector("#menuConta"),
  btnConta: document.querySelector("#btnConta"),
  painelConta: document.querySelector("#painelConta"),
  btnLogin: document.querySelector("#btnLogin"),
  btnLogout: document.querySelector("#btnLogout"),
  loginModal: document.querySelector("#loginModal"),
  formLogin: document.querySelector("#formLogin"),
  btnFecharLogin: document.querySelector("#btnFecharLogin"),
  mensagemLogin: document.querySelector("#mensagemLogin"),
  authOnly: document.querySelectorAll(".auth-only"),
};

function escaparHtml(valor) {
  return String(valor ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#039;");
}

function formatarNumero(valor) {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return "";

  return new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: 2,
  }).format(numero);
}

function formatarQuantidade(ingrediente) {
  const quantidade = formatarNumero(ingrediente.quantidade);
  const unidade = ingrediente.unidade || "";
  return [quantidade, unidade].filter(Boolean).join(" ");
}

function formatarQuantidadeEscalada(ingrediente, fator) {
  return formatarNumero(Number(ingrediente.quantidade || 0) * fator);
}

function imagemUrl(nome) {
  return `api/receitas/imagem?nome=${encodeURIComponent(nome)}&v=${estado.imagemVersao}`;
}

async function buscarJson(url) {
  const resposta = await fetch(url);
  const dados = await resposta.json();

  if (!resposta.ok) {
    throw new Error(dados.erro || "Falha ao carregar dados");
  }

  return dados;
}

async function enviarJson(url, payload) {
  const resposta = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload || {}),
  });
  const dados = await resposta.json();

  if (!resposta.ok) {
    throw new Error(dados.erro || "Falha ao processar");
  }

  return dados;
}

function arquivoParaBase64(arquivo) {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onload = () => resolve(String(leitor.result || ""));
    leitor.onerror = () => reject(new Error("Nao foi possivel ler a imagem"));
    leitor.readAsDataURL(arquivo);
  });
}

function aplicarEstadoAutenticacao(autenticado) {
  estado.autenticado = autenticado;
  els.authOnly.forEach((item) => {
    item.hidden = !autenticado;
  });
  els.btnLogin.hidden = autenticado;
  els.btnConta.textContent = autenticado ? "Cadastros" : "Login";
}

function abrirMenuConta() {
  els.painelConta.hidden = false;
  els.btnConta.setAttribute("aria-expanded", "true");
}

function fecharMenuConta() {
  els.painelConta.hidden = true;
  els.btnConta.setAttribute("aria-expanded", "false");
}

function alternarMenuConta() {
  if (els.painelConta.hidden) {
    abrirMenuConta();
    return;
  }

  fecharMenuConta();
}

function abrirLogin() {
  fecharMenuConta();
  els.mensagemLogin.textContent = "";
  els.mensagemLogin.dataset.tipo = "";
  els.formLogin.reset();
  els.loginModal.hidden = false;
  els.formLogin.usuario.focus();
}

function fecharLogin() {
  els.loginModal.hidden = true;
}

async function carregarAutenticacao() {
  const auth = await buscarJson("api/auth/status");
  aplicarEstadoAutenticacao(Boolean(auth.autenticado));
}

function renderizarLista() {
  if (estado.receitas.length === 0) {
    els.lista.innerHTML = '<div class="loading">Nenhuma receita encontrada.</div>';
    els.statusLista.textContent = "0 receitas";
    return;
  }

  els.statusLista.textContent = `${estado.receitas.length} receita${estado.receitas.length === 1 ? "" : "s"}`;
  els.lista.innerHTML = estado.receitas.map((receita) => {
    const ativa = receita.nome === estado.selecionada ? " active" : "";
    const src = receita.temImagem ? imagemUrl(receita.nome) : "";
    const img = src
      ? `<img class="thumb" src="${src}" alt="">`
      : '<div class="thumb" aria-hidden="true"></div>';

    return `
      <button class="recipe-card${ativa}" type="button" data-nome="${escaparHtml(receita.nome)}">
        ${img}
        <span>
          <span class="card-title">${escaparHtml(receita.nome)}</span>
          <span class="card-meta">
            <span class="tag">${escaparHtml(receita.categoria)}</span>
            <span>${escaparHtml(receita.pessoas)} pessoas</span>
            <span>${escaparHtml(receita.calorias)} kcal</span>
          </span>
        </span>
      </button>
    `;
  }).join("");
}

function renderizarDetalhe(receita) {
  estado.selecionada = receita.nome;
  renderizarLista();

  const ingredientes = receita.ingredientes.map((ingrediente) => `
    <li>
      <span class="amount">${escaparHtml(formatarQuantidade(ingrediente))}</span>
      <span>${escaparHtml(ingrediente.nome)}</span>
    </li>
  `).join("");

  els.detalhe.innerHTML = `
    <section class="detail-hero">
      <div class="recipe-photo-block">
        <div class="recipe-photo-frame">
          <img class="hero-image" src="${imagemUrl(receita.nome)}" alt="">
          ${estado.autenticado ? `
            <button type="button" class="secondary-button image-search-button">Foto</button>
          ` : ""}
        </div>
        ${estado.autenticado ? `
          <div class="image-search-dialog" hidden>
            <div class="image-search-panel">
              <div class="section-title-row">
                <h3>Fotos para ${escaparHtml(receita.nome)}</h3>
                <button type="button" class="icon-button image-search-close">Fechar</button>
              </div>
              <p class="image-search-status" aria-live="polite"></p>
              <div class="local-image-upload">
                <label class="secondary-button local-image-label">
                  Escolher foto do computador
                  <input class="local-image-input" type="file" accept="image/jpeg,image/png,image/webp">
                </label>
              </div>
              <div class="image-search-results"></div>
            </div>
          </div>
        ` : ""}
      </div>
      <div class="hero-copy">
        <p class="category-line">${escaparHtml(receita.categoria)}</p>
        <div class="recipe-title-row">
          <h2>${escaparHtml(receita.nome)}</h2>
          <button type="button" class="icon-button recipe-print" aria-label="Imprimir receita" title="Imprimir receita">
            <svg class="printer-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M7 8V3h10v5"></path>
              <path d="M7 17H5a3 3 0 0 1-3-3v-3a3 3 0 0 1 3-3h14a3 3 0 0 1 3 3v3a3 3 0 0 1-3 3h-2"></path>
              <path d="M7 14h10v7H7z"></path>
              <path d="M17 11h.01"></path>
            </svg>
          </button>
        </div>
        <div class="stats" aria-label="Resumo nutricional">
          <div class="stat"><strong>${escaparHtml(receita.pessoas)}</strong><span>Pessoas</span></div>
          <div class="stat"><strong>${escaparHtml(receita.peso)} g</strong><span>Peso total</span></div>
          <div class="stat"><strong>${escaparHtml(receita.calorias)}</strong><span>Calorias</span></div>
          <div class="stat"><strong>${escaparHtml(receita.proteinas)} g</strong><span>Proteinas</span></div>
          <div class="stat"><strong>${escaparHtml(receita.carboidratos)} g</strong><span>Carboidratos</span></div>
          <div class="stat"><strong>${escaparHtml(receita.gorduras)} g</strong><span>Gorduras</span></div>
        </div>
      </div>
    </section>
    <section class="detail-content">
      <div class="section-block">
        <h3>Ingredientes</h3>
        <ul class="ingredients">${ingredientes || "<li>Sem ingredientes cadastrados.</li>"}</ul>
        <div class="shopping-box" data-receita="${escaparHtml(receita.nome)}">
          <h3>Lista de compras</h3>
          <div class="shopping-controls">
            <label>
              Pessoas
              <input class="shopping-people" type="number" min="1" step="1" value="${escaparHtml(receita.pessoas || 1)}">
            </label>
            <button type="button" class="icon-button shopping-print" aria-label="Imprimir lista de compras" title="Imprimir lista de compras">
              <svg class="printer-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M7 8V3h10v5"></path>
                <path d="M7 17H5a3 3 0 0 1-3-3v-3a3 3 0 0 1 3-3h14a3 3 0 0 1 3 3v3a3 3 0 0 1-3 3h-2"></path>
                <path d="M7 14h10v7H7z"></path>
                <path d="M17 11h.01"></path>
              </svg>
            </button>
          </div>
        </div>
      </div>
      <div class="section-block">
        <h3>Preparo</h3>
        <p class="instructions">${escaparHtml(receita.instrucoes)}</p>
      </div>
    </section>
  `;
  configurarImpressaoReceita(receita);
  configurarListaCompras(receita);
  configurarPesquisaImagem(receita);
  els.detalhe.focus({ preventScroll: true });
}

function renderizarResultadosImagem(receita, imagens) {
  const resultados = els.detalhe.querySelector(".image-search-results");

  if (!resultados) return;

  if (imagens.length === 0) {
    resultados.innerHTML = '<p class="field-hint">Nenhuma imagem encontrada.</p>';
    return;
  }

  resultados.innerHTML = imagens.map((imagem) => `
    <button type="button" class="image-choice" data-url="${escaparHtml(imagem.url)}" data-alternativa="${escaparHtml(imagem.thumbnailUrl || "")}" title="${escaparHtml(imagem.titulo || imagem.fonte || "Usar esta foto")}">
      <img src="${escaparHtml(imagem.thumbnailUrl || imagem.url)}" alt="">
    </button>
  `).join("");

  resultados.querySelectorAll(".image-choice").forEach((botao) => {
    botao.addEventListener("click", async () => {
      const status = els.detalhe.querySelector(".image-search-status");
      status.textContent = "Salvando foto...";

      try {
        await enviarJson("api/receitas/imagem", {
          nome: receita.nome,
          urlImagem: botao.dataset.url,
          urlAlternativa: botao.dataset.alternativa,
        });
        estado.imagemVersao = Date.now();
        receita.temImagem = true;
        const imagemPrincipal = els.detalhe.querySelector(".hero-image");
        imagemPrincipal.src = imagemUrl(receita.nome);
        estado.receitas = estado.receitas.map((item) => (
          item.nome === receita.nome ? { ...item, temImagem: true } : item
        ));
        renderizarLista();
        status.textContent = "Foto gravada com sucesso.";
        window.setTimeout(() => fecharPesquisaImagem(), 700);
      } catch (err) {
        status.textContent = err.message;
      }
    });
  });
}

async function salvarImagemLocal(receita, arquivo) {
  const status = els.detalhe.querySelector(".image-search-status");
  const tiposPermitidos = ["image/jpeg", "image/png", "image/webp"];

  if (!arquivo) return;

  if (!tiposPermitidos.includes(arquivo.type)) {
    status.textContent = "Selecione uma imagem JPG, PNG ou WEBP.";
    return;
  }

  if (arquivo.size > 8 * 1024 * 1024) {
    status.textContent = "A imagem deve ter no maximo 8 MB.";
    return;
  }

  status.textContent = "Gravando foto local...";

  try {
    const base64 = await arquivoParaBase64(arquivo);
    await enviarJson("api/receitas/imagem/local", {
      nome: receita.nome,
      imagem: {
        base64,
        mimeType: arquivo.type,
      },
    });
    estado.imagemVersao = Date.now();
    receita.temImagem = true;
    const imagemPrincipal = els.detalhe.querySelector(".hero-image");
    imagemPrincipal.src = imagemUrl(receita.nome);
    estado.receitas = estado.receitas.map((item) => (
      item.nome === receita.nome ? { ...item, temImagem: true } : item
    ));
    renderizarLista();
    status.textContent = "Foto local gravada com sucesso.";
    window.setTimeout(() => fecharPesquisaImagem(), 700);
  } catch (err) {
    status.textContent = err.message;
  }
}

function abrirPesquisaImagem() {
  const dialog = els.detalhe.querySelector(".image-search-dialog");
  if (dialog) {
    dialog.hidden = false;
  }
}

function fecharPesquisaImagem() {
  const dialog = els.detalhe.querySelector(".image-search-dialog");
  if (dialog) {
    dialog.hidden = true;
  }
}

function configurarPesquisaImagem(receita) {
  const botao = els.detalhe.querySelector(".image-search-button");
  if (!botao) return;

  const fechar = els.detalhe.querySelector(".image-search-close");
  const dialog = els.detalhe.querySelector(".image-search-dialog");
  const inputLocal = els.detalhe.querySelector(".local-image-input");

  fechar.addEventListener("click", fecharPesquisaImagem);
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      fecharPesquisaImagem();
    }
  });
  inputLocal.addEventListener("change", () => {
    salvarImagemLocal(receita, inputLocal.files[0]).finally(() => {
      inputLocal.value = "";
    });
  });

  botao.addEventListener("click", async () => {
    abrirPesquisaImagem();
    const status = els.detalhe.querySelector(".image-search-status");
    const resultados = els.detalhe.querySelector(".image-search-results");
    status.textContent = "Pesquisando fotos...";
    resultados.innerHTML = "";

    try {
      const imagens = await buscarJson(`api/internet/imagens?receita=${encodeURIComponent(receita.nome)}`);
      status.textContent = `${imagens.length} foto${imagens.length === 1 ? "" : "s"} encontrada${imagens.length === 1 ? "" : "s"}.`;
      renderizarResultadosImagem(receita, imagens);
    } catch (err) {
      status.textContent = err.message;
    }
  });
}

function imprimirReceita(receita) {
  const janela = window.open("", "_blank", "width=820,height=900");

  if (!janela) return;

  const imagem = receita.temImagem
    ? `<img class="recipe-image" src="${imagemUrl(receita.nome)}" alt="">`
    : "";
  const ingredientes = receita.ingredientes.map((ingrediente) => `
    <li>
      <strong>${escaparHtml(formatarQuantidade(ingrediente))}</strong>
      <span>${escaparHtml(ingrediente.nome)}</span>
    </li>
  `).join("");

  janela.document.write(`
    <!doctype html>
    <html lang="pt-BR">
      <head>
        <meta charset="utf-8">
        <title>Receita - ${escaparHtml(receita.nome)}</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 32px; color: #222; line-height: 1.45; }
          h1 { margin: 0 0 6px; font-size: 30px; }
          h2 { margin: 26px 0 12px; font-size: 18px; }
          p { margin: 0; }
          .category { margin-bottom: 20px; color: #666; }
          .recipe-image { width: 100%; max-height: 280px; margin: 0 0 22px; border-radius: 8px; object-fit: cover; }
          .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 18px 0 22px; }
          .stat { border: 1px solid #ddd; padding: 10px; }
          .stat strong { display: block; font-size: 17px; }
          .stat span { color: #666; font-size: 12px; }
          ul { list-style: none; padding: 0; margin: 0; }
          li { display: grid; grid-template-columns: 120px 1fr; gap: 14px; padding: 8px 0; border-bottom: 1px solid #ddd; }
          .instructions { white-space: pre-line; }
          @media print { body { margin: 18mm; } }
        </style>
      </head>
      <body>
        <h1>${escaparHtml(receita.nome)}</h1>
        <p class="category">${escaparHtml(receita.categoria)}</p>
        ${imagem}
        <div class="stats">
          <div class="stat"><strong>${escaparHtml(receita.pessoas)}</strong><span>Pessoas</span></div>
          <div class="stat"><strong>${escaparHtml(receita.peso)} g</strong><span>Peso total</span></div>
          <div class="stat"><strong>${escaparHtml(receita.calorias)}</strong><span>Calorias</span></div>
          <div class="stat"><strong>${escaparHtml(receita.proteinas)} g</strong><span>Proteinas</span></div>
          <div class="stat"><strong>${escaparHtml(receita.carboidratos)} g</strong><span>Carboidratos</span></div>
          <div class="stat"><strong>${escaparHtml(receita.gorduras)} g</strong><span>Gorduras</span></div>
        </div>
        <h2>Ingredientes</h2>
        <ul>${ingredientes || "<li>Sem ingredientes cadastrados.</li>"}</ul>
        <h2>Preparo</h2>
        <p class="instructions">${escaparHtml(receita.instrucoes)}</p>
      </body>
    </html>
  `);
  janela.document.close();
  janela.focus();

  const imagemImpressao = janela.document.querySelector(".recipe-image");
  if (imagemImpressao && !imagemImpressao.complete) {
    imagemImpressao.addEventListener("load", () => janela.print(), { once: true });
    imagemImpressao.addEventListener("error", () => janela.print(), { once: true });
    return;
  }

  janela.print();
}

function configurarImpressaoReceita(receita) {
  const botao = els.detalhe.querySelector(".recipe-print");

  botao.addEventListener("click", () => imprimirReceita(receita));
}

function calcularListaCompras(receita, pessoasDesejadas) {
  const pessoasBase = Number(receita.pessoas || 1) || 1;
  const fator = Math.max(Number(pessoasDesejadas || pessoasBase), 1) / pessoasBase;

  return receita.ingredientes.map((ingrediente) => ({
    nome: ingrediente.nome,
    unidade: ingrediente.unidade || "",
    quantidade: formatarQuantidadeEscalada(ingrediente, fator),
  }));
}

function imprimirListaCompras(receita, pessoasDesejadas) {
  const itens = calcularListaCompras(receita, pessoasDesejadas);
  const janela = window.open("", "_blank", "width=720,height=900");

  if (!janela) return;

  janela.document.write(`
    <!doctype html>
    <html lang="pt-BR">
      <head>
        <meta charset="utf-8">
        <title>Lista de compras - ${escaparHtml(receita.nome)}</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 32px; color: #222; }
          h1 { margin: 0 0 6px; font-size: 28px; }
          p { margin: 0 0 24px; color: #666; }
          ul { list-style: none; padding: 0; margin: 0; }
          li { display: flex; justify-content: space-between; gap: 24px; padding: 10px 0; border-bottom: 1px solid #ddd; }
          strong { white-space: nowrap; }
          @media print { body { margin: 18mm; } }
        </style>
      </head>
      <body>
        <h1>${escaparHtml(receita.nome)}</h1>
        <p>Lista de compras para ${escaparHtml(pessoasDesejadas)} pessoa${Number(pessoasDesejadas) === 1 ? "" : "s"}</p>
        <ul>
          ${itens.map((item) => `
            <li>
              <span>${escaparHtml(item.nome)}</span>
              <strong>${escaparHtml([item.quantidade, item.unidade].filter(Boolean).join(" "))}</strong>
            </li>
          `).join("")}
        </ul>
      </body>
    </html>
  `);
  janela.document.close();
  janela.focus();
  janela.print();
}

function configurarListaCompras(receita) {
  const input = els.detalhe.querySelector(".shopping-people");
  const botao = els.detalhe.querySelector(".shopping-print");

  botao.addEventListener("click", () => imprimirListaCompras(receita, input.value));
}

function renderizarErro(mensagem) {
  els.detalhe.innerHTML = `
    <section class="error-state">
      <h2>Nao foi possivel carregar</h2>
      <p>${escaparHtml(mensagem)}</p>
    </section>
  `;
}

async function carregarCategorias() {
  estado.categorias = await buscarJson("api/categorias");
  els.categoria.innerHTML = '<option value="">Todas</option>' + estado.categorias.map((categoria) => `
    <option value="${escaparHtml(categoria.codigo)}">${escaparHtml(categoria.descricao)}</option>
  `).join("");
}

async function carregarReceitas(selecionarPrimeira = false) {
  const params = new URLSearchParams();
  const busca = els.busca.value.trim();
  const ingrediente = els.ingrediente.value.trim();
  const categoria = els.categoria.value;

  if (busca) params.set("busca", busca);
  if (ingrediente) params.set("ingrediente", ingrediente);
  if (categoria) params.set("categoria", categoria);

  els.statusLista.textContent = "Carregando";
  els.lista.innerHTML = '<div class="loading">Buscando receitas...</div>';

  estado.receitas = await buscarJson(`api/receitas?${params.toString()}`);
  els.totalReceitas.textContent = `${estado.receitas.length} receita${estado.receitas.length === 1 ? "" : "s"} na lista`;
  renderizarLista();

  if (selecionarPrimeira && estado.receitas[0]) {
    await carregarDetalhe(estado.receitas[0].nome);
  }
}

async function carregarDetalhe(nome) {
  els.detalhe.innerHTML = '<section class="loading">Carregando receita...</section>';
  els.detalhe.scrollTo({ top: 0 });

  try {
    const receita = await buscarJson(`api/receitas/detalhe?nome=${encodeURIComponent(nome)}`);
    renderizarDetalhe(receita);
    els.detalhe.scrollTo({ top: 0 });
  } catch (err) {
    renderizarErro(err.message);
  }
}

els.formFiltros.addEventListener("submit", (event) => {
  event.preventDefault();
  estado.selecionada = "";
  carregarReceitas(true).catch((err) => renderizarErro(err.message));
});

els.categoria.addEventListener("change", () => {
  estado.selecionada = "";
  carregarReceitas(true).catch((err) => renderizarErro(err.message));
});

els.btnLimpar.addEventListener("click", () => {
  els.busca.value = "";
  els.ingrediente.value = "";
  els.categoria.value = "";
  estado.selecionada = "";
  carregarReceitas(true).catch((err) => renderizarErro(err.message));
});

els.btnConta.addEventListener("click", alternarMenuConta);

els.btnLogin.addEventListener("click", abrirLogin);

els.btnFecharLogin.addEventListener("click", fecharLogin);

document.addEventListener("click", (event) => {
  if (!els.menuConta.contains(event.target)) {
    fecharMenuConta();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    fecharMenuConta();
    fecharLogin();
    fecharPesquisaImagem();
  }
});

els.loginModal.addEventListener("click", (event) => {
  if (event.target === els.loginModal) {
    fecharLogin();
  }
});

els.formLogin.addEventListener("submit", async (event) => {
  event.preventDefault();
  els.mensagemLogin.textContent = "Entrando...";
  els.mensagemLogin.dataset.tipo = "";

  try {
    const dados = new FormData(els.formLogin);
    await enviarJson("api/auth/login", {
      usuario: dados.get("usuario"),
      senha: dados.get("senha"),
    });
    aplicarEstadoAutenticacao(true);
    fecharLogin();
    if (estado.selecionada) {
      await carregarDetalhe(estado.selecionada);
    }
  } catch (err) {
    els.mensagemLogin.textContent = err.message;
    els.mensagemLogin.dataset.tipo = "erro";
  }
});

els.btnLogout.addEventListener("click", async () => {
  await enviarJson("api/auth/logout");
  aplicarEstadoAutenticacao(false);
  fecharMenuConta();
  if (estado.selecionada) {
    await carregarDetalhe(estado.selecionada);
  }
});

els.lista.addEventListener("click", (event) => {
  const card = event.target.closest(".recipe-card");
  if (!card) return;

  carregarDetalhe(card.dataset.nome).catch((err) => renderizarErro(err.message));
});

async function iniciar() {
  try {
    const params = new URLSearchParams(window.location.search);
    const buscaInicial = params.get("busca");

    if (buscaInicial) {
      els.busca.value = buscaInicial;
    }

    await carregarAutenticacao();
    await carregarCategorias();
    await carregarReceitas(true);

    if (params.get("login") === "1" && !estado.autenticado) {
      abrirLogin();
    }
  } catch (err) {
    renderizarErro(err.message);
  }
}

iniciar();
