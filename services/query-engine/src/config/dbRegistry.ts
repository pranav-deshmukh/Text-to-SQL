export interface DatabaseConfig {
  dbId: string;
  displayName: string;
  connectionString: string;
  qdrantCollection: string;
}

interface RegistryEntry {
  dbId: string;
  displayName?: string;
  connectionString?: string;
}

const DEFAULT_DB_ID = "default";
const DEFAULT_DISPLAY_NAME = "Default Database";
const DEFAULT_COLLECTION = "sql_context";

function parseJsonRegistry(): DatabaseConfig[] {
  let rawRegistry = process.env.DB_REGISTRY?.trim();
  if (!rawRegistry) {
    return [];
  }

  // Strip surrounding quotes that dotenv may include on Windows
  if ((rawRegistry.startsWith("'") && rawRegistry.endsWith("'")) ||
      (rawRegistry.startsWith('"') && rawRegistry.endsWith('"'))) {
    rawRegistry = rawRegistry.slice(1, -1);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawRegistry);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown parse error";
    throw new Error(`Invalid DB_REGISTRY JSON: ${message}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error("DB_REGISTRY must be a JSON array.");
  }

  return parsed.map((entry, index) => toDatabaseConfig(entry, index));
}

function parseEnvRegistry(): DatabaseConfig[] {
  const ids = (process.env.REGISTERED_DBS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  return ids.map((dbId, index) => {
    const envKey = dbId.toUpperCase();
    return toDatabaseConfig(
      {
        dbId,
        displayName: process.env[`DB_DISPLAY_NAME_${envKey}`],
        connectionString: process.env[`DB_CONNECTION_STRING_${envKey}`],
      },
      index,
    );
  });
}

function buildFallbackRegistry(): DatabaseConfig[] {
  const connectionString = process.env.DB_CONNECTION_STRING?.trim();
  if (!connectionString) {
    return [];
  }

  return [
    {
      dbId: DEFAULT_DB_ID,
      displayName: process.env.DB_DISPLAY_NAME_DEFAULT?.trim() || DEFAULT_DISPLAY_NAME,
      connectionString,
      qdrantCollection: DEFAULT_COLLECTION,
    },
  ];
}

function toDatabaseConfig(entry: unknown, index: number): DatabaseConfig {
  if (!entry || typeof entry !== "object") {
    throw new Error(`DB registry entry at index ${index} must be an object.`);
  }

  const candidate = entry as RegistryEntry;
  const dbId = candidate.dbId?.trim();
  if (!dbId) {
    throw new Error(`DB registry entry at index ${index} is missing a valid dbId.`);
  }

  const connectionString = candidate.connectionString?.trim();
  if (!connectionString) {
    throw new Error(`Database "${dbId}" is missing a connection string.`);
  }

  const displayName = candidate.displayName?.trim() || dbId;

  return {
    dbId,
    displayName,
    connectionString,
    qdrantCollection: dbId === DEFAULT_DB_ID && !process.env.DB_REGISTRY && !process.env.REGISTERED_DBS
      ? DEFAULT_COLLECTION
      : `sql_context_${dbId}`,
  };
}

function validateDatabases(databases: DatabaseConfig[]): DatabaseConfig[] {
  const seenDbIds = new Set<string>();

  for (const database of databases) {
    const normalizedId = database.dbId.toLowerCase();
    if (seenDbIds.has(normalizedId)) {
      throw new Error(`Duplicate database registration for dbId "${database.dbId}".`);
    }

    seenDbIds.add(normalizedId);
  }

  return databases;
}

export function getRegisteredDatabases(): DatabaseConfig[] {
  const jsonRegistry = parseJsonRegistry();
  if (jsonRegistry.length > 0) {
    return validateDatabases(jsonRegistry);
  }

  const envRegistry = parseEnvRegistry();
  if (envRegistry.length > 0) {
    return validateDatabases(envRegistry);
  }

  return validateDatabases(buildFallbackRegistry());
}

export function getDatabaseConfig(dbId: string): DatabaseConfig | undefined {
  return getRegisteredDatabases().find((database) => database.dbId === dbId);
}
