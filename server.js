require("dotenv").config();

const fs = require("fs");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
const dbClient = (process.env.DB_CLIENT || "sqlite").toLowerCase();
const sql = dbClient === "sqlite" ? require("./sqlite-db") : require("mssql");

const host = process.env.APP_HOST || "127.0.0.1";
const port = Number(process.env.APP_PORT || 3001);
const publicDir = path.join(__dirname, "public");
const imagensReceitasDir = path.join(publicDir, "images", "receitas");
const sessoes = new Map();
const paginasProtegidas = new Set(["/nova.html", "/categorias.html", "/unidades.html", "/importar.html", "/usuarios.html"]);

const dbConfig = {
  filename: process.env.SQLITE_FILE || path.join(__dirname, "migracao-sqlite", "app.db"),
  server: process.env.DB_SERVER || "localhost",
  database: process.env.DB_DATABASE || "Receitas",
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: {
    encrypt: process.env.DB_ENCRYPT === "true",
    trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE !== "false",
  },
};

let poolPromise;

function obterPool() {
  if (!poolPromise) {
    poolPromise = sql.connect(dbConfig);
  }

  return poolPromise;
}

function enviarJson(res, statusCode, dados) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(dados, null, 2));
}

function enviarJsonComHeaders(res, statusCode, dados, headers = {}) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    ...headers,
  });
  res.end(JSON.stringify(dados, null, 2));
}

function enviarErro(res, statusCode, mensagem, detalhe) {
  enviarJson(res, statusCode, {
    erro: mensagem,
    detalhe: process.env.NODE_ENV === "development" ? detalhe : undefined,
  });
}

function lerCorpoJson(req, limiteBytes = 12 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let corpo = "";

    req.on("data", (chunk) => {
      corpo += chunk;
      if (Buffer.byteLength(corpo) > limiteBytes) {
        reject(new Error("Corpo da requisicao muito grande"));
        req.destroy();
      }
    });

    req.on("end", () => {
      try {
        resolve(corpo ? JSON.parse(corpo) : {});
      } catch (err) {
        reject(new Error("JSON invalido"));
      }
    });

    req.on("error", reject);
  });
}

function lerCookies(req) {
  return String(req.headers.cookie || "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .reduce((cookies, item) => {
      const indice = item.indexOf("=");
      if (indice === -1) return cookies;

      const chave = item.slice(0, indice);
      const valor = item.slice(indice + 1);
      cookies[chave] = decodeURIComponent(valor);
      return cookies;
    }, {});
}

function usuarioAutenticado(req) {
  const token = lerCookies(req).receitasSessao;
  return Boolean(token && sessoes.has(token));
}

function exigirAutenticacao(req, res) {
  if (usuarioAutenticado(req)) return true;

  enviarJson(res, 401, { erro: "Login necessario para acessar cadastros" });
  return false;
}

