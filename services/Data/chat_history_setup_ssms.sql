USE [QueryAssist];
GO

IF OBJECT_ID(N'dbo.chat_conversations', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.chat_conversations
    (
        conversation_id UNIQUEIDENTIFIER NOT NULL,
        user_id NVARCHAR(64) NOT NULL,
        title NVARCHAR(200) NOT NULL,
        selected_db_id NVARCHAR(100) NULL,
        created_at DATETIME2(0) NOT NULL CONSTRAINT DF_chat_conversations_created_at DEFAULT (SYSUTCDATETIME()),
        updated_at DATETIME2(0) NOT NULL CONSTRAINT DF_chat_conversations_updated_at DEFAULT (SYSUTCDATETIME()),
        last_message_at DATETIME2(0) NULL,
        is_archived BIT NOT NULL CONSTRAINT DF_chat_conversations_is_archived DEFAULT (0),
        CONSTRAINT PK_chat_conversations PRIMARY KEY CLUSTERED (conversation_id),
        CONSTRAINT FK_chat_conversations_app_users FOREIGN KEY (user_id)
            REFERENCES dbo.app_users (user_id)
    );
END
GO

IF OBJECT_ID(N'dbo.chat_messages', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.chat_messages
    (
        message_id UNIQUEIDENTIFIER NOT NULL,
        conversation_id UNIQUEIDENTIFIER NOT NULL,
        sequence_no INT NOT NULL,
        role NVARCHAR(20) NOT NULL,
        message_type NVARCHAR(40) NOT NULL,
        question_text NVARCHAR(MAX) NULL,
        response_text NVARCHAR(MAX) NULL,
        sql_text NVARCHAR(MAX) NULL,
        generated_sql NVARCHAR(MAX) NULL,
        editable_sql NVARCHAR(MAX) NULL,
        thread_id NVARCHAR(100) NULL,
        db_id NVARCHAR(100) NULL,
        status NVARCHAR(40) NULL,
        error_text NVARCHAR(MAX) NULL,
        detail_text NVARCHAR(MAX) NULL,
        phase NVARCHAR(20) NULL,
        display_target NVARCHAR(20) NULL,
        code NVARCHAR(100) NULL,
        result_json NVARCHAR(MAX) NULL,
        retrieved_tables_json NVARCHAR(MAX) NULL,
        schema_context NVARCHAR(MAX) NULL,
        prompt_preview_json NVARCHAR(MAX) NULL,
        last_error_json NVARCHAR(MAX) NULL,
        final_error_json NVARCHAR(MAX) NULL,
        tokens_json NVARCHAR(MAX) NULL,
        agent_steps_json NVARCHAR(MAX) NULL,
        retry_count INT NULL,
        max_retries INT NULL,
        max_attempts INT NULL,
        created_at DATETIME2(0) NOT NULL CONSTRAINT DF_chat_messages_created_at DEFAULT (SYSUTCDATETIME()),
        completed_at DATETIME2(0) NULL,
        CONSTRAINT PK_chat_messages PRIMARY KEY CLUSTERED (message_id),
        CONSTRAINT FK_chat_messages_chat_conversations FOREIGN KEY (conversation_id)
            REFERENCES dbo.chat_conversations (conversation_id),
        CONSTRAINT UQ_chat_messages_sequence UNIQUE (conversation_id, sequence_no),
        CONSTRAINT CK_chat_messages_role CHECK (role IN (N'user', N'assistant', N'system')),
        CONSTRAINT CK_chat_messages_phase CHECK (phase IS NULL OR phase IN (N'request', N'generation', N'validation', N'execution', N'internal')),
        CONSTRAINT CK_chat_messages_display_target CHECK (display_target IS NULL OR display_target IN (N'sql-box', N'error-box'))
    );
END
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.chat_conversations')
      AND name = N'IX_chat_conversations_user_last_message'
)
BEGIN
    CREATE INDEX IX_chat_conversations_user_last_message
        ON dbo.chat_conversations (user_id, last_message_at DESC, updated_at DESC);
END
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.chat_messages')
      AND name = N'IX_chat_messages_conversation_created'
)
BEGIN
    CREATE INDEX IX_chat_messages_conversation_created
        ON dbo.chat_messages (conversation_id, created_at, sequence_no);
END
GO
