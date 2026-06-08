from pydantic import BaseModel, Field


class QueryRequest(BaseModel):
    question: str
    dbId: str
    conversationId: str | None = None


class RagInspectRequest(BaseModel):
    question: str
    dbId: str
    topK: int | None = Field(default=None, ge=1, le=25)


class ReviewRunRequest(BaseModel):
    threadId: str
    approvedSQL: str
    conversationId: str | None = None


class ReviewRegenerateRequest(BaseModel):
    threadId: str
    conversationId: str | None = None


class ReviewCancelRequest(BaseModel):
    threadId: str
    reason: str | None = None