function cookieSessao(token) {
  return [
    `receitasSessao=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
  ].join("; ");
}

async function login(req, res) {
  const dados = await lerCorpoJson(req, 16 * 1024);
  const usuario = String(dados.usuario || "").trim();
  const senha = String(dados.senha || "");

  if (!usuario || !senha) {
    enviarJson(res, 400, { erro: "Informe usuario e senha" });
    return;
  }

  const pool = await obterPool();
  const resultado = await pool.request()
    .input("usuario", sql.VarChar(60), usuario.toLowerCase())
    .input("senha", sql.VarChar(20), senha)
    .query(`
      SELECT TOP 1
        LTRIM(RTRIM(usucod)) AS codigo,
        LTRIM(RTRIM(usunome)) AS nome,
        usuperfil AS perfil
      FROM dbo.Usuario
      WHERE (
          LOWER(LTRIM(RTRIM(usucod))) = @usuario
          OR LOWER(LTRIM(RTRIM(usunome))) = @usuario
        )
        AND LTRIM(RTRIM(ususenha)) = @senha;
    `);

  if (resultado.recordset.length === 0) {
    enviarJson(res, 401, { erro: "Usuario ou senha invalidos" });
    return;
  }

  const usuarioBanco = resultado.recordset[0];
  const token = cryptoRandomToken();
  sessoes.set(token, {
    usuario: usuarioBanco.codigo,
    nome: usuarioBanco.nome,
    perfil: usuarioBanco.perfil,
    criadoEm: Date.now(),
  });

  enviarJsonComHeaders(res, 200, {
    ok: true,
    usuario: usuarioBanco.codigo,
    nome: usuarioBanco.nome,
  }, {
    "Set-Cookie": cookieSessao(token),
  });
}

function logout(req, res) {
  const token = lerCookies(req).receitasSessao;
  if (token) {
    sessoes.delete(token);
  }

  enviarJsonComHeaders(res, 200, { ok: true }, {
    "Set-Cookie": "receitasSessao=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
  });
}

async function listarUsuarios(res) {
  const pool = await obterPool();
  const resultado = await pool.request().query(`
    SELECT
      LTRIM(RTRIM(usucod)) AS codigo,
      LTRIM(RTRIM(usunome)) AS nome,
      usuperfil AS perfil
    FROM dbo.Usuario
    ORDER BY LTRIM(RTRIM(usucod));
  `);

  enviarJson(res, 200, resultado.recordset);
}

async function salvarUsuario(req, res) {
  const dados = await lerCorpoJson(req, 32 * 1024);
  const codigoOriginal = String(dados.codigoOriginal || "").trim();
  const codigo = String(dados.codigo || "").trim();
  const nome = String(dados.nome || "").trim();
  const senha = String(dados.senha || "");
  const perfil = Number(dados.perfil || 0);

  if (!codigo || !nome) {
    enviarJson(res, 400, { erro: "Informe usuario e nome" });
    return;
  }

  if (!codigoOriginal && !senha) {
    enviarJson(res, 400, { erro: "Informe a senha" });
    return;
  }

  const pool = await obterPool();
  const existente = await pool.request()
    .input("codigo", sql.VarChar(60), codigo)
    .query(`
      SELECT TOP 1 LTRIM(RTRIM(usucod)) AS codigo
      FROM dbo.Usuario
      WHERE LTRIM(RTRIM(usucod)) = @codigo;
    `);

  if (existente.recordset.length && (!codigoOriginal || existente.recordset[0].codigo !== codigoOriginal)) {
    enviarJson(res, 409, { erro: "Ja existe um usuario com este codigo" });
    return;
  }

  if (codigoOriginal) {
    const request = pool.request()
      .input("codigoOriginal", sql.VarChar(60), codigoOriginal)
      .input("codigo", sql.VarChar(60), codigo)
      .input("nome", sql.VarChar(60), nome)
      .input("perfil", sql.Int, perfil);

    if (senha) request.input("senha", sql.VarChar(20), senha);

    const resultado = await request.query(`
      UPDATE dbo.Usuario
      SET
        usucod = @codigo,
        usunome = @nome,
        usuperfil = @perfil
        ${senha ? ", ususenha = @senha" : ""}
      WHERE LTRIM(RTRIM(usucod)) = @codigoOriginal;
      SELECT @@ROWCOUNT AS alteradas;
    `);

    if (!resultado.recordset[0]?.alteradas) {
      enviarJson(res, 404, { erro: "Usuario nao encontrado" });
      return;
    }

    enviarJson(res, 200, { ok: true });
    return;
  }

  await pool.request()
    .input("codigo", sql.VarChar(60), codigo)
    .input("nome", sql.VarChar(60), nome)
    .input("senha", sql.VarChar(20), senha)
    .input("perfil", sql.Int, perfil)
    .query(`
      INSERT INTO dbo.Usuario (usucod, usunome, ususenha, usuperfil)
      VALUES (@codigo, @nome, @senha, @perfil);
    `);

  enviarJson(res, 201, { ok: true });
}

async function excluirUsuario(req, res, url) {
  const codigo = String(url.searchParams.get("codigo") || "").trim();

  if (!codigo) {
    enviarJson(res, 400, { erro: "Informe o usuario" });
    return;
  }

  const pool = await obterPool();
  const resultado = await pool.request()
    .input("codigo", sql.VarChar(60), codigo)
    .query(`
      DELETE FROM dbo.Usuario
      WHERE LTRIM(RTRIM(usucod)) = @codigo;
      SELECT @@ROWCOUNT AS alteradas;
    `);

  if (!resultado.recordset[0]?.alteradas) {
    enviarJson(res, 404, { erro: "Usuario nao encontrado" });
    return;
  }

  enviarJson(res, 200, { ok: true });
}

function cryptoRandomToken() {
  return crypto.randomBytes(32).toString("hex");
}

function enviarArquivo(res, caminhoArquivo) {
  const extensao = path.extname(caminhoArquivo).toLowerCase();
  const contentTypes = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
  };

  fs.readFile(caminhoArquivo, (err, conteudo) => {
    if (err) {
      enviarJson(res, 404, { erro: "Arquivo nao encontrado" });
      return;
    }

    res.writeHead(200, {
      "Content-Type": contentTypes[extensao] || "application/octet-stream",
    });
    res.end(conteudo);
  });
}

function normalizarNomeArquivo(nome) {
  return String(nome || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function obterImagemLocal(nome) {
  const base = normalizarNomeArquivo(nome);
  const extensoes = [".jpg", ".jpeg", ".png", ".webp"];

  for (const extensao of extensoes) {
    const caminho = path.join(imagensReceitasDir, `${base}${extensao}`);
    if (fs.existsSync(caminho)) {
      return caminho;
    }
  }

  return null;
}

async function listarCategorias(res) {
  const pool = await obterPool();
  const resultado = await pool.request().query(`
    SELECT
      CategoriaCodigo AS codigo,
      LTRIM(RTRIM(CategoriaDescricao)) AS descricao
    FROM dbo.Categoria
    WHERE LTRIM(RTRIM(CategoriaDescricao)) <> ''
    ORDER BY CategoriaDescricao;
  `);

  enviarJson(res, 200, resultado.recordset);
}

async function criarCategoria(req, res) {
  const dados = await lerCorpoJson(req);
  const descricao = textoObrigatorio(dados.descricao, "a descricao da categoria", 40);
  const pool = await obterPool();
  const transaction = new sql.Transaction(pool);

  await transaction.begin();

  try {
    const existente = await new sql.Request(transaction)
      .input("descricao", sql.VarChar(40), descricao)
      .query(`
        SELECT 1
        FROM dbo.Categoria
        WHERE LTRIM(RTRIM(CategoriaDescricao)) = @descricao;
      `);

    if (existente.recordset.length > 0) {
      throw new Error("Categoria ja cadastrada");
    }

    const codigoResultado = await new sql.Request(transaction)
      .query(`
        SELECT ISNULL(MAX(CategoriaCodigo), 0) + 1 AS codigo
        FROM dbo.Categoria WITH (UPDLOCK, HOLDLOCK);
      `);
    const codigo = codigoResultado.recordset[0].codigo;

    await new sql.Request(transaction)
      .input("codigo", sql.SmallInt, codigo)
      .input("descricao", sql.VarChar(40), descricao)
      .query(`
        INSERT INTO dbo.Categoria (
          CategoriaCodigo,
          CategoriaDescricao
        )
        VALUES (
          @codigo,
          @descricao
        );
      `);

    await transaction.commit();

    enviarJson(res, 201, {
      ok: true,
      codigo,
      descricao,
    });
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

async function listarUnidades(res) {
  const pool = await obterPool();
  const resultado = await pool.request().query(`
    SELECT
      LTRIM(RTRIM(Unidade)) AS unidade,
      Quantidade AS quantidade
    FROM dbo.Unidades
    WHERE LTRIM(RTRIM(Unidade)) <> ''
    ORDER BY Unidade;
  `);

  enviarJson(res, 200, resultado.recordset);
}

async function criarUnidade(req, res) {
  const dados = await lerCorpoJson(req);
  const unidade = textoObrigatorio(dados.unidade, "a unidade", 20);
  const quantidade = dados.quantidade === undefined || dados.quantidade === null || dados.quantidade === ""
    ? 0
    : numeroDecimal(dados.quantidade, "Quantidade");
  const pool = await obterPool();

  const existente = await pool.request()
    .input("unidade", sql.VarChar(20), unidade)
    .query(`
      SELECT 1
      FROM dbo.Unidades
      WHERE LTRIM(RTRIM(Unidade)) = @unidade;
    `);

  if (existente.recordset.length > 0) {
    throw new Error("Unidade ja cadastrada");
  }

  await pool.request()
    .input("unidade", sql.VarChar(20), unidade)
    .input("quantidade", sql.Decimal(18, 6), quantidade)
    .query(`
      INSERT INTO dbo.Unidades (
        Unidade,
        Quantidade
      )
      VALUES (
        @unidade,
        @quantidade
      );
    `);

  enviarJson(res, 201, {
    ok: true,
    unidade,
    quantidade,
  });
}

async function listarIngredientes(res, url) {
  const busca = (url.searchParams.get("busca") || "").trim();
  const pool = await obterPool();
  const resultado = await pool.request()
    .input("busca", sql.VarChar(80), `%${busca}%`)
    .query(`
    SELECT TOP 2000
        LTRIM(RTRIM(i.IngredienteNome)) AS nome,
        LTRIM(RTRIM(i.IngredienteTipo)) AS tipo,
        i.IngredienteCalorias AS calorias,
        i.IngredienteProteinas AS proteinas,
        i.IngredienteCarboidratos AS carboidratos,
        i.IngredienteGorduras AS gorduras
      FROM dbo.Ingrediente i
      WHERE (@busca = '%%' OR i.IngredienteNome LIKE @busca)
      ORDER BY i.IngredienteNome;
    `);

  enviarJson(res, 200, resultado.recordset);
}

async function listarMedidasIngrediente(res, url) {
  const nome = (url.searchParams.get("nome") || "").trim();

  if (!nome) {
    enviarJson(res, 400, { erro: "Informe o ingrediente" });
    return;
  }

  const pool = await obterPool();
  const resultado = await pool.request()
    .input("nome", sql.VarChar(60), nome)
    .query(`
      SELECT
        LTRIM(RTRIM(IngredienteMedidaUnidade)) AS unidade,
        IngredienteMedidaPeso AS peso
      FROM dbo.IngredienteMedida
      WHERE IngredienteNome = @nome
      ORDER BY IngredienteMedidaUnidade;
    `);

  enviarJson(res, 200, resultado.recordset);
}

async function listarReceitas(res, url) {
  const busca = (url.searchParams.get("busca") || "").trim();
  const ingrediente = (url.searchParams.get("ingrediente") || "").trim();
  const categoria = url.searchParams.get("categoria");

  const pool = await obterPool();
  const request = pool.request();
  request.input("busca", sql.VarChar(80), `%${busca}%`);
  request.input("ingrediente", sql.VarChar(80), `%${ingrediente}%`);

  let filtroCategoria = "";
  if (categoria) {
    request.input("categoria", sql.SmallInt, Number(categoria));
    filtroCategoria = "AND r.CategoriaCodigo = @categoria";
  }

  const resultado = await request.query(`
    SELECT
      LTRIM(RTRIM(r.ReceitaNome)) AS nome,
      r.ReceitaPessoas AS pessoas,
      r.ReceitaPeso AS peso,
      r.ReceitaCalorias AS calorias,
      r.ReceitaProteinas AS proteinas,
      r.ReceitaCarboidratos AS carboidratos,
      r.ReceitaGorduras AS gorduras,
      r.CategoriaCodigo AS categoriaCodigo,
      LTRIM(RTRIM(c.CategoriaDescricao)) AS categoria,
      CASE WHEN DATALENGTH(r.ReceitaImagem) > 0 THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END AS temImagem
    FROM dbo.Receita r
    INNER JOIN dbo.Categoria c ON c.CategoriaCodigo = r.CategoriaCodigo
    WHERE (@busca = '%%' OR r.ReceitaNome LIKE @busca)
      AND (
        @ingrediente = '%%'
        OR EXISTS (
          SELECT 1
          FROM dbo.ReceitaIngrediente ri
          WHERE ri.ReceitaNome = r.ReceitaNome
            AND ri.IngredienteNome LIKE @ingrediente
        )
      )
      ${filtroCategoria}
    ORDER BY r.ReceitaNome;
  `);

  enviarJson(res, 200, resultado.recordset.map((receita) => ({
    ...receita,
    temImagem: Boolean(receita.temImagem || obterImagemLocal(receita.nome)),
  })));
}

async function obterReceita(res, url) {
  const nome = (url.searchParams.get("nome") || "").trim();

  if (!nome) {
    enviarJson(res, 400, { erro: "Informe o nome da receita" });
    return;
  }

  const pool = await obterPool();
  const receitaResultado = await pool.request()
    .input("nome", sql.VarChar(60), nome)
    .query(`
      SELECT
        LTRIM(RTRIM(r.ReceitaNome)) AS nome,
        r.ReceitaInstrucoes AS instrucoes,
        r.ReceitaPessoas AS pessoas,
        r.ReceitaPeso AS peso,
        r.ReceitaCalorias AS calorias,
        r.ReceitaProteinas AS proteinas,
        r.ReceitaCarboidratos AS carboidratos,
        r.ReceitaGorduras AS gorduras,
        r.CategoriaCodigo AS categoriaCodigo,
        LTRIM(RTRIM(c.CategoriaDescricao)) AS categoria,
        CASE WHEN DATALENGTH(r.ReceitaImagem) > 0 THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END AS temImagem
      FROM dbo.Receita r
      INNER JOIN dbo.Categoria c ON c.CategoriaCodigo = r.CategoriaCodigo
      WHERE r.ReceitaNome = @nome;
    `);

  if (receitaResultado.recordset.length === 0) {
    enviarJson(res, 404, { erro: "Receita nao encontrada" });
    return;
  }

  const ingredientesResultado = await pool.request()
    .input("nome", sql.VarChar(60), nome)
    .query(`
      SELECT
        LTRIM(RTRIM(IngredienteNome)) AS nome,
        ReceitaIngredienteQuantidade AS quantidade,
        LTRIM(RTRIM(ReceitaIngredienteUnidade)) AS unidade,
        LTRIM(RTRIM(ReceitaIngredienteTipo)) AS tipo
      FROM dbo.ReceitaIngrediente
      WHERE ReceitaNome = @nome
      ORDER BY IngredienteNome;
    `);

  const receita = receitaResultado.recordset[0];

  enviarJson(res, 200, {
    ...receita,
    temImagem: Boolean(receita.temImagem || obterImagemLocal(receita.nome)),
    ingredientes: ingredientesResultado.recordset,
  });
}

async function obterImagemReceita(res, url) {
  const nome = (url.searchParams.get("nome") || "").trim();

  if (!nome) {
    enviarJson(res, 400, { erro: "Informe o nome da receita" });
    return;
  }

  const pool = await obterPool();
  const resultado = await pool.request()
    .input("nome", sql.VarChar(60), nome)
    .query(`
      SELECT ReceitaImagem AS imagem
      FROM dbo.Receita
      WHERE ReceitaNome = @nome;
    `);

  if (resultado.recordset.length > 0 && resultado.recordset[0].imagem?.length > 0) {
    const imagem = resultado.recordset[0].imagem;
    res.writeHead(200, {
      "Content-Type": detectarMimeImagem(imagem),
      "Cache-Control": "public, max-age=86400",
    });
    res.end(imagem);
    return;
  }

  const imagemLocal = obterImagemLocal(nome);
  if (imagemLocal) {
    enviarArquivo(res, imagemLocal);
    return;
  }

  if (resultado.recordset.length === 0) {
    enviarJson(res, 404, { erro: "Imagem nao encontrada" });
    return;
  }

  enviarJson(res, 404, { erro: "Imagem nao encontrada" });
}

function detectarMimeImagem(bytes) {
  if (bytes?.[0] === 0xff && bytes?.[1] === 0xd8) return "image/jpeg";
  if (bytes?.[0] === 0x89 && bytes?.[1] === 0x50 && bytes?.[2] === 0x4e && bytes?.[3] === 0x47) return "image/png";
  if (bytes?.slice?.(0, 4).toString("ascii") === "RIFF" && bytes?.slice?.(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return "application/octet-stream";
}

function textoObrigatorio(valor, nomeCampo, tamanhoMaximo) {
  const texto = String(valor || "").trim();
  if (!texto) {
    throw new Error(`Informe ${nomeCampo}`);
  }
  if (texto.length > tamanhoMaximo) {
    throw new Error(`${nomeCampo} deve ter ate ${tamanhoMaximo} caracteres`);
  }
  return texto;
}

function numeroInteiro(valor, nomeCampo) {
  const numero = Number(valor);
  if (!Number.isFinite(numero) || numero < 0) {
    throw new Error(`${nomeCampo} invalido`);
  }
  return Math.round(numero);
}

function numeroDecimal(valor, nomeCampo) {
  const numero = Number(valor);
  if (!Number.isFinite(numero) || numero < 0) {
    throw new Error(`${nomeCampo} invalido`);
  }
  return numero;
}

function gramasPorMedida(quantidade, pesoMedida) {
  if (!Number.isFinite(pesoMedida) || pesoMedida <= 0) return 0;
  return pesoMedida >= 1 ? quantidade : quantidade * pesoMedida * 1000;
}

async function calcularResumoReceita(transaction, ingredientes) {
  const resumo = {
    peso: 0,
    calorias: 0,
    proteinas: 0,
    carboidratos: 0,
    gorduras: 0,
  };

  for (const ingrediente of ingredientes) {
    const resultado = await new sql.Request(transaction)
      .input("nome", sql.VarChar(60), ingrediente.nome)
      .input("unidade", sql.VarChar(20), ingrediente.unidade)
      .query(`
        SELECT
          i.IngredienteCalorias AS calorias,
          i.IngredienteProteinas AS proteinas,
          i.IngredienteCarboidratos AS carboidratos,
          i.IngredienteGorduras AS gorduras,
          m.IngredienteMedidaPeso AS pesoMedida
        FROM dbo.Ingrediente i
        INNER JOIN dbo.IngredienteMedida m
          ON LTRIM(RTRIM(m.IngredienteNome)) = LTRIM(RTRIM(i.IngredienteNome))
         AND LTRIM(RTRIM(m.IngredienteMedidaUnidade)) = @unidade
        WHERE LTRIM(RTRIM(i.IngredienteNome)) = @nome;
      `);

    if (resultado.recordset.length === 0) {
      const unidadeNormalizada = String(ingrediente.unidade || "").trim().toLowerCase();

      if (unidadeNormalizada === "grama(s)" || unidadeNormalizada === "gramas" || unidadeNormalizada === "g") {
        const ingredienteResultado = await new sql.Request(transaction)
          .input("nome", sql.VarChar(60), ingrediente.nome)
          .query(`
            SELECT
              IngredienteCalorias AS calorias,
              IngredienteProteinas AS proteinas,
              IngredienteCarboidratos AS carboidratos,
              IngredienteGorduras AS gorduras,
              100 AS pesoMedida
            FROM dbo.Ingrediente
            WHERE LTRIM(RTRIM(IngredienteNome)) = @nome;
          `);

        if (ingredienteResultado.recordset.length === 0) {
          throw new Error(`Ingrediente ou medida nao cadastrada: ${ingrediente.nome}`);
        }

        resultado.recordset = ingredienteResultado.recordset;
      } else {
        throw new Error(`Ingrediente ou medida nao cadastrada: ${ingrediente.nome}`);
      }
    }

    const base = resultado.recordset[0];
    const gramas = gramasPorMedida(ingrediente.quantidade, Number(base.pesoMedida));
    const fatorNutricional = gramas / 100;

    resumo.peso += gramas;
    resumo.calorias += Number(base.calorias || 0) * fatorNutricional;
    resumo.proteinas += Number(base.proteinas || 0) * fatorNutricional;
    resumo.carboidratos += Number(base.carboidratos || 0) * fatorNutricional;
    resumo.gorduras += Number(base.gorduras || 0) * fatorNutricional;
  }

  return {
    peso: Math.round(resumo.peso),
    calorias: Math.round(resumo.calorias),
    proteinas: Math.round(resumo.proteinas),
    carboidratos: Math.round(resumo.carboidratos),
    gorduras: Math.round(resumo.gorduras),
  };
}

function prepararImagemReceita(nomeReceita, imagem) {
  if (!imagem || !imagem.base64) return null;

  const mimeType = String(imagem.mimeType || "").toLowerCase();
  const extensoes = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
  };
  const extensao = extensoes[mimeType];

  if (!extensao) {
    throw new Error("Use uma imagem JPG, PNG ou WEBP");
  }

  const base64 = String(imagem.base64).replace(/^data:image\/[a-z+]+;base64,/, "");
  const bytes = Buffer.from(base64, "base64");

  if (bytes.length === 0) {
    throw new Error("Imagem invalida");
  }

  if (bytes.length > 8 * 1024 * 1024) {
    throw new Error("A imagem deve ter no maximo 8 MB");
  }

  return {
    caminho: path.join(imagensReceitasDir, `${normalizarNomeArquivo(nomeReceita)}${extensao}`),
    bytes,
  };
}

async function criarReceita(req, res) {
  const dados = await lerCorpoJson(req);
  const nome = textoObrigatorio(dados.nome, "o nome da receita", 60).toUpperCase();
  const instrucoes = textoObrigatorio(dados.instrucoes, "o preparo", 8000);
  const categoriaCodigo = numeroInteiro(dados.categoriaCodigo, "Categoria");
  const pessoas = numeroInteiro(dados.pessoas, "Pessoas");
  const ingredientes = Array.isArray(dados.ingredientes) ? dados.ingredientes : [];
  const imagem = prepararImagemReceita(nome, dados.imagem);

  if (ingredientes.length === 0) {
    throw new Error("Informe ao menos um ingrediente");
  }

  const ingredientesValidos = ingredientes.map((item) => ({
    nome: textoObrigatorio(item.nome, "o nome do ingrediente", 60).toUpperCase(),
    quantidade: numeroDecimal(item.quantidade, "Quantidade"),
    unidade: textoObrigatorio(item.unidade, "a unidade do ingrediente", 20),
    tipo: String(item.tipo || "s").trim().slice(0, 1) || "s",
  }));

  const pool = await obterPool();
  const transaction = new sql.Transaction(pool);

  await transaction.begin();

  try {
    const existente = await new sql.Request(transaction)
      .input("nome", sql.VarChar(60), nome)
      .query("SELECT 1 AS existe FROM dbo.Receita WHERE ReceitaNome = @nome;");

    if (existente.recordset.length > 0) {
      throw new Error("Ja existe uma receita com esse nome");
    }

    const resumo = await calcularResumoReceita(transaction, ingredientesValidos);

    await new sql.Request(transaction)
      .input("nome", sql.VarChar(60), nome)
      .input("instrucoes", sql.VarChar(sql.MAX), instrucoes)
      .input("pessoas", sql.Int, pessoas)
      .input("peso", sql.Int, resumo.peso)
      .input("calorias", sql.Int, resumo.calorias)
      .input("proteinas", sql.Int, resumo.proteinas)
      .input("carboidratos", sql.Int, resumo.carboidratos)
      .input("gorduras", sql.Int, resumo.gorduras)
      .input("imagem", sql.VarBinary(sql.MAX), Buffer.alloc(0))
      .input("categoriaCodigo", sql.SmallInt, categoriaCodigo)
      .query(`
        INSERT INTO dbo.Receita (
          ReceitaNome,
          ReceitaInstrucoes,
          ReceitaPessoas,
          ReceitaPeso,
          ReceitaCalorias,
          ReceitaProteinas,
          ReceitaCarboidratos,
          ReceitaGorduras,
          ReceitaImagem,
          CategoriaCodigo
        )
        VALUES (
          @nome,
          @instrucoes,
          @pessoas,
          @peso,
          @calorias,
          @proteinas,
          @carboidratos,
          @gorduras,
          @imagem,
          @categoriaCodigo
        );
      `);

    for (const ingrediente of ingredientesValidos) {
      await new sql.Request(transaction)
        .input("receitaNome", sql.VarChar(60), nome)
        .input("ingredienteNome", sql.VarChar(60), ingrediente.nome)
        .input("quantidade", sql.Decimal(18, 6), ingrediente.quantidade)
        .input("unidade", sql.VarChar(20), ingrediente.unidade)
        .input("tipo", sql.VarChar(1), ingrediente.tipo)
        .query(`
          INSERT INTO dbo.ReceitaIngrediente (
            ReceitaNome,
            IngredienteNome,
            ReceitaIngredienteQuantidade,
            ReceitaIngredienteUnidade,
            ReceitaIngredienteTipo
          )
          VALUES (
            @receitaNome,
            @ingredienteNome,
            @quantidade,
            @unidade,
            @tipo
          );
        `);
    }

    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }

  if (imagem) {
    fs.mkdirSync(imagensReceitasDir, { recursive: true });
    fs.writeFileSync(imagem.caminho, imagem.bytes);
  }

  enviarJson(res, 201, {
    ok: true,
    nome,
  });
}

async function atualizarReceita(req, res) {
  const dados = await lerCorpoJson(req);
  const nomeOriginal = textoObrigatorio(dados.nomeOriginal || dados.nomeAnterior || dados.nome, "a receita original", 60).toUpperCase();
  const nome = textoObrigatorio(dados.nome, "o nome da receita", 60).toUpperCase();
  const instrucoes = textoObrigatorio(dados.instrucoes, "o preparo", 8000);
  const categoriaCodigo = numeroInteiro(dados.categoriaCodigo, "Categoria");
  const pessoas = numeroInteiro(dados.pessoas, "Pessoas");
  const ingredientes = Array.isArray(dados.ingredientes) ? dados.ingredientes : [];
  const imagem = prepararImagemReceita(nome, dados.imagem);

  if (ingredientes.length === 0) {
    throw new Error("Informe ao menos um ingrediente");
  }

  const ingredientesValidos = ingredientes.map((item) => ({
    nome: textoObrigatorio(item.nome, "o nome do ingrediente", 60).toUpperCase(),
    quantidade: numeroDecimal(item.quantidade, "Quantidade"),
    unidade: textoObrigatorio(item.unidade, "a unidade do ingrediente", 20),
    tipo: String(item.tipo || "s").trim().slice(0, 1) || "s",
  }));

  const pool = await obterPool();
  const transaction = new sql.Transaction(pool);

  await transaction.begin();

  try {
    const existente = await new sql.Request(transaction)
      .input("nomeOriginal", sql.VarChar(60), nomeOriginal)
      .query("SELECT 1 AS existe FROM dbo.Receita WHERE ReceitaNome = @nomeOriginal;");

    if (existente.recordset.length === 0) {
      throw new Error("Receita nao encontrada");
    }

    if (nome !== nomeOriginal) {
      const duplicada = await new sql.Request(transaction)
        .input("nome", sql.VarChar(60), nome)
        .query("SELECT 1 AS existe FROM dbo.Receita WHERE ReceitaNome = @nome;");

      if (duplicada.recordset.length > 0) {
        throw new Error("Ja existe uma receita com esse nome");
      }
    }

    const resumo = await calcularResumoReceita(transaction, ingredientesValidos);

    await new sql.Request(transaction)
      .input("nomeOriginal", sql.VarChar(60), nomeOriginal)
      .query("DELETE FROM dbo.ReceitaIngrediente WHERE ReceitaNome = @nomeOriginal;");

    const updateImagem = imagem ? ", ReceitaImagem = @imagem" : "";
    const requisicaoReceita = new sql.Request(transaction)
      .input("nomeOriginal", sql.VarChar(60), nomeOriginal)
      .input("nome", sql.VarChar(60), nome)
      .input("instrucoes", sql.VarChar(sql.MAX), instrucoes)
      .input("pessoas", sql.Int, pessoas)
      .input("peso", sql.Int, resumo.peso)
      .input("calorias", sql.Int, resumo.calorias)
      .input("proteinas", sql.Int, resumo.proteinas)
      .input("carboidratos", sql.Int, resumo.carboidratos)
      .input("gorduras", sql.Int, resumo.gorduras)
      .input("categoriaCodigo", sql.SmallInt, categoriaCodigo);

    if (imagem) {
      requisicaoReceita.input("imagem", sql.VarBinary(sql.MAX), imagem.bytes);
    }

    await requisicaoReceita.query(`
      UPDATE dbo.Receita
      SET
        ReceitaNome = CAST(@nome AS varchar(60)),
        ReceitaInstrucoes = @instrucoes,
        ReceitaPessoas = @pessoas,
        ReceitaPeso = @peso,
        ReceitaCalorias = @calorias,
        ReceitaProteinas = @proteinas,
        ReceitaCarboidratos = @carboidratos,
        ReceitaGorduras = @gorduras,
        CategoriaCodigo = @categoriaCodigo
        ${updateImagem}
      WHERE ReceitaNome = @nomeOriginal;
    `);

    for (const ingrediente of ingredientesValidos) {
      await new sql.Request(transaction)
        .input("receitaNome", sql.VarChar(60), nome)
        .input("ingredienteNome", sql.VarChar(60), ingrediente.nome)
        .input("quantidade", sql.Decimal(18, 6), ingrediente.quantidade)
        .input("unidade", sql.VarChar(20), ingrediente.unidade)
        .input("tipo", sql.VarChar(1), ingrediente.tipo)
        .query(`
          INSERT INTO dbo.ReceitaIngrediente (
            ReceitaNome,
            IngredienteNome,
            ReceitaIngredienteQuantidade,
            ReceitaIngredienteUnidade,
            ReceitaIngredienteTipo
          )
          VALUES (
            @receitaNome,
            @ingredienteNome,
            @quantidade,
            @unidade,
            @tipo
          );
        `);
    }

    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }

  if (imagem) {
    removerImagemLocalReceita(nomeOriginal);
    removerImagemLocalReceita(nome);
  } else if (nome !== nomeOriginal) {
    renomearImagemLocalReceita(nomeOriginal, nome);
  }

  enviarJson(res, 200, {
    ok: true,
    nome,
  });
}

async function criarIngrediente(req, res) {
  const dados = await lerCorpoJson(req);
  const nome = textoObrigatorio(dados.nome, "o nome do ingrediente", 60).toUpperCase();
  const tipo = String(dados.tipo || "s").trim().slice(0, 1) || "s";
  const calorias = numeroInteiro(dados.calorias, "Calorias");
  const proteinas = numeroInteiro(dados.proteinas, "Proteinas");
  const carboidratos = numeroInteiro(dados.carboidratos, "Carboidratos");
  const gorduras = numeroInteiro(dados.gorduras, "Gorduras");
  const medidas = Array.isArray(dados.medidas) ? dados.medidas : [];

  if (medidas.length === 0) {
    throw new Error("Informe ao menos uma medida do ingrediente");
  }

  const medidasValidas = medidas.map((medida) => ({
    unidade: textoObrigatorio(medida.unidade, "a unidade da medida", 20),
    peso: numeroDecimal(medida.peso, "Peso da medida"),
  }));

  const pool = await obterPool();
  const transaction = new sql.Transaction(pool);

  await transaction.begin();

  try {
    const existente = await new sql.Request(transaction)
      .input("nome", sql.VarChar(60), nome)
      .query("SELECT 1 FROM dbo.Ingrediente WHERE IngredienteNome = @nome;");

    if (existente.recordset.length > 0) {
      throw new Error("Ingrediente ja cadastrado");
    }

    await new sql.Request(transaction)
      .input("nome", sql.VarChar(60), nome)
      .input("tipo", sql.VarChar(1), tipo)
      .input("calorias", sql.Int, calorias)
      .input("proteinas", sql.Int, proteinas)
      .input("carboidratos", sql.Int, carboidratos)
      .input("gorduras", sql.Int, gorduras)
      .query(`
        INSERT INTO dbo.Ingrediente (
          IngredienteNome,
          IngredienteTipo,
          IngredienteCalorias,
          IngredienteProteinas,
          IngredienteCarboidratos,
          IngredienteGorduras
        )
        VALUES (
          @nome,
          @tipo,
          @calorias,
          @proteinas,
          @carboidratos,
          @gorduras
        );
      `);

    for (const medida of medidasValidas) {
      await new sql.Request(transaction)
        .input("nome", sql.VarChar(60), nome)
        .input("unidade", sql.VarChar(20), medida.unidade)
        .input("peso", sql.Decimal(18, 6), medida.peso)
        .query(`
          INSERT INTO dbo.IngredienteMedida (
            IngredienteNome,
            IngredienteMedidaUnidade,
            IngredienteMedidaPeso
          )
          VALUES (@nome, @unidade, @peso);
        `);
    }

    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }

  enviarJson(res, 201, {
    ok: true,
    nome,
  });
}

function decodificarHtml(texto) {
  const entidades = {
    aacute: "á",
    agrave: "à",
    acirc: "â",
    atilde: "ã",
    eacute: "é",
    ecirc: "ê",
    iacute: "í",
    oacute: "ó",
    ocirc: "ô",
    otilde: "õ",
    uacute: "ú",
    ccedil: "ç",
    Aacute: "Á",
    Agrave: "À",
    Acirc: "Â",
    Atilde: "Ã",
    Eacute: "É",
    Ecirc: "Ê",
    Iacute: "Í",
    Oacute: "Ó",
    Ocirc: "Ô",
    Otilde: "Õ",
    Uacute: "Ú",
    Ccedil: "Ç",
    nbsp: " ",
  };

  return String(texto || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&([a-zA-Z]+);/g, (entidadeCompleta, entidade) => entidades[entidade] || entidadeCompleta)
    .replace(/&#(\d+);/g, (_, codigo) => String.fromCharCode(Number(codigo)));
}

function limparTextoWeb(valor) {
  return decodificarHtml(String(valor || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim());
}

function encontrarReceitasJsonLd(valor) {
  const encontrados = [];

  function visitar(item) {
    if (!item || typeof item !== "object") return;

    const tipo = item["@type"];
    const tipos = Array.isArray(tipo) ? tipo : [tipo];
    if (tipos.some((t) => String(t || "").toLowerCase() === "recipe")) {
      encontrados.push(item);
    }

    if (Array.isArray(item["@graph"])) {
      item["@graph"].forEach(visitar);
    }
  }

  if (Array.isArray(valor)) {
    valor.forEach(visitar);
  } else {
    visitar(valor);
  }

  return encontrados;
}

function extrairReceitasHtml(html, urlOrigem) {
  const receitas = [];
  const scripts = String(html || "").matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);

  for (const script of scripts) {
    try {
      let json;
      try {
        json = JSON.parse(script[1].trim());
      } catch {
        json = JSON.parse(decodificarHtml(script[1].trim()));
      }
      const itens = encontrarReceitasJsonLd(json);

      for (const item of itens) {
        const nome = limparTextoWeb(item.name);
        if (!nome) continue;

        const ingredientes = []
          .concat(item.recipeIngredient || item.ingredients || [])
          .map(limparTextoWeb)
          .filter(Boolean);
        const instrucoesOriginais = Array.isArray(item.recipeInstructions)
          ? item.recipeInstructions.map((passo) => limparTextoWeb(passo.text || passo.name || passo)).filter(Boolean)
          : [limparTextoWeb(item.recipeInstructions)].filter(Boolean);
        const imagem = Array.isArray(item.image) ? item.image[0] : item.image;
        const imagemUrl = typeof imagem === "object" ? imagem.url : imagem;

        receitas.push({
          nome,
          ingredientes,
          instrucoes: instrucoesOriginais.join("\n"),
          pessoas: Number.parseInt(item.recipeYield, 10) || 0,
          imagemUrl: imagemUrl ? new URL(imagemUrl, urlOrigem).toString() : "",
          fonte: urlOrigem,
        });
      }
    } catch {
      // Ignora blocos JSON-LD invalidos de paginas externas.
    }
  }

  return receitas;
}

async function baixarTexto(url, limiteBytes = 2 * 1024 * 1024) {
  const resposta = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; ReceitasBot/1.0)",
      Accept: "text/html,application/xhtml+xml",
    },
  });

  if (!resposta.ok) {
    throw new Error(`Falha ao acessar ${url}`);
  }

  const buffer = Buffer.from(await resposta.arrayBuffer());
  if (buffer.length > limiteBytes) {
    throw new Error("Pagina muito grande");
  }

  return buffer.toString("utf8");
}

function adicionarLinkUnico(links, link) {
  if (link && !links.includes(link)) {
    links.push(link);
  }
}

function extrairLinksDuckDuckGo(htmlBusca, links) {
  for (const item of String(htmlBusca || "").matchAll(/<a[^>]*class=["'][^"']*result__a[^"']*["'][^>]*>/gi)) {
    const href = item[0].match(/\shref=["']([^"']+)["']/i);
    if (!href) continue;

    let link = decodificarHtml(href[1]);
    try {
      if (link.startsWith("//")) {
        link = `https:${link}`;
      }
      const urlLink = new URL(link);
      if (urlLink.searchParams.has("uddg")) {
        link = urlLink.searchParams.get("uddg");
      }
    } catch {
      continue;
    }

    adicionarLinkUnico(links, link);
    if (links.length >= 12) break;
  }
}

function decodificarLinkBing(link) {
  try {
    const urlLink = new URL(decodificarHtml(link));
    const codificado = urlLink.searchParams.get("u");
    if (!codificado) return urlLink.toString();

    const base64 = codificado.startsWith("a1") ? codificado.slice(2) : codificado;
    const destino = Buffer.from(base64.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    return destino || urlLink.toString();
  } catch {
    return "";
  }
}

function extrairLinksBing(htmlBusca, links) {
  for (const item of String(htmlBusca || "").matchAll(/<li[^>]+class=["'][^"']*b_algo[^"']*["'][\s\S]*?<a[^>]+href=["']([^"']+)["']/gi)) {
    const link = decodificarLinkBing(item[1]);
    adicionarLinkUnico(links, link);
    if (links.length >= 12) break;
  }
}

function extrairLinksReceitasHtml(htmlBusca, links, baseUrl, termoBusca = "") {
  for (const item of String(htmlBusca || "").matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = decodificarHtml(item[1]);
    const textoLink = limparTextoWeb(item[2]);

    try {
      const url = new URL(href, baseUrl);
      const destino = url.toString();

      if (!/tudogostoso\.com\.br\/receita\/.+\.html/i.test(destino)) continue;
      if (termoBusca && !textoCombinaComBusca(`${textoLink} ${destino}`, termoBusca)) continue;

      adicionarLinkUnico(links, destino);
    } catch {
      // Ignora links invalidos.
    }

    if (links.length >= 24) break;
  }
}

async function adicionarLinksFontesReceitas(busca, ingredientes, links) {
  const termos = [busca, ingredientes].filter(Boolean).join(" ").trim();
  if (!termos) return;

  const urlsBusca = [
    `https://www.tudogostoso.com.br/busca?q=${encodeURIComponent(termos)}`,
  ];

  for (const urlBusca of urlsBusca) {
    try {
      const html = await baixarTexto(urlBusca, 4 * 1024 * 1024);
      extrairLinksReceitasHtml(html, links, urlBusca, termos);
    } catch {
      // Ignora fonte temporariamente indisponivel.
    }

    if (links.length >= 24) break;
  }
}

