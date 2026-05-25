import { randomUUID } from "crypto";
import msnodesqlv8 from "msnodesqlv8";
import { resolveAuthConnectionString } from "../auth/users";
import {
  ChatConversationDetail,
  ChatConversationSummary,
  ChatMessageRecord,
  CreateConversationInput,
  CreateMessageInput,
  UpdateMessageInput,
} from "./types";

const CONVERSATIONS_TABLE = "[dbo].[chat_conversations]";
const MESSAGES_TABLE = "[dbo].[chat_messages]";

interface ConversationRow {
  conversationId: string;
  title: string;
  selectedDbId: string | null;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string | null;
  previewText: string | null;
}

interface MessageRow {
  messageId: string;
  conversationId: string;
  sequenceNo: number;
  role: string;
  messageType: string;
  question: string | null;
  responseText: string | null;
  sql: string | null;
  generatedSQL: string | null;
  editableSQL: string | null;
  threadId: string | null;
  dbId: string | null;
  status: string | null;
  error: string | null;
  detail: string | null;
  phase: string | null;
  displayTarget: string | null;
  code: string | null;
  resultJson: string | null;
  retrievedTablesJson: string | null;
  schemaContext: string | null;
  promptPreviewJson: string | null;
  lastErrorJson: string | null;
  finalErrorJson: string | null;
  tokensJson: string | null;
  agentStepsJson: string | null;
  retryCount: number | null;
  maxRetries: number | null;
  maxAttempts: number | null;
  createdAt: string;
  completedAt: string | null;
}

function queryRows<T>(sqlQuery: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    msnodesqlv8.query(resolveAuthConnectionString(), sqlQuery, (error, rows?: T[]) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(rows ?? []);
    });
  });
}

function escapeSqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

function toSqlString(value?: string | null): string {
  if (value === undefined || value === null || value.length === 0) {
    return "NULL";
  }

  return `N'${escapeSqlLiteral(value)}'`;
}

function toSqlJson(value: unknown): string {
  if (value === undefined || value === null) {
    return "NULL";
  }

  return toSqlString(JSON.stringify(value));
}

function toSqlNumber(value?: number | null): string {
  return Number.isFinite(value ?? NaN) ? String(value) : "NULL";
}

function toSqlDate(value?: string | null): string {
  return value ? toSqlString(value) : "NULL";
}

