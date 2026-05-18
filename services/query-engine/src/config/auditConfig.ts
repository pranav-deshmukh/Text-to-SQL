import path from "path";

export type AppEnvironment = "dev" | "prod";

export interface AuditConfig {
  appEnv: AppEnvironment;
  enabled: boolean;
  uiEnabled: boolean;
  includeStack: boolean;
  logDir: string;
  maxTextLength: number;
}

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

export function getAuditConfig(): AuditConfig {
  const rawEnv = (process.env.APP_ENV || "dev").toLowerCase();
  const appEnv: AppEnvironment = rawEnv === "prod" ? "prod" : "dev";
  const enabledByEnv = appEnv === "dev";
  const enabled = parseBoolean(process.env.AUDIT_ENABLED, enabledByEnv) && appEnv === "dev";
  const uiEnabled = parseBoolean(process.env.AUDIT_UI_ENABLED, true) && enabled;
  const includeStack = parseBoolean(process.env.AUDIT_INCLUDE_STACK, true) && appEnv === "dev";
  const maxTextLength = Math.max(200, Number.parseInt(process.env.AUDIT_MAX_TEXT_LENGTH || "3000", 10) || 3000);

  const configuredDir = process.env.AUDIT_LOG_DIR || "logs/dev";
  const logDir = path.isAbsolute(configuredDir)
    ? configuredDir
    : path.resolve(process.cwd(), configuredDir);

  return {
    appEnv,
    enabled,
    uiEnabled,
    includeStack,
    logDir,
    maxTextLength,
  };
}