async function pesquisarReceitasInternet(res, url) {
  const busca = (url.searchParams.get("busca") || "").trim();
  const ingredientes = (url.searchParams.get("ingredientes") || "").trim();
  const partes = [busca, ingredientes, "receita"].filter(Boolean);

  if (partes.length <= 1) {
    enviarJson(res, 400, { erro: "Informe uma receita, categoria ou ingrediente para pesquisar" });
    return;
  }

  const consulta = partes.join(" ");
  const links = [];

  await adicionarLinksFontesReceitas(busca, ingredientes, links);

  try {
    const htmlDuckDuckGo = await baixarTexto(`https://duckduckgo.com/html/?q=${encodeURIComponent(consulta)}`);
    extrairLinksDuckDuckGo(htmlDuckDuckGo, links);
  } catch {
    // Tenta o proximo mecanismo de busca.
  }

  if (links.length < 4) {
    try {
      const htmlBing = await baixarTexto(`https://www.bing.com/search?q=${encodeURIComponent(consulta)}`, 4 * 1024 * 1024);
      extrairLinksBing(htmlBing, links);
    } catch {
      // Sem resultados aproveitaveis.
    }
  }

  const receitas = [];
  for (const link of links) {
    try {
      const limitePagina = /tudogostoso\.com\.br/i.test(link)
        ? 8 * 1024 * 1024
        : 2 * 1024 * 1024;
      const html = await baixarTexto(link, limitePagina);
      for (const receita of extrairReceitasHtml(html, link)) {
        if (!receitas.some((item) => item.nome.toLowerCase() === receita.nome.toLowerCase())) {
          receitas.push(receita);
        }
      }
    } catch {
      // Resultado externo indisponivel ou sem formato aproveitavel.
    }

    if (receitas.length >= 12) break;
  }

  enviarJson(res, 200, receitas);
}