function parseJson<T>(value: string | null): T | null {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function mapConversation(row: ConversationRow): ChatConversationSummary {
  return {
    conversationId: row.conversationId,
    title: row.title,
    selectedDbId: row.selectedDbId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastMessageAt: row.lastMessageAt,
    previewText: row.previewText,
  };
}

function mapMessage(row: MessageRow): ChatMessageRecord {
  return {
    messageId: row.messageId,
    conversationId: row.conversationId,
    sequenceNo: row.sequenceNo,
    role: (row.role || "assistant") as ChatMessageRecord["role"],
    messageType: row.messageType,
    question: row.question,
    responseText: row.responseText,
    sql: row.sql,
    generatedSQL: row.generatedSQL,
    editableSQL: row.editableSQL,
    threadId: row.threadId,
    dbId: row.dbId,
    status: (row.status || null) as ChatMessageRecord["status"],
    error: row.error,
    detail: row.detail,
    phase: (row.phase || null) as ChatMessageRecord["phase"],
    displayTarget: (row.displayTarget || null) as ChatMessageRecord["displayTarget"],
    code: row.code,
    result: parseJson<ChatMessageRecord["result"]>(row.resultJson),
    retrievedTables: parseJson<string[]>(row.retrievedTablesJson) || [],
    schemaContext: row.schemaContext,
    promptPreview: parseJson<ChatMessageRecord["promptPreview"]>(row.promptPreviewJson),
    lastError: parseJson<ChatMessageRecord["lastError"]>(row.lastErrorJson),
    finalError: parseJson<ChatMessageRecord["finalError"]>(row.finalErrorJson),
    tokens: parseJson<ChatMessageRecord["tokens"]>(row.tokensJson),
    agentSteps: parseJson<ChatMessageRecord["agentSteps"]>(row.agentStepsJson) || [],
    retryCount: row.retryCount,
    maxRetries: row.maxRetries,
    maxAttempts: row.maxAttempts,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
  };
}

export async function registerChatStore(): Promise<void> {
  const rows = await queryRows<{ conversationCount: number; messageCount: number }>(
    `SELECT
        (SELECT COUNT(1) FROM ${CONVERSATIONS_TABLE}) AS conversationCount,
        (SELECT COUNT(1) FROM ${MESSAGES_TABLE}) AS messageCount;`
  );

  const row = rows[0];
  console.log(`💬 Chat store ready with ${row?.conversationCount ?? 0} conversation(s) and ${row?.messageCount ?? 0} message(s).`);
}

export async function listConversations(userId: string): Promise<ChatConversationSummary[]> {
  const escapedUserId = escapeSqlLiteral(userId);
  const rows = await queryRows<ConversationRow>(
    `SELECT
        c.conversation_id AS conversationId,
        c.title,
        c.selected_db_id AS selectedDbId,
        CONVERT(varchar(33), c.created_at, 127) + 'Z' AS createdAt,
        CONVERT(varchar(33), c.updated_at, 127) + 'Z' AS updatedAt,
        CASE WHEN c.last_message_at IS NULL THEN NULL ELSE CONVERT(varchar(33), c.last_message_at, 127) + 'Z' END AS lastMessageAt,
        latest.preview_text AS previewText
      FROM ${CONVERSATIONS_TABLE} c
      OUTER APPLY (
        SELECT TOP 1
          COALESCE(
            NULLIF(m.question_text, ''),
            NULLIF(m.response_text, ''),
            NULLIF(m.error_text, ''),
            NULLIF(m.sql_text, '')
          ) AS preview_text
        FROM ${MESSAGES_TABLE} m
        WHERE m.conversation_id = c.conversation_id
        ORDER BY m.sequence_no DESC
      ) latest
      WHERE c.user_id = N'${escapedUserId}'
        AND c.is_archived = 0
      ORDER BY COALESCE(c.last_message_at, c.updated_at) DESC, c.created_at DESC;`
  );

  return rows.map(mapConversation);
}

export async function getConversation(userId: string, conversationId: string): Promise<ChatConversationDetail | null> {
  const escapedUserId = escapeSqlLiteral(userId);
  const escapedConversationId = escapeSqlLiteral(conversationId);
  const conversations = await queryRows<ConversationRow>(
    `SELECT TOP 1
        c.conversation_id AS conversationId,
        c.title,
        c.selected_db_id AS selectedDbId,
        CONVERT(varchar(33), c.created_at, 127) + 'Z' AS createdAt,
        CONVERT(varchar(33), c.updated_at, 127) + 'Z' AS updatedAt,
        CASE WHEN c.last_message_at IS NULL THEN NULL ELSE CONVERT(varchar(33), c.last_message_at, 127) + 'Z' END AS lastMessageAt,
        latest.preview_text AS previewText
      FROM ${CONVERSATIONS_TABLE} c
      OUTER APPLY (
        SELECT TOP 1
          COALESCE(
            NULLIF(m.question_text, ''),
            NULLIF(m.response_text, ''),
            NULLIF(m.error_text, ''),
            NULLIF(m.sql_text, '')
          ) AS preview_text
        FROM ${MESSAGES_TABLE} m
        WHERE m.conversation_id = c.conversation_id
        ORDER BY m.sequence_no DESC
      ) latest
      WHERE c.user_id = N'${escapedUserId}'
        AND c.conversation_id = '${escapedConversationId}'
        AND c.is_archived = 0;`
  );

  const conversation = conversations[0];
  if (!conversation) {
    return null;
  }

  const messageRows = await queryRows<MessageRow>(
    `SELECT
        m.message_id AS messageId,
        m.conversation_id AS conversationId,
        m.sequence_no AS sequenceNo,
        m.role,
        m.message_type AS messageType,
        m.question_text AS question,
        m.response_text AS responseText,
        m.sql_text AS sql,
        m.generated_sql AS generatedSQL,
        m.editable_sql AS editableSQL,
        m.thread_id AS threadId,
        m.db_id AS dbId,
        m.status,
        m.error_text AS error,
        m.detail_text AS detail,
        m.phase,
        m.display_target AS displayTarget,
        m.code,
        m.result_json AS resultJson,
        m.retrieved_tables_json AS retrievedTablesJson,
        m.schema_context AS schemaContext,
        m.prompt_preview_json AS promptPreviewJson,
        m.last_error_json AS lastErrorJson,
        m.final_error_json AS finalErrorJson,
        m.tokens_json AS tokensJson,
        m.agent_steps_json AS agentStepsJson,
        m.retry_count AS retryCount,
        m.max_retries AS maxRetries,
        m.max_attempts AS maxAttempts,
        CONVERT(varchar(33), m.created_at, 127) + 'Z' AS createdAt,
        CASE WHEN m.completed_at IS NULL THEN NULL ELSE CONVERT(varchar(33), m.completed_at, 127) + 'Z' END AS completedAt
      FROM ${MESSAGES_TABLE} m
      WHERE m.conversation_id = '${escapedConversationId}'
      ORDER BY m.sequence_no ASC;`
  );

  return {
    ...mapConversation(conversation),
    messages: messageRows.map(mapMessage),
  };
}

export async function createConversation(input: CreateConversationInput): Promise<ChatConversationSummary> {
  const conversationId = randomUUID();
  const escapedConversationId = escapeSqlLiteral(conversationId);
  const escapedUserId = escapeSqlLiteral(input.userId);
  const rows = await queryRows<ConversationRow>(
    `INSERT INTO ${CONVERSATIONS_TABLE} (
        conversation_id,
        user_id,
        title,
        selected_db_id,
        created_at,
        updated_at,
        last_message_at,
        is_archived
      )
      OUTPUT
        inserted.conversation_id AS conversationId,
        inserted.title,
        inserted.selected_db_id AS selectedDbId,
        CONVERT(varchar(33), inserted.created_at, 127) + 'Z' AS createdAt,
        CONVERT(varchar(33), inserted.updated_at, 127) + 'Z' AS updatedAt,
        CASE WHEN inserted.last_message_at IS NULL THEN NULL ELSE CONVERT(varchar(33), inserted.last_message_at, 127) + 'Z' END AS lastMessageAt,
        NULL AS previewText
      VALUES (
        '${escapedConversationId}',
        N'${escapedUserId}',
        ${toSqlString(input.title)},
        ${toSqlString(input.selectedDbId || null)},
        SYSUTCDATETIME(),
        SYSUTCDATETIME(),
        NULL,
        0
      );`
  );

  return mapConversation(rows[0]);
}

export async function updateConversationMetadata(
  conversationId: string,
  changes: { title?: string | null; selectedDbId?: string | null; touchLastMessageAt?: boolean },
): Promise<void> {
  const assignments: string[] = ["updated_at = SYSUTCDATETIME()"];

  if (changes.title !== undefined) {
    assignments.push(`title = ${toSqlString(changes.title)}`);
  }

  if (changes.selectedDbId !== undefined) {
    assignments.push(`selected_db_id = ${toSqlString(changes.selectedDbId)}`);
  }

  if (changes.touchLastMessageAt) {
    assignments.push("last_message_at = SYSUTCDATETIME()");
  }

  const escapedConversationId = escapeSqlLiteral(conversationId);
  await queryRows(
    `UPDATE ${CONVERSATIONS_TABLE}
      SET ${assignments.join(", ")}
      WHERE conversation_id = '${escapedConversationId}';`
  );
}

export async function appendMessage(input: CreateMessageInput): Promise<ChatMessageRecord> {
  const messageId = randomUUID();
  const escapedConversationId = escapeSqlLiteral(input.conversationId);
  const escapedMessageId = escapeSqlLiteral(messageId);

  const rows = await queryRows<MessageRow>(
    `DECLARE @conversationId uniqueidentifier = '${escapedConversationId}';
      DECLARE @messageId uniqueidentifier = '${escapedMessageId}';
      DECLARE @sequenceNo int = ISNULL((SELECT MAX(sequence_no) FROM ${MESSAGES_TABLE} WHERE conversation_id = @conversationId), 0) + 1;

      INSERT INTO ${MESSAGES_TABLE} (
        message_id,
        conversation_id,
        sequence_no,
        role,
        message_type,
        question_text,
        response_text,
        sql_text,
        generated_sql,
        editable_sql,
        thread_id,
        db_id,
        status,
        error_text,
        detail_text,
        phase,
        display_target,
        code,
        result_json,
        retrieved_tables_json,
        schema_context,
        prompt_preview_json,
        last_error_json,
        final_error_json,
        tokens_json,
        agent_steps_json,
        retry_count,
        max_retries,
        max_attempts,
        created_at,
        completed_at
      )
      OUTPUT
        inserted.message_id AS messageId,
        inserted.conversation_id AS conversationId,
        inserted.sequence_no AS sequenceNo,
        inserted.role,
        inserted.message_type AS messageType,
        inserted.question_text AS question,
        inserted.response_text AS responseText,
        inserted.sql_text AS sql,
        inserted.generated_sql AS generatedSQL,
        inserted.editable_sql AS editableSQL,
        inserted.thread_id AS threadId,
        inserted.db_id AS dbId,
        inserted.status,
        inserted.error_text AS error,
        inserted.detail_text AS detail,
        inserted.phase,
        inserted.display_target AS displayTarget,
        inserted.code,
        inserted.result_json AS resultJson,
        inserted.retrieved_tables_json AS retrievedTablesJson,
        inserted.schema_context AS schemaContext,
        inserted.prompt_preview_json AS promptPreviewJson,
        inserted.last_error_json AS lastErrorJson,
        inserted.final_error_json AS finalErrorJson,
        inserted.tokens_json AS tokensJson,
        inserted.agent_steps_json AS agentStepsJson,
        inserted.retry_count AS retryCount,
        inserted.max_retries AS maxRetries,
        inserted.max_attempts AS maxAttempts,
        CONVERT(varchar(33), inserted.created_at, 127) + 'Z' AS createdAt,
        CASE WHEN inserted.completed_at IS NULL THEN NULL ELSE CONVERT(varchar(33), inserted.completed_at, 127) + 'Z' END AS completedAt
      VALUES (
        @messageId,
        @conversationId,
        @sequenceNo,
        ${toSqlString(input.role)},
        ${toSqlString(input.messageType)},
        ${toSqlString(input.question || null)},
        ${toSqlString(input.responseText || null)},
        ${toSqlString(input.sql || null)},
        ${toSqlString(input.generatedSQL || null)},
        ${toSqlString(input.editableSQL || null)},
        ${toSqlString(input.threadId || null)},
        ${toSqlString(input.dbId || null)},
        ${toSqlString(input.status || null)},
        ${toSqlString(input.error || null)},
        ${toSqlString(input.detail || null)},
        ${toSqlString(input.phase || null)},
        ${toSqlString(input.displayTarget || null)},
        ${toSqlString(input.code || null)},
        ${toSqlJson(input.result)},
        ${toSqlJson(input.retrievedTables || [])},
        ${toSqlString(input.schemaContext || null)},
        ${toSqlJson(input.promptPreview)},
        ${toSqlJson(input.lastError)},
        ${toSqlJson(input.finalError)},
        ${toSqlJson(input.tokens)},
        ${toSqlJson(input.agentSteps || [])},
        ${toSqlNumber(input.retryCount)},
        ${toSqlNumber(input.maxRetries)},
        ${toSqlNumber(input.maxAttempts)},
        SYSUTCDATETIME(),
        ${toSqlDate(input.completedAt)}
      );`
  );

  await updateConversationMetadata(input.conversationId, {
    selectedDbId: input.dbId,
    touchLastMessageAt: true,
  });

  return mapMessage(rows[0]);
}

export async function updateMessage(
  conversationId: string,
  messageId: string,
  changes: UpdateMessageInput,
): Promise<ChatMessageRecord | null> {
  const sets: string[] = [];

  if (changes.question !== undefined) sets.push(`question_text = ${toSqlString(changes.question)}`);
  if (changes.responseText !== undefined) sets.push(`response_text = ${toSqlString(changes.responseText)}`);
  if (changes.sql !== undefined) sets.push(`sql_text = ${toSqlString(changes.sql)}`);
  if (changes.generatedSQL !== undefined) sets.push(`generated_sql = ${toSqlString(changes.generatedSQL)}`);
  if (changes.editableSQL !== undefined) sets.push(`editable_sql = ${toSqlString(changes.editableSQL)}`);
  if (changes.threadId !== undefined) sets.push(`thread_id = ${toSqlString(changes.threadId)}`);
  if (changes.dbId !== undefined) sets.push(`db_id = ${toSqlString(changes.dbId)}`);
  if (changes.status !== undefined) sets.push(`status = ${toSqlString(changes.status)}`);
  if (changes.error !== undefined) sets.push(`error_text = ${toSqlString(changes.error)}`);
  if (changes.detail !== undefined) sets.push(`detail_text = ${toSqlString(changes.detail)}`);
  if (changes.phase !== undefined) sets.push(`phase = ${toSqlString(changes.phase)}`);
  if (changes.displayTarget !== undefined) sets.push(`display_target = ${toSqlString(changes.displayTarget)}`);
  if (changes.code !== undefined) sets.push(`code = ${toSqlString(changes.code)}`);
  if (changes.result !== undefined) sets.push(`result_json = ${toSqlJson(changes.result)}`);
  if (changes.retrievedTables !== undefined) sets.push(`retrieved_tables_json = ${toSqlJson(changes.retrievedTables)}`);
  if (changes.schemaContext !== undefined) sets.push(`schema_context = ${toSqlString(changes.schemaContext)}`);
  if (changes.promptPreview !== undefined) sets.push(`prompt_preview_json = ${toSqlJson(changes.promptPreview)}`);
  if (changes.lastError !== undefined) sets.push(`last_error_json = ${toSqlJson(changes.lastError)}`);
  if (changes.finalError !== undefined) sets.push(`final_error_json = ${toSqlJson(changes.finalError)}`);
  if (changes.tokens !== undefined) sets.push(`tokens_json = ${toSqlJson(changes.tokens)}`);
  if (changes.agentSteps !== undefined) sets.push(`agent_steps_json = ${toSqlJson(changes.agentSteps)}`);
  if (changes.retryCount !== undefined) sets.push(`retry_count = ${toSqlNumber(changes.retryCount)}`);
  if (changes.maxRetries !== undefined) sets.push(`max_retries = ${toSqlNumber(changes.maxRetries)}`);
  if (changes.maxAttempts !== undefined) sets.push(`max_attempts = ${toSqlNumber(changes.maxAttempts)}`);
  if (changes.completedAt !== undefined) sets.push(`completed_at = ${toSqlDate(changes.completedAt)}`);

  if (sets.length === 0) {
    return null;
  }

  sets.push("created_at = created_at");

  const escapedConversationId = escapeSqlLiteral(conversationId);
  const escapedMessageId = escapeSqlLiteral(messageId);
  const rows = await queryRows<MessageRow>(
    `UPDATE ${MESSAGES_TABLE}
      SET ${sets.join(", ")}
      OUTPUT
        inserted.message_id AS messageId,
        inserted.conversation_id AS conversationId,
        inserted.sequence_no AS sequenceNo,
        inserted.role,
        inserted.message_type AS messageType,
        inserted.question_text AS question,
        inserted.response_text AS responseText,
        inserted.sql_text AS sql,
        inserted.generated_sql AS generatedSQL,
        inserted.editable_sql AS editableSQL,
        inserted.thread_id AS threadId,
        inserted.db_id AS dbId,
        inserted.status,
        inserted.error_text AS error,
        inserted.detail_text AS detail,
        inserted.phase,
        inserted.display_target AS displayTarget,
        inserted.code,
        inserted.result_json AS resultJson,
        inserted.retrieved_tables_json AS retrievedTablesJson,
        inserted.schema_context AS schemaContext,
        inserted.prompt_preview_json AS promptPreviewJson,
        inserted.last_error_json AS lastErrorJson,
        inserted.final_error_json AS finalErrorJson,
        inserted.tokens_json AS tokensJson,
        inserted.agent_steps_json AS agentStepsJson,
        inserted.retry_count AS retryCount,
        inserted.max_retries AS maxRetries,
        inserted.max_attempts AS maxAttempts,
        CONVERT(varchar(33), inserted.created_at, 127) + 'Z' AS createdAt,
        CASE WHEN inserted.completed_at IS NULL THEN NULL ELSE CONVERT(varchar(33), inserted.completed_at, 127) + 'Z' END AS completedAt
      WHERE conversation_id = '${escapedConversationId}'
        AND message_id = '${escapedMessageId}';`
  );

  await updateConversationMetadata(conversationId, {
    touchLastMessageAt: true,
  });

  return rows[0] ? mapMessage(rows[0]) : null;
}

export async function archiveConversation(userId: string, conversationId: string): Promise<boolean> {
  const escapedUserId = escapeSqlLiteral(userId);
  const escapedConversationId = escapeSqlLiteral(conversationId);
  const rows = await queryRows<{ archivedConversationId: string }>(
    `UPDATE ${CONVERSATIONS_TABLE}
      SET is_archived = 1,
          updated_at = SYSUTCDATETIME()
      OUTPUT inserted.conversation_id AS archivedConversationId
      WHERE user_id = N'${escapedUserId}'
        AND conversation_id = '${escapedConversationId}'
        AND is_archived = 0;`
  );

  return rows.length > 0;
}
