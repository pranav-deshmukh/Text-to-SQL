"""
Phase 4: Generate trading data — portfolios, orders, executed trades, holdings.
All financial math is computed, not hardcoded.
"""

import random
from datetime import date, timedelta, datetime
from decimal import Decimal
from typing import List, Tuple, Dict

from config import VOLUMES, TRADING_START, TRADING_END, BROKERAGE_RATE
from state import GlobalState, PortfolioState, D, D4


PORTFOLIO_TYPES = ["Growth", "Income", "Balanced", "Retirement", "Tax Saving", "Custom"]
OBJECTIVES = [
    "Long-term wealth creation", "Monthly income generation",
    "Balanced risk-return", "Retirement corpus building",
    "Tax-efficient growth", "Customized strategy",
    "Capital appreciation", "Dividend income focus",
    "Index tracking", "Aggressive growth",
]
BENCHMARK_INDICES = [
    "S&P 500", "NASDAQ Composite", "Dow Jones Industrial Average",
    "Russell 2000", "S&P 400 MidCap", None,
]


def _random_date(rng: random.Random, start: date, end: date) -> date:
    delta = (end - start).days
    return start + timedelta(days=rng.randint(0, max(0, delta)))


def _random_datetime(rng: random.Random, d: date) -> datetime:
    hour = rng.randint(9, 15)
    minute = rng.randint(0, 59)
    second = rng.randint(0, 59)
    return datetime(d.year, d.month, d.day, hour, minute, second)


def generate_portfolios(rng: random.Random, state: GlobalState,
                        clients: List[Tuple], accounts: List[Tuple]) -> List[Tuple]:
    """Generate 2500 portfolios. Each client gets at least 1."""
    rows = []
    portfolio_id = 0
    target = VOLUMES["portfolios"]

    # Build client -> account mapping
    client_accounts: Dict[int, List[int]] = {}
    for acct in accounts:
        cid = acct[1]
        aid = acct[0]
        client_accounts.setdefault(cid, []).append(aid)

    # Give each client at least 1 portfolio
    for client in clients:
        portfolio_id += 1
        client_id = client[0]
        acct_id = client_accounts[client_id][0]  # first account
        port_type = rng.choice(PORTFOLIO_TYPES)
        code = f"PF{portfolio_id:06d}"
        name = f"{client[4]} {client[5]} - {port_type} Portfolio"
        inception = _random_date(rng, date(2020, 1, 1), date(2025, 6, 1))

        state.portfolios[portfolio_id] = PortfolioState(
            portfolio_id=portfolio_id,
            client_id=client_id,
            account_id=acct_id,
        )

        rows.append((
            portfolio_id,
            client_id,
            acct_id,
            code,
            name,
            port_type,
            rng.choice(OBJECTIVES),
            "USD",
            inception,
            0,      # total_invested_amount (will be updated)
            0,      # current_market_value (will be updated)
            0,      # unrealized_profit_loss (will be updated)
            0,      # realized_profit_loss (will be updated)
            round(rng.uniform(0.5, 2.5), 2),
            rng.choice(BENCHMARK_INDICES),
            "Active",
        ))

    # Extra portfolios for clients with 2 accounts
    extra_needed = target - portfolio_id
    multi_acct_clients = [cid for cid, accts in client_accounts.items() if len(accts) > 1]
    extras = rng.sample(multi_acct_clients, min(extra_needed, len(multi_acct_clients)))

    for cid in extras[:extra_needed]:
        portfolio_id += 1
        acct_id = client_accounts[cid][1]  # second account
        port_type = rng.choice(PORTFOLIO_TYPES)
        code = f"PF{portfolio_id:06d}"
        name = f"Secondary {port_type} Portfolio"
        inception = _random_date(rng, date(2021, 1, 1), date(2025, 6, 1))

        state.portfolios[portfolio_id] = PortfolioState(
            portfolio_id=portfolio_id,
            client_id=cid,
            account_id=acct_id,
        )

        rows.append((
            portfolio_id,
            cid,
            acct_id,
            code,
            name,
            port_type,
            rng.choice(OBJECTIVES),
            "USD",
            inception,
            0, 0, 0, 0,
            round(rng.uniform(0.5, 2.5), 2),
            rng.choice(BENCHMARK_INDICES),
            "Active",
        ))

    return rows


PORTFOLIO_COLUMNS = [
    "portfolio_id", "client_id", "account_id", "portfolio_code",
    "portfolio_name", "portfolio_type", "investment_objective",
    "base_currency", "inception_date", "total_invested_amount",
    "current_market_value", "unrealized_profit_loss", "realized_profit_loss",
    "annual_management_fee", "benchmark_index", "portfolio_status",
]