async function garantirCategoria(transaction, descricao) {
  const nome = textoObrigatorio(descricao, "a categoria", 40);
  const existente = await new sql.Request(transaction)
    .input("descricao", sql.VarChar(40), nome)
    .query(`
      SELECT TOP 1 CategoriaCodigo AS codigo
      FROM dbo.Categoria
      WHERE LTRIM(RTRIM(CategoriaDescricao)) = @descricao;
    `);

  if (existente.recordset.length > 0) {
    return existente.recordset[0].codigo;
  }

  const codigoResultado = await new sql.Request(transaction)
    .query("SELECT ISNULL(MAX(CategoriaCodigo), 0) + 1 AS codigo FROM dbo.Categoria WITH (UPDLOCK, HOLDLOCK);");
  const codigo = codigoResultado.recordset[0].codigo;

  await new sql.Request(transaction)
    .input("codigo", sql.SmallInt, codigo)
    .input("descricao", sql.VarChar(40), nome)
    .query("INSERT INTO dbo.Categoria (CategoriaCodigo, CategoriaDescricao) VALUES (@codigo, @descricao);");

  return codigo;
}

async function garantirUnidadeBasica(transaction) {
  const unidade = "unidade";
  const existente = await new sql.Request(transaction)
    .input("unidade", sql.VarChar(20), unidade)
    .query("SELECT 1 FROM dbo.Unidades WHERE LTRIM(RTRIM(Unidade)) = @unidade;");

  if (existente.recordset.length === 0) {
    await new sql.Request(transaction)
      .input("unidade", sql.VarChar(20), unidade)
      .input("quantidade", sql.Decimal(18, 6), 1)
      .query("INSERT INTO dbo.Unidades (Unidade, Quantidade) VALUES (@unidade, @quantidade);");
  }

  return unidade;
}

