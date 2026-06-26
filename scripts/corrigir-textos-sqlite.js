require("dotenv").config();

const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const caminhoInformado = args.find((arg) => !arg.startsWith("--"));

const correcoes = [
  ["SANDU-CHE", "SANDUÍCHE"],
  ["CONTRA-FILE", "CONTRA-FILÉ"],
  ["GRAO-DE-BICO", "GRÃO-DE-BICO"],
  ["MEDITERR-NEA", "MEDITERRÂNEA"],
  ["ARCO--RIS", "ARCO-ÍRIS"],
  ["AM-NDOAS", "AMÊNDOAS"],
  ["PORTUGU-S", "PORTUGUÊS"],
  ["CAMPON-S", "CAMPONÊS"],
  ["HOLAND-S", "HOLANDÊS"],
  ["MARACUJ-", "MARACUJÁ"],
  ["FRANC-S", "FRANCÊS"],
  ["T-RTARA", "TÁRTARA"],
  ["T-RTARO", "TÁRTARO"],
  ["R-PIDO", "RÁPIDO"],
  ["R-PIDA", "RÁPIDA"],
  ["B-SICA", "BÁSICA"],
  ["B-SICO", "BÁSICO"],
  ["SAUD-VEL", "SAUDÁVEL"],
  ["M-RMORE", "MÁRMORE"],
  ["P-SSEGO", "PÊSSEGO"],
  ["T-PICO", "TÍPICO"],
  ["P-PRICA", "PÁPRICA"],
  ["MO-DA", "MOÍDA"],
  ["F-CIL", "FÁCIL"],
  ["DEL-CIA", "DELÍCIA"],
  ["S-RIAS", "SÉRIAS"],
  ["FUB-", "FUBÁ"],
  ["FRAP-", "FRAPÊ"],
  ["GLAC-", "GLACÊ"],
  ["PAV-", "PAVÊ"],
  ["PAT-", "PATÊ"],
  ["PUR-", "PURÊ"],
  ["ROL-", "ROLÊ"],
  ["SUFL-", "SUFLÊ"],
  ["GELÃIA", "GELÉIA"],
  ["LINGUIÃA", "LINGUIÇA"],
  ["PROVENÃAL", "PROVENÇAL"],
  ["CAÃAROLA", "CAÇAROLA"],
  ["HAMBÃRGUER", "HAMBÚRGUER"],
  ["ESPINHAÃO", "ESPINHAÇO"],
  ["MEUNIÃRE", "MEUNIÈRE"],
  ["HÃNGARO", "HÚNGARO"],
  ["SAUTEÃ", "SAUTÉ"],
  ["POCHÃS", "POCHÊS"],
  ["CAÃÃO", "CAÇÃO"],
  ["FILÃS", "FILÉS"],
  ["FILÃ", "FILÉ"],
  ["ROSÃ", "ROSÉ"],
  ["MAÃÃS", "MAÇÃS"],
  ["MAÃAS", "MAÇÃS"],
  ["MAÃÃ", "MAÇÃ"],
  ["MAÃA", "MAÇÃ"],
  ["LIMEÐA", "LIMEÑA"],
  ["MAáA", "MASSA"],
  ["Maáa", "Massa"],
  ["maáas", "massas"],
  ["maáa", "massa"],
  ["Amaáe-os", "Amasse-os"],
  ["Amaáe-as", "Amasse-as"],
  ["Amaáe-a", "Amasse-a"],
  ["Amaáe-o", "Amasse-o"],
  ["amaáando-as", "amassando-as"],
  ["amaáando", "amassando"],
  ["amaáadas", "amassadas"],
  ["amaáada", "amassada"],
  ["amaáe-as", "amasse-as"],
  ["amaáe-a", "amasse-a"],
  ["amaáe-o", "amasse-o"],
  ["Amaáe", "Amasse"],
  ["amaáe", "amasse"],
  ["Aáe-os", "Asse-os"],
  ["aáe-os", "asse-os"],
  ["aáados", "assados"],
  ["aáadas", "assadas"],
  ["aáando", "assando"],
  ["aáado", "assado"],
  ["aáada", "assada"],
  ["Aáe", "Asse"],
  ["aáe", "asse"],
  ["aáuma", "assuma"],
  ["aáim", "assim"],
  ["engroáar", "engrossar"],
  ["engroáado", "engrossado"],
  ["engroáe", "engrosse"],
  ["groáeiramente", "grosseiramente"],
  ["ultraespeáa", "ultraespessa"],
  ["espeáura", "espessura"],
  ["espeáo", "espesso"],
  ["groáos", "grossos"],
  ["groáas", "grossas"],
  ["groáo", "grosso"],
  ["groáa", "grossa"],
  ["Diásolva", "Dissolva"],
  ["Diáolva", "Dissolva"],
  ["Diáola", "Dissolva"],
  ["diáolvê-la", "dissolvê-la"],
  ["diáolverem", "dissolverem"],
  ["diáolver", "dissolver"],
  ["diáolvidas", "dissolvidas"],
  ["diáolvida", "dissolvida"],
  ["diáolvido", "dissolvido"],
  ["diáolva", "dissolva"],
  ["proceáador", "processador"],
  ["proceáo", "processo"],
  ["preáionando-as", "pressionando-as"],
  ["preáão", "pressão"],
  ["poáível", "possível"],
  ["poáam", "possam"],
  ["poáa", "possa"],
  ["peáoa", "pessoa"],
  ["paáando-os", "passando-os"],
  ["paáando", "passando"],
  ["paáada", "passada"],
  ["paáado", "passado"],
  ["paáas", "passas"],
  ["paáa", "passa"],
  ["Muáarela", "Mussarela"],
  ["muáarela", "mussarela"],
  ["pêáegos", "pêssegos"],
  ["pêáego", "pêssego"],
  ["oáobucos", "ossobucos"],
  ["oáobuco", "ossobuco"],
  ["neceáárias", "necessárias"],
  ["neceáidade", "necessidade"],
  ["necesário", "necessário"],
  ["Deáalgue", "Dessalgue"],
  ["deáalgar", "dessalgar"],
  ["deáalgado", "dessalgado"],
  ["desoáados", "desossados"],
  ["desoáado", "desossado"],
  ["neáe", "nesse"],
  ["neáa", "nessa"],
  ["Eáe", "Esse"],
  ["eáe", "esse"],
  ["eáa", "essa"],
  ["deáe", "desse"],
  ["foáe", "fosse"],
  ["iáo", "isso"],
  ["eáência", "essência"],
  ["mouáes", "mousses"],
  ["mouáe", "mousse"],
  ["Claáico", "Clássico"],
  ["Kaáler", "Kassler"],
  ["couscouáiére", "couscoussière"],
  ["Caáis", "Cassis"],
  ["éltimo", "último"],
  ["éltima", "última"],
  ["camar§es", "camarões"],
  ["piment§es", "pimentões"],
  ["porç§es", "porções"],
  ["lim§es", "limões"],
  ["mexilh§es", "mexilhões"],
  ["mam§es", "mamões"],
  ["bast§es", "bastões"],
  ["empad§es", "empadões"],
  ["instruç§es", "instruções"],
  ["refeiç§es", "refeições"],
  ["Opç§es", "Opções"],
  ["bràcolis", "brócolis"],
  ["pràpria", "própria"],
  ["pràprio", "próprio"],
  ["sàdio", "sódio"],
  ["sà", "só"],
  ["pão de là", "pão de ló"],
  ["Pão de là", "Pão de ló"],
  ["raviàlis", "raviólis"],
  ["raviàli", "ravióli"],
  ["chicària", "chicória"],
  ["fàsforo", "fósforo"],
  ["abricà", "abricó"],
  ["ì superficie", "à superfície"],
  ["ì superfície", "à superfície"],
  ["o ì vinagre", "o vinagre"],
  ["a ì quantidade", "a quantidade"],
  ["a ì panela", "a panela"],
  ["diÔmetro", "diâmetro"],
  ["distÔncia", "distância"],
  ["lÔminas", "lâminas"],
  ["triÔngulos", "triângulos"],
  ["retÔngulo", "retângulo"],
  ["cerÔmica", "cerâmica"],
  ["ChÔteau", "Château"],
  ["ma¯tre", "maître"],
  ["K³mmel", "Kümmel"],
  ["Liq³idifique", "Liquidifique"]
];

