export const appConfig = {
  agent: {
    maxRetries: 2,
  },
} as const;

export interface AgentRetryConfig {
  maxRetries: number;
  maxAttempts: number;
}

export function getAgentRetryConfig(): AgentRetryConfig {
  const configuredRetries = Number(appConfig.agent.maxRetries);
  const maxRetries = Number.isInteger(configuredRetries) && configuredRetries >= 0 ? configuredRetries : 0;

  return {
    maxRetries,
    maxAttempts: maxRetries + 1,
  };
}