async function garantirIngredienteBasico(transaction, nome, unidade) {
  const ingrediente = textoObrigatorio(nome, "o ingrediente", 60).toUpperCase();
  const existente = await new sql.Request(transaction)
    .input("nome", sql.VarChar(60), ingrediente)
    .query("SELECT 1 FROM dbo.Ingrediente WHERE IngredienteNome = @nome;");

  if (existente.recordset.length === 0) {
    await new sql.Request(transaction)
      .input("nome", sql.VarChar(60), ingrediente)
      .input("tipo", sql.VarChar(1), "s")
      .input("zero", sql.Int, 0)
      .query(`
        INSERT INTO dbo.Ingrediente (
          IngredienteNome,
          IngredienteTipo,
          IngredienteCalorias,
          IngredienteProteinas,
          IngredienteCarboidratos,
          IngredienteGorduras
        )
        VALUES (@nome, @tipo, @zero, @zero, @zero, @zero);
      `);
  }

  const medida = await new sql.Request(transaction)
    .input("nome", sql.VarChar(60), ingrediente)
    .input("unidade", sql.VarChar(20), unidade)
    .query(`
      SELECT 1
      FROM dbo.IngredienteMedida
      WHERE IngredienteNome = @nome AND IngredienteMedidaUnidade = @unidade;
    `);

  if (medida.recordset.length === 0) {
    await new sql.Request(transaction)
      .input("nome", sql.VarChar(60), ingrediente)
      .input("unidade", sql.VarChar(20), unidade)
      .input("peso", sql.Decimal(18, 6), 1)
      .query(`
        INSERT INTO dbo.IngredienteMedida (
          IngredienteNome,
          IngredienteMedidaUnidade,
          IngredienteMedidaPeso
        )
        VALUES (@nome, @unidade, @peso);
      `);
  }

  return ingrediente;
}