def generate_orders_and_trades(rng: random.Random, state: GlobalState,
                               portfolios: List[Tuple], assets: List[Tuple]):
    """
    Generate buy/sell orders and executed trades.
    Returns: (orders_rows, trades_rows)

    Logic:
    - Generate mostly BUY orders first to build positions
    - Then generate some SELL orders against existing holdings
    - Each executed order creates a trade
    - Trade amounts flow through to account balances and holdings
    """
    orders_rows = []
    trades_rows = []

    num_orders = VOLUMES["buy_sell_orders"]
    num_trades = VOLUMES["executed_trades"]

    # Tradeable assets (stocks and ETFs primarily)
    tradeable_assets = [a for a in assets if a[4] in ("Stock", "ETF")]
    if not tradeable_assets:
        tradeable_assets = assets[:100]

    # Phase A: BUY orders (70% of total)
    buy_count = int(num_orders * 0.7)
    sell_count = num_orders - buy_count

    order_id = 0
    trade_id = 0
    all_orders = []

    # Generate BUY orders
    for i in range(buy_count):
        order_id += 1
        portfolio = rng.choice(portfolios)
        port_id = portfolio[0]
        acct_id = portfolio[2]
        asset = rng.choice(tradeable_assets)
        asset_id = asset[0]

        order_date = _random_date(rng, TRADING_START, TRADING_END)
        price = float(state.latest_prices.get(asset_id, Decimal("100")))
        # Randomize price slightly around latest
        requested_price = round(price * rng.uniform(0.95, 1.05), 4)
        quantity = round(rng.uniform(1, 200), 4)
        total_value = round(quantity * requested_price, 2)

        order_number = state.next_order_number()
        category = rng.choice(["Market", "Limit"])

        # 90% of buy orders get executed
        will_execute = rng.random() < 0.90

        status = "Executed" if will_execute else rng.choice(["Cancelled", "Expired", "Pending"])
        placed_at = _random_datetime(rng, order_date)

        orders_rows.append((
            order_id,
            port_id,
            acct_id,
            asset_id,
            order_number,
            "Buy",
            category,
            quantity,
            requested_price,
            total_value,
            None,           # stop_loss_price
            None,           # target_price
            status,
            placed_at,
            None,           # expiry_date
            None,           # remarks
        ))

        if will_execute and trade_id < num_trades:
            exec_price = round(requested_price * rng.uniform(0.998, 1.002), 4)
            exec_qty = quantity
            gross = round(exec_qty * exec_price, 2)
            brokerage = round(gross * BROKERAGE_RATE, 2)
            tax = round(gross * 0.001, 2)  # STT
            net = round(gross + brokerage + tax, 2)  # buyer pays more

            # Check account has enough balance — cap quantity if needed
            acct_state = state.accounts.get(acct_id)
            if acct_state:
                available = float(acct_state.current_balance)
                if net > available:
                    # Reduce quantity to fit within 80% of available balance
                    max_affordable = available * 0.8
                    if max_affordable < 100:  # skip if account too low
                        status = "Rejected"
                        orders_rows[-1] = orders_rows[-1][:12] + (status,) + orders_rows[-1][13:]
                        continue
                    exec_qty = round(max_affordable / exec_price, 4)
                    if exec_qty < 0.5:
                        status = "Rejected"
                        orders_rows[-1] = orders_rows[-1][:12] + (status,) + orders_rows[-1][13:]
                        continue
                    quantity = exec_qty
                    gross = round(exec_qty * exec_price, 2)
                    brokerage = round(gross * BROKERAGE_RATE, 2)
                    tax = round(gross * 0.001, 2)
                    net = round(gross + brokerage + tax, 2)
                    total_value = round(quantity * requested_price, 2)
                    # Update the order row with adjusted quantity
                    orders_rows[-1] = (
                        order_id, port_id, acct_id, asset_id, order_number,
                        "Buy", category, quantity, requested_price, total_value,
                        None, None, status, placed_at, None, None,
                    )

            trade_id += 1
            settlement_date = order_date + timedelta(days=2)
            exec_time = _random_datetime(rng, order_date)
            trade_number = state.next_trade_number()

            trades_rows.append((
                trade_id,
                order_id,
                asset_id,
                port_id,
                trade_number,
                exec_qty,
                exec_price,
                gross,
                brokerage,
                tax,
                net,
                exec_time,
                settlement_date,
                "Settled",
                None,
            ))

            # Update state
            holding = state.get_holding(port_id, asset_id)
            holding.buy(D4(exec_qty), D4(exec_price), order_date)

            if acct_state:
                acct_state.buy_debit(D(net), order_date)

            all_orders.append(("Buy", port_id, asset_id, exec_qty, order_date))

    # Generate SELL orders (only for assets we hold)
    sell_generated = 0
    holdings_list = [(k, v) for k, v in state.holdings.items() if v.quantity > 0]

    for i in range(sell_count):
        if not holdings_list:
            break

        order_id += 1
        key, holding = rng.choice(holdings_list)
        port_id, asset_id = key

        # Can't sell more than we hold
        max_sell = float(holding.quantity)
        if max_sell <= 0:
            continue

        quantity = round(rng.uniform(0.5, min(max_sell * 0.5, max_sell)), 4)
        if quantity <= 0:
            continue

        # Find the portfolio's account
        port_state = state.portfolios.get(port_id)
        if not port_state:
            continue
        acct_id = port_state.account_id

        order_date = _random_date(rng, TRADING_START, TRADING_END)
        price = float(state.latest_prices.get(asset_id, holding.average_buy_price))
        requested_price = round(price * rng.uniform(0.95, 1.05), 4)
        total_value = round(quantity * requested_price, 2)

        order_number = state.next_order_number()
        category = rng.choice(["Market", "Limit"])

        will_execute = rng.random() < 0.85
        status = "Executed" if will_execute else rng.choice(["Cancelled", "Pending"])
        placed_at = _random_datetime(rng, order_date)

        orders_rows.append((
            order_id,
            port_id,
            acct_id,
            asset_id,
            order_number,
            "Sell",
            category,
            quantity,
            requested_price,
            total_value,
            None,
            None,
            status,
            placed_at,
            None,
            None,
        ))

        if will_execute and trade_id < num_trades:
            trade_id += 1
            exec_price = round(requested_price * rng.uniform(0.998, 1.002), 4)
            exec_qty = quantity
            gross = round(exec_qty * exec_price, 2)
            brokerage = round(gross * BROKERAGE_RATE, 2)
            tax = round(gross * 0.001, 2)
            net = round(gross - brokerage - tax, 2)  # seller receives less

            settlement_date = order_date + timedelta(days=2)
            exec_time = _random_datetime(rng, order_date)
            trade_number = state.next_trade_number()

            trades_rows.append((
                trade_id,
                order_id,
                asset_id,
                port_id,
                trade_number,
                exec_qty,
                exec_price,
                gross,
                brokerage,
                tax,
                net,
                exec_time,
                settlement_date,
                "Settled",
                None,
            ))

            # Update state
            realized = holding.sell(D4(exec_qty), D4(exec_price), order_date)

            acct_state = state.accounts.get(acct_id)
            if acct_state:
                acct_state.sell_credit(D(net), order_date)

            sell_generated += 1

        # Refresh holdings list
        holdings_list = [(k, v) for k, v in state.holdings.items() if v.quantity > 0]

    print(f"  Orders generated: {order_id}, Trades executed: {trade_id}")
    return orders_rows, trades_rows


