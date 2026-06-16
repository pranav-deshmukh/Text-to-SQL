"""
RAG Chunker — introspects SQL Server metadata and produces document chunks
for embedding and storage in Qdrant.

Equivalent of the TypeScript chunker.ts — a one-time CLI tool.
"""

import pyodbc

TABLE_COLUMNS_SQL = """
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
JOIN sys.schemas s ON s.schema_id = t.schema_id
JOIN sys.columns c ON c.object_id = t.object_id
JOIN sys.types ty ON ty.user_type_id = c.user_type_id
LEFT JOIN sys.default_constraints dc
  ON dc.parent_object_id = c.object_id AND dc.parent_column_id = c.column_id
LEFT JOIN (
  SELECT ic.object_id, ic.column_id
  FROM sys.indexes i
  JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
  WHERE i.is_primary_key = 1
) pk ON pk.object_id = c.object_id AND pk.column_id = c.column_id
WHERE t.is_ms_shipped = 0
ORDER BY s.name, t.name, c.column_id;
"""

FOREIGN_KEYS_SQL = """
SELECT
  fk.name AS foreignKeyName,
  ps.name AS parentSchema,
  pt.name AS parentTable,
  pc.name AS parentColumn,
  rs.name AS referencedSchema,
  rt.name AS referencedTable,
  rc.name AS referencedColumn
FROM sys.foreign_keys fk
JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
JOIN sys.tables pt ON pt.object_id = fkc.parent_object_id
JOIN sys.schemas ps ON ps.schema_id = pt.schema_id
JOIN sys.columns pc ON pc.object_id = pt.object_id AND pc.column_id = fkc.parent_column_id
JOIN sys.tables rt ON rt.object_id = fkc.referenced_object_id
JOIN sys.schemas rs ON rs.schema_id = rt.schema_id
JOIN sys.columns rc ON rc.object_id = rt.object_id AND rc.column_id = fkc.referenced_column_id
WHERE pt.is_ms_shipped = 0 AND rt.is_ms_shipped = 0
ORDER BY ps.name, pt.name, fk.name;
"""

ROW_COUNTS_SQL = """
SELECT
  s.name AS schemaName,
  t.name AS tableName,
  CAST(SUM(p.row_count) AS bigint) AS [rowCount]
FROM sys.tables t
JOIN sys.schemas s ON s.schema_id = t.schema_id
JOIN sys.dm_db_partition_stats p ON p.object_id = t.object_id AND p.index_id IN (0, 1)
WHERE t.is_ms_shipped = 0
GROUP BY s.name, t.name;
"""

MODULES_SQL = """
SELECT
  s.name AS schemaName,
  o.name AS objectName,
  CASE WHEN o.type = 'V' THEN 'view' ELSE 'procedure' END AS objectType,
  m.definition AS definition
FROM sys.objects o
JOIN sys.schemas s ON s.schema_id = o.schema_id
JOIN sys.sql_modules m ON m.object_id = o.object_id
WHERE o.is_ms_shipped = 0 AND o.type IN ('P', 'V')
ORDER BY s.name, o.name;
"""

MODULE_PARAMETERS_SQL = """
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
JOIN sys.schemas s ON s.schema_id = o.schema_id
JOIN sys.parameters p ON p.object_id = o.object_id
JOIN sys.types ty ON ty.user_type_id = p.user_type_id
WHERE o.is_ms_shipped = 0 AND o.type = 'P'
ORDER BY s.name, o.name, p.parameter_id;
"""

MODULE_DEPENDENCIES_SQL = """
SELECT
  ss.name AS schemaName,
  so.name AS objectName,
  rs.name AS referencedSchema,
  sed.referenced_entity_name AS referencedEntity
FROM sys.sql_expression_dependencies sed
JOIN sys.objects so ON so.object_id = sed.referencing_id
JOIN sys.schemas ss ON ss.schema_id = so.schema_id
LEFT JOIN sys.schemas rs ON rs.name = sed.referenced_schema_name
WHERE so.is_ms_shipped = 0 AND so.type IN ('P', 'V') AND sed.referenced_entity_name IS NOT NULL
ORDER BY ss.name, so.name;
"""

