USE QueryAssist;
GO

CREATE SCHEMA audit AUTHORIZATION dbo;
GO

-- 1) Database dimension (for reporting/filter UX)
CREATE TABLE audit.databases (
    db_id           NVARCHAR(100)  NOT NULL PRIMARY KEY,
    display_name    NVARCHAR(200)  NOT NULL,
    is_active       BIT            NOT NULL CONSTRAINT DF_audit_databases_is_active DEFAULT (1),
    created_at      DATETIME2(3)   NOT NULL CONSTRAINT DF_audit_databases_created_at DEFAULT (SYSUTCDATETIME()),
    updated_at      DATETIME2(3)   NOT NULL CONSTRAINT DF_audit_databases_updated_at DEFAULT (SYSUTCDATETIME())
);
GO

-- 2) Request-level audit record
CREATE TABLE audit.requests (
    request_id        UNIQUEIDENTIFIER NOT NULL PRIMARY KEY, -- from randomUUID() in app
    endpoint          NVARCHAR(120)    NOT NULL,             -- /query/initiate, /query/resume, /logs/api, etc.
    app_env           NVARCHAR(10)     NOT NULL,             -- dev/prod
    status            NVARCHAR(10)     NOT NULL,             -- success/error
    user_id           NVARCHAR(120)    NULL,
    user_role         NVARCHAR(60)     NULL,
    db_id             NVARCHAR(100)    NULL,                 -- database used for this request
    db_display_name   NVARCHAR(200)    NULL,                 -- snapshot for historical readability
    question          NVARCHAR(MAX)    NULL,
    started_at        DATETIME2(3)     NOT NULL,
    completed_at      DATETIME2(3)     NULL,
    duration_ms       AS (CASE WHEN completed_at IS NULL THEN NULL ELSE DATEDIFF_BIG(MILLISECOND, started_at, completed_at) END) PERSISTED,
    summary_json      NVARCHAR(MAX)    NULL,                 -- stage/output summary object
    created_at        DATETIME2(3)     NOT NULL CONSTRAINT DF_audit_requests_created_at DEFAULT (SYSUTCDATETIME()),

    CONSTRAINT CK_audit_requests_app_env CHECK (app_env IN ('dev', 'prod')),
    CONSTRAINT CK_audit_requests_status CHECK (status IN ('success', 'error')),
    CONSTRAINT CK_audit_requests_summary_json CHECK (summary_json IS NULL OR ISJSON(summary_json) = 1),
    CONSTRAINT FK_audit_requests_db FOREIGN KEY (db_id) REFERENCES audit.databases(db_id)
);
GO

-- 3) Stage-level audit records (1 request -> many stages)
CREATE TABLE audit.stages (
    stage_id          BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    request_id        UNIQUEIDENTIFIER     NOT NULL,
    stage_order       SMALLINT             NOT NULL,         -- sequence in lifecycle
    stage_name        NVARCHAR(80)         NOT NULL,         -- request_received/input_validation/...
    status            NVARCHAR(10)         NOT NULL,         -- success/error
    [timestamp]       DATETIME2(3)         NOT NULL,
    duration_ms       INT                  NULL,
    details_json      NVARCHAR(MAX)        NULL,             -- stage details
    error_name        NVARCHAR(200)        NULL,
    error_message     NVARCHAR(MAX)        NULL,
    error_code        NVARCHAR(100)        NULL,
    error_stack       NVARCHAR(MAX)        NULL,

    CONSTRAINT FK_audit_stages_request FOREIGN KEY (request_id)
        REFERENCES audit.requests(request_id) ON DELETE CASCADE,
    CONSTRAINT UQ_audit_stages_request_order UNIQUE (request_id, stage_order),
    CONSTRAINT CK_audit_stages_status CHECK (status IN ('success', 'error')),
    CONSTRAINT CK_audit_stages_details_json CHECK (details_json IS NULL OR ISJSON(details_json) = 1)
);
GO

-- Indexes for logs screen filters
CREATE INDEX IX_audit_requests_started_at
    ON audit.requests (started_at DESC);

CREATE INDEX IX_audit_requests_status_started
    ON audit.requests (status, started_at DESC);

CREATE INDEX IX_audit_requests_db_started
    ON audit.requests (db_id, started_at DESC);

CREATE INDEX IX_audit_requests_env_started
    ON audit.requests (app_env, started_at DESC);

CREATE INDEX IX_audit_requests_env_db_started
    ON audit.requests (app_env, db_id, started_at DESC);

CREATE INDEX IX_audit_requests_endpoint_started
    ON audit.requests (endpoint, started_at DESC);

CREATE INDEX IX_audit_stages_request_timestamp
    ON audit.stages (request_id, [timestamp] DESC);

CREATE INDEX IX_audit_stages_name_status_timestamp
    ON audit.stages (stage_name, status, [timestamp] DESC);
GO