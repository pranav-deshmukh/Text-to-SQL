# QueryAssist Auth Setup for SSMS

This project has two application roles today:

- `end_user` — can ask natural-language questions and view validated results, but does not get SQL review tooling.
- `tech_team` — can inspect generated SQL, use review/resume routes, and access the logs UI.

The backend now authenticates against SQL Server table `dbo.app_users` instead of the old in-memory demo array.

## What to configure

1. Run the T-SQL below in SSMS.
2. Point `AUTH_DB_CONNECTION_STRING` in `services/query-engine/.env` to the created database.
3. Start the backend.

Example connection string:

```env
AUTH_DB_CONNECTION_STRING=Driver={ODBC Driver 18 for SQL Server};Server=YOUR_SERVER;Database=QueryAssistAuth;Uid=YOUR_USER;Pwd=YOUR_PASSWORD;TrustServerCertificate=yes;
```

## SSMS script

```sql
USE [master];
GO

IF DB_ID(N'QueryAssistAuth') IS NULL
BEGIN
    CREATE DATABASE [QueryAssistAuth];
END
GO

USE [QueryAssistAuth];
GO

IF OBJECT_ID(N'dbo.app_users', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.app_users
    (
        user_id NVARCHAR(64) NOT NULL,
        username NVARCHAR(128) NOT NULL,
        password_hash NVARCHAR(255) NOT NULL,
        role NVARCHAR(32) NOT NULL,
        is_active BIT NOT NULL CONSTRAINT DF_app_users_is_active DEFAULT (1),
        created_at DATETIME2(0) NOT NULL CONSTRAINT DF_app_users_created_at DEFAULT (SYSUTCDATETIME()),
        updated_at DATETIME2(0) NOT NULL CONSTRAINT DF_app_users_updated_at DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT PK_app_users PRIMARY KEY CLUSTERED (user_id),
        CONSTRAINT UQ_app_users_username UNIQUE (username),
        CONSTRAINT CK_app_users_role CHECK (role IN (N'end_user', N'tech_team'))
    );
END
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.app_users')
      AND name = N'IX_app_users_username_active'
)
BEGIN
    CREATE INDEX IX_app_users_username_active
        ON dbo.app_users (username, is_active);
END
GO

MERGE dbo.app_users AS target
USING (
    VALUES
        (
            N'end-user-001',
            N'enduser',
            N'$2b$12$DkTFZXWZl8Qaw2SFLjDP/O.OesBJUHron8mlG2YjeOykKFoDfN3zq',
            N'end_user',
            CAST(1 AS bit)
        ),
        (
            N'tech-team-001',
            N'techteam',
            N'$2b$12$ObjOZCHRsnQuuPBNqCtUO.ovOWru7YZO0ZfMxxKUVfspvs5z81yRy',
            N'tech_team',
            CAST(1 AS bit)
        )
) AS source (user_id, username, password_hash, role, is_active)
ON target.user_id = source.user_id
WHEN MATCHED THEN
    UPDATE SET
        username = source.username,
        password_hash = source.password_hash,
        role = source.role,
        is_active = source.is_active,
        updated_at = SYSUTCDATETIME()
WHEN NOT MATCHED THEN
    INSERT (user_id, username, password_hash, role, is_active)
    VALUES (source.user_id, source.username, source.password_hash, source.role, source.is_active);
GO

SELECT user_id, username, role, is_active, created_at, updated_at
FROM dbo.app_users
ORDER BY username;
GO
```

## Seeded login accounts

- `enduser` / `EndUser@123`
- `techteam` / `TechTeam@123`

Change the seeded passwords by replacing the bcrypt hashes before running the `MERGE`, or update the rows later with new hashes.