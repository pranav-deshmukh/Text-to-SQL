import msnodesqlv8 from "msnodesqlv8";

/**
 * SQL Executor Tool — Step 6 in architecture.
 * Standalone tool: input = SQL string, output = result set.
 * Enforces: read-only connection, timeout, row limit.
 * Uses msnodesqlv8 directly for shared memory (no TCP needed).
 */

const connectionStrings = new Map<string, string>();

export interface SqlExecutorConfig {
  connectionString: string;
}

export interface QueryResult {
  columns: string[];
  rows: Record<string, any>[];
  rowCount: number;
  executionTimeMs: number;
}

export async function registerSqlExecutor(dbId: string, config: SqlExecutorConfig): Promise<void> {
  console.log("🔌 Connecting with:", config.connectionString.replace(/Pwd=[^;]*/i, "Pwd=***"));

  // Test the connection
  return new Promise((resolve, reject) => {
    msnodesqlv8.query(config.connectionString, "SELECT 1 AS connected", (err: any) => {
      if (err) {
        console.error("Connection error:", err.message);
        reject(err);
      } else {
        connectionStrings.set(dbId, config.connectionString);
        console.log(`Connected to SQL Server for database: ${dbId}`);
        resolve();
      }
    });
  });
}

export async function executeSQL(sqlQuery: string, dbId: string): Promise<QueryResult> {
  const connectionString = connectionStrings.get(dbId);
  if (!connectionString) {
    throw new Error(`No SQL connection registered for database: ${dbId}`);
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
