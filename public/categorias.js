const formCategoria = document.querySelector("#formCategoria");
const listaCategorias = document.querySelector("#listaCategorias");
const mensagemCategoria = document.querySelector("#mensagemCategoria");

async function buscarJson(url, opcoes) {
  const resposta = await fetch(url, opcoes);
  const dados = await resposta.json();

  if (!resposta.ok) {
    throw new Error(dados.erro || "Falha ao processar");
  }

  return dados;
}

function mostrarMensagem(texto, tipo = "") {
  mensagemCategoria.textContent = texto;
  mensagemCategoria.dataset.tipo = tipo;
}

function renderizarCategorias(categorias) {
  if (categorias.length === 0) {
    listaCategorias.innerHTML = '<p class="field-hint">Nenhuma categoria cadastrada.</p>';
    return;
  }

  listaCategorias.innerHTML = categorias.map((categoria) => `
    <div class="category-row">
      <strong>${categoria.codigo}</strong>
      <span>${categoria.descricao}</span>
    </div>
  `).join("");
}

async function carregarCategorias() {
  const categorias = await buscarJson("api/categorias");
  renderizarCategorias(categorias);
}

formCategoria.addEventListener("submit", async (event) => {
  event.preventDefault();
  mostrarMensagem("Salvando categoria...");

  try {
    const dados = new FormData(formCategoria);
    await buscarJson("api/categorias", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        descricao: dados.get("descricao"),
      }),
    });

    formCategoria.reset();
    mostrarMensagem("Categoria salva com sucesso.", "sucesso");
    await carregarCategorias();
  } catch (err) {
    mostrarMensagem(err.message, "erro");
  }
});

carregarCategorias().catch((err) => mostrarMensagem(err.message, "erro"));
