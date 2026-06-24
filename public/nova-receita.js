const estadoCadastro = {
  categorias: [],
  unidades: [],
  ingredientes: [],
  ingredientesPorNome: new Map(),
  timersMedidas: new WeakMap(),
};

const form = document.querySelector("#formReceita");
const categoriaSelect = document.querySelector("#categoriaCodigo");
const ingredientesEditor = document.querySelector("#ingredientesEditor");
const templateIngrediente = document.querySelector("#templateIngrediente");
const listaIngredientes = document.querySelector("#listaIngredientes");
const btnAdicionarIngrediente = document.querySelector("#btnAdicionarIngrediente");
const btnNovoIngrediente = document.querySelector("#btnNovoIngrediente");
const btnFecharIngrediente = document.querySelector("#btnFecharIngrediente");
const btnSalvarIngrediente = document.querySelector("#btnSalvarIngrediente");
const cadastroIngrediente = document.querySelector("#cadastroIngrediente");
const mensagemFormulario = document.querySelector("#mensagemFormulario");
const previewImagem = document.querySelector("#previewImagem");

const novoIngrediente = {
  nome: document.querySelector("#novoIngredienteNome"),
  calorias: document.querySelector("#novoIngredienteCalorias"),
  proteinas: document.querySelector("#novoIngredienteProteinas"),
  carboidratos: document.querySelector("#novoIngredienteCarboidratos"),
  gorduras: document.querySelector("#novoIngredienteGorduras"),
  unidade: document.querySelector("#novoIngredienteUnidade"),
  peso: document.querySelector("#novoIngredientePeso"),
};

async function buscarJson(url, opcoes) {
  const resposta = await fetch(url, opcoes);
  const dados = await resposta.json();

  if (!resposta.ok) {
    throw new Error(dados.erro || "Falha ao processar");
  }

  return dados;
}

function mostrarMensagem(texto, tipo = "") {
  mensagemFormulario.textContent = texto;
  mensagemFormulario.dataset.tipo = tipo;
}

function preencherCategorias() {
  categoriaSelect.innerHTML = '<option value="">Selecione</option>' + estadoCadastro.categorias.map((categoria) => {
    return `<option value="${categoria.codigo}">${categoria.descricao}</option>`;
  }).join("");
}

function preencherUnidades(select) {
  select.innerHTML = '<option value="">Selecione</option>' + estadoCadastro.unidades.map((item) => {
    return `<option value="${item.unidade}">${item.unidade}</option>`;
  }).join("");
}

function preencherIngredientes() {
  estadoCadastro.ingredientesPorNome = new Map(
    estadoCadastro.ingredientes.map((ingrediente) => [normalizarNome(ingrediente.nome), ingrediente])
  );
  listaIngredientes.innerHTML = estadoCadastro.ingredientes.map((ingrediente) => {
    return `<option value="${ingrediente.nome}"></option>`;
  }).join("");
}

function normalizarNome(nome) {
  return String(nome || "").trim().toUpperCase();
}

async function carregarIngredientes() {
  estadoCadastro.ingredientes = await buscarJson("api/ingredientes");
  preencherIngredientes();
}

function gramasPorMedida(quantidade, pesoMedida) {
  const peso = Number(pesoMedida);
  if (!Number.isFinite(peso) || peso <= 0) return 0;
  return peso >= 1 ? quantidade : quantidade * peso * 1000;
}

