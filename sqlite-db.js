const path = require("path");
const Database = require("better-sqlite3");

function normalizarSql(textoSql) {
  let sql = String(textoSql || "")
    .replace(/\bdbo\./gi, "")
    .replace(/\bWITH\s*\(\s*UPDLOCK\s*,\s*HOLDLOCK\s*\)/gi, "")
    .replace(/\bISNULL\s*\(/gi, "IFNULL(")
    .replace(/\bDATALENGTH\s*\(/gi, "length(")
    .replace(/CAST\s*\(\s*1\s+AS\s+bit\s*\)/gi, "1")
    .replace(/CAST\s*\(\s*0\s+AS\s+bit\s*\)/gi, "0");

  sql = sql.replace(
    /((?:\b\w+\.)?(?:ReceitaNome|IngredienteNome|IngredienteMedidaUnidade|Unidade))\s*=\s*(@\w+)/gi,
    "LTRIM(RTRIM($1)) = $2"
  );

  const top = sql.match(/\bSELECT\s+TOP\s+(\d+)\s+/i);
  if (top) {
    sql = sql.replace(/\bSELECT\s+TOP\s+\d+\s+/i, "SELECT ");
    if (!/\bLIMIT\s+\d+\b/i.test(sql)) {
      sql = sql.replace(/;?\s*$/, ` LIMIT ${top[1]};`);
    }
  }

  return sql;
}

function dividirStatements(sql) {
  return normalizarSql(sql)
    .split(";")
    .map((parte) => parte.trim())
    .filter(Boolean);
}

class SqliteRequest {
  constructor(contexto) {
    this.db = contexto?.db || contexto;
    this.params = {};
  }

  input(nome, _tipo, valor) {
    this.params[nome] = valor;
    return this;
  }

  async query(sql) {
    const statements = dividirStatements(sql);
    let recordset = [];
    let changes = 0;

    for (const statement of statements) {
      if (/^SELECT\s+@@ROWCOUNT\s+AS\s+alteradas$/i.test(statement)) {
        recordset = [{ alteradas: changes }];
        continue;
      }

      const comando = this.db.prepare(statement);
      if (/^\s*SELECT\b/i.test(statement)) {
        recordset = comando.all(this.params);
      } else {
        const info = comando.run(this.params);
        changes = info.changes || 0;
      }
    }

    return { recordset };
  }
}

class SqliteTransaction {
  constructor(pool) {
    this.db = pool.db;
    this.ativa = false;
  }

  async begin() {
    this.db.exec("BEGIN IMMEDIATE");
    this.ativa = true;
  }

  async commit() {
    if (this.ativa) {
      this.db.exec("COMMIT");
      this.ativa = false;
    }
  }

  async rollback() {
    if (this.ativa) {
      this.db.exec("ROLLBACK");
      this.ativa = false;
    }
  }
}

class SqlitePool {
  constructor(db) {
    this.db = db;
  }

  request() {
    return new SqliteRequest(this.db);
  }
}

async function connect(config = {}) {
  const arquivo = config.filename || process.env.SQLITE_FILE || path.join(__dirname, "migracao-sqlite", "app.db");
  const db = new Database(arquivo);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return new SqlitePool(db);
}

module.exports = {
  connect,
  Request: SqliteRequest,
  Transaction: SqliteTransaction,
  VarChar: () => "TEXT",
  SmallInt: "INTEGER",
  Int: "INTEGER",
  Decimal: () => "REAL",
  VarBinary: () => "BLOB",
  MAX: "MAX",
};
