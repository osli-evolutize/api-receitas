require("dotenv").config();

const sql = require("mssql");
const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");

const sqliteFile = process.env.SQLITE_FILE || "C:\\migracao-sqlite\\app.db";

const sqlConfig = {
  user: process.env.SQLSERVER_USER,
  password: process.env.SQLSERVER_PASSWORD,
  server: process.env.SQLSERVER_HOST || "localhost",
  database: process.env.SQLSERVER_DATABASE,
  options: {
    encrypt: false,
    trustServerCertificate: true
  },
  requestTimeout: 0,
  connectionTimeout: 30000
};

if (process.env.SQLSERVER_INSTANCE) {
  sqlConfig.options.instanceName = process.env.SQLSERVER_INSTANCE;
} else {
  sqlConfig.port = Number(process.env.SQLSERVER_PORT || 1433);
}

function qSqlite(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function qSqlServer(name) {
  return `[${String(name).replace(/]/g, "]]")}]`;
}

function nomeTabelaSQLite(schema, tableName) {
  return schema === "dbo" ? tableName : `${schema}__${tableName}`;
}

function tipoSQLite(col) {
  const tipo = String(col.DATA_TYPE).toLowerCase();

  if (["int", "bigint", "smallint", "tinyint", "bit"].includes(tipo)) {
    return "INTEGER";
  }

  if (["decimal", "numeric", "money", "smallmoney", "float", "real"].includes(tipo)) {
    return "REAL";
  }

  if (["binary", "varbinary", "image", "timestamp", "rowversion"].includes(tipo)) {
    return "BLOB";
  }

  return "TEXT";
}

function converterValor(valor) {
  if (valor === null || valor === undefined) return null;
  if (valor instanceof Date) return valor.toISOString().replace("T", " ").substring(0, 19);
  if (Buffer.isBuffer(valor)) return valor;
  if (typeof valor === "boolean") return valor ? 1 : 0;
  return valor;
}

async function buscarTabelas(pool) {
  const result = await pool.request().query(`
    SELECT 
      s.name AS schema_name,
      t.name AS table_name
    FROM sys.tables t
    INNER JOIN sys.schemas s ON s.schema_id = t.schema_id
    WHERE t.is_ms_shipped = 0
    ORDER BY s.name, t.name
  `);

  return result.recordset;
}

async function buscarColunas(pool, schema, tabela) {
  const result = await pool.request()
    .input("schema", sql.NVarChar, schema)
    .input("tabela", sql.NVarChar, tabela)
    .query(`
      SELECT
        c.COLUMN_NAME,
        c.DATA_TYPE,
        COLUMNPROPERTY(
          OBJECT_ID(QUOTENAME(c.TABLE_SCHEMA) + '.' + QUOTENAME(c.TABLE_NAME)),
          c.COLUMN_NAME,
          'IsIdentity'
        ) AS IS_IDENTITY
      FROM INFORMATION_SCHEMA.COLUMNS c
      WHERE c.TABLE_SCHEMA = @schema
        AND c.TABLE_NAME = @tabela
      ORDER BY c.ORDINAL_POSITION
    `);

  return result.recordset;
}

async function buscarPk(pool, schema, tabela) {
  const result = await pool.request()
    .input("schema", sql.NVarChar, schema)
    .input("tabela", sql.NVarChar, tabela)
    .query(`
      SELECT 
        k.COLUMN_NAME
      FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS t
      INNER JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE k
        ON t.CONSTRAINT_NAME = k.CONSTRAINT_NAME
       AND t.TABLE_SCHEMA = k.TABLE_SCHEMA
       AND t.TABLE_NAME = k.TABLE_NAME
      WHERE t.CONSTRAINT_TYPE = 'PRIMARY KEY'
        AND t.TABLE_SCHEMA = @schema
        AND t.TABLE_NAME = @tabela
      ORDER BY k.ORDINAL_POSITION
    `);

  return result.recordset.map(r => r.COLUMN_NAME);
}

async function contarRegistros(pool, schema, tabela) {
  const result = await pool.request().query(`
    SELECT COUNT(*) AS total
    FROM ${qSqlServer(schema)}.${qSqlServer(tabela)}
  `);

  return Number(result.recordset[0].total);
}

async function migrar() {
  console.log("Conectando no SQL Server...");
  const pool = await sql.connect(sqlConfig);

  console.log("SQLite destino:", sqliteFile);

  fs.mkdirSync(path.dirname(sqliteFile), { recursive: true });

  if (fs.existsSync(sqliteFile)) {
    const backup = `${sqliteFile}.backup-${Date.now()}`;
    fs.copyFileSync(sqliteFile, backup);
    console.log("Backup criado:", backup);
  }

  const db = new Database(sqliteFile);

  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = OFF");
  db.pragma("synchronous = NORMAL");

  const tabelas = await buscarTabelas(pool);

  console.log(`Tabelas encontradas: ${tabelas.length}`);

  for (const tab of tabelas) {
    const schema = tab.schema_name;
    const tabelaOrigem = tab.table_name;
    const tabelaDestino = nomeTabelaSQLite(schema, tabelaOrigem);

    console.log(`\nMigrando ${schema}.${tabelaOrigem} -> ${tabelaDestino}`);

    const colunas = await buscarColunas(pool, schema, tabelaOrigem);
    const pk = await buscarPk(pool, schema, tabelaOrigem);

    if (colunas.length === 0) {
      console.log("  Ignorada: sem colunas.");
      continue;
    }

    db.exec(`DROP TABLE IF EXISTS ${qSqlite(tabelaDestino)}`);

    const defs = colunas.map(col => {
      const nome = col.COLUMN_NAME;
      const tipo = tipoSQLite(col);
      const isPkUnica = pk.length === 1 && pk[0] === nome;
      const isIdentity = Number(col.IS_IDENTITY) === 1;

      if (isPkUnica && isIdentity && tipo === "INTEGER") {
        return `${qSqlite(nome)} INTEGER PRIMARY KEY AUTOINCREMENT`;
      }

      return `${qSqlite(nome)} ${tipo}`;
    });

    const pkIdentity =
      pk.length === 1 &&
      Number(colunas.find(c => c.COLUMN_NAME === pk[0])?.IS_IDENTITY) === 1;

    if (pk.length > 0 && !pkIdentity) {
      defs.push(`PRIMARY KEY (${pk.map(qSqlite).join(", ")})`);
    }

    db.exec(`
      CREATE TABLE ${qSqlite(tabelaDestino)} (
        ${defs.join(",\n        ")}
      )
    `);

    const total = await contarRegistros(pool, schema, tabelaOrigem);
    console.log(`  Registros: ${total}`);

    if (total === 0) continue;

    const nomesColunas = colunas.map(c => c.COLUMN_NAME);

    const insert = db.prepare(`
      INSERT INTO ${qSqlite(tabelaDestino)}
      (${nomesColunas.map(qSqlite).join(", ")})
      VALUES (${nomesColunas.map(() => "?").join(", ")})
    `);

    const inserirTransacao = db.transaction((linhas) => {
      for (const linha of linhas) {
        insert.run(nomesColunas.map(nome => converterValor(linha[nome])));
      }
    });

    const batchSize = 1000;
    let offset = 0;

    while (offset < total) {
      const result = await pool.request().query(`
        SELECT ${nomesColunas.map(qSqlServer).join(", ")}
        FROM ${qSqlServer(schema)}.${qSqlServer(tabelaOrigem)}
        ORDER BY (SELECT NULL)
        OFFSET ${offset} ROWS FETCH NEXT ${batchSize} ROWS ONLY
      `);

      inserirTransacao(result.recordset);

      offset += result.recordset.length;
      console.log(`  Copiados: ${offset}/${total}`);

      if (result.recordset.length === 0) break;
    }
  }

  db.pragma("foreign_keys = ON");
  db.close();
  await pool.close();

  console.log("\nMigração concluída.");
  console.log("Arquivo gerado:", sqliteFile);
}

migrar().catch(err => {
  console.error("\nErro na migração:");
  console.error(err);
  process.exit(1);
});