# Chat History UI Plan

## Goal

Replace the current chat page with a ChatGPT-style workspace that includes:

- Left sidebar only layout
- `New chat` button at the top of the sidebar
- Saved conversation list below it
- Re-openable chat history per user
- Bottom profile section with a click menu for logout
- No top navigation bar in the main chat screen

This plan covers the required SQL Server tables, backend APIs, frontend refactor, and rollout sequence.

---

## Target Experience

### Sidebar

- Top: `New chat`
- Middle: saved chats for the logged-in user
- Bottom: user profile summary
- Profile click opens a small menu with:
  - `Logout`
  - optional future actions like `Settings` or `View logs`

### Main Area

- Active conversation view
- Existing chat messages visible when revisiting a saved chat
- New prompt input at the bottom
- SQL review experience remains available for `tech_team`
- End users continue to see the simplified experience

---

## Current System Summary

### Frontend

Current chat UI is centered around:

- `web/src/app/quotes/quotes.ts`
- `web/src/app/quotes/quotes.html`
- `web/src/app/quotes/quotes.css`

Auth and current user state already exist in:

- `web/src/app/Services/auth-service.ts`
- `web/src/app/Models/auth-user.ts`
- `web/src/app/guards/auth.guard.ts`
- `web/src/app/guards/logs.guard.ts`

Reusable message model already exists in:

- `web/src/app/Models/message.ts`

### Backend

Current API and auth live in:

- `services/query-engine/src/index.ts`
- `services/query-engine/src/auth/users.ts`
- `services/query-engine/src/auth/middleware.ts`
- `services/query-engine/src/auth/token.ts`

Temporary tech review session logic exists in:

- `services/query-engine/src/agent/reviewFlow.ts`
- `services/query-engine/src/agent/reviewSessions.ts`

There is no persistent chat history yet.

---

## New Data Model

The easiest and cleanest approach is to store chat history in the same SQL Server database as application auth.

### Table 1: `dbo.chat_conversations`

Represents one saved chat thread.

#### Columns

- `conversation_id` `uniqueidentifier` primary key
- `user_id` `nvarchar(64)` not null
- `title` `nvarchar(200)` not null
- `selected_db_id` `nvarchar(100)` null
- `created_at` `datetime2` not null default `SYSUTCDATETIME()`
- `updated_at` `datetime2` not null default `SYSUTCDATETIME()`
- `last_message_at` `datetime2` null
- `is_archived` `bit` not null default `0`

#### Notes

- `user_id` should map to `dbo.app_users.user_id`
- `title` can initially be generated from the first user prompt
- `selected_db_id` stores which business database the chat is using
- `last_message_at` is used to sort sidebar chats

### Table 2: `dbo.chat_messages`

Represents each user or assistant message inside a conversation.

#### Columns

- `message_id` `uniqueidentifier` primary key
- `conversation_id` `uniqueidentifier` not null
- `sequence_no` `int` not null
- `role` `nvarchar(20)` not null
- `message_type` `nvarchar(40)` not null
- `question_text` `nvarchar(max)` null
- `response_text` `nvarchar(max)` null
- `sql_text` `nvarchar(max)` null
- `generated_sql` `nvarchar(max)` null
- `editable_sql` `nvarchar(max)` null
- `db_id` `nvarchar(100)` null
- `status` `nvarchar(40)` null
- `error_code` `nvarchar(100)` null
- `error_detail` `nvarchar(max)` null
- `result_json` `nvarchar(max)` null
- `retrieved_tables_json` `nvarchar(max)` null
- `prompt_context_json` `nvarchar(max)` null
- `created_at` `datetime2` not null default `SYSUTCDATETIME()`
- `completed_at` `datetime2` null

#### Notes

- `role` values: `user`, `assistant`, `system`
- `message_type` can distinguish normal replies, streamed result messages, review drafts, resume actions, and error messages
- `result_json` should store a bounded payload, not unlimited result sets for very large queries

### Optional Table 3: `dbo.chat_message_artifacts`

Use this only if `chat_messages` becomes too large.

#### Possible columns

- `artifact_id` `uniqueidentifier` primary key
- `message_id` `uniqueidentifier` not null
- `artifact_type` `nvarchar(50)` not null
- `artifact_json` `nvarchar(max)` not null
- `created_at` `datetime2` not null default `SYSUTCDATETIME()`

This is optional and can be skipped in phase 1.

---

## Recommended Relationships

- One user can have many conversations
- One conversation can have many messages
- One message may optionally have one or more artifacts

### Indexes

#### `chat_conversations`

- index on `(user_id, last_message_at desc)`
- index on `(user_id, is_archived)`

#### `chat_messages`

- unique index on `(conversation_id, sequence_no)`
- index on `(conversation_id, created_at)`

---

## Backend Changes

### New backend modules to add

Suggested files under `services/query-engine/src/chat/`:

- `types.ts`
- `repository.ts`
- `service.ts`
- `sql.ts`

### Responsibilities

#### `repository.ts`

- raw SQL access for conversations and messages
- create conversation
- list conversations for a user
- load one conversation with messages
- append messages
- update titles and timestamps

#### `service.ts`

- business rules
- create new chat on first prompt
- infer title from first user message
- validate ownership
- handle persistence for normal query flow and tech review flow

#### `types.ts`

- shared interfaces for chat conversation summaries and message records

---

## Backend API Plan

### 1. `GET /chats`

