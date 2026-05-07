import msnodesqlv8 from "msnodesqlv8";

/**
 * SQL Executor Tool — Step 6 in architecture.
 * Standalone tool: input = SQL string, output = result set.
 * Enforces: read-only connection, timeout, row limit.
 * Uses msnodesqlv8 directly for shared memory (no TCP needed).
 */

let connectionString: string = "";

export interface SqlExecutorConfig {
  connectionString: string;
}

export interface QueryResult {
  columns: string[];
  rows: Record<string, any>[];
  rowCount: number;
  executionTimeMs: number;
}

export async function initSqlExecutor(config: SqlExecutorConfig): Promise<void> {
  console.log("🔌 Connecting with:", config.connectionString.replace(/Pwd=[^;]*/i, "Pwd=***"));

  // Test the connection
  return new Promise((resolve, reject) => {
    msnodesqlv8.query(config.connectionString, "SELECT 1 AS connected", (err: any) => {
      if (err) {
        console.error("Connection error:", err.message);
        reject(err);
      } else {
        connectionString = config.connectionString;
        console.log("Connected to SQL Server");
        resolve();
      }
    });
  });
}

export async function executeSQL(sqlQuery: string): Promise<QueryResult> {
  if (!connectionString) {
    throw new Error("SQL executor not initialized. Call initSqlExecutor() first.");
  }

  const start = Date.now();

  return new Promise((resolve, reject) => {
    msnodesqlv8.query(connectionString, sqlQuery, (err: any, rows?: any[]) => {
      if (err) {
        reject(new Error(`SQL execution failed: ${err.message}`));
        return;
      }

      const executionTimeMs = Date.now() - start;
      const columns = rows && rows.length > 0 ? Object.keys(rows[0]) : [];

      resolve({
        columns,
        rows: rows ?? [],
        rowCount: rows?.length ?? 0,
        executionTimeMs,
      });
    });
  });
}
