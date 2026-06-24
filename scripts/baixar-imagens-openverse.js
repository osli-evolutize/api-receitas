require("dotenv").config();

const fs = require("fs");
const path = require("path");
const sql = require("mssql");

const raiz = path.join(__dirname, "..");
const imagensDir = path.join(raiz, "public", "images", "receitas");
const atribuicoesPath = path.join(imagensDir, "atribuicoes.json");

const dbConfig = {
  server: process.env.DB_SERVER || "localhost",
  database: process.env.DB_DATABASE || "Receitas",
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: {
    encrypt: process.env.DB_ENCRYPT === "true",
    trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE !== "false",
  },
};

const args = new Map(process.argv.slice(2).map((arg) => {
  const [chave, valor = "true"] = arg.replace(/^--/, "").split("=");
  return [chave, valor];
}));

const limite = Number(args.get("limit") || args.get("limite") || 25);
const sobrescrever = args.get("overwrite") === "true" || args.get("sobrescrever") === "true";
const licencas = args.get("licenses")
  || args.get("licencas")
  || "cc0,pdm,by,by-sa,by-nc,by-nc-sa,by-nd,by-nc-nd";

const palavrasIgnoradas = new Set([
  "a",
  "ao",
  "aos",
  "as",
  "com",
  "da",
  "das",
  "de",
  "do",
  "dos",
  "e",
  "em",
  "i",
  "ii",
  "o",
  "os",
  "receita",
]);

function normalizarNomeArquivo(nome) {
  return String(nome || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizarTexto(texto) {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function obterTokensReceita(nome) {
  return normalizarTexto(nome)
    .split(/[^a-z0-9]+/)
    .map((parte) => parte.trim())
    .filter((parte) => parte.length >= 3 && !palavrasIgnoradas.has(parte));
}

function calcularPontuacao(receita, imagem) {
  const tokens = obterTokensReceita(receita.nome);
  const tags = (imagem.tags || []).map((tag) => tag.name).join(" ");
  const titulo = normalizarTexto(imagem.title || "");
  const textoCompleto = normalizarTexto(`${imagem.title || ""} ${tags}`);
  const encontradosNoTitulo = tokens.filter((token) => titulo.includes(token));
  const minimo = Math.min(2, tokens.length);

  if (encontradosNoTitulo.length < minimo) return 0;

  let pontos = encontradosNoTitulo.length;
  if (textoCompleto.includes("food") || textoCompleto.includes("comida") || textoCompleto.includes("receita")) pontos += 1;
  if (imagem.width >= 600 && imagem.height >= 400) pontos += 1;

  return pontos;
}

function imagemExistente(nome) {
  const base = normalizarNomeArquivo(nome);
  for (const extensao of [".jpg", ".jpeg", ".png", ".webp"]) {
    const caminho = path.join(imagensDir, `${base}${extensao}`);
    if (fs.existsSync(caminho)) return caminho;
  }
  return null;
}

function carregarAtribuicoes() {
  if (!fs.existsSync(atribuicoesPath)) return {};
  const conteudo = fs.readFileSync(atribuicoesPath, "utf8").replace(/^\uFEFF/, "");
  return JSON.parse(conteudo);
}

function salvarAtribuicoes(atribuicoes) {
  fs.writeFileSync(atribuicoesPath, JSON.stringify(atribuicoes, null, 2));
}

async function buscarImagem(receita) {
  const termos = [
    `${receita.nome} receita`,
    `${receita.nome} food`,
    receita.nome,
  ];

  for (const termo of termos) {
    const url = new URL("https://api.openverse.org/v1/images/");
    url.searchParams.set("q", termo);
    url.searchParams.set("page_size", "20");
    url.searchParams.set("mature", "false");
    url.searchParams.set("license", licencas);

    const resposta = await fetch(url);
    if (!resposta.ok) continue;

    const dados = await resposta.json();
    const candidatos = (dados.results || [])
      .filter((item) => item.url && item.width >= 300 && item.height >= 220)
      .map((item) => ({
        ...item,
        pontuacao: calcularPontuacao(receita, item),
      }))
      .filter((item) => item.pontuacao > 0)
      .sort((a, b) => b.pontuacao - a.pontuacao);

    if (candidatos[0]) return candidatos[0];
  }

  return null;
}

function extensaoPorTipo(contentType, url) {
  if (contentType.includes("png")) return ".png";
  if (contentType.includes("webp")) return ".webp";
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return ".jpg";

  const ext = path.extname(new URL(url).pathname).toLowerCase();
  if ([".jpg", ".jpeg", ".png", ".webp"].includes(ext)) return ext;

  return ".jpg";
}

async function baixarImagem(receita, imagem) {
  const resposta = await fetch(imagem.url);
  if (!resposta.ok) {
    throw new Error(`HTTP ${resposta.status}`);
  }

  const contentType = resposta.headers.get("content-type") || "";
  const extensao = extensaoPorTipo(contentType, imagem.url);
  const arquivo = `${normalizarNomeArquivo(receita.nome)}${extensao}`;
  const caminho = path.join(imagensDir, arquivo);
  const bytes = Buffer.from(await resposta.arrayBuffer());

  fs.writeFileSync(caminho, bytes);
  return { arquivo, caminho, contentType, bytes: bytes.length };
}

async function carregarReceitas() {
  const pool = await sql.connect(dbConfig);
  const resultado = await pool.request().query(`
    SELECT
      LTRIM(RTRIM(r.ReceitaNome)) AS nome,
      LTRIM(RTRIM(c.CategoriaDescricao)) AS categoria
    FROM dbo.Receita r
    INNER JOIN dbo.Categoria c ON c.CategoriaCodigo = r.CategoriaCodigo
    ORDER BY r.ReceitaNome;
  `);

  await pool.close();
  return resultado.recordset;
}

async function main() {
  fs.mkdirSync(imagensDir, { recursive: true });

  const atribuicoes = carregarAtribuicoes();
  const receitas = await carregarReceitas();
  const pendentes = receitas.filter((receita) => sobrescrever || !imagemExistente(receita.nome));
  const lote = limite > 0 ? pendentes.slice(0, limite) : pendentes;

  console.log(`Receitas no banco: ${receitas.length}`);
  console.log(`Pendentes para imagem local: ${pendentes.length}`);
  console.log(`Processando agora: ${lote.length}`);

  let baixadas = 0;
  let semResultado = 0;
  let falhas = 0;

  for (const receita of lote) {
    try {
      const imagem = await buscarImagem(receita);
      if (!imagem) {
        semResultado += 1;
        console.log(`[sem imagem] ${receita.nome}`);
        continue;
      }

      const arquivo = await baixarImagem(receita, imagem);
      atribuicoes[receita.nome] = {
        arquivo: arquivo.arquivo,
        titulo: imagem.title,
        autor: imagem.creator,
        autorUrl: imagem.creator_url,
        licenca: imagem.license,
        licencaUrl: imagem.license_url,
        origem: imagem.foreign_landing_url,
        provider: imagem.provider,
        pontuacao: imagem.pontuacao,
        baixadoEm: new Date().toISOString(),
      };
      salvarAtribuicoes(atribuicoes);
      baixadas += 1;
      console.log(`[ok] ${receita.nome} -> ${arquivo.arquivo}`);
    } catch (err) {
      falhas += 1;
      console.log(`[erro] ${receita.nome}: ${err.message}`);
    }
  }

  console.log(`Concluido. Baixadas: ${baixadas}. Sem resultado: ${semResultado}. Falhas: ${falhas}.`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