async function baixarImagemReceita(urlImagem, nomeReceita) {
  if (!urlImagem) return null;

  try {
    const resposta = await fetch(urlImagem, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ReceitasBot/1.0)" },
    });
    if (!resposta.ok) return null;

    const mimeType = String(resposta.headers.get("content-type") || "").split(";")[0].toLowerCase();
    const extensoes = {
      "image/jpeg": ".jpg",
      "image/png": ".png",
      "image/webp": ".webp",
    };
    const extensao = extensoes[mimeType];
    if (!extensao) return null;

    const bytes = Buffer.from(await resposta.arrayBuffer());
    if (bytes.length === 0 || bytes.length > 8 * 1024 * 1024) return null;

    return {
      caminho: path.join(imagensReceitasDir, `${normalizarNomeArquivo(nomeReceita)}${extensao}`),
      bytes,
    };
  } catch {
    return null;
  }
}

async function importarReceitaInternet(req, res) {
  const dados = await lerCorpoJson(req);
  const nome = textoObrigatorio(dados.nome, "o nome da receita", 60).toUpperCase();
  const categoria = textoObrigatorio(dados.categoria, "a categoria", 40);
  const ingredientesOriginais = Array.isArray(dados.ingredientes) ? dados.ingredientes : [];
  const ingredientes = [...new Set(ingredientesOriginais.map((item) => limparTextoWeb(item).slice(0, 60)).filter(Boolean))];

  if (ingredientes.length === 0) {
    throw new Error("A receita importada nao trouxe ingredientes");
  }

  const fonte = limparTextoWeb(dados.fonte);
  const identificacao = limparTextoWeb(dados.identificacao);
  const instrucoes = [
    limparTextoWeb(dados.instrucoes) || "Modo de preparo nao informado na fonte.",
    identificacao ? `Identificacao: ${identificacao}` : "",
    fonte ? `Fonte: ${fonte}` : "",
  ].filter(Boolean).join("\n\n").slice(0, 8000);
  const pessoas = Number.parseInt(dados.pessoas, 10) || 0;
  const pool = await obterPool();
  const transaction = new sql.Transaction(pool);
  let imagem = null;

  await transaction.begin();

  try {
    const existente = await new sql.Request(transaction)
      .input("nome", sql.VarChar(60), nome)
      .query("SELECT 1 FROM dbo.Receita WHERE ReceitaNome = @nome;");

    if (existente.recordset.length > 0) {
      throw new Error("Ja existe uma receita com esse nome");
    }

    const categoriaCodigo = await garantirCategoria(transaction, categoria);
    const unidade = await garantirUnidadeBasica(transaction);

    await new sql.Request(transaction)
      .input("nome", sql.VarChar(60), nome)
      .input("instrucoes", sql.VarChar(sql.MAX), instrucoes)
      .input("pessoas", sql.Int, pessoas)
      .input("zero", sql.Int, 0)
      .input("imagem", sql.VarBinary(sql.MAX), Buffer.alloc(0))
      .input("categoriaCodigo", sql.SmallInt, categoriaCodigo)
      .query(`
        INSERT INTO dbo.Receita (
          ReceitaNome,
          ReceitaInstrucoes,
          ReceitaPessoas,
          ReceitaPeso,
          ReceitaCalorias,
          ReceitaProteinas,
          ReceitaCarboidratos,
          ReceitaGorduras,
          ReceitaImagem,
          CategoriaCodigo
        )
        VALUES (@nome, @instrucoes, @pessoas, @zero, @zero, @zero, @zero, @zero, @imagem, @categoriaCodigo);
      `);

    for (const item of ingredientes) {
      const ingrediente = await garantirIngredienteBasico(transaction, item, unidade);
      await new sql.Request(transaction)
        .input("receitaNome", sql.VarChar(60), nome)
        .input("ingredienteNome", sql.VarChar(60), ingrediente)
        .input("quantidade", sql.Decimal(18, 6), 1)
        .input("unidade", sql.VarChar(20), unidade)
        .input("tipo", sql.VarChar(1), "s")
        .query(`
          INSERT INTO dbo.ReceitaIngrediente (
            ReceitaNome,
            IngredienteNome,
            ReceitaIngredienteQuantidade,
            ReceitaIngredienteUnidade,
            ReceitaIngredienteTipo
          )
          VALUES (@receitaNome, @ingredienteNome, @quantidade, @unidade, @tipo);
        `);
    }

    await transaction.commit();
    imagem = await baixarImagemReceita(dados.imagemUrl, nome);
  } catch (err) {
    await transaction.rollback();
    throw err;
  }

  if (imagem) {
    fs.mkdirSync(imagensReceitasDir, { recursive: true });
    fs.writeFileSync(imagem.caminho, imagem.bytes);
  }

  enviarJson(res, 201, {
    ok: true,
    nome,
  });
}

