import msnodesqlv8 from "msnodesqlv8";
import { DocumentToStore } from "./vectorStore";

type SqlValue = string | number | boolean | null;

interface TableColumnRow {
  schemaName: string;
  tableName: string;
  columnOrder: number;
  columnName: string;
  dataType: string;
  maxLength: number | null;
  precisionValue: number | null;
  scaleValue: number | null;
  isNullable: boolean;
  isIdentity: boolean;
  isPrimaryKey: boolean;
  defaultDefinition: string | null;
}

interface ForeignKeyRow {
  foreignKeyName: string;
  parentSchema: string;
  parentTable: string;
  parentColumn: string;
  referencedSchema: string;
  referencedTable: string;
  referencedColumn: string;
}

interface RowCountRow {
  schemaName: string;
  tableName: string;
  rowCount: number;
}

interface ModuleRow {
  schemaName: string;
  objectName: string;
  objectType: "procedure" | "view";
  definition: string;
}

interface ModuleParameterRow {
  schemaName: string;
  objectName: string;
  parameterOrder: number;
  parameterName: string;
  dataType: string;
  maxLength: number | null;
  precisionValue: number | null;
  scaleValue: number | null;
  isOutput: boolean;
}

interface DependencyRow {
  schemaName: string;
  objectName: string;
  referencedSchema: string | null;
  referencedEntity: string | null;
}

interface ColumnMetadata {
  name: string;
  dataType: string;
  nullable: boolean;
  isIdentity: boolean;
  isPrimaryKey: boolean;
  defaultDefinition: string | null;
}

interface TableMetadata {
  schemaName: string;
  tableName: string;
  rowCount: number | null;
  columns: ColumnMetadata[];
  outboundRelationships: ForeignKeyRow[];
  inboundRelationships: ForeignKeyRow[];
}

const TABLE_COLUMNS_SQL = `
SELECT
  s.name AS schemaName,
  t.name AS tableName,
  c.column_id AS columnOrder,
  c.name AS columnName,
  ty.name AS dataType,
  CAST(c.max_length AS int) AS maxLength,
  CAST(c.precision AS int) AS precisionValue,
  CAST(c.scale AS int) AS scaleValue,
  CAST(c.is_nullable AS bit) AS isNullable,
  CAST(c.is_identity AS bit) AS isIdentity,
  CAST(CASE WHEN pk.column_id IS NOT NULL THEN 1 ELSE 0 END AS bit) AS isPrimaryKey,
  dc.definition AS defaultDefinition
FROM sys.tables t
JOIN sys.schemas s
  ON s.schema_id = t.schema_id
JOIN sys.columns c
  ON c.object_id = t.object_id
JOIN sys.types ty
  ON ty.user_type_id = c.user_type_id
LEFT JOIN sys.default_constraints dc
  ON dc.parent_object_id = c.object_id
 AND dc.parent_column_id = c.column_id
LEFT JOIN (
  SELECT ic.object_id, ic.column_id
  FROM sys.indexes i
  JOIN sys.index_columns ic
    ON ic.object_id = i.object_id
   AND ic.index_id = i.index_id
  WHERE i.is_primary_key = 1
) pk
  ON pk.object_id = c.object_id
 AND pk.column_id = c.column_id
WHERE t.is_ms_shipped = 0
ORDER BY s.name, t.name, c.column_id;
`;

const FOREIGN_KEYS_SQL = `
SELECT
  fk.name AS foreignKeyName,
  ps.name AS parentSchema,
  pt.name AS parentTable,
  pc.name AS parentColumn,
  rs.name AS referencedSchema,
  rt.name AS referencedTable,
  rc.name AS referencedColumn
FROM sys.foreign_keys fk
JOIN sys.foreign_key_columns fkc
  ON fkc.constraint_object_id = fk.object_id
JOIN sys.tables pt
  ON pt.object_id = fkc.parent_object_id
JOIN sys.schemas ps
  ON ps.schema_id = pt.schema_id
JOIN sys.columns pc
  ON pc.object_id = pt.object_id
 AND pc.column_id = fkc.parent_column_id
JOIN sys.tables rt
  ON rt.object_id = fkc.referenced_object_id
JOIN sys.schemas rs
  ON rs.schema_id = rt.schema_id
JOIN sys.columns rc
  ON rc.object_id = rt.object_id
 AND rc.column_id = fkc.referenced_column_id
WHERE pt.is_ms_shipped = 0
  AND rt.is_ms_shipped = 0
ORDER BY ps.name, pt.name, fk.name;
`;