CHECK_CONSTRAINTS_SQL = """
SELECT
  s.name AS schemaName,
  t.name AS tableName,
  cc.name AS constraintName,
  cc.definition AS checkDefinition
FROM sys.check_constraints cc
JOIN sys.tables t ON cc.parent_object_id = t.object_id
JOIN sys.schemas s ON s.schema_id = t.schema_id
WHERE t.is_ms_shipped = 0
ORDER BY s.name, t.name, cc.name;
"""

CODE_COLUMNS_SQL = """
SELECT
  s.name AS schemaName,
  t.name AS tableName,
  c.name AS columnName
FROM sys.columns c
JOIN sys.tables t ON c.object_id = t.object_id
JOIN sys.schemas s ON s.schema_id = t.schema_id
JOIN sys.types tp ON tp.user_type_id = c.user_type_id
WHERE tp.name IN ('char','varchar','nchar','nvarchar')
  AND c.max_length BETWEEN 1 AND 20
  AND t.is_ms_shipped = 0
ORDER BY s.name, t.name, c.name;
"""


def _run_query(connection_string: str, sql: str) -> list[pyodbc.Row]:
    conn = pyodbc.connect(connection_string)
    try:
        cursor = conn.cursor()
        cursor.execute(sql)
        return cursor.fetchall() if cursor.description else []
    finally:
        conn.close()


def _format_data_type(data_type: str, max_length, precision_value, scale_value) -> str:
    normalized = data_type.lower()
    if normalized in ("varchar", "char", "varbinary", "binary"):
        if max_length is None:
            return data_type
        return f"{data_type}({'max' if max_length == -1 else max_length})"
    if normalized in ("nvarchar", "nchar"):
        if max_length is None:
            return data_type
        display_length = "max" if max_length == -1 else max_length // 2
        return f"{data_type}({display_length})"
    if normalized in ("decimal", "numeric"):
        if precision_value is None or scale_value is None:
            return data_type
        return f"{data_type}({precision_value},{scale_value})"
    if normalized in ("datetime2", "datetimeoffset", "time") and scale_value is not None:
        return f"{data_type}({scale_value})"
    return data_type


def _normalize_whitespace(text: str) -> str:
    import re
    return re.sub(r"[ \t]+", " ", text.replace("\r", "")).strip()


def _split_large_text(text: str, max_chars: int = 5000, overlap: int = 500) -> list[str]:
    if len(text) <= max_chars:
        return [text]
    segments: list[str] = []
    start = 0
    while start < len(text):
        end = min(start + max_chars, len(text))
        if end < len(text):
            boundary = text.rfind("\n", start, end)
            if boundary > start + int(max_chars * 0.6):
                end = boundary
        segments.append(text[start:end].strip())
        start = max(end - overlap, end)
    return [s for s in segments if s]


def _qualified_name(schema_name: str, object_name: str) -> str:
    return f"{schema_name}.{object_name}"


def _as_bool(value) -> bool:
    return value is True or value == 1 or value == "1"


def _unique_sorted(items: list[str]) -> list[str]:
    return sorted(set(i for i in items if i))


