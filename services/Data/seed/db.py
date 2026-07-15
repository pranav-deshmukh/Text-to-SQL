"""
Database connection and batch insert utilities.
"""

import pyodbc
from typing import List, Tuple, Any
from config import DB_CONNECTION_STRING, BATCH_SIZE


def get_connection() -> pyodbc.Connection:
    """Get a new database connection."""
    conn = pyodbc.connect(DB_CONNECTION_STRING, autocommit=False)
    return conn


def execute_sql(conn: pyodbc.Connection, sql: str, params=None):
    """Execute a single SQL statement."""
    cursor = conn.cursor()
    if params:
        cursor.execute(sql, params)
    else:
        cursor.execute(sql)
    conn.commit()
    cursor.close()


def batch_insert(conn: pyodbc.Connection, table: str, columns: List[str], rows: List[Tuple], schema: str = None):
    """
    Batch insert rows with SET IDENTITY_INSERT ON.
    Uses executemany for performance.
    """
    full_table = f"[{schema}].[{table}]" if schema else f"[{table}]"
    placeholders = ", ".join(["?" for _ in columns])
    col_names = ", ".join([f"[{c}]" for c in columns])
    sql = f"INSERT INTO {full_table} ({col_names}) VALUES ({placeholders})"

    cursor = conn.cursor()

    # Insert in batches
    for i in range(0, len(rows), BATCH_SIZE):
        batch = rows[i:i + BATCH_SIZE]
        cursor.executemany(sql, batch)

    conn.commit()
    cursor.close()
    print(f"  Inserted {len(rows)} rows into {full_table}")


def batch_insert_identity(conn: pyodbc.Connection, table: str, columns: List[str], rows: List[Tuple], schema: str = None):
    """
    Batch insert rows with explicit identity values (IDENTITY_INSERT ON).
    """
    full_table = f"[{schema}].[{table}]" if schema else f"[{table}]"
    placeholders = ", ".join(["?" for _ in columns])
    col_names = ", ".join([f"[{c}]" for c in columns])

    cursor = conn.cursor()
    cursor.execute(f"SET IDENTITY_INSERT {full_table} ON")

    sql = f"INSERT INTO {full_table} ({col_names}) VALUES ({placeholders})"

    for i in range(0, len(rows), BATCH_SIZE):
        batch = rows[i:i + BATCH_SIZE]
        cursor.executemany(sql, batch)

    cursor.execute(f"SET IDENTITY_INSERT {full_table} OFF")
    conn.commit()
    cursor.close()
    print(f"  Inserted {len(rows)} rows into {full_table} (with identity)")


def truncate_all(conn: pyodbc.Connection):
    """Truncate all tables in correct order (reverse dependency)."""
    tables = [
        ("security", "audit_logs"),
        ("security", "notifications"),
        ("portfolio", "watchlist_items"),
        ("portfolio", "watchlists"),
        ("portfolio", "portfolio_performance"),
        ("finance", "tax_records"),
        ("finance", "interest_payments"),
        ("finance", "dividends"),
        ("finance", "fees"),
        ("finance", "account_statements"),
        ("finance", "transactions"),
        ("portfolio", "portfolio_holdings"),
        ("trading", "executed_trades"),
        ("trading", "buy_sell_orders"),
        ("trading", "market_prices"),
        ("portfolio", "portfolios"),
        ("customer", "kyc_records"),
        ("customer", "risk_profiles"),
        ("customer", "accounts"),
        ("customer", "clients"),
        ("customer", "relationship_managers"),
        ("master_data", "assets"),
        ("master_data", "exchanges"),
        ("master_data", "branches"),
    ]

    cursor = conn.cursor()
    # Disable all FK constraints
    cursor.execute("EXEC sp_MSForEachTable 'ALTER TABLE ? NOCHECK CONSTRAINT ALL'")
    conn.commit()

    for schema, table in tables:
        try:
            cursor.execute(f"DELETE FROM [{schema}].[{table}]")
            # Reset identity
            cursor.execute(f"DBCC CHECKIDENT ('[{schema}].[{table}]', RESEED, 0)")
        except Exception as e:
            print(f"  Warning: Could not truncate {schema}.{table}: {e}")

    conn.commit()

    # Re-enable FK constraints
    cursor.execute("EXEC sp_MSForEachTable 'ALTER TABLE ? WITH CHECK CHECK CONSTRAINT ALL'")
    conn.commit()
    cursor.close()
    print("  All tables truncated and identities reset.")