function resolverBanco() {
  const candidatos = [
    caminhoInformado,
    process.env.SQLITE_FILE,
    path.join(__dirname, "..", "migracao-sqlite", "app.db"),
    path.join(__dirname, "..", "data", "app.db")
  ].filter(Boolean);

  for (const candidato of candidatos) {
    const absoluto = path.resolve(candidato);
    if (fs.existsSync(absoluto)) return absoluto;
  }

  throw new Error(`Banco SQLite nao encontrado. Informe o caminho: npm run textos:corrigir -- /caminho/app.db`);
}

function quoteId(nome) {
  return `"${String(nome).replace(/"/g, '""')}"`;
}

function colunasTexto(db) {
  const tabelas = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((row) => row.name);
  const colunas = [];

  for (const tabela of tabelas) {
    const info = db.prepare(`PRAGMA table_info(${quoteId(tabela)})`).all();
    for (const coluna of info) {
      if (/TEXT|CHAR|CLOB|VARCHAR|NVARCHAR|NCHAR/i.test(coluna.type || "")) {
        colunas.push({ tabela, coluna: coluna.name });
      }
    }
  }

  return colunas;
}

function corrigirTexto(valor) {
  let corrigido = valor;
  for (const [antes, depois] of correcoes) {
    corrigido = corrigido.split(antes).join(depois);
  }
  return corrigido;
}

