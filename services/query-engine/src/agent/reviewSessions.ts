import { randomUUID } from "crypto";

export interface ReviewSession {
  threadId: string;
  userId: string;
  dbId: string;
  conversationId?: string;
  assistantMessageId?: string;
  question: string;
  generatedSql: string;
  editableSql: string;
  schemaContext: string;
  promptPreview: {
    systemPrompt: string;
    userPrompt: string;
  };
  retrievedTables: string[];
  createdAt: string;
  updatedAt: string;
  lastError?: {
    phase: "validation" | "execution";
    message: string;
  };
}

const reviewSessions = new Map<string, ReviewSession>();
const ttlMinutes = Number.parseInt(process.env.REVIEW_SESSION_TTL_MINUTES || "30", 10);
const REVIEW_TTL_MS = (Number.isFinite(ttlMinutes) && ttlMinutes > 0 ? ttlMinutes : 30) * 60 * 1000;

function isExpired(session: ReviewSession): boolean {
  return Date.now() - new Date(session.updatedAt).getTime() > REVIEW_TTL_MS;
}

export function cleanupExpiredReviewSessions(): void {
  for (const [threadId, session] of reviewSessions.entries()) {
    if (isExpired(session)) {
      reviewSessions.delete(threadId);
    }
  }
}

export function createReviewSession(input: Omit<ReviewSession, "threadId" | "createdAt" | "updatedAt">): ReviewSession {
  cleanupExpiredReviewSessions();

  const now = new Date().toISOString();
  const session: ReviewSession = {
    ...input,
    threadId: randomUUID(),
    createdAt: now,
    updatedAt: now,
  };

  reviewSessions.set(session.threadId, session);
  return session;
}

export function getReviewSession(threadId: string, userId: string): ReviewSession | null {
  cleanupExpiredReviewSessions();

  const session = reviewSessions.get(threadId);
  if (!session || session.userId !== userId) {
    return null;
  }

  if (isExpired(session)) {
    reviewSessions.delete(threadId);
    return null;
  }

  return session;
}

export function updateReviewSession(threadId: string, updater: (session: ReviewSession) => ReviewSession): ReviewSession | null {
  const existing = reviewSessions.get(threadId);
  if (!existing) {
    return null;
  }

  const next = {
    ...updater(existing),
    updatedAt: new Date().toISOString(),
  };

  reviewSessions.set(threadId, next);
  return next;
}

export function completeReviewSession(threadId: string): void {
  reviewSessions.delete(threadId);
}
