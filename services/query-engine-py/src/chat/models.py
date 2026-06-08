from typing import Literal

from pydantic import BaseModel


ChatMessageRole = Literal["user", "assistant", "system"]
ChatMessageStatus = Literal["success", "error", "awaiting_review"]


class ChatConversationSummary(BaseModel):
    conversationId: str
    title: str
    selectedDbId: str | None
    createdAt: str
    updatedAt: str
    lastMessageAt: str | None
    previewText: str | None


class ChatConversationMessage(BaseModel):
    messageId: str
    conversationId: str
    sequenceNo: int
    role: ChatMessageRole
    messageType: str
    question: str | None = None
    responseText: str | None = None
    sql: str | None = None
    generatedSQL: str | None = None
    editableSQL: str | None = None
    threadId: str | None = None
    dbId: str | None = None
    status: ChatMessageStatus | None = None
    error: str | None = None
    detail: str | None = None
    phase: str | None = None
    displayTarget: str | None = None
    code: str | None = None
    result: dict | None = None
    retrievedTables: list[str] = []
    schemaContext: str | None = None
    promptPreview: dict | None = None
    lastError: dict | None = None
    finalError: dict | None = None
    tokens: dict | None = None
    agentSteps: list[dict] = []
    retryCount: int | None = None
    maxRetries: int | None = None
    maxAttempts: int | None = None
    createdAt: str
    completedAt: str | None = None


class ChatConversationDetail(ChatConversationSummary):
    messages: list[ChatConversationMessage]


class CreateChatRequest(BaseModel):
    dbId: str | None = None
    title: str | None = None


class RenameChatRequest(BaseModel):
    title: str