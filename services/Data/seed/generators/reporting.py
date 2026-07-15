"""
Phase 6 & 7: Reporting (account statements, portfolio performance)
and auxiliary data (watchlists, notifications, audit logs).
"""

import random
from datetime import date, timedelta, datetime
from decimal import Decimal
from typing import List, Tuple

from config import VOLUMES, TRADING_START, TRADING_END
from state import GlobalState, D


def _random_date(rng: random.Random, start: date, end: date) -> date:
    delta = (end - start).days
    return start + timedelta(days=rng.randint(0, max(0, delta)))


def _random_datetime(rng: random.Random, d: date) -> datetime:
    return datetime(d.year, d.month, d.day, rng.randint(0, 23), rng.randint(0, 59), rng.randint(0, 59))


# ─── Account Statements ──────────────────────────────────────────────────────

def generate_account_statements(rng: random.Random, state: GlobalState,
                                accounts: List[Tuple]) -> List[Tuple]:
    """
    Generate account statements.
    closing_balance = opening_balance + deposits - withdrawals + trade_amount - fees + dividends + interest - taxes
    """
    rows = []
    stmt_id = 0
    target = VOLUMES["account_statements"]

    acct_ids = list(state.accounts.keys())

    # Generate monthly statements for some accounts
    for acct_id in rng.sample(acct_ids, min(target // 3, len(acct_ids))):
        acct_state = state.accounts[acct_id]

        # Generate ~3 monthly statements per account
        for month_offset in range(3):
            stmt_id += 1
            if stmt_id > target:
                break

            period_start = date(2025, 1 + month_offset * 4, 1)
            if period_start.month > 12:
                break
            period_end = period_start + timedelta(days=29)

            # Derive statement values from account state proportionally
            total_bal = float(acct_state.current_balance)
            opening_bal = round(float(acct_state.opening_balance) * (1 + month_offset * 0.1), 2)
            deposits = round(float(acct_state.total_deposits) / 4, 2)
            withdrawals = round(float(acct_state.total_withdrawals) / 4, 2)
            trade_amount = round(abs(float(acct_state.total_sell - acct_state.total_buy)) / 4, 2)
            fees = round(float(acct_state.total_fees) / 4, 2)
            dividends = round(float(acct_state.total_dividends) / 4, 2)
            interest = round(float(acct_state.total_interest) / 4, 2)
            taxes = round(float(acct_state.total_taxes) / 4, 2)

            # EXACT derivation: closing = opening + deposits - withdrawals + trade_amount - fees + dividends + interest - taxes
            closing_bal = round(opening_bal + deposits - withdrawals + trade_amount - fees + dividends + interest - taxes, 2)

            stmt_number = f"STMT{stmt_id:08d}"

            rows.append((
                stmt_id,
                acct_id,
                stmt_number,
                period_start,
                period_end,
                opening_bal,
                deposits,
                withdrawals,
                trade_amount,
                fees,
                dividends,
                interest,
                taxes,
                closing_bal,
                _random_datetime(rng, period_end + timedelta(days=1)),
                "System",
                "Generated",
                None,
            ))

    # Fill remaining
    while stmt_id < target:
        stmt_id += 1
        acct_id = rng.choice(acct_ids)
        acct_state = state.accounts[acct_id]

        period_start = _random_date(rng, date(2025, 1, 1), date(2026, 5, 1))
        period_end = period_start + timedelta(days=rng.choice([29, 30, 31]))

        opening_bal = round(float(acct_state.opening_balance), 2)
        deposits = round(rng.uniform(0, 50000), 2)
        withdrawals = round(rng.uniform(0, 20000), 2)
        trade_amount = round(rng.uniform(0, 30000), 2)
        fees = round(rng.uniform(0, 500), 2)
        dividends = round(rng.uniform(0, 5000), 2)
        interest = round(rng.uniform(0, 2000), 2)
        taxes = round(rng.uniform(0, 3000), 2)

        # EXACT derivation: same formula as validator
        closing_bal = round(opening_bal + deposits - withdrawals + trade_amount - fees + dividends + interest - taxes, 2)

        rows.append((
            stmt_id,
            acct_id,
            f"STMT{stmt_id:08d}",
            period_start,
            period_end,
            opening_bal,
            deposits,
            withdrawals,
            trade_amount,
            fees,
            dividends,
            interest,
            taxes,
            closing_bal,
            _random_datetime(rng, period_end + timedelta(days=1)),
            "System",
            "Generated",
            None,
        ))

    print(f"  Account statements generated: {stmt_id}")
    return rows


STATEMENT_COLUMNS = [
    "statement_id", "account_id", "statement_number",
    "statement_period_start", "statement_period_end",
    "opening_balance", "total_deposits", "total_withdrawals",
    "total_trade_amount", "total_fees", "total_dividends",
    "total_interest", "total_taxes", "closing_balance",
    "generated_on", "generated_by", "statement_status", "remarks",
]


# ─── Portfolio Performance ────────────────────────────────────────────────────

def generate_portfolio_performance(rng: random.Random, state: GlobalState,
                                   portfolios: List[Tuple]) -> List[Tuple]:
    """
    Generate portfolio performance snapshots.
    total_profit_loss = unrealized + realized (exact).
    market_value = invested + total_profit_loss (exact).
    """
    rows = []
    perf_id = 0
    target = VOLUMES["portfolio_performance"]

    port_ids = [p[0] for p in portfolios]
    used_combos = set()

    for i in range(target):
        perf_id += 1
        port_id = rng.choice(port_ids)
        perf_date = _random_date(rng, date(2025, 6, 1), TRADING_END)

        # Avoid duplicate (portfolio_id, performance_date)
        combo = (port_id, perf_date)
        attempts = 0
        while combo in used_combos and attempts < 10:
            perf_date = _random_date(rng, date(2025, 1, 1), TRADING_END)
            combo = (port_id, perf_date)
            attempts += 1
        if combo in used_combos:
            perf_id -= 1
            continue
        used_combos.add(combo)

        port_state = state.portfolios.get(port_id)
        if port_state and float(port_state.total_invested) > 0:
            invested = float(port_state.total_invested)
            unrealized = float(port_state.unrealized_pnl)
            realized = float(port_state.realized_pnl)
        else:
            invested = round(rng.uniform(50000, 2000000), 2)
            unrealized = round(rng.uniform(-invested * 0.2, invested * 0.4), 2)
            realized = round(rng.uniform(0, invested * 0.1), 2)

        # EXACT derivations
        total_pnl = round(unrealized + realized, 2)
        market_value = round(invested + total_pnl, 2)

        daily_ret = round(rng.uniform(-3, 3), 4)
        monthly_ret = round(rng.uniform(-10, 15), 4)
        yearly_ret = round(rng.uniform(-20, 50), 4)
        bench_ret = round(rng.uniform(-15, 30), 4)
        beta = round(rng.uniform(0.5, 1.8), 4)
        alpha = round(yearly_ret - bench_ret * beta, 4)
        sharpe = round(rng.uniform(-0.5, 3.0), 4)
        vol = round(rng.uniform(5, 35), 4)

        rows.append((
            perf_id,
            port_id,
            perf_date,
            invested,
            market_value,
            unrealized,
            realized,
            total_pnl,
            daily_ret,
            monthly_ret,
            yearly_ret,
            bench_ret,
            beta,
            alpha,
            sharpe,
            vol,
        ))

    print(f"  Portfolio performance generated: {perf_id}")
    return rows


PERFORMANCE_COLUMNS = [
    "performance_id", "portfolio_id", "performance_date",
    "invested_amount", "market_value", "unrealized_profit_loss",
    "realized_profit_loss", "total_profit_loss",
    "daily_return_percent", "monthly_return_percent", "yearly_return_percent",
    "benchmark_return_percent", "portfolio_beta", "portfolio_alpha",
    "sharpe_ratio", "volatility",
]


# ─── Watchlists & Items ──────────────────────────────────────────────────────

def generate_watchlists(rng: random.Random, state: GlobalState,
                        clients: List[Tuple]) -> List[Tuple]:
    """Generate watchlists for clients."""
    rows = []
    wl_id = 0
    target = VOLUMES["watchlists"]

    wl_names = [
        "Tech Stocks", "Dividend Picks", "Growth Watchlist", "Value Stocks",
        "Energy Sector", "Healthcare Picks", "Blue Chips", "Small Cap Gems",
        "ETF Tracker", "Bond Watchlist", "High Momentum", "Earnings Play",
        "IPO Watch", "Sector Rotation", "Income Focus",
    ]

    client_ids = [c[0] for c in clients]

    for i in range(target):
        wl_id += 1
        client_id = rng.choice(client_ids)
        name = rng.choice(wl_names) + f" #{wl_id}"

        state.watchlist_item_counts[wl_id] = 0

        rows.append((
            wl_id,
            client_id,
            name,
            None,
            1 if i < 100 else 0,
            i + 1,
            0,          # total_assets (will be patched)
            _random_datetime(rng, _random_date(rng, TRADING_START, TRADING_END)),
            "Active",
        ))

    return rows


WATCHLIST_COLUMNS = [
    "watchlist_id", "client_id", "watchlist_name", "description",
    "is_default", "display_order", "total_assets", "last_viewed_at", "status",
]


def generate_watchlist_items(rng: random.Random, state: GlobalState,
                             watchlists: List[Tuple], assets: List[Tuple]) -> List[Tuple]:
    """Generate watchlist items. Update watchlist.total_assets count."""
    rows = []
    item_id = 0
    target = VOLUMES["watchlist_items"]

    asset_ids = [a[0] for a in assets]
    wl_ids = [w[0] for w in watchlists]
    used_combos = set()

    for i in range(target):
        item_id += 1
        wl_id = rng.choice(wl_ids)
        asset_id = rng.choice(asset_ids)

        combo = (wl_id, asset_id)
        attempts = 0
        while combo in used_combos and attempts < 20:
            asset_id = rng.choice(asset_ids)
            combo = (wl_id, asset_id)
            attempts += 1
        if combo in used_combos:
            item_id -= 1
            continue
        used_combos.add(combo)

        state.watchlist_item_counts[wl_id] = state.watchlist_item_counts.get(wl_id, 0) + 1

        target_buy = round(rng.uniform(10, 500), 4) if rng.random() > 0.3 else None
        target_sell = round(rng.uniform(50, 800), 4) if rng.random() > 0.3 else None

        rows.append((
            item_id,
            wl_id,
            asset_id,
            target_buy,
            target_sell,
            1,
            None,
            _random_datetime(rng, _random_date(rng, TRADING_START, TRADING_END)),
            None,
        ))

    print(f"  Watchlist items generated: {item_id}")
    return rows


WATCHLIST_ITEM_COLUMNS = [
    "watchlist_item_id", "watchlist_id", "asset_id", "target_buy_price",
    "target_sell_price", "alert_enabled", "notes", "added_on", "last_alert_sent",
]


# ─── Notifications ────────────────────────────────────────────────────────────

def generate_notifications(rng: random.Random, clients: List[Tuple],
                           accounts: List[Tuple], portfolios: List[Tuple]) -> List[Tuple]:
    """Generate notification records."""
    rows = []
    notif_id = 0
    target = VOLUMES["notifications"]

    notif_types = ["Trade", "Dividend", "Interest", "Fee", "Tax", "KYC", "System", "Portfolio", "Price Alert"]
    priorities = ["Low", "Medium", "High", "Critical"]
    channels = ["Email", "SMS", "Push", "In App"]

    client_ids = [c[0] for c in clients]
    acct_ids = [a[0] for a in accounts]
    port_ids = [p[0] for p in portfolios]

    messages = {
        "Trade": ("Trade Executed", "Your {type} order has been executed successfully."),
        "Dividend": ("Dividend Received", "Dividend of ${amount} has been credited to your account."),
        "Interest": ("Interest Payment", "Interest payment of ${amount} received."),
        "Fee": ("Fee Charged", "A {fee_type} fee of ${amount} has been charged."),
        "Tax": ("Tax Deduction", "Tax of ${amount} has been deducted."),
        "KYC": ("KYC Update", "Your KYC verification has been completed."),
        "System": ("System Maintenance", "Scheduled maintenance on {date}."),
        "Portfolio": ("Portfolio Alert", "Your portfolio value has changed by {pct}%."),
        "Price Alert": ("Price Alert", "Asset has reached your target price."),
    }

    for i in range(target):
        notif_id += 1
        client_id = rng.choice(client_ids)
        notif_type = rng.choice(notif_types)
        title, msg_template = messages[notif_type]
        msg = msg_template.format(
            type="Buy", amount=f"{rng.uniform(100, 50000):.2f}",
            fee_type="management", date="2025-06-15", pct=f"{rng.uniform(-5, 10):.1f}"
        )

        sent_at = _random_datetime(rng, _random_date(rng, TRADING_START, TRADING_END))
        is_read = rng.choice([0, 0, 1, 1, 1])
        read_at = sent_at + timedelta(hours=rng.randint(1, 48)) if is_read else None

        rows.append((
            notif_id,
            client_id,
            rng.choice(acct_ids) if rng.random() > 0.3 else None,
            rng.choice(port_ids) if rng.random() > 0.3 else None,
            notif_type,
            title,
            msg,
            rng.choice(priorities),
            rng.choice(channels),
            is_read,
            sent_at,
            read_at,
            None,
        ))

    print(f"  Notifications generated: {notif_id}")
    return rows


NOTIFICATION_COLUMNS = [
    "notification_id", "client_id", "account_id", "portfolio_id",
    "notification_type", "notification_title", "notification_message",
    "priority", "delivery_channel", "is_read", "sent_at", "read_at", "expiry_date",
]


# ─── Audit Logs ───────────────────────────────────────────────────────────────

def generate_audit_logs(rng: random.Random, clients: List[Tuple],
                        accounts: List[Tuple], portfolios: List[Tuple]) -> List[Tuple]:
    """Generate audit log entries."""
    rows = []
    audit_id = 0
    target = VOLUMES["audit_logs"]

    actions = ["INSERT", "UPDATE", "DELETE", "LOGIN", "LOGOUT", "VIEW", "EXPORT"]
    tables = [
        "portfolios", "accounts", "buy_sell_orders", "executed_trades",
        "transactions", "clients", "portfolio_holdings",
    ]

    client_ids = [c[0] for c in clients]
    acct_ids = [a[0] for a in accounts]
    port_ids = [p[0] for p in portfolios]
    num_rms = VOLUMES["relationship_managers"]

    for i in range(target):
        audit_id += 1
        action = rng.choice(actions)
        table = rng.choice(tables)
        timestamp = _random_datetime(rng, _random_date(rng, TRADING_START, TRADING_END))

        rows.append((
            audit_id,
            rng.choice(client_ids) if rng.random() > 0.3 else None,
            rng.choice(acct_ids) if rng.random() > 0.5 else None,
            rng.choice(port_ids) if rng.random() > 0.5 else None,
            rng.randint(1, num_rms) if rng.random() > 0.5 else None,
            action,
            table,
            rng.randint(1, 5000),
            None,       # old_value
            None,       # new_value
            f"{rng.randint(10,199)}.{rng.randint(0,255)}.{rng.randint(0,255)}.{rng.randint(1,254)}",
            rng.choice(["Windows/Chrome", "macOS/Safari", "iOS/App", "Android/App", "Linux/Firefox"]),
            timestamp,
        ))

    print(f"  Audit logs generated: {audit_id}")
    return rows


AUDIT_LOG_COLUMNS = [
    "audit_log_id", "client_id", "account_id", "portfolio_id", "manager_id",
    "action_type", "table_name", "record_id", "old_value", "new_value",
    "ip_address", "device_info", "action_timestamp",
]