function extrairUrlsImagensBing(htmlBusca) {
  const imagens = [];
  const dominiosBloqueados = [
    "rule34",
    "porn",
    "xxx",
    "xvideos",
    "redtube",
  ];

  for (const item of String(htmlBusca || "").matchAll(/murl(?:&quot;|")\s*:\s*(?:&quot;|")([\s\S]*?)(?:&quot;|")[\s\S]*?turl(?:&quot;|")\s*:\s*(?:&quot;|")([\s\S]*?)(?:&quot;|")[\s\S]*?t(?:&quot;|")\s*:\s*(?:&quot;|")([\s\S]*?)(?:&quot;|")/gi)) {
    const urlImagem = decodificarHtml(item[1])
      .replace(/\\\//g, "/")
      .replace(/\\"/g, "\"");
    const miniatura = decodificarHtml(item[2])
      .replace(/\\\//g, "/")
      .replace(/\\"/g, "\"");
    const titulo = limparTextoWeb(item[3]);

    try {
      const url = new URL(urlImagem);
      if (!/^https?:$/.test(url.protocol)) continue;
      const host = url.hostname.toLowerCase();
      if (dominiosBloqueados.some((dominio) => host.includes(dominio))) continue;
      if (!imagens.some((imagem) => imagem.url === url.toString())) {
        imagens.push({
          url: url.toString(),
          thumbnailUrl: miniatura,
          titulo,
        });
      }
    } catch {
      // Ignora URLs invalidas retornadas pelo buscador.
    }

    if (imagens.length >= 18) break;
  }

  return imagens;
}

function adicionarImagemUnica(imagens, imagem) {
  if (!imagem?.url) return;

  try {
    const url = new URL(imagem.url);
    if (!/^https?:$/.test(url.protocol)) return;
    if (!imagens.some((item) => item.url === url.toString())) {
      imagens.push({
        url: url.toString(),
        thumbnailUrl: imagem.thumbnailUrl || "",
        titulo: imagem.titulo || "",
        fonte: imagem.fonte || "",
      });
    }
  } catch {
    // Ignora URLs invalidas.
  }
}

async function pesquisarImagensDuckDuckGo(consulta) {
  const imagens = [];
  const htmlInicial = await baixarTexto(`https://duckduckgo.com/?q=${encodeURIComponent(consulta)}&iax=images&ia=images`);
  const vqd = htmlInicial.match(/vqd=['"]?([^'"&]+)['"]?/i)?.[1];

  if (!vqd) return imagens;

  const resposta = await fetch(`https://duckduckgo.com/i.js?l=br-pt&o=json&q=${encodeURIComponent(consulta)}&vqd=${encodeURIComponent(vqd)}&f=,,,&p=1`, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; ReceitasBot/1.0)",
      Accept: "application/json",
      Referer: "https://duckduckgo.com/",
    },
  });

  if (!resposta.ok) return imagens;

  const dados = await resposta.json();
  const resultados = Array.isArray(dados.results) ? dados.results : [];

  for (const item of resultados) {
    adicionarImagemUnica(imagens, {
      url: item.image,
      thumbnailUrl: item.thumbnail,
      titulo: limparTextoWeb(item.title),
      fonte: item.url,
    });
    if (imagens.length >= 30) break;
  }

  return imagens;
}

function imagemPareceAproveitavel(urlImagem) {
  const texto = normalizarTermoBusca(urlImagem);
  const bloqueados = [
    "/assets/",
    "/themes/",
    "logo",
    "avatar",
    "profile",
    "placeholder",
    "sprite",
    "icon",
    "favicon",
    "banner",
    "doubleclick",
  ];

  if (bloqueados.some((termo) => texto.includes(termo))) return false;
  return /\.(jpe?g|png|webp)(\?|#|$)/i.test(urlImagem);
}

function extrairImagemMeta(html, urlOrigem) {
  const metas = [
    /<meta[^>]+(?:property|name)=["']og:image["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']og:image["'][^>]*>/i,
    /<meta[^>]+(?:property|name)=["']twitter:image["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']twitter:image["'][^>]*>/i,
  ];

  for (const regex of metas) {
    const match = String(html || "").match(regex);
    if (!match) continue;

    try {
      return new URL(decodificarHtml(match[1]), urlOrigem).toString();
    } catch {
      // Tenta o proximo metadado.
    }
  }

  return "";
}

function extrairImagensPaginaReceita(html, urlOrigem) {
  const imagens = [];

  for (const receita of extrairReceitasHtml(html, urlOrigem)) {
    adicionarImagemUnica(imagens, {
      url: receita.imagemUrl,
      titulo: receita.nome,
      fonte: urlOrigem,
    });
  }

  adicionarImagemUnica(imagens, {
    url: extrairImagemMeta(html, urlOrigem),
    fonte: urlOrigem,
  });

  for (const match of String(html || "").matchAll(/<img[^>]+>/gi)) {
    const tag = match[0];
    const candidatos = [];
    const src = tag.match(/\s(?:src|data-src|data-lazy-src|data-full)=["']([^"']+)["']/i);
    const srcset = tag.match(/\s(?:srcset|data-srcset)=["']([^"']+)["']/i);
    const alt = tag.match(/\salt=["']([^"']*)["']/i);
    const largura = Number(tag.match(/\swidth=["']?(\d+)/i)?.[1] || 0);
    const altura = Number(tag.match(/\sheight=["']?(\d+)/i)?.[1] || 0);
    const titulo = limparTextoWeb(alt?.[1] || "");

    for (const extra of tag.matchAll(/\sdata-full=["']([^"']+)["']/gi)) {
      candidatos.push(extra[1]);
    }

    if (src) {
      candidatos.push(src[1]);
    }

    if (srcset) {
      for (const item of srcset[1].split(",")) {
        const urlCandidata = item.trim().split(/\s+/)[0];
        if (urlCandidata) candidatos.push(urlCandidata);
      }
    }

    for (const candidato of candidatos) {
      try {
        const urlImagem = new URL(decodificarHtml(candidato), urlOrigem).toString();
        if (!imagemPareceAproveitavel(urlImagem)) continue;
        if (largura && altura && (largura < 260 || altura < 180)) continue;
        adicionarImagemUnica(imagens, {
          url: urlImagem,
          titulo,
          fonte: urlOrigem,
        });
      } catch {
        // Ignora imagem invalida.
      }
    }

    if (imagens.length >= 10) break;
  }

  return imagens;
}

function normalizarTermoBusca(texto) {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const PALAVRAS_IGNORADAS_BUSCA = new Set([
  "a",
  "ao",
  "aos",
  "as",
  "com",
  "como",
  "da",
  "das",
  "de",
  "do",
  "dos",
  "e",
  "em",
  "o",
  "os",
  "para",
  "prato",
  "pronto",
  "receita",
  "receitas",
]);

function reduzirPalavraBusca(palavra) {
  if (palavra.length > 4 && palavra.endsWith("oes")) return `${palavra.slice(0, -3)}ao`;
  if (palavra.length > 4 && palavra.endsWith("es")) return palavra.slice(0, -2);
  if (palavra.length > 3 && palavra.endsWith("s")) return palavra.slice(0, -1);
  return palavra;
}

function palavrasSignificativasBusca(texto) {
  return normalizarTermoBusca(texto)
    .split(/[^a-z0-9]+/i)
    .map(reduzirPalavraBusca)
    .filter((palavra) => palavra.length >= 3 && !PALAVRAS_IGNORADAS_BUSCA.has(palavra));
}

function textoCombinaComBusca(texto, busca) {
  const palavras = [...new Set(palavrasSignificativasBusca(busca))];
  if (palavras.length === 0) return true;

  const textoNormalizado = normalizarTermoBusca(texto);
  const encontradas = palavras.filter((palavra) => textoNormalizado.includes(palavra));
  const minimo = palavras.length <= 2 ? palavras.length : 2;
  return encontradas.length >= minimo;
}

function imagemCombinaComBusca(imagem, busca) {
  return textoCombinaComBusca(`${imagem.titulo || ""} ${imagem.fonte || ""} ${imagem.url || ""}`, busca);
}

function paginaCombinaComBusca(html, urlOrigem, busca) {
  const titulo = limparTextoWeb(
    html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1]
    || html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
    || html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
    || ""
  );

  return textoCombinaComBusca(`${titulo} ${urlOrigem}`, busca);
}

function montarConsultasImagemReceita(receita) {
  const nome = String(receita || "").trim();
  const normalizado = normalizarTermoBusca(nome);
  const consultas = [
    `${nome} receita`,
    `"${nome}" receita`,
    `${normalizado} receita`,
  ];

  if (normalizado.includes("batata suica")) {
    consultas.push(
      normalizado.replace("batata suica", "batata rosti"),
      normalizado.replace("batata suica", "batata rostie"),
      normalizado.replace("batata suica", "batata rosti receita"),
      normalizado.replace("batata suica", "batata rostie receita")
    );
  }

  return [...new Set(consultas)];
}

async function pesquisarLinksWeb(consulta) {
  const links = [];

  await adicionarLinksFontesReceitas(consulta, "", links);

  try {
    const htmlDuckDuckGo = await baixarTexto(`https://duckduckgo.com/html/?q=${encodeURIComponent(consulta)}`);
    extrairLinksDuckDuckGo(htmlDuckDuckGo, links);
  } catch {
    // Tenta Bing.
  }

  if (links.length < 6) {
    try {
      const htmlBing = await baixarTexto(`https://www.bing.com/search?q=${encodeURIComponent(consulta)}`, 4 * 1024 * 1024);
      extrairLinksBing(htmlBing, links);
    } catch {
      // Sem resultados aproveitaveis.
    }
  }

  return links;
}

async function pesquisarImagensReceita(res, url) {
  const receita = (url.searchParams.get("receita") || "").trim();

  if (!receita) {
    enviarJson(res, 400, { erro: "Informe a receita para pesquisar imagens" });
    return;
  }

  const imagens = [];
  const consultas = montarConsultasImagemReceita(receita);

  for (const consulta of consultas.slice(0, 4)) {
    try {
      for (const imagem of await pesquisarImagensDuckDuckGo(consulta)) {
        if (!imagemCombinaComBusca(imagem, receita)) continue;
        adicionarImagemUnica(imagens, imagem);
      }
    } catch {
      // Tenta as proximas fontes.
    }

    if (imagens.length >= 24) break;
  }

  for (const consulta of consultas) {
    const links = await pesquisarLinksWeb(consulta);

    for (const link of links.slice(0, 12)) {
      try {
        const html = await baixarTexto(link);
        if (!paginaCombinaComBusca(html, link, receita)) continue;
        for (const imagem of extrairImagensPaginaReceita(html, link)) {
          adicionarImagemUnica(imagens, imagem);
        }
      } catch {
        // Ignora paginas externas indisponiveis.
      }

      if (imagens.length >= 30) break;
    }

    if (imagens.length >= 24) break;
  }

  if (imagens.length < 24) {
    for (const consulta of consultas.slice(0, 3)) {
      try {
        const consultaImagem = `${consulta} prato pronto`;
        const htmlBusca = await baixarTexto(`https://www.bing.com/images/search?safeSearch=Strict&q=${encodeURIComponent(consultaImagem)}`, 4 * 1024 * 1024);
        for (const imagem of extrairUrlsImagensBing(htmlBusca)) {
          if (!imagemCombinaComBusca(imagem, receita)) continue;
          adicionarImagemUnica(imagens, imagem);
        }
      } catch {
        // Sem imagens adicionais.
      }

      if (imagens.length >= 30) break;
    }
  }

  const imagensValidas = [];
  for (const imagem of imagens) {
    const urlValidacao = imagem.thumbnailUrl || imagem.url;
    if (await imagemRemotaValida(urlValidacao)) {
      imagensValidas.push(imagem);
    }

    if (imagensValidas.length >= 30) break;
  }

  enviarJson(res, 200, imagensValidas);
}

async function baixarImagemRemota(urlImagem, limiteBytes = 8 * 1024 * 1024) {
  const resposta = await fetch(urlImagem, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; ReceitasBot/1.0)",
      Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
    },
  });

  if (!resposta.ok) {
    throw new Error("Nao foi possivel baixar a imagem selecionada");
  }

  const bytes = Buffer.from(await resposta.arrayBuffer());
  if (bytes.length === 0) {
    throw new Error("Imagem selecionada invalida");
  }

  if (bytes.length > limiteBytes) {
    throw new Error("A imagem deve ter no maximo 8 MB");
  }

  const mimeType = detectarMimeImagem(bytes);
  if (!["image/jpeg", "image/png", "image/webp"].includes(mimeType)) {
    throw new Error("Selecione uma imagem JPG, PNG ou WEBP");
  }

  return { bytes, mimeType };
}

async function imagemRemotaValida(urlImagem) {
  try {
    await baixarImagemRemota(urlImagem, 4 * 1024 * 1024);
    return true;
  } catch {
    return false;
  }
}

async function proxyImagemInternet(res, url) {
  const urlImagem = (url.searchParams.get("url") || "").trim();

  if (!urlImagem) {
    enviarJson(res, 400, { erro: "Informe a URL da imagem" });
    return;
  }

  try {
    const { bytes, mimeType } = await baixarImagemRemota(urlImagem, 4 * 1024 * 1024);
    res.writeHead(200, {
      "Content-Type": mimeType,
      "Cache-Control": "public, max-age=86400",
    });
    res.end(bytes);
  } catch {
    enviarJson(res, 404, { erro: "Imagem indisponivel" });
  }
}

async function baixarImagemUnicaParaBanco(urlImagem) {
  const { bytes } = await baixarImagemRemota(urlImagem);
  return bytes;
}

async function baixarImagemParaBanco(urlImagem, urlAlternativa = "") {
  try {
    return await baixarImagemUnicaParaBanco(urlImagem);
  } catch (err) {
    if (!urlAlternativa) throw err;
    return baixarImagemUnicaParaBanco(urlAlternativa);
  }
}

function removerImagemLocalReceita(nome) {
  const base = normalizarNomeArquivo(nome);
  for (const extensao of [".jpg", ".jpeg", ".png", ".webp"]) {
    const caminho = path.join(imagensReceitasDir, `${base}${extensao}`);
    if (fs.existsSync(caminho)) {
      fs.unlinkSync(caminho);
    }
  }
}

function renomearImagemLocalReceita(nomeOriginal, nomeNovo) {
  const baseOriginal = normalizarNomeArquivo(nomeOriginal);
  const baseNovo = normalizarNomeArquivo(nomeNovo);

  if (!baseOriginal || !baseNovo || baseOriginal === baseNovo) return;

  for (const extensao of [".jpg", ".jpeg", ".png", ".webp"]) {
    const origem = path.join(imagensReceitasDir, `${baseOriginal}${extensao}`);
    const destino = path.join(imagensReceitasDir, `${baseNovo}${extensao}`);

    if (fs.existsSync(origem)) {
      fs.mkdirSync(imagensReceitasDir, { recursive: true });
      if (fs.existsSync(destino)) {
        fs.unlinkSync(destino);
      }
      fs.renameSync(origem, destino);
      return;
    }
  }
}

async function salvarImagemReceitaInternet(req, res) {
  const dados = await lerCorpoJson(req, 1024 * 1024);
  const nome = textoObrigatorio(dados.nome, "o nome da receita", 60).toUpperCase();
  const urlImagem = textoObrigatorio(dados.urlImagem, "a URL da imagem", 2048);
  const urlAlternativa = String(dados.urlAlternativa || "").trim();
  const bytes = await baixarImagemParaBanco(urlImagem, urlAlternativa);
  const pool = await obterPool();
  const resultado = await pool.request()
    .input("nome", sql.VarChar(60), nome)
    .input("imagem", sql.VarBinary(sql.MAX), bytes)
    .query(`
      UPDATE dbo.Receita
      SET ReceitaImagem = @imagem
      WHERE ReceitaNome = @nome;

      SELECT @@ROWCOUNT AS alteradas;
    `);

  if (!resultado.recordset[0]?.alteradas) {
    enviarJson(res, 404, { erro: "Receita nao encontrada" });
    return;
  }

  removerImagemLocalReceita(nome);

  enviarJson(res, 200, {
    ok: true,
    nome,
  });
}

async function salvarImagemReceitaLocal(req, res) {
  const dados = await lerCorpoJson(req, 12 * 1024 * 1024);
  const nome = textoObrigatorio(dados.nome, "o nome da receita", 60).toUpperCase();
  const imagem = prepararImagemReceita(nome, dados.imagem);

  if (!imagem) {
    enviarJson(res, 400, { erro: "Informe a imagem local" });
    return;
  }

  const pool = await obterPool();
  const resultado = await pool.request()
    .input("nome", sql.VarChar(60), nome)
    .input("imagem", sql.VarBinary(sql.MAX), imagem.bytes)
    .query(`
      UPDATE dbo.Receita
      SET ReceitaImagem = @imagem
      WHERE ReceitaNome = @nome;

      SELECT @@ROWCOUNT AS alteradas;
    `);

  if (!resultado.recordset[0]?.alteradas) {
    enviarJson(res, 404, { erro: "Receita nao encontrada" });
    return;
  }

  removerImagemLocalReceita(nome);

  enviarJson(res, 200, {
    ok: true,
    nome,
  });
}

async function tratarApi(req, res, url) {
  try {
    if (req.method === "GET" && url.pathname === "/api/auth/status") {
      const token = lerCookies(req).receitasSessao;
      const sessao = token ? sessoes.get(token) : null;
      enviarJson(res, 200, {
        autenticado: Boolean(sessao),
        usuario: sessao?.usuario,
        nome: sessao?.nome,
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/auth/login") {
      await login(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/auth/logout") {
      logout(req, res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/saude") {
      enviarJson(res, 200, {
        ok: true,
        cliente: dbClient,
        banco: dbConfig.database,
        arquivo: dbClient === "sqlite" ? dbConfig.filename : undefined,
        dataHora: new Date().toISOString(),
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/usuarios") {
      if (!exigirAutenticacao(req, res)) return;
      await listarUsuarios(res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/usuarios") {
      if (!exigirAutenticacao(req, res)) return;
      await salvarUsuario(req, res);
      return;
    }

    if (req.method === "DELETE" && url.pathname === "/api/usuarios") {
      if (!exigirAutenticacao(req, res)) return;
      await excluirUsuario(req, res, url);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/categorias") {
      await listarCategorias(res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/categorias") {
      if (!exigirAutenticacao(req, res)) return;
      await criarCategoria(req, res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/unidades") {
      await listarUnidades(res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/unidades") {
      if (!exigirAutenticacao(req, res)) return;
      await criarUnidade(req, res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/ingredientes") {
      await listarIngredientes(res, url);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/ingredientes") {
      if (!exigirAutenticacao(req, res)) return;
      await criarIngrediente(req, res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/ingredientes/medidas") {
      await listarMedidasIngrediente(res, url);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/receitas") {
      await listarReceitas(res, url);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/receitas") {
      if (!exigirAutenticacao(req, res)) return;
      await criarReceita(req, res);
      return;
    }

    if (req.method === "PUT" && url.pathname === "/api/receitas") {
      if (!exigirAutenticacao(req, res)) return;
      await atualizarReceita(req, res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/receitas/detalhe") {
      await obterReceita(res, url);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/receitas/imagem") {
      await obterImagemReceita(res, url);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/internet/receitas") {
      if (!exigirAutenticacao(req, res)) return;
      await pesquisarReceitasInternet(res, url);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/internet/importar") {
      if (!exigirAutenticacao(req, res)) return;
      await importarReceitaInternet(req, res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/internet/imagens") {
      if (!exigirAutenticacao(req, res)) return;
      await pesquisarImagensReceita(res, url);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/internet/imagem-proxy") {
      if (!exigirAutenticacao(req, res)) return;
      await proxyImagemInternet(res, url);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/receitas/imagem") {
      if (!exigirAutenticacao(req, res)) return;
      await salvarImagemReceitaInternet(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/receitas/imagem/local") {
      if (!exigirAutenticacao(req, res)) return;
      await salvarImagemReceitaLocal(req, res);
      return;
    }

    enviarJson(res, 404, { erro: "Rota da API nao encontrada" });
  } catch (err) {
    enviarErro(res, 500, "Erro ao processar a requisicao", err.message);
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname.startsWith("/api/")) {
    tratarApi(req, res, url);
    return;
  }

  const caminho = url.pathname === "/"
    ? path.join(publicDir, "index.html")
    : path.join(publicDir, path.normalize(url.pathname));

  if (req.method === "GET" && paginasProtegidas.has(url.pathname) && !usuarioAutenticado(req)) {
    res.writeHead(302, {
      Location: "./?login=1",
    });
    res.end();
    return;
  }

  if (!caminho.startsWith(publicDir)) {
    enviarJson(res, 403, { erro: "Acesso negado" });
    return;
  }

  enviarArquivo(res, caminho);
});

server.listen(port, host, () => {
  console.log(`API receitas rodando em http://${host}:${port}`);
});
