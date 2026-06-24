require("dotenv").config();

const sql = require("mssql");

const config = {
  user: process.env.SQLSERVER_USER,
  password: process.env.SQLSERVER_PASSWORD,
  server: process.env.SQLSERVER_HOST || "localhost",
  database: process.env.SQLSERVER_DATABASE,
  options: {
    encrypt: false,
    trustServerCertificate: true
  },
  connectionTimeout: 30000,
  requestTimeout: 30000
};

if (process.env.SQLSERVER_INSTANCE) {
  config.options.instanceName = process.env.SQLSERVER_INSTANCE;
} else {
  config.port = Number(process.env.SQLSERVER_PORT || 1433);
}

async function testar() {
  try {
    console.log("Conectando no SQL Server...");

    const pool = await sql.connect(config);

    const result = await pool.request().query(`
      SELECT 
        @@SERVERNAME AS Servidor,
        DB_NAME() AS Banco,
        GETDATE() AS DataHora
    `);

    console.log("Conexão OK:");
    console.table(result.recordset);

    await pool.close();
  } catch (err) {
    console.error("Erro ao conectar:");
    console.error(err);
  }
}

testar();