def chunk_database_metadata(connection_string: str) -> list[dict]:
    table_rows = _run_query(connection_string, TABLE_COLUMNS_SQL)
    relationship_rows = _run_query(connection_string, FOREIGN_KEYS_SQL)
    row_count_rows = _run_query(connection_string, ROW_COUNTS_SQL)
    module_rows = _run_query(connection_string, MODULES_SQL)
    module_parameter_rows = _run_query(connection_string, MODULE_PARAMETERS_SQL)
    dependency_rows = _run_query(connection_string, MODULE_DEPENDENCIES_SQL)
    check_constraint_rows = _run_query(connection_string, CHECK_CONSTRAINTS_SQL)
    code_column_rows = _run_query(connection_string, CODE_COLUMNS_SQL)

    # Check constraints map
    check_constraint_map: dict[str, list[str]] = {}
    for row in check_constraint_rows:
        qn = _qualified_name(row.schemaName, row.tableName)
        line = f"- {row.constraintName}: {_normalize_whitespace(row.checkDefinition)}"
        check_constraint_map.setdefault(qn, []).append(line)

    # Row counts
    row_count_map: dict[str, int] = {}
    for row in row_count_rows:
        row_count_map[_qualified_name(row.schemaName, row.tableName)] = int(row.rowCount)

    # Relationships
    outbound_rels: dict[str, list] = {}
    inbound_rels: dict[str, list] = {}
    for row in relationship_rows:
        from_key = _qualified_name(row.parentSchema, row.parentTable)
        to_key = _qualified_name(row.referencedSchema, row.referencedTable)
        outbound_rels.setdefault(from_key, []).append(row)
        inbound_rels.setdefault(to_key, []).append(row)

    # Build table metadata
    table_map: dict[str, dict] = {}
    for row in table_rows:
        qn = _qualified_name(row.schemaName, row.tableName)
        if qn not in table_map:
            table_map[qn] = {
                "schemaName": row.schemaName,
                "tableName": row.tableName,
                "rowCount": row_count_map.get(qn),
                "columns": [],
                "outboundRelationships": outbound_rels.get(qn, []),
                "inboundRelationships": inbound_rels.get(qn, []),
            }
        table_map[qn]["columns"].append({
            "name": row.columnName,
            "dataType": _format_data_type(row.dataType, row.maxLength, row.precisionValue, row.scaleValue),
            "nullable": _as_bool(row.isNullable),
            "isIdentity": _as_bool(row.isIdentity),
            "isPrimaryKey": _as_bool(row.isPrimaryKey),
            "defaultDefinition": _normalize_whitespace(str(row.defaultDefinition)) if row.defaultDefinition else None,
        })

    # Module parameters
    parameter_map: dict[str, list[str]] = {}
    for row in module_parameter_rows:
        qn = _qualified_name(row.schemaName, row.objectName)
        type_text = _format_data_type(row.dataType, row.maxLength, row.precisionValue, row.scaleValue)
        output_text = " OUTPUT" if _as_bool(row.isOutput) else ""
        parameter_map.setdefault(qn, []).append(f"- {row.parameterName} {type_text}{output_text}")

    # Dependencies
    dependency_map: dict[str, list[str]] = {}
    for row in dependency_rows:
        if not row.referencedEntity:
            continue
        qn = _qualified_name(row.schemaName, row.objectName)
        ref_name = _qualified_name(row.referencedSchema, row.referencedEntity) if row.referencedSchema else row.referencedEntity
        dependency_map.setdefault(qn, []).append(ref_name)

    # Build table documents
    table_docs: list[dict] = []
    for table in table_map.values():
        qn = _qualified_name(table["schemaName"], table["tableName"])
        primary_keys = [c["name"] for c in table["columns"] if c["isPrimaryKey"]]
        referenced_tables = _unique_sorted(
            [_qualified_name(r.referencedSchema, r.referencedTable) for r in table["outboundRelationships"]]
        )

        column_lines = []
        for col in table["columns"]:
            flags = []
            if col["isPrimaryKey"]:
                flags.append("PRIMARY KEY")
            if col["isIdentity"]:
                flags.append("IDENTITY")
            if not col["nullable"]:
                flags.append("NOT NULL")
            if col["defaultDefinition"]:
                flags.append(f"DEFAULT {col['defaultDefinition']}")
            flag_text = f" [{', '.join(flags)}]" if flags else ""
            column_lines.append(f"- {col['name']}: {col['dataType']}{flag_text}")

        outbound_lines = (
            [f"- {r.parentColumn} -> {_qualified_name(r.referencedSchema, r.referencedTable)}.{r.referencedColumn}"
             for r in table["outboundRelationships"]]
            or ["- none"]
        )
        inbound_lines = (
            [f"- {_qualified_name(r.parentSchema, r.parentTable)}.{r.parentColumn} -> {r.referencedColumn}"
             for r in table["inboundRelationships"]]
            or ["- none"]
        )

        text = "\n".join([
            "OBJECT TYPE: TABLE",
            f"TABLE: {qn}",
            f"ROW COUNT ESTIMATE: {table['rowCount'] if table['rowCount'] is not None else 'unknown'}",
            f"PRIMARY KEY: {', '.join(primary_keys) if primary_keys else 'none'}",
            "COLUMNS:",
            *column_lines,
            "OUTBOUND RELATIONSHIPS:",
            *outbound_lines,
            "INBOUND RELATIONSHIPS:",
            *inbound_lines,
        ])

        # Append check constraints
        checks = check_constraint_map.get(qn)
        if checks:
            text += "\nCHECK CONSTRAINTS:\n" + "\n".join(checks)

        table_docs.append({
            "id": f"table:{qn}",
            "text": text,
            "metadata": {
                "objectType": "table",
                "schemaName": table["schemaName"],
                "objectName": table["tableName"],
                "tableName": qn,
                "referencedTables": referenced_tables,
                "rowCount": table["rowCount"],
                "source": "sqlserver-catalog",
            },
        })

    # Build relationship documents
    relationship_docs: list[dict] = []
    for rel in relationship_rows:
        from_table = _qualified_name(rel.parentSchema, rel.parentTable)
        to_table = _qualified_name(rel.referencedSchema, rel.referencedTable)
        relationship_docs.append({
            "id": f"relationship:{rel.foreignKeyName}:{from_table}.{rel.parentColumn}",
            "text": "\n".join([
                "OBJECT TYPE: RELATIONSHIP",
                f"FOREIGN KEY: {rel.foreignKeyName}",
                f"FROM: {from_table}.{rel.parentColumn}",
                f"TO: {to_table}.{rel.referencedColumn}",
                f"JOIN CONDITION: {from_table}.{rel.parentColumn} = {to_table}.{rel.referencedColumn}",
            ]),
            "metadata": {
                "objectType": "relationship",
                "schemaName": rel.parentSchema,
                "objectName": rel.foreignKeyName,
                "tableName": from_table,
                "referencedTables": [from_table, to_table],
                "source": "sqlserver-foreign-keys",
            },
        })

    # Build module documents
    module_docs: list[dict] = []
    for mod in module_rows:
        qn = _qualified_name(mod.schemaName, mod.objectName)
        param_lines = parameter_map.get(qn, [])
        referenced_tables = _unique_sorted(dependency_map.get(qn, []))
        header = [
            f"OBJECT TYPE: {mod.objectType.upper()}",
            f"{mod.objectType.upper()}: {qn}",
            f"REFERENCED TABLES: {', '.join(referenced_tables) if referenced_tables else 'none detected'}",
        ]
        if param_lines:
            header.append("PARAMETERS:")
            header.extend(param_lines)
        header.append("DEFINITION:")

        normalized_definition = mod.definition.replace("\r", "").strip()
        segments = _split_large_text(normalized_definition, 5000, 500)
        for index, segment in enumerate(segments):
            seg_header = list(header)
            if len(segments) > 1:
                seg_header.insert(2, f"SEGMENT: {index + 1}/{len(segments)}")
            module_docs.append({
                "id": f"{mod.objectType}:{qn}:segment:{index + 1}",
                "text": "\n".join([*seg_header, segment]),
                "metadata": {
                    "objectType": mod.objectType,
                    "schemaName": mod.schemaName,
                    "objectName": mod.objectName,
                    "tableName": None,
                    "referencedTables": referenced_tables,
                    "segmentIndex": index + 1,
                    "segmentCount": len(segments),
                    "source": "sqlserver-modules",
                },
            })

    # Build column profile documents
    profile_docs: list[dict] = []
    for col in code_column_rows:
        qualified_table = _qualified_name(col.schemaName, col.tableName)
        profile_sql = f"SELECT TOP 10 CAST([{col.columnName}] AS VARCHAR(20)) AS val, COUNT(*) AS cnt FROM [{col.schemaName}].[{col.tableName}] GROUP BY [{col.columnName}] ORDER BY cnt DESC"
        top_values = "unable to profile"
        try:
            rows = _run_query(connection_string, profile_sql)
            if rows:
                top_values = ", ".join(f"{r.val or 'NULL'} ({r.cnt})" for r in rows)
        except Exception:
            pass

        profile_docs.append({
            "id": f"profile:{qualified_table}.{col.columnName}",
            "text": "\n".join([
                "OBJECT TYPE: COLUMN_PROFILE",
                f"TABLE: {qualified_table}",
                f"COLUMN: {col.columnName}",
                f"TOP VALUES: {top_values}",
            ]),
            "metadata": {
                "objectType": "profile",
                "schemaName": col.schemaName,
                "objectName": col.columnName,
                "tableName": qualified_table,
                "referencedTables": [qualified_table],
                "source": "sqlserver-profiling",
            },
        })

    print(f"   📊 Profiled {len(profile_docs)} code columns")

    return [*table_docs, *relationship_docs, *module_docs, *profile_docs]
