const formUsuario = document.querySelector("#formUsuario");
const listaUsuarios = document.querySelector("#listaUsuarios");
const mensagemUsuario = document.querySelector("#mensagemUsuario");
const tituloFormulario = document.querySelector("#tituloFormulario");
const btnNovo = document.querySelector("#btnNovo");

let usuarios = [];

async function buscarJson(url, opcoes) {
  const resposta = await fetch(url, opcoes);
  const dados = await resposta.json().catch(() => ({}));

  if (!resposta.ok) {
    throw new Error(dados.erro || "Falha ao processar");
  }

  return dados;
}

function mostrarMensagem(texto, tipo = "") {
  mensagemUsuario.textContent = texto;
  mensagemUsuario.dataset.tipo = tipo;
}

function escapar(valor) {
  return String(valor ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function limparFormulario() {
  formUsuario.reset();
  formUsuario.codigoOriginal.value = "";
  formUsuario.perfil.value = "0";
  tituloFormulario.textContent = "Novo usuario";
  mostrarMensagem("");
}

function editarUsuario(codigo) {
  const usuario = usuarios.find((item) => item.codigo === codigo);
  if (!usuario) return;

  formUsuario.codigoOriginal.value = usuario.codigo;
  formUsuario.codigo.value = usuario.codigo;
  formUsuario.nome.value = usuario.nome || "";
  formUsuario.senha.value = "";
  formUsuario.perfil.value = usuario.perfil ?? 0;
  tituloFormulario.textContent = `Editar ${usuario.codigo}`;
  mostrarMensagem("Senha atual protegida. Preencha apenas se quiser trocar.", "sucesso");
  formUsuario.nome.focus();
}

function renderizarUsuarios() {
  if (usuarios.length === 0) {
    listaUsuarios.innerHTML = '<p class="field-hint">Nenhum usuario cadastrado.</p>';
    return;
  }

  listaUsuarios.innerHTML = usuarios.map((usuario) => `
    <div class="category-row user-row">
      <strong>${escapar(usuario.codigo)}</strong>
      <span>${escapar(usuario.nome || "")}</span>
      <span>********</span>
      <span>Perfil ${escapar(usuario.perfil ?? 0)}</span>
      <div class="user-actions">
        <button type="button" class="secondary-button" data-editar="${escapar(usuario.codigo)}">Editar</button>
        <button type="button" class="icon-button" data-excluir="${escapar(usuario.codigo)}">Excluir</button>
      </div>
    </div>
  `).join("");

  listaUsuarios.querySelectorAll("[data-editar]").forEach((botao) => {
    botao.addEventListener("click", () => editarUsuario(botao.dataset.editar));
  });

  listaUsuarios.querySelectorAll("[data-excluir]").forEach((botao) => {
    botao.addEventListener("click", async () => {
      const codigo = botao.dataset.excluir;
      if (!confirm(`Excluir o usuario ${codigo}?`)) return;

      try {
        await buscarJson(`api/usuarios?codigo=${encodeURIComponent(codigo)}`, { method: "DELETE" });
        mostrarMensagem("Usuario excluido com sucesso.", "sucesso");
        if (formUsuario.codigoOriginal.value === codigo) limparFormulario();
        await carregarUsuarios();
      } catch (err) {
        mostrarMensagem(err.message, "erro");
      }
    });
  });
}

async function carregarUsuarios() {
  usuarios = await buscarJson("api/usuarios");
  renderizarUsuarios();
}

formUsuario.addEventListener("submit", async (event) => {
  event.preventDefault();
  mostrarMensagem("Salvando usuario...");

  try {
    const dados = new FormData(formUsuario);
    await buscarJson("api/usuarios", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        codigoOriginal: dados.get("codigoOriginal"),
        codigo: dados.get("codigo"),
        nome: dados.get("nome"),
        senha: dados.get("senha"),
        perfil: dados.get("perfil"),
      }),
    });

    limparFormulario();
    mostrarMensagem("Usuario salvo com sucesso.", "sucesso");
    await carregarUsuarios();
  } catch (err) {
    mostrarMensagem(err.message, "erro");
  }
});

btnNovo.addEventListener("click", limparFormulario);

carregarUsuarios().catch((err) => mostrarMensagem(err.message, "erro"));