ORDER_COLUMNS = [
    "order_id", "portfolio_id", "account_id", "asset_id", "order_number",
    "order_type", "order_category", "quantity", "requested_price",
    "total_order_value", "stop_loss_price", "target_price",
    "order_status", "placed_at", "expiry_date", "remarks",
]

TRADE_COLUMNS = [
    "trade_id", "order_id", "asset_id", "portfolio_id", "trade_number",
    "executed_quantity", "executed_price", "gross_amount", "brokerage_amount",
    "tax_amount", "net_amount", "execution_time", "settlement_date",
    "settlement_status", "exchange_trade_reference",
]


def generate_portfolio_holdings(state: GlobalState) -> List[Tuple]:
    """
    Generate holdings from accumulated state.
    Holdings are DERIVED from trade history — not randomly generated.
    """
    rows = []
    holding_id = 0

    for (port_id, asset_id), h in state.holdings.items():
        if h.quantity <= 0:
            continue

        holding_id += 1
        current_price = state.latest_prices.get(asset_id, h.average_buy_price)
        current_market_value = D(h.quantity * current_price)
        unrealized_pnl = D(current_market_value - h.total_cost)

        rows.append((
            holding_id,
            port_id,
            asset_id,
            float(h.quantity),
            float(h.average_buy_price),
            float(current_price),
            float(h.total_cost),
            float(current_market_value),
            float(unrealized_pnl),
            float(h.realized_pnl),
            h.first_purchase_date,
            h.last_purchase_date,
        ))

    # Update portfolio aggregates
    for port_id in state.portfolios:
        state.update_portfolio_from_holdings(port_id)

    print(f"  Holdings generated: {holding_id}")
    return rows


HOLDING_COLUMNS = [
    "holding_id", "portfolio_id", "asset_id", "quantity",
    "average_buy_price", "current_market_price", "total_cost",
    "current_market_value", "unrealized_profit_loss", "realized_profit_loss",
    "first_purchase_date", "last_purchase_date",
]
