"""
Main orchestrator — runs all phases in dependency order.
Ensures mathematical consistency across all tables.

Usage:
    python main.py              # Full seed (truncate + insert + validate)
    python main.py --validate   # Only run validations on existing data
    python main.py --no-truncate # Insert without truncating first
"""

import sys
import os
import random
import time

# Add current directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from config import RANDOM_SEED, VOLUMES
from state import GlobalState, D
from db import get_connection, batch_insert_identity, truncate_all
from validators import run_validations

from generators.reference import (
    generate_branches, BRANCH_COLUMNS,
    generate_exchanges, EXCHANGE_COLUMNS,
    generate_assets, ASSET_COLUMNS,
)
from generators.people import (
    generate_relationship_managers, RM_COLUMNS,
    generate_clients, CLIENT_COLUMNS,
    generate_risk_profiles, RISK_PROFILE_COLUMNS,
    generate_accounts, ACCOUNT_COLUMNS,
    generate_kyc_records, KYC_COLUMNS,
)
from generators.market import (
    generate_market_prices, MARKET_PRICE_COLUMNS,
)
from generators.trading import (
    generate_portfolios, PORTFOLIO_COLUMNS,
    generate_orders_and_trades, ORDER_COLUMNS, TRADE_COLUMNS,
    generate_portfolio_holdings, HOLDING_COLUMNS,
)
from generators.finance import (
    generate_transactions, TRANSACTION_COLUMNS,
    generate_fees, FEE_COLUMNS,
    generate_dividends, DIVIDEND_COLUMNS,
    generate_interest_payments, INTEREST_COLUMNS,
    generate_tax_records, TAX_COLUMNS,
)
from generators.reporting import (
    generate_account_statements, STATEMENT_COLUMNS,
    generate_portfolio_performance, PERFORMANCE_COLUMNS,
    generate_watchlists, WATCHLIST_COLUMNS,
    generate_watchlist_items, WATCHLIST_ITEM_COLUMNS,
    generate_notifications, NOTIFICATION_COLUMNS,
    generate_audit_logs, AUDIT_LOG_COLUMNS,
)


def backpatch_portfolios(conn, state: GlobalState):
    """Update portfolio aggregates from computed holdings state."""
    cursor = conn.cursor()
    updated = 0
    for port_id, port in state.portfolios.items():
        if float(port.total_invested) > 0:
            cursor.execute("""
                UPDATE [portfolio].[portfolios]
                SET total_invested_amount = ?,
                    current_market_value = ?,
                    unrealized_profit_loss = ?,
                    realized_profit_loss = ?
                WHERE portfolio_id = ?
            """, (
                float(port.total_invested),
                float(port.current_market_value),
                float(port.unrealized_pnl),
                float(port.realized_pnl),
                port_id,
            ))
            updated += 1
    conn.commit()
    cursor.close()
    print(f"  Back-patched {updated} portfolio aggregates")


def backpatch_accounts(conn, state: GlobalState):
    """Update account current_balance and last_transaction_date from state."""
    cursor = conn.cursor()
    updated = 0
    for acct_id, acct in state.accounts.items():
        # Ensure balance is never negative (CHECK constraint)
        balance = max(float(acct.current_balance), 0.00)
        cursor.execute("""
            UPDATE [customer].[accounts]
            SET current_balance = ?,
                available_balance = ?,
                last_transaction_date = ?
            WHERE account_id = ?
        """, (
            balance,
            balance,
            acct.last_transaction_date,
            acct_id,
        ))
        updated += 1
    conn.commit()
    cursor.close()
    print(f"  Back-patched {updated} account balances")


def backpatch_rm_client_counts(conn, state: GlobalState):
    """Update RM current_client_count from actual client counts."""
    cursor = conn.cursor()
    cursor.execute("""
        UPDATE rm
        SET rm.current_client_count = ISNULL(c.cnt, 0)
        FROM [customer].[relationship_managers] rm
        LEFT JOIN (
            SELECT relationship_manager_id, COUNT(*) AS cnt
            FROM [customer].[clients]
            WHERE status = 'Active'
            GROUP BY relationship_manager_id
        ) c ON rm.manager_id = c.relationship_manager_id
    """)
    conn.commit()
    cursor.close()
    print(f"  Back-patched RM client counts")


