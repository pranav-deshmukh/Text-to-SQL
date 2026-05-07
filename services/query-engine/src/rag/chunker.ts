import fs from "fs";
import path from "path";

/**
 * Chunker — splits schema.md + schema_definitions.md into per-table documents.
 * Each chunk = one table with DDL + column definitions + business context.
 * This is the unit of retrieval for RAG.
 */

export interface TableChunk {
  /** e.g. "dbo.rep_master" */
  tableName: string;
  /** Business purpose from schema comments */
  businessPurpose: string;
  /** Full CREATE TABLE DDL */
  ddl: string;
  /** Column definitions with business meanings */
  columnDefinitions: string;
  /** Combined text for embedding */
  embeddingText: string;
}

const DATA_DIR = path.resolve(__dirname, "../../../Data");

/**
 * Parse schema.md into per-table blocks.
 * Each block starts with "-- dbo.<table>" comments and includes the CREATE TABLE.
 */
function parseSchema(schemaContent: string): Map<string, { purpose: string; ddl: string }> {
  const tables = new Map<string, { purpose: string; ddl: string }>();

  // Split on blank line before "-- dbo." comments
  const blocks = schemaContent.split(/\n(?=-- dbo\.)/);

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    // Extract table name from first line: "-- dbo.rep_master"
    const nameMatch = trimmed.match(/^-- (dbo\.\w+)/);
    if (!nameMatch) continue;
    const tableName = nameMatch[1];

    // Extract business purpose from comment lines
    const commentLines = trimmed
      .split("\n")
      .filter((l) => l.startsWith("-- ") && !l.startsWith(`-- ${tableName}`))
      .map((l) => l.replace(/^-- /, "").trim());
    const purpose = commentLines.join(" ");

    // Extract CREATE TABLE block
    const ddlMatch = trimmed.match(/(CREATE TABLE[\s\S]+?\);)/);
    const ddl = ddlMatch ? ddlMatch[1] : "";

    tables.set(tableName, { purpose, ddl });
  }

  return tables;
}

/**
 * Parse schema_definitions.md into per-table column definitions.
 * The file has column defs grouped by table (separated by blank lines).
 * We match columns to tables by checking which table contains that column in the DDL.
 */
function parseDefinitions(
  defsContent: string,
  tablesDDL: Map<string, { purpose: string; ddl: string }>
): Map<string, string[]> {
  const tableDefs = new Map<string, string[]>();

  // Initialize
  for (const name of tablesDDL.keys()) {
    tableDefs.set(name, []);
  }

  // Parse each line like: col_name: "definition"
  const lines = defsContent.split("\n").filter((l) => l.trim());

  for (const line of lines) {
    const match = line.match(/^(\w+):\s+"(.+)"$/);
    if (!match) continue;

    const [, colName, definition] = match;

    // Find which table owns this column
    for (const [tableName, { ddl }] of tablesDDL.entries()) {
      // Check if column appears in this table's DDL
      const colRegex = new RegExp(`\\b${colName}\\b`, "i");
      if (colRegex.test(ddl)) {
        tableDefs.get(tableName)!.push(`${colName}: ${definition}`);
        break; // First match wins (some cols like mkt_val appear in multiple tables)
      }
    }
  }

  return tableDefs;
}

/**
 * Main function: reads schema files, returns per-table chunks ready for embedding.
 */
export function chunkSchemaFiles(): TableChunk[] {
  const schemaContent = fs.readFileSync(path.join(DATA_DIR, "schema.md"), "utf-8");
  const defsContent = fs.readFileSync(path.join(DATA_DIR, "schema_definitions.md"), "utf-8");

  const tablesDDL = parseSchema(schemaContent);
  const tableDefs = parseDefinitions(defsContent, tablesDDL);

  const chunks: TableChunk[] = [];

  for (const [tableName, { purpose, ddl }] of tablesDDL.entries()) {
    const colDefs = tableDefs.get(tableName) || [];
    const columnDefinitions = colDefs.join("\n");

    // Combine everything into one embedding-friendly text
    const embeddingText = [
      `Table: ${tableName}`,
      `Business Purpose: ${purpose}`,
      `DDL:\n${ddl}`,
      `Column Definitions:\n${columnDefinitions}`,
    ].join("\n\n");

    chunks.push({
      tableName,
      businessPurpose: purpose,
      ddl,
      columnDefinitions,
      embeddingText,
    });
  }

  return chunks;
}
