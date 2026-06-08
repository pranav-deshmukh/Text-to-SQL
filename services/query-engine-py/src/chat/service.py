from chat.models import ChatConversationMessage, ChatConversationSummary
from chat.repository import (
    append_message,
    archive_conversation,
    create_conversation,
    delete_conversation,
    get_conversation,
    list_conversations,
    register_chat_store,
    rename_conversation,
    unarchive_conversation,
    update_message,
    update_conversation_metadata,
)

MAX_CONVERSATION_TITLE_LENGTH = 120


def _truncate_title(question: str) -> str:
    trimmed = " ".join(question.strip().split())
    if len(trimmed) <= 80:
        return trimmed
    return f"{trimmed[:77].strip()}..."


def _normalize_title(title: str) -> str:
    normalized = " ".join(title.strip().split())
    if not normalized:
        raise ValueError("Conversation title is required.")
    if len(normalized) > MAX_CONVERSATION_TITLE_LENGTH:
        return f"{normalized[:MAX_CONVERSATION_TITLE_LENGTH - 3].strip()}..."
    return normalized


async def list_user_conversations(user_id: str, archived: bool = False):
    return await list_conversations(user_id, archived)


async def get_user_conversation(user_id: str, conversation_id: str, archived: bool = False):
    return await get_conversation(user_id, conversation_id, archived)


async def create_user_conversation(user_id: str, selected_db_id: str | None = None, title: str | None = None) -> ChatConversationSummary:
    return await create_conversation(user_id, selected_db_id, title.strip() if title and title.strip() else "New chat")


async def rename_user_conversation(user_id: str, conversation_id: str, title: str):
    return await rename_conversation(user_id, conversation_id, _normalize_title(title))


async def archive_user_conversation(user_id: str, conversation_id: str) -> bool:
    return await archive_conversation(user_id, conversation_id)


async def unarchive_user_conversation(user_id: str, conversation_id: str) -> bool:
    return await unarchive_conversation(user_id, conversation_id)


async def delete_user_conversation(user_id: str, conversation_id: str) -> bool:
    return await delete_conversation(user_id, conversation_id)


async def ensure_conversation(user_id: str, question: str, db_id: str, conversation_id: str | None = None) -> ChatConversationSummary:
    if conversation_id:
        existing = await get_conversation(user_id, conversation_id)
        if not existing:
            raise ValueError("Conversation not found.")
        await update_conversation_metadata(conversation_id, selected_db_id=db_id)
        return ChatConversationSummary(**existing.model_dump(exclude={"messages"}))
    return await create_conversation(user_id, db_id, _truncate_title(question))


async def persist_user_question(user_id: str, question: str, db_id: str, conversation_id: str | None = None) -> tuple[ChatConversationSummary, ChatConversationMessage]:
    conversation = await ensure_conversation(user_id, question, db_id, conversation_id)
    message = await append_message({
        "conversationId": conversation.conversationId,
        "role": "user",
        "messageType": "question",
        "question": question,
        "dbId": db_id,
        "status": "success",
        "completedAt": None,
    })
    return conversation, message


async def persist_assistant_result(conversation_id: str, response: dict) -> ChatConversationMessage:
    return await append_message({
        "conversationId": conversation_id,
        "role": "assistant",
        "messageType": response.get("messageType", "answer"),
        "responseText": response.get("error"),
        "sql": response.get("sql"),
        "dbId": response.get("dbId"),
        "status": response.get("status", "error" if response.get("error") else "success"),
        "error": response.get("error"),
        "detail": response.get("detail"),
        "phase": response.get("phase"),
        "displayTarget": response.get("displayTarget"),
        "code": response.get("code"),
        "result": response.get("data"),
        "retrievedTables": response.get("retrievedTables", []),
        "schemaContext": response.get("schemaContext"),
        "promptPreview": response.get("promptPreview"),
        "finalError": response.get("finalError"),
        "tokens": response.get("tokens"),
        "agentSteps": response.get("agentSteps", []),
        "retryCount": response.get("retryCount"),
        "maxRetries": response.get("maxRetries"),
        "maxAttempts": response.get("maxAttempts"),
        "completedAt": None,
    })


async def persist_agent_success(conversation_id: str, result: dict) -> ChatConversationMessage:
    return await persist_assistant_result(conversation_id, {
        "sql": result.get("sql"),
        "data": result.get("data"),
        "retrievedTables": result.get("retrievedTables", []),
        "retryCount": result.get("retryCount"),
        "maxRetries": result.get("maxRetries"),
        "maxAttempts": result.get("maxAttempts"),
        "finalError": None,
        "status": "success",
    })


async def persist_agent_error(conversation_id: str, result: dict) -> ChatConversationMessage:
    return await persist_assistant_result(conversation_id, {
        "sql": result.get("sql"),
        "error": result.get("error"),
        "detail": result.get("detail"),
        "phase": result.get("phase"),
        "displayTarget": result.get("displayTarget"),
        "code": result.get("code"),
        "finalError": result.get("finalError"),
        "retrievedTables": result.get("retrievedTables", []),
        "retryCount": result.get("retryCount"),
        "maxRetries": result.get("maxRetries"),
        "maxAttempts": result.get("maxAttempts"),
        "status": "error",
        "messageType": "error",
    })


async def persist_review_draft(conversation_id: str, draft: dict) -> ChatConversationMessage:
    return await append_message({
        "conversationId": conversation_id,
        "role": "assistant",
        "messageType": "review_draft",
        "responseText": None,
        "generatedSQL": draft.get("generatedSQL"),
        "editableSQL": draft.get("editableSQL"),
        "threadId": draft.get("threadId"),
        "status": "awaiting_review",
        "retrievedTables": draft.get("retrievedTables", []),
        "schemaContext": draft.get("schemaContext"),
        "promptPreview": draft.get("promptPreview"),
        "lastError": draft.get("lastError"),
    })


async def update_persisted_review_message(conversation_id: str, message_id: str, changes: dict) -> ChatConversationMessage | None:
    return await update_message(conversation_id, message_id, changes)