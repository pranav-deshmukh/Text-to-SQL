export type QueryErrorPhase = "request" | "generation" | "validation" | "execution" | "internal";
export type QueryErrorDisplayTarget = "sql-box" | "error-box";

export interface QueryErrorPayload {
  error: string;
  detail?: string;
  sql?: string;
  phase: QueryErrorPhase;
  displayTarget: QueryErrorDisplayTarget;
  code: string;
}

function cleanDetail(detail: string): string {
  return detail.replace(/\s+/g, " ").trim();
}

function detectGenerationCode(detail: string): string {
  const normalized = detail.toLowerCase();

  if (normalized.includes("api key") || normalized.includes("google_cloud_project")) {
    return "LLM_AUTH";
  }

  if (normalized.includes("429") || normalized.includes("rate")) {
    return "LLM_RATE_LIMIT";
  }

  if (normalized.includes("timeout") || normalized.includes("timed out")) {
    return "LLM_TIMEOUT";
  }

  if (normalized.includes("network") || normalized.includes("fetch") || normalized.includes("socket")) {
    return "LLM_NETWORK";
  }

  return "SQL_GENERATION_FAILED";
}

function detectExecutionCode(detail: string): string {
  const normalized = detail.toLowerCase();

  if (normalized.includes("not initialized")) {
    return "DB_NOT_READY";
  }

  if (normalized.includes("timeout") || normalized.includes("timed out")) {
    return "DB_TIMEOUT";
  }

  if (normalized.includes("login failed") || normalized.includes("connection")) {
    return "DB_CONNECTION_FAILED";
  }

  return "SQL_EXECUTION_FAILED";
}

export function buildRequestError(detail: string): QueryErrorPayload {
  return {
    error: "Question is required.",
    detail: cleanDetail(detail),
    phase: "request",
    displayTarget: "error-box",
    code: "BAD_REQUEST",
  };
}

export function buildGenerationError(detail: string, sql?: string): QueryErrorPayload {
  return {
    error: "Unable to generate SQL for this question.",
    detail: cleanDetail(detail),
    sql,
    phase: "generation",
    displayTarget: "sql-box",
    code: detectGenerationCode(detail),
  };
}

export function buildValidationError(detail: string, sql?: string): QueryErrorPayload {
  return {
    error: "The generated SQL failed validation.",
    detail: cleanDetail(detail),
    sql,
    phase: "validation",
    displayTarget: "error-box",
    code: "SQL_VALIDATION_FAILED",
  };
}

export function buildExecutionError(detail: string, sql?: string): QueryErrorPayload {
  return {
    error: "The SQL query could not be executed.",
    detail: cleanDetail(detail),
    sql,
    phase: "execution",
    displayTarget: "error-box",
    code: detectExecutionCode(detail),
  };
}

export function buildInternalError(detail: string): QueryErrorPayload {
  return {
    error: "Something went wrong while processing the request.",
    detail: cleanDetail(detail),
    phase: "internal",
    displayTarget: "error-box",
    code: "INTERNAL_ERROR",
  };
}
