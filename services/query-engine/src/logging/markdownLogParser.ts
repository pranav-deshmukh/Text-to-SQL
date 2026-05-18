import fs from "fs/promises";
import path from "path";
import { AuditRequestRecord } from "./auditLogger";
import { getAuditConfig } from "../config/auditConfig";

export interface LogQuery {
  q?: string;
  status?: "success" | "error";
  stage?: string;
  from?: string;
  to?: string;
  page: number;
  pageSize: number;
}

export interface LogQueryResult {
  total: number;
  page: number;
  pageSize: number;
  items: AuditRequestRecord[];
}

function parseMarkdownEntries(markdown: string): AuditRequestRecord[] {
  const pattern = /<!-- AUDIT_ENTRY_START -->\s*```json\s*([\s\S]*?)\s*```\s*<!-- AUDIT_ENTRY_END -->/g;
  const items: AuditRequestRecord[] = [];

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(markdown)) !== null) {
    try {
      items.push(JSON.parse(match[1]) as AuditRequestRecord);
    } catch {
      // Skip malformed entry
    }
  }

  return items;
}

function includesText(item: AuditRequestRecord, q: string): boolean {
  const normalized = q.toLowerCase();
  return JSON.stringify(item).toLowerCase().includes(normalized);
}

export async function queryAuditLogs(query: LogQuery): Promise<LogQueryResult> {
  const config = getAuditConfig();
  const dirExists = await fs.stat(config.logDir).then(() => true).catch(() => false);

  if (!dirExists) {
    return {
      total: 0,
      page: query.page,
      pageSize: query.pageSize,
      items: [],
    };
  }

  const files = (await fs.readdir(config.logDir))
    .filter((name) => name.endsWith(".md"))
    .sort((a, b) => b.localeCompare(a));

  const records: AuditRequestRecord[] = [];

  for (const fileName of files) {
    const content = await fs.readFile(path.join(config.logDir, fileName), "utf-8");
    records.push(...parseMarkdownEntries(content));
  }

  const filtered = records
    .filter((item) => !query.status || item.status === query.status)
    .filter((item) => !query.stage || item.stages.some((stage) => stage.stage === query.stage))
    .filter((item) => !query.q || includesText(item, query.q))
    .filter((item) => !query.from || item.startedAt >= query.from)
    .filter((item) => !query.to || item.startedAt <= query.to)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));

  const total = filtered.length;
  const start = (query.page - 1) * query.pageSize;
  const items = filtered.slice(start, start + query.pageSize);

  return {
    total,
    page: query.page,
    pageSize: query.pageSize,
    items,
  };
}