const ROW_COUNTS_SQL = `
SELECT
  s.name AS schemaName,
  t.name AS tableName,
  CAST(SUM(p.row_count) AS bigint) AS [rowCount]
FROM sys.tables t
JOIN sys.schemas s
  ON s.schema_id = t.schema_id
JOIN sys.dm_db_partition_stats p
  ON p.object_id = t.object_id
 AND p.index_id IN (0, 1)
WHERE t.is_ms_shipped = 0
GROUP BY s.name, t.name;
`;

const MODULES_SQL = `
SELECT
  s.name AS schemaName,
  o.name AS objectName,
  CASE WHEN o.type = 'V' THEN 'view' ELSE 'procedure' END AS objectType,
  m.definition AS definition
FROM sys.objects o
JOIN sys.schemas s
  ON s.schema_id = o.schema_id
JOIN sys.sql_modules m
  ON m.object_id = o.object_id
WHERE o.is_ms_shipped = 0
  AND o.type IN ('P', 'V')
ORDER BY s.name, o.name;
`;

const MODULE_PARAMETERS_SQL = `
SELECT
  s.name AS schemaName,
  o.name AS objectName,
  p.parameter_id AS parameterOrder,
  p.name AS parameterName,
  ty.name AS dataType,
  CAST(p.max_length AS int) AS maxLength,
  CAST(p.precision AS int) AS precisionValue,
  CAST(p.scale AS int) AS scaleValue,
  CAST(p.is_output AS bit) AS isOutput
FROM sys.objects o
JOIN sys.schemas s
  ON s.schema_id = o.schema_id
JOIN sys.parameters p
  ON p.object_id = o.object_id
JOIN sys.types ty
  ON ty.user_type_id = p.user_type_id
WHERE o.is_ms_shipped = 0
  AND o.type = 'P'
ORDER BY s.name, o.name, p.parameter_id;
`;

const MODULE_DEPENDENCIES_SQL = `
SELECT
  ss.name AS schemaName,
  so.name AS objectName,
  rs.name AS referencedSchema,
  sed.referenced_entity_name AS referencedEntity
FROM sys.sql_expression_dependencies sed
JOIN sys.objects so
  ON so.object_id = sed.referencing_id
JOIN sys.schemas ss
  ON ss.schema_id = so.schema_id
LEFT JOIN sys.schemas rs
  ON rs.name = sed.referenced_schema_name
WHERE so.is_ms_shipped = 0
  AND so.type IN ('P', 'V')
  AND sed.referenced_entity_name IS NOT NULL
ORDER BY ss.name, so.name;
`;

const CHECK_CONSTRAINTS_SQL = `
SELECT
  s.name AS schemaName,
  t.name AS tableName,
  cc.name AS constraintName,
  cc.definition AS checkDefinition
FROM sys.check_constraints cc
JOIN sys.tables t
  ON cc.parent_object_id = t.object_id
JOIN sys.schemas s
  ON s.schema_id = t.schema_id
WHERE t.is_ms_shipped = 0
ORDER BY s.name, t.name, cc.name;
`;

const CODE_COLUMNS_SQL = `
SELECT
  s.name AS schemaName,
  t.name AS tableName,
  c.name AS columnName
FROM sys.columns c
JOIN sys.tables t
  ON c.object_id = t.object_id
JOIN sys.schemas s
  ON s.schema_id = t.schema_id
JOIN sys.types tp
  ON tp.user_type_id = c.user_type_id
WHERE tp.name IN ('char','varchar','nchar','nvarchar')
  AND c.max_length BETWEEN 1 AND 20
  AND t.is_ms_shipped = 0
ORDER BY s.name, t.name, c.name;
`;

interface CheckConstraintRow {
  schemaName: string;
  tableName: string;
  constraintName: string;
  checkDefinition: string;
}

interface CodeColumnRow {
  schemaName: string;
  tableName: string;
  columnName: string;
}

interface ColumnProfileValue {
  val: string | null;
  cnt: number;
}

function runQuery<T>(connectionString: string, sql: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    msnodesqlv8.query(connectionString, sql, (err: any, rows?: T[]) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(rows ?? []);
    });
  });
}

function formatDataType(
  dataType: string,
  maxLength: number | null,
  precisionValue: number | null,
  scaleValue: number | null
): string {
  const normalized = dataType.toLowerCase();

  if (["varchar", "char", "varbinary", "binary"].includes(normalized)) {
    if (maxLength === null) return dataType;
    return `${dataType}(${maxLength === -1 ? "max" : maxLength})`;
  }

  if (["nvarchar", "nchar"].includes(normalized)) {
    if (maxLength === null) return dataType;
    const displayLength = maxLength === -1 ? "max" : Math.floor(maxLength / 2);
    return `${dataType}(${displayLength})`;
  }

  if (["decimal", "numeric"].includes(normalized)) {
    if (precisionValue === null || scaleValue === null) return dataType;
    return `${dataType}(${precisionValue},${scaleValue})`;
  }

  if (["datetime2", "datetimeoffset", "time"].includes(normalized) && scaleValue !== null) {
    return `${dataType}(${scaleValue})`;
  }

  return dataType;
}

