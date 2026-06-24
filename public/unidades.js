const formUnidade = document.querySelector("#formUnidade");
const listaUnidades = document.querySelector("#listaUnidades");
const mensagemUnidade = document.querySelector("#mensagemUnidade");

async function buscarJson(url, opcoes) {
  const resposta = await fetch(url, opcoes);
  const dados = await resposta.json();

  if (!resposta.ok) {
    throw new Error(dados.erro || "Falha ao processar");
  }

  return dados;
}

function mostrarMensagem(texto, tipo = "") {
  mensagemUnidade.textContent = texto;
  mensagemUnidade.dataset.tipo = tipo;
}

function renderizarUnidades(unidades) {
  if (unidades.length === 0) {
    listaUnidades.innerHTML = '<p class="field-hint">Nenhuma unidade cadastrada.</p>';
    return;
  }

  listaUnidades.innerHTML = unidades.map((unidade) => `
    <div class="category-row unit-row">
      <strong>${unidade.unidade}</strong>
    </div>
  `).join("");
}

async function carregarUnidades() {
  const unidades = await buscarJson("api/unidades");
  renderizarUnidades(unidades);
}

formUnidade.addEventListener("submit", async (event) => {
  event.preventDefault();
  mostrarMensagem("Salvando unidade...");

  try {
    const dados = new FormData(formUnidade);
    await buscarJson("api/unidades", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        unidade: dados.get("unidade"),
      }),
    });

    formUnidade.reset();
    mostrarMensagem("Unidade salva com sucesso.", "sucesso");
    await carregarUnidades();
  } catch (err) {
    mostrarMensagem(err.message, "erro");
  }
});

carregarUnidades().catch((err) => mostrarMensagem(err.message, "erro"));
