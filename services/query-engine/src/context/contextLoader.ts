import fs from "fs";
import path from "path";

export interface SchemaContext {
  schemaDDL: string;
  columnDefinitions: string;
}

const DATA_DIR = path.resolve(__dirname, "../../../Data");

export function loadSchemaContext(): SchemaContext {
  const schemaDDL = fs.readFileSync(
    path.join(DATA_DIR, "schema.md"),
    "utf-8"
  );
  const columnDefinitions = fs.readFileSync(
    path.join(DATA_DIR, "schema_definitions.md"),
    "utf-8"
  );

  return { schemaDDL, columnDefinitions };
}