function normalizeWhitespace(input: string): string {
  return input.replace(/\r/g, "").replace(/[ \t]+/g, " ").trim();
}

function splitLargeText(text: string, maxChars: number = 5000, overlap: number = 500): string[] {
  if (text.length <= maxChars) {
    return [text];
  }

  const segments: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(start + maxChars, text.length);

    if (end < text.length) {
      const boundary = text.lastIndexOf("\n", end);
      if (boundary > start + Math.floor(maxChars * 0.6)) {
        end = boundary;
      }
    }

    segments.push(text.slice(start, end).trim());
    start = Math.max(end - overlap, end);
  }

  return segments.filter(Boolean);
}

function uniqueSorted(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function toQualifiedName(schemaName: string, objectName: string): string {
  return `${schemaName}.${objectName}`;
}

function stringifyValue(value: SqlValue): string {
  if (value === null) return "";
  return String(value);
}

function asBoolean(value: SqlValue): boolean {
  return value === true || value === 1 || value === "1";
}

function buildTableDocuments(tables: TableMetadata[]): DocumentToStore[] {
  return tables.map((table) => {
    const qualifiedName = toQualifiedName(table.schemaName, table.tableName);
    const primaryKeys = table.columns.filter((column) => column.isPrimaryKey).map((column) => column.name);
    const referencedTables = uniqueSorted(
      table.outboundRelationships.map((relationship) =>
        toQualifiedName(relationship.referencedSchema, relationship.referencedTable)
      )
    );

    const columnLines = table.columns.map((column) => {
      const flags: string[] = [];

      if (column.isPrimaryKey) flags.push("PRIMARY KEY");
      if (column.isIdentity) flags.push("IDENTITY");
      if (!column.nullable) flags.push("NOT NULL");
      if (column.defaultDefinition) flags.push(`DEFAULT ${normalizeWhitespace(column.defaultDefinition)}`);

      const flagText = flags.length > 0 ? ` [${flags.join(", ")}]` : "";
      return `- ${column.name}: ${column.dataType}${flagText}`;
    });

    const outboundLines = table.outboundRelationships.length > 0
      ? table.outboundRelationships.map((relationship) =>
          `- ${relationship.parentColumn} -> ${toQualifiedName(
            relationship.referencedSchema,
            relationship.referencedTable
          )}.${relationship.referencedColumn}`
        )
      : ["- none"];

    const inboundLines = table.inboundRelationships.length > 0
      ? table.inboundRelationships.map((relationship) =>
          `- ${toQualifiedName(relationship.parentSchema, relationship.parentTable)}.${relationship.parentColumn} -> ${relationship.referencedColumn}`
        )
      : ["- none"];

    const text = [
      "OBJECT TYPE: TABLE",
      `TABLE: ${qualifiedName}`,
      `ROW COUNT ESTIMATE: ${table.rowCount ?? "unknown"}`,
      `PRIMARY KEY: ${primaryKeys.length > 0 ? primaryKeys.join(", ") : "none"}`,
      "COLUMNS:",
      ...columnLines,
      "OUTBOUND RELATIONSHIPS:",
      ...outboundLines,
      "INBOUND RELATIONSHIPS:",
      ...inboundLines,
    ].join("\n");

    return {
      id: `table:${qualifiedName}`,
      text,
      metadata: {
        objectType: "table",
        schemaName: table.schemaName,
        objectName: table.tableName,
        tableName: qualifiedName,
        referencedTables,
        rowCount: table.rowCount,
        source: "sqlserver-catalog",
      },
    };
  });
}

function buildRelationshipDocuments(relationships: ForeignKeyRow[]): DocumentToStore[] {
  return relationships.map((relationship) => {
    const fromTable = toQualifiedName(relationship.parentSchema, relationship.parentTable);
    const toTable = toQualifiedName(relationship.referencedSchema, relationship.referencedTable);

    return {
      id: `relationship:${relationship.foreignKeyName}:${fromTable}.${relationship.parentColumn}`,
      text: [
        "OBJECT TYPE: RELATIONSHIP",
        `FOREIGN KEY: ${relationship.foreignKeyName}`,
        `FROM: ${fromTable}.${relationship.parentColumn}`,
        `TO: ${toTable}.${relationship.referencedColumn}`,
        `JOIN CONDITION: ${fromTable}.${relationship.parentColumn} = ${toTable}.${relationship.referencedColumn}`,
      ].join("\n"),
      metadata: {
        objectType: "relationship",
        schemaName: relationship.parentSchema,
        objectName: relationship.foreignKeyName,
        tableName: fromTable,
        referencedTables: [fromTable, toTable],
        source: "sqlserver-foreign-keys",
      },
    };
  });
}

function buildModuleDocuments(
  modules: ModuleRow[],
  moduleParameters: Map<string, string[]>,
  dependencies: Map<string, string[]>
): DocumentToStore[] {
  const docs: DocumentToStore[] = [];

  for (const moduleRow of modules) {
    const qualifiedName = toQualifiedName(moduleRow.schemaName, moduleRow.objectName);
    const parameterLines = moduleParameters.get(qualifiedName) ?? [];
    const referencedTables = uniqueSorted(dependencies.get(qualifiedName) ?? []);
    const header = [
      `OBJECT TYPE: ${moduleRow.objectType.toUpperCase()}`,
      `${moduleRow.objectType.toUpperCase()}: ${qualifiedName}`,
      `REFERENCED TABLES: ${referencedTables.length > 0 ? referencedTables.join(", ") : "none detected"}`,
    ];

    if (parameterLines.length > 0) {
      header.push("PARAMETERS:");
      header.push(...parameterLines);
    }

    header.push("DEFINITION:");

    const normalizedDefinition = moduleRow.definition.replace(/\r/g, "").trim();
    const segments = splitLargeText(normalizedDefinition, 5000, 500);

    segments.forEach((segment, index) => {
      const segmentHeader = [...header];

      if (segments.length > 1) {
        segmentHeader.splice(2, 0, `SEGMENT: ${index + 1}/${segments.length}`);
      }

      docs.push({
        id: `${moduleRow.objectType}:${qualifiedName}:segment:${index + 1}`,
        text: [...segmentHeader, segment].join("\n"),
        metadata: {
          objectType: moduleRow.objectType,
          schemaName: moduleRow.schemaName,
          objectName: moduleRow.objectName,
          tableName: null,
          referencedTables,
          segmentIndex: index + 1,
          segmentCount: segments.length,
          source: "sqlserver-modules",
        },
      });
    });
  }

  return docs;
}

function buildProfileDocuments(
  connectionString: string,
  codeColumns: CodeColumnRow[]
): Promise<DocumentToStore[]> {
  return Promise.all(
    codeColumns.map(async (col) => {
      const qualifiedTable = toQualifiedName(col.schemaName, col.tableName);
      const profileSql = `SELECT TOP 10 CAST([${col.columnName}] AS VARCHAR(20)) AS val, COUNT(*) AS cnt FROM [${col.schemaName}].[${col.tableName}] GROUP BY [${col.columnName}] ORDER BY cnt DESC`;

      let topValues = "unable to profile";
      try {
        const rows = await runQuery<ColumnProfileValue>(connectionString, profileSql);
        if (rows.length > 0) {
          topValues = rows
            .map((r) => `${r.val ?? "NULL"} (${r.cnt})`)
            .join(", ");
        }
      } catch {
        // skip columns that error during profiling
      }

      return {
        id: `profile:${qualifiedTable}.${col.columnName}`,
        text: [
          "OBJECT TYPE: COLUMN_PROFILE",
          `TABLE: ${qualifiedTable}`,
          `COLUMN: ${col.columnName}`,
          `TOP VALUES: ${topValues}`,
        ].join("\n"),
        metadata: {
          objectType: "profile",
          schemaName: col.schemaName,
          objectName: col.columnName,
          tableName: qualifiedTable,
          referencedTables: [qualifiedTable],
          source: "sqlserver-profiling",
        },
      };
    })
  );
}

export async function chunkDatabaseMetadata(connectionString: string): Promise<DocumentToStore[]> {
  const [tableRows, relationshipRows, rowCountRows, moduleRows, moduleParameterRows, dependencyRows, checkConstraintRows, codeColumnRows] = await Promise.all([
    runQuery<TableColumnRow>(connectionString, TABLE_COLUMNS_SQL),
    runQuery<ForeignKeyRow>(connectionString, FOREIGN_KEYS_SQL),
    runQuery<RowCountRow>(connectionString, ROW_COUNTS_SQL),
    runQuery<ModuleRow>(connectionString, MODULES_SQL),
    runQuery<ModuleParameterRow>(connectionString, MODULE_PARAMETERS_SQL),
    runQuery<DependencyRow>(connectionString, MODULE_DEPENDENCIES_SQL),
    runQuery<CheckConstraintRow>(connectionString, CHECK_CONSTRAINTS_SQL),
    runQuery<CodeColumnRow>(connectionString, CODE_COLUMNS_SQL),
  ]);

  // Build a map of CHECK constraints per table for appending to table chunks later
  const checkConstraintMap = new Map<string, string[]>();
  for (const row of checkConstraintRows) {
    const qualifiedName = toQualifiedName(row.schemaName, row.tableName);
    const line = `- ${row.constraintName}: ${normalizeWhitespace(row.checkDefinition)}`;
    checkConstraintMap.set(qualifiedName, [...(checkConstraintMap.get(qualifiedName) ?? []), line]);
  }

  const rowCountMap = new Map<string, number>();
  for (const row of rowCountRows) {
    rowCountMap.set(toQualifiedName(row.schemaName, row.tableName), Number(row.rowCount));
  }

  const outboundRelationships = new Map<string, ForeignKeyRow[]>();
  const inboundRelationships = new Map<string, ForeignKeyRow[]>();
  for (const relationship of relationshipRows) {
    const fromKey = toQualifiedName(relationship.parentSchema, relationship.parentTable);
    const toKey = toQualifiedName(relationship.referencedSchema, relationship.referencedTable);

    outboundRelationships.set(fromKey, [...(outboundRelationships.get(fromKey) ?? []), relationship]);
    inboundRelationships.set(toKey, [...(inboundRelationships.get(toKey) ?? []), relationship]);
  }

  const tableMap = new Map<string, TableMetadata>();
  for (const row of tableRows) {
    const qualifiedName = toQualifiedName(row.schemaName, row.tableName);

    if (!tableMap.has(qualifiedName)) {
      tableMap.set(qualifiedName, {
        schemaName: row.schemaName,
        tableName: row.tableName,
        rowCount: rowCountMap.get(qualifiedName) ?? null,
        columns: [],
        outboundRelationships: outboundRelationships.get(qualifiedName) ?? [],
        inboundRelationships: inboundRelationships.get(qualifiedName) ?? [],
      });
    }

    tableMap.get(qualifiedName)?.columns.push({
      name: row.columnName,
      dataType: formatDataType(row.dataType, row.maxLength, row.precisionValue, row.scaleValue),
      nullable: asBoolean(row.isNullable),
      isIdentity: asBoolean(row.isIdentity),
      isPrimaryKey: asBoolean(row.isPrimaryKey),
      defaultDefinition: row.defaultDefinition ? normalizeWhitespace(stringifyValue(row.defaultDefinition)) : null,
    });
  }

  const parameterMap = new Map<string, string[]>();
  for (const row of moduleParameterRows) {
    const qualifiedName = toQualifiedName(row.schemaName, row.objectName);
    const typeText = formatDataType(row.dataType, row.maxLength, row.precisionValue, row.scaleValue);
    const outputText = asBoolean(row.isOutput) ? " OUTPUT" : "";
    const line = `- ${row.parameterName} ${typeText}${outputText}`;
    parameterMap.set(qualifiedName, [...(parameterMap.get(qualifiedName) ?? []), line]);
  }

  const dependencyMap = new Map<string, string[]>();
  for (const row of dependencyRows) {
    if (!row.referencedEntity) continue;
    const qualifiedName = toQualifiedName(row.schemaName, row.objectName);
    const referencedName = row.referencedSchema
      ? toQualifiedName(row.referencedSchema, row.referencedEntity)
      : row.referencedEntity;

    dependencyMap.set(qualifiedName, [...(dependencyMap.get(qualifiedName) ?? []), referencedName]);
  }

  // Build table documents first, then append CHECK constraints to their text
  const tableDocs = buildTableDocuments([...tableMap.values()]);
  for (const doc of tableDocs) {
    const tableName = typeof doc.metadata.tableName === "string" ? doc.metadata.tableName : "";
    const checks = checkConstraintMap.get(tableName);
    if (checks && checks.length > 0) {
      doc.text += "\nCHECK CONSTRAINTS:\n" + checks.join("\n");
    }
  }

  // Build column profile documents (queries actual data for code-like columns)
  const profileDocs = await buildProfileDocuments(connectionString, codeColumnRows);
  console.log(`   📊 Profiled ${profileDocs.length} code columns`);

  return [
    ...tableDocs,
    ...buildRelationshipDocuments(relationshipRows),
    ...buildModuleDocuments(moduleRows, parameterMap, dependencyMap),
    ...profileDocs,
  ];
}