function recalcularResumo() {
  const resumo = {
    peso: 0,
    calorias: 0,
    proteinas: 0,
    carboidratos: 0,
    gorduras: 0,
  };

  ingredientesEditor.querySelectorAll(".ingredient-row").forEach((linha) => {
    const nome = normalizarNome(linha.querySelector('input[name="ingredienteNome"]').value);
    const quantidade = Number(linha.querySelector('input[name="ingredienteQuantidade"]').value || 0);
    const unidade = linha.querySelector('select[name="ingredienteUnidade"]');
    const medidaPeso = Number(unidade.selectedOptions[0]?.dataset.peso || 0);
    const ingrediente = estadoCadastro.ingredientesPorNome.get(nome);

    if (!ingrediente || !quantidade || !medidaPeso) return;

    const gramas = gramasPorMedida(quantidade, medidaPeso);
    const fator = gramas / 100;

    resumo.peso += gramas;
    resumo.calorias += Number(ingrediente.calorias || 0) * fator;
    resumo.proteinas += Number(ingrediente.proteinas || 0) * fator;
    resumo.carboidratos += Number(ingrediente.carboidratos || 0) * fator;
    resumo.gorduras += Number(ingrediente.gorduras || 0) * fator;
  });

  form.peso.value = Math.round(resumo.peso);
  form.calorias.value = Math.round(resumo.calorias);
  form.proteinas.value = Math.round(resumo.proteinas);
  form.carboidratos.value = Math.round(resumo.carboidratos);
  form.gorduras.value = Math.round(resumo.gorduras);
}

async function carregarMedidas(linha) {
  const nomeInput = linha.querySelector('input[name="ingredienteNome"]');
  const unidadeSelect = linha.querySelector('select[name="ingredienteUnidade"]');
  const nome = normalizarNome(nomeInput.value);

  unidadeSelect.innerHTML = '<option value="">Selecione</option>';

  if (!nome) {
    recalcularResumo();
    return;
  }

  if (!estadoCadastro.ingredientesPorNome.has(nome)) {
    mostrarMensagem("Ingrediente ainda nao cadastrado. Use Novo ingrediente.", "erro");
    recalcularResumo();
    return;
  }

  const medidas = await buscarJson(`api/ingredientes/medidas?nome=${encodeURIComponent(nome)}`);
  unidadeSelect.innerHTML = '<option value="">Selecione</option>' + medidas.map((medida) => {
    return `<option value="${medida.unidade}" data-peso="${medida.peso}">${medida.unidade}</option>`;
  }).join("");
  if (medidas.length === 1) {
    unidadeSelect.value = medidas[0].unidade;
  }
  mostrarMensagem("");
  recalcularResumo();
}

function agendarCarregamentoMedidas(linha) {
  const timerAnterior = estadoCadastro.timersMedidas.get(linha);
  window.clearTimeout(timerAnterior);

  const timer = window.setTimeout(() => {
    const nome = normalizarNome(linha.querySelector('input[name="ingredienteNome"]').value);
    if (estadoCadastro.ingredientesPorNome.has(nome)) {
      carregarMedidas(linha).catch((err) => mostrarMensagem(err.message, "erro"));
    }
  }, 200);

  estadoCadastro.timersMedidas.set(linha, timer);
}

function adicionarIngrediente(nomeInicial = "") {
  const fragmento = templateIngrediente.content.cloneNode(true);
  const linha = fragmento.querySelector(".ingredient-row");
  const nome = fragmento.querySelector('input[name="ingredienteNome"]');
  const quantidade = fragmento.querySelector('input[name="ingredienteQuantidade"]');
  const unidade = fragmento.querySelector('select[name="ingredienteUnidade"]');
  const remover = fragmento.querySelector(".icon-button");

  nome.value = nomeInicial;
  unidade.innerHTML = '<option value="">Selecione</option>';

  nome.addEventListener("input", () => agendarCarregamentoMedidas(linha));
  nome.addEventListener("change", () => carregarMedidas(linha).catch((err) => mostrarMensagem(err.message, "erro")));
  quantidade.addEventListener("input", recalcularResumo);
  unidade.addEventListener("change", recalcularResumo);
  remover.addEventListener("click", () => {
    if (ingredientesEditor.children.length > 1) {
      linha.remove();
      recalcularResumo();
    }
  });

  ingredientesEditor.appendChild(fragmento);
}

function obterLinhaVaziaOuCriar() {
  const vazia = [...ingredientesEditor.querySelectorAll(".ingredient-row")].find((linha) => {
    return !linha.querySelector('input[name="ingredienteNome"]').value.trim();
  });

  if (vazia) return vazia;

  adicionarIngrediente();
  return ingredientesEditor.lastElementChild;
}

function arquivoParaBase64(arquivo) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(arquivo);
  });
}

