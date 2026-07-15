"""
Configuration for Investment Banking DB seeding.
All volumes, date ranges, and DB connection settings.
"""

import os
from datetime import date

# ─── Random Seed (reproducible) ───────────────────────────────────────────────
RANDOM_SEED = 42

# ─── Database Connection ──────────────────────────────────────────────────────
DB_CONNECTION_STRING = (
    "Driver={ODBC Driver 18 for SQL Server};"
    "Server=localhost\\SQLEXPRESS;"
    "Database=InvestmentBankingPortfolioManagement;"
    "Uid=sa;"
    "Pwd=Incedo@1234;"
    "TrustServerCertificate=Yes;"
)

# ─── Date Ranges ──────────────────────────────────────────────────────────────
FIRM_START_DATE = date(2018, 1, 1)       # Earliest branch opening
MARKET_DATA_START = date(2025, 1, 2)     # Start of price history
MARKET_DATA_END = date(2026, 6, 20)      # End of price history (~370 trading days)
TRADING_START = date(2025, 3, 1)         # First trades happen
TRADING_END = date(2026, 6, 20)          # Last trade date

# ─── Volume Targets ───────────────────────────────────────────────────────────
VOLUMES = {
    # Phase 1 - Reference (real-world constrained, cannot be 500)
    "branches": 25,
    "exchanges": 5,
    "assets": 500,

    # Phase 2 - People & Accounts
    "relationship_managers": 500,
    "clients": 2000,
    "risk_profiles": 2000,          # 1 per client
    "accounts": 2500,               # 1-2 per client
    "kyc_records": 2000,            # 1 per client

    # Phase 3 - Market Data
    # market_prices = assets × trading_days (~500 × 370 = 185,000)
    # We'll use a subset of 100 most-traded assets × 370 days + rest × 30 days
    "market_prices_active_assets": 100,
    "market_prices_full_days": 370,
    "market_prices_other_days": 30,

    # Phase 4 - Trading
    "portfolios": 2500,             # 1-2 per client
    "buy_sell_orders": 2000,
    "executed_trades": 1800,        # ~90% fill rate

    # Phase 5 - Holdings & Finance
    "portfolio_holdings": 2000,     # Derived from trades
    "transactions": 2000,           # trades + deposits/withdrawals
    "fees": 500,
    "dividends": 500,
    "interest_payments": 500,
    "tax_records": 500,

    # Phase 6 - Reporting
    "account_statements": 500,
    "portfolio_performance": 2000,

    # Phase 7 - Auxiliary
    "watchlists": 500,
    "watchlist_items": 2000,
    "notifications": 2000,
    "audit_logs": 2000,
}

# ─── Financial Parameters ─────────────────────────────────────────────────────
BROKERAGE_RATE = 0.001          # 0.1% brokerage
TAX_RATE_SHORT_TERM = 0.15      # 15% short-term capital gains
TAX_RATE_LONG_TERM = 0.10       # 10% long-term
DIVIDEND_TAX_RATE = 0.10        # 10% dividend withholding
INTEREST_TAX_RATE = 0.10        # 10% interest TDS
MANAGEMENT_FEE_RANGE = (0.5, 2.5)  # Annual management fee %

# ─── Batch Insert Size ────────────────────────────────────────────────────────
BATCH_SIZE = 500