function nomeBackup(arquivo) {
  const agora = new Date();
  const stamp = [
    agora.getFullYear(),
    String(agora.getMonth() + 1).padStart(2, "0"),
    String(agora.getDate()).padStart(2, "0"),
    "-",
    String(agora.getHours()).padStart(2, "0"),
    String(agora.getMinutes()).padStart(2, "0"),
    String(agora.getSeconds()).padStart(2, "0")
  ].join("");
  return path.join(path.dirname(arquivo), `app.pre-correcao-textos-${stamp}.db`);
}

const arquivo = resolverBanco();
console.log(`Banco: ${arquivo}`);
console.log(`Modo: ${dryRun ? "simulacao (--dry-run)" : "corrigir de verdade"}`);

if (!dryRun) {
  const backup = nomeBackup(arquivo);
  fs.copyFileSync(arquivo, backup);
  console.log(`Backup criado: ${backup}`);
}

const db = new Database(arquivo, { readonly: dryRun });
if (!dryRun) db.pragma("foreign_keys = OFF");

const resumo = new Map();
const exemplos = [];
let celulas = 0;

const executar = db.transaction(() => {
  for (const { tabela, coluna } of colunasTexto(db)) {
    const rows = db
      .prepare(`SELECT rowid, ${quoteId(coluna)} AS valor FROM ${quoteId(tabela)} WHERE ${quoteId(coluna)} IS NOT NULL`)
      .all();
    const update = dryRun ? null : db.prepare(`UPDATE ${quoteId(tabela)} SET ${quoteId(coluna)} = ? WHERE rowid = ?`);

    for (const row of rows) {
      const original = String(row.valor);
      const corrigido = corrigirTexto(original);
      if (corrigido === original) continue;

      celulas += 1;
      const chave = `${tabela}.${coluna}`;
      resumo.set(chave, (resumo.get(chave) || 0) + 1);
      if (exemplos.length < 12) {
        exemplos.push({ tabela, coluna, rowid: row.rowid, antes: original, depois: corrigido });
      }
      if (!dryRun) update.run(corrigido, row.rowid);
    }
  }
});

executar();
if (!dryRun) db.pragma("foreign_keys = ON");
db.close();

console.log(`Celulas ${dryRun ? "que seriam corrigidas" : "corrigidas"}: ${celulas}`);
for (const [chave, total] of [...resumo.entries()].sort()) {
  console.log(`- ${chave}: ${total}`);
}

if (exemplos.length) {
  console.log("\nExemplos:");
  for (const exemplo of exemplos) {
    console.log(`- ${exemplo.tabela}.${exemplo.coluna}#${exemplo.rowid}`);
    console.log(`  antes: ${exemplo.antes.replace(/\s+/g, " ").trim().slice(0, 180)}`);
    console.log(`  depois: ${exemplo.depois.replace(/\s+/g, " ").trim().slice(0, 180)}`);
  }
}