Returns sidebar list for the logged-in user.

#### Response

- conversation id
- title
- selected db id
- created at
- updated at
- last message at
- latest message preview

### 2. `POST /chats`

Creates a new empty conversation.

#### Request

- optional `dbId`
- optional `title`

### 3. `GET /chats/:conversationId`

Returns one conversation and all messages.

#### Used for

- revisit old chats
- restore chat pane on refresh

### 4. `DELETE /chats/:conversationId`

Optional in phase 1, but useful for sidebar cleanup.

#### Behavior

- soft archive instead of hard delete

### 5. Extend `POST /query`

Accept `conversationId` in request body.

#### Behavior

- persist user question message
- persist assistant response message
- update conversation timestamps
- create conversation automatically if no `conversationId` is supplied

### 6. Extend review endpoints

Affected routes:

- `POST /query/initiate`
- `POST /query/resume`
- `GET /query/status/:threadId`
- streaming variants if required

#### Behavior

- save tech review drafts and resumed SQL responses into the conversation history
- remove reliance on memory-only review state where possible

---

## Frontend Changes

### Main refactor target

Current file to refactor heavily:

- `web/src/app/quotes/quotes.html`
- `web/src/app/quotes/quotes.css`
- `web/src/app/quotes/quotes.ts`

### New frontend pieces to add

Suggested files:

- `web/src/app/Services/chat-history.service.ts`
- `web/src/app/Models/chat-conversation.ts`
- `web/src/app/Components/chat-sidebar/`
- `web/src/app/Components/profile-menu/`

### New responsibilities

#### Chat history service

- fetch chat list
- create new chat
- fetch one conversation
- delete or archive chat later
- keep active `conversationId`

#### Sidebar component

- render `New chat`
- render conversation list
- highlight active chat
- navigate between chats
- show profile area at bottom

#### Profile menu component

- show current username and role
- open menu on click
- allow logout
- optionally show logs link for `tech_team`

---

## Routing Plan

### Current

The app currently uses a single protected root route for the main chat page.

### Proposed

Keep the root route but support conversation-based navigation:

- `/` → opens a new empty chat or most recent chat
- `/chat/:conversationId` → opens a saved chat
- `/login`
- `/signup`
- `/logs`

This gives deep linking and revisit support.

---

## UI Layout Plan

### Remove

Remove the current top header area from the chat page.

### Replace with

A two-column layout:

#### Left sidebar

- fixed width
- dark theme similar to ChatGPT style
- `New chat` button at top
- saved chats list in middle
- profile area at bottom

#### Main panel

- chat transcript area
- result cards / SQL review cards
- input composer at bottom

### Visual notes

- keep message components reusable where possible
- change shell structure, not only colors
- sidebar should remain visible across chat navigation

---

## Suggested Phase Plan

### Phase 1: Data + backend foundation

- create chat tables in SQL Server
- add repository/service layer
- add `GET /chats`, `POST /chats`, `GET /chats/:conversationId`
- extend query route to persist history

### Phase 2: Frontend sidebar shell

- replace top-bar page layout
- add sidebar component
- add conversation list loading
- add profile/logout area
- add route navigation by conversation id

### Phase 3: Persisted query experience

- load saved messages when a chat opens
- create new conversation on `New chat`
- append messages after each query
- keep `tech_team` review UI working inside saved chats

### Phase 4: Cleanup and quality

- add archive/delete chat support
- improve chat title generation
- cap stored result payload size
- test refresh and revisit behavior

---

## Risks and Important Decisions

### 1. Review flow persistence

Current tech review state is memory-based. If users must reopen an in-progress review later, review sessions must also be persisted in SQL Server.

### 2. Result payload size

Saving every full SQL result set may make the database grow too fast.

Recommended phase-1 rule:

- store metadata plus a capped preview of rows
- rerun large queries if needed later

### 3. Ownership checks

Every chat endpoint must ensure the logged-in user only sees their own conversations.

### 4. Conversation title generation

For phase 1, use one of these:

- first user question truncated to 60 to 80 chars
- later allow rename support

### 5. Migration safety

There is no existing chat history to migrate, so rollout is straightforward.

---

## Acceptance Criteria

The work is complete when:

- a logged-in user can click `New chat`
- each new conversation is saved in SQL Server
- chats appear in a left sidebar list
- clicking an old chat restores its full messages
- the top bar is removed from the main chat page
- a bottom profile area opens a logout option
- `tech_team` still gets SQL review and logs access
- `end_user` still gets the simplified query experience

---

## Recommended Next Implementation Files

### Backend

- `services/query-engine/src/chat/types.ts`
- `services/query-engine/src/chat/repository.ts`
- `services/query-engine/src/chat/service.ts`
- `services/query-engine/src/chat/sql.ts`
- update `services/query-engine/src/index.ts`

### Frontend

- `web/src/app/Services/chat-history.service.ts`
- `web/src/app/Models/chat-conversation.ts`
- `web/src/app/Components/chat-sidebar/*`
- `web/src/app/Components/profile-menu/*`
- update `web/src/app/quotes/quotes.ts`
- update `web/src/app/quotes/quotes.html`
- update `web/src/app/quotes/quotes.css`
- update `web/src/app/app.routes.ts`

---

## Recommendation

Start with database tables and chat history APIs first, then refactor the frontend shell. That keeps the UI work grounded in real persisted data instead of temporary local state.