function obterIngredientes() {
  return [...ingredientesEditor.querySelectorAll(".ingredient-row")].map((linha) => ({
    nome: linha.querySelector('input[name="ingredienteNome"]').value.trim(),
    quantidade: Number(linha.querySelector('input[name="ingredienteQuantidade"]').value || 0),
    unidade: linha.querySelector('select[name="ingredienteUnidade"]').value,
    tipo: "s",
  })).filter((ingrediente) => ingrediente.nome);
}

async function montarPayload() {
  const dados = new FormData(form);
  const arquivo = dados.get("imagem");
  let imagem = null;

  if (arquivo && arquivo.size > 0) {
    imagem = {
      nome: arquivo.name,
      mimeType: arquivo.type,
      base64: await arquivoParaBase64(arquivo),
    };
  }

  return {
    nome: dados.get("nome"),
    categoriaCodigo: Number(dados.get("categoriaCodigo")),
    pessoas: Number(dados.get("pessoas")),
    instrucoes: dados.get("instrucoes"),
    ingredientes: obterIngredientes(),
    imagem,
  };
}

function limparCadastroIngrediente() {
  novoIngrediente.nome.value = "";
  novoIngrediente.calorias.value = 0;
  novoIngrediente.proteinas.value = 0;
  novoIngrediente.carboidratos.value = 0;
  novoIngrediente.gorduras.value = 0;
  novoIngrediente.unidade.value = "grama(s)";
  novoIngrediente.peso.value = 100;
}

async function salvarIngrediente() {
  mostrarMensagem("Salvando ingrediente...");

  const payload = {
    nome: novoIngrediente.nome.value,
    tipo: "s",
    calorias: Number(novoIngrediente.calorias.value || 0),
    proteinas: Number(novoIngrediente.proteinas.value || 0),
    carboidratos: Number(novoIngrediente.carboidratos.value || 0),
    gorduras: Number(novoIngrediente.gorduras.value || 0),
    medidas: [{
      unidade: novoIngrediente.unidade.value,
      peso: Number(novoIngrediente.peso.value || 0),
    }],
  };

  const resultado = await buscarJson("api/ingredientes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  await carregarIngredientes();
  cadastroIngrediente.hidden = true;
  const linha = obterLinhaVaziaOuCriar();
  linha.querySelector('input[name="ingredienteNome"]').value = resultado.nome;
  await carregarMedidas(linha);
  limparCadastroIngrediente();
  mostrarMensagem("Ingrediente cadastrado e adicionado a receita.", "sucesso");
}

form.imagem.addEventListener("change", () => {
  const arquivo = form.imagem.files[0];
  previewImagem.removeAttribute("src");

  if (!arquivo) return;

  previewImagem.src = URL.createObjectURL(arquivo);
});

btnAdicionarIngrediente.addEventListener("click", () => adicionarIngrediente());
btnNovoIngrediente.addEventListener("click", () => {
  cadastroIngrediente.hidden = false;
  novoIngrediente.nome.focus();
});
btnFecharIngrediente.addEventListener("click", () => {
  cadastroIngrediente.hidden = true;
});
btnSalvarIngrediente.addEventListener("click", () => {
  salvarIngrediente().catch((err) => mostrarMensagem(err.message, "erro"));
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  mostrarMensagem("Salvando receita...");

  try {
    const payload = await montarPayload();
    const resultado = await buscarJson("api/receitas", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    mostrarMensagem("Receita salva com sucesso.", "sucesso");
    window.setTimeout(() => {
      window.location.href = `/?busca=${encodeURIComponent(resultado.nome)}`;
    }, 800);
  } catch (err) {
    mostrarMensagem(err.message, "erro");
  }
});

async function iniciarCadastro() {
  try {
    const [categorias, unidades] = await Promise.all([
      buscarJson("api/categorias"),
      buscarJson("api/unidades"),
      carregarIngredientes(),
    ]);

    estadoCadastro.categorias = categorias;
    estadoCadastro.unidades = unidades;
    preencherCategorias();
    preencherUnidades(novoIngrediente.unidade);
    limparCadastroIngrediente();
    adicionarIngrediente();
  } catch (err) {
    mostrarMensagem(err.message, "erro");
  }
}

iniciarCadastro();