def backpatch_watchlist_counts(conn, state: GlobalState):
    """Update watchlist total_assets from actual item counts."""
    cursor = conn.cursor()
    cursor.execute("""
        UPDATE w
        SET w.total_assets = ISNULL(i.cnt, 0)
        FROM [portfolio].[watchlists] w
        LEFT JOIN (
            SELECT watchlist_id, COUNT(*) AS cnt
            FROM [portfolio].[watchlist_items]
            GROUP BY watchlist_id
        ) i ON w.watchlist_id = i.watchlist_id
    """)
    conn.commit()
    cursor.close()
    print(f"  Back-patched watchlist item counts")


def main():
    validate_only = "--validate" in sys.argv
    no_truncate = "--no-truncate" in sys.argv

    print("=" * 70)
    print("  INVESTMENT BANKING DB — DATA SEEDING")
    print(f"  Random seed: {RANDOM_SEED}")
    print("=" * 70)

    # Initialize
    rng = random.Random(RANDOM_SEED)
    state = GlobalState()
    conn = get_connection()

    if validate_only:
        run_validations(conn)
        conn.close()
        return

    start_time = time.time()

    # ─── Truncate ─────────────────────────────────────────────────────────────
    if not no_truncate:
        print("\n[Phase 0] Truncating all tables...")
        truncate_all(conn)

    # ─── Phase 1: Reference Data ──────────────────────────────────────────────
    print("\n[Phase 1] Generating reference data...")

    branches = generate_branches(rng)
    batch_insert_identity(conn, "branches", BRANCH_COLUMNS, branches, schema="master_data")

    exchanges = generate_exchanges(rng)
    batch_insert_identity(conn, "exchanges", EXCHANGE_COLUMNS, exchanges, schema="master_data")

    assets = generate_assets(rng)
    batch_insert_identity(conn, "assets", ASSET_COLUMNS, assets, schema="master_data")

    # ─── Phase 2: People & Accounts ──────────────────────────────────────────
    print("\n[Phase 2] Generating people & accounts...")

    rms = generate_relationship_managers(rng, state)
    batch_insert_identity(conn, "relationship_managers", RM_COLUMNS, rms, schema="customer")

    clients = generate_clients(rng, state)
    batch_insert_identity(conn, "clients", CLIENT_COLUMNS, clients, schema="customer")

    risk_profiles = generate_risk_profiles(rng, clients)
    batch_insert_identity(conn, "risk_profiles", RISK_PROFILE_COLUMNS, risk_profiles, schema="customer")

    accounts = generate_accounts(rng, state, clients)
    batch_insert_identity(conn, "accounts", ACCOUNT_COLUMNS, accounts, schema="customer")

    kyc = generate_kyc_records(rng, clients)
    batch_insert_identity(conn, "kyc_records", KYC_COLUMNS, kyc, schema="customer")

    # ─── Phase 3: Market Data ─────────────────────────────────────────────────
    print("\n[Phase 3] Generating market prices (this may take a moment)...")

    market_prices = generate_market_prices(rng, state, assets)
    batch_insert_identity(conn, "market_prices", MARKET_PRICE_COLUMNS, market_prices, schema="trading")

    # ─── Phase 4: Trading ─────────────────────────────────────────────────────
    print("\n[Phase 4] Generating trading data...")

    portfolios = generate_portfolios(rng, state, clients, accounts)
    batch_insert_identity(conn, "portfolios", PORTFOLIO_COLUMNS, portfolios, schema="portfolio")

    orders, trades = generate_orders_and_trades(rng, state, portfolios, assets)
    batch_insert_identity(conn, "buy_sell_orders", ORDER_COLUMNS, orders, schema="trading")
    batch_insert_identity(conn, "executed_trades", TRADE_COLUMNS, trades, schema="trading")

    holdings = generate_portfolio_holdings(state)
    batch_insert_identity(conn, "portfolio_holdings", HOLDING_COLUMNS, holdings, schema="portfolio")

    # ─── Phase 5: Finance ─────────────────────────────────────────────────────
    print("\n[Phase 5] Generating financial records...")

    transactions = generate_transactions(rng, state, trades, accounts)
    batch_insert_identity(conn, "transactions", TRANSACTION_COLUMNS, transactions, schema="finance")

    fees = generate_fees(rng, state, transactions, portfolios)
    batch_insert_identity(conn, "fees", FEE_COLUMNS, fees, schema="finance")

    dividends = generate_dividends(rng, state, transactions, portfolios, assets)
    batch_insert_identity(conn, "dividends", DIVIDEND_COLUMNS, dividends, schema="finance")

    interest = generate_interest_payments(rng, state, transactions, portfolios, assets)
    batch_insert_identity(conn, "interest_payments", INTEREST_COLUMNS, interest, schema="finance")

    tax_records = generate_tax_records(rng, state, transactions, portfolios, assets)
    batch_insert_identity(conn, "tax_records", TAX_COLUMNS, tax_records, schema="finance")

    # ─── Phase 6: Reporting ───────────────────────────────────────────────────
    print("\n[Phase 6] Generating reporting data...")

    statements = generate_account_statements(rng, state, accounts)
    batch_insert_identity(conn, "account_statements", STATEMENT_COLUMNS, statements, schema="finance")

    performance = generate_portfolio_performance(rng, state, portfolios)
    batch_insert_identity(conn, "portfolio_performance", PERFORMANCE_COLUMNS, performance, schema="portfolio")

    # ─── Phase 7: Auxiliary ───────────────────────────────────────────────────
    print("\n[Phase 7] Generating auxiliary data...")

    watchlists = generate_watchlists(rng, state, clients)
    batch_insert_identity(conn, "watchlists", WATCHLIST_COLUMNS, watchlists, schema="portfolio")

    wl_items = generate_watchlist_items(rng, state, watchlists, assets)
    batch_insert_identity(conn, "watchlist_items", WATCHLIST_ITEM_COLUMNS, wl_items, schema="portfolio")

    notifications = generate_notifications(rng, clients, accounts, portfolios)
    batch_insert_identity(conn, "notifications", NOTIFICATION_COLUMNS, notifications, schema="security")

    audit_logs = generate_audit_logs(rng, clients, accounts, portfolios)
    batch_insert_identity(conn, "audit_logs", AUDIT_LOG_COLUMNS, audit_logs, schema="security")

    # ─── Phase 8: Back-patches ────────────────────────────────────────────────
    print("\n[Phase 8] Back-patching computed fields...")

    backpatch_portfolios(conn, state)
    backpatch_accounts(conn, state)
    backpatch_rm_client_counts(conn, state)
    backpatch_watchlist_counts(conn, state)

    elapsed = time.time() - start_time
    print(f"\n  Seeding complete in {elapsed:.1f}s")

    # ─── Validation ───────────────────────────────────────────────────────────
    print("\n[Phase 9] Running validations...")
    run_validations(conn)

    # ─── Summary ──────────────────────────────────────────────────────────────
    print("\n  ROW COUNT SUMMARY:")
    cursor = conn.cursor()
    table_list = [
        ("master_data", "branches"), ("master_data", "exchanges"), ("master_data", "assets"),
        ("customer", "relationship_managers"), ("customer", "clients"),
        ("customer", "risk_profiles"), ("customer", "accounts"), ("customer", "kyc_records"),
        ("trading", "market_prices"), ("trading", "buy_sell_orders"), ("trading", "executed_trades"),
        ("portfolio", "portfolios"), ("portfolio", "portfolio_holdings"),
        ("portfolio", "portfolio_performance"), ("portfolio", "watchlists"),
        ("portfolio", "watchlist_items"),
        ("finance", "transactions"), ("finance", "fees"), ("finance", "dividends"),
        ("finance", "interest_payments"), ("finance", "tax_records"),
        ("finance", "account_statements"),
        ("security", "notifications"), ("security", "audit_logs"),
    ]
    total = 0
    for schema, table in table_list:
        cursor.execute(f"SELECT COUNT(*) FROM [{schema}].[{table}]")
        count = cursor.fetchone()[0]
        total += count
        print(f"    {schema}.{table}: {count:,}")
    print(f"\n    TOTAL: {total:,} rows")
    cursor.close()

    conn.close()
    print("\n  Done!")


if __name__ == "__main__":
    main()
