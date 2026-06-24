const formImportar = document.querySelector("#formImportar");
const resultadosInternet = document.querySelector("#resultadosInternet");
const mensagemImportacao = document.querySelector("#mensagemImportacao");
let receitasEncontradas = [];

function escaparHtml(valor) {
  return String(valor ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#039;");
}

async function buscarJson(url, opcoes) {
  const resposta = await fetch(url, opcoes);
  const dados = await resposta.json();

  if (!resposta.ok) {
    throw new Error(dados.erro || "Falha ao processar");
  }

  return dados;
}

function mostrarMensagem(texto, tipo = "") {
  mensagemImportacao.textContent = texto;
  mensagemImportacao.dataset.tipo = tipo;
}

function renderizarResultados() {
  if (receitasEncontradas.length === 0) {
    resultadosInternet.innerHTML = '<p class="field-hint">Nenhuma receita encontrada.</p>';
    return;
  }

  resultadosInternet.innerHTML = receitasEncontradas.map((receita, indice) => `
    <article class="web-result">
      ${receita.imagemUrl ? `<img src="${escaparHtml(receita.imagemUrl)}" alt="">` : '<div class="web-result-placeholder"></div>'}
      <div>
        <h3>${escaparHtml(receita.nome)}</h3>
        <p>${escaparHtml(receita.ingredientes.length)} ingrediente${receita.ingredientes.length === 1 ? "" : "s"} encontrado${receita.ingredientes.length === 1 ? "" : "s"}</p>
        <a href="${escaparHtml(receita.fonte)}" target="_blank" rel="noopener">Ver fonte</a>
      </div>
      <button type="button" class="secondary-button" data-importar="${indice}">Importar</button>
    </article>
  `).join("");
}

formImportar.addEventListener("submit", async (event) => {
  event.preventDefault();
  mostrarMensagem("Buscando receitas na internet...");
  resultadosInternet.innerHTML = '<p class="field-hint">Pesquisando paginas com receitas estruturadas...</p>';

  try {
    const dados = new FormData(formImportar);
    const params = new URLSearchParams({
      busca: dados.get("busca") || "",
      categoria: dados.get("categoria") || "",
      ingredientes: dados.get("ingredientes") || "",
      origem: dados.get("origem") || "",
    });
    receitasEncontradas = await buscarJson(`api/internet/receitas?${params.toString()}`);
    mostrarMensagem(`${receitasEncontradas.length} receita${receitasEncontradas.length === 1 ? "" : "s"} encontrada${receitasEncontradas.length === 1 ? "" : "s"}.`, "sucesso");
    renderizarResultados();
  } catch (err) {
    mostrarMensagem(err.message, "erro");
    resultadosInternet.innerHTML = "";
  }
});

resultadosInternet.addEventListener("click", async (event) => {
  const botao = event.target.closest("[data-importar]");
  if (!botao) return;

  const indice = Number(botao.dataset.importar);
  const receita = receitasEncontradas[indice];
  const dados = new FormData(formImportar);

  botao.disabled = true;
  botao.textContent = "Importando...";
  mostrarMensagem(`Importando ${receita.nome}...`);

  try {
    await buscarJson("api/internet/importar", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...receita,
        categoria: dados.get("categoria"),
        identificacao: dados.get("origem"),
      }),
    });
    botao.textContent = "Importada";
    mostrarMensagem("Receita importada com sucesso.", "sucesso");
  } catch (err) {
    botao.disabled = false;
    botao.textContent = "Importar";
    mostrarMensagem(err.message, "erro");
  }
});
