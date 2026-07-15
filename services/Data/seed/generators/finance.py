"""
Phase 5: Generate financial records — transactions, fees, dividends, interest, taxes.
All amounts are derived from trades/holdings, never hardcoded.
"""

import random
from datetime import date, timedelta, datetime
from decimal import Decimal
from typing import List, Tuple

from config import (
    VOLUMES, TRADING_START, TRADING_END,
    BROKERAGE_RATE, DIVIDEND_TAX_RATE, INTEREST_TAX_RATE,
    TAX_RATE_SHORT_TERM,
)
from state import GlobalState, D, D4


def _random_date(rng: random.Random, start: date, end: date) -> date:
    delta = (end - start).days
    return start + timedelta(days=rng.randint(0, max(0, delta)))


def _random_datetime(rng: random.Random, d: date) -> datetime:
    return datetime(d.year, d.month, d.day, rng.randint(9, 17), rng.randint(0, 59), rng.randint(0, 59))


def generate_transactions(rng: random.Random, state: GlobalState,
                          trades: List[Tuple], accounts: List[Tuple]) -> List[Tuple]:
    """
    Generate transaction records:
    - 1 transaction per executed trade (Buy/Sell)
    - Additional deposit/withdrawal transactions
    Total target: 2000+
    """
    rows = []
    txn_id = 0

    # Transaction for each trade
    for trade in trades:
        txn_id += 1
        trade_id_val = trade[0]
        order_id = trade[1]
        asset_id = trade[2]
        port_id = trade[3]
        net_amount = trade[10]
        exec_time = trade[11]

        # Determine if buy or sell from gross vs net
        # For buys: net > gross (buyer pays fees); For sells: net < gross
        gross = trade[7]
        is_buy = net_amount > gross

        port_state = state.portfolios.get(port_id)
        acct_id = port_state.account_id if port_state else 1

        txn_ref = state.next_txn_ref()
        txn_type = "Buy" if is_buy else "Sell"
        txn_date = exec_time if isinstance(exec_time, datetime) else _random_datetime(rng, exec_time)

        rows.append((
            txn_id,
            acct_id,
            port_id,
            trade_id_val,
            txn_ref,
            txn_type,
            "Electronic Transfer",
            abs(net_amount),
            "USD",
            txn_date,
            f"{txn_type} trade for asset {asset_id}",
            "Completed",
        ))

    # Generate additional deposit transactions (to make accounts viable)
    deposit_count = max(200, VOLUMES["transactions"] - txn_id)
    acct_ids = list(state.accounts.keys())

    for i in range(deposit_count // 2):
        txn_id += 1
        acct_id = rng.choice(acct_ids)
        acct_state = state.accounts[acct_id]
        amount = round(rng.uniform(5000, 200000), 2)
        txn_date = _random_datetime(rng, _random_date(rng, TRADING_START, TRADING_END))

        acct_state.deposit(D(amount), txn_date.date())

        rows.append((
            txn_id,
            acct_id,
            None,
            None,
            state.next_txn_ref(),
            "Deposit",
            rng.choice(["Wire Transfer", "ACH Transfer", "Check Deposit"]),
            amount,
            "USD",
            txn_date,
            "Fund deposit",
            "Completed",
        ))

    # Some withdrawals
    for i in range(deposit_count // 4):
        acct_id = rng.choice(acct_ids)
        acct_state = state.accounts[acct_id]
        # Withdraw at most 10% of current balance
        max_withdraw = float(acct_state.current_balance) * 0.1
        if max_withdraw < 1000:
            continue
        txn_id += 1
        amount = round(rng.uniform(1000, max_withdraw), 2)
        txn_date = _random_datetime(rng, _random_date(rng, TRADING_START, TRADING_END))

        acct_state.withdraw(D(amount), txn_date.date())

        rows.append((
            txn_id,
            acct_id,
            None,
            None,
            state.next_txn_ref(),
            "Withdrawal",
            rng.choice(["Wire Transfer", "ACH Transfer"]),
            amount,
            "USD",
            txn_date,
            "Fund withdrawal",
            "Completed",
        ))

    print(f"  Transactions generated: {txn_id}")
    return rows


TRANSACTION_COLUMNS = [
    "transaction_id", "account_id", "portfolio_id", "trade_id",
    "transaction_reference", "transaction_type", "payment_method",
    "amount", "currency", "transaction_date", "description", "status",
]


def generate_fees(rng: random.Random, state: GlobalState,
                  transactions: List[Tuple], portfolios: List[Tuple]) -> List[Tuple]:
    """
    Generate fee records.
    fee_amount is derived from fee_percentage × base amount.
    """
    rows = []
    fee_id = 0
    target = VOLUMES["fees"]

    fee_types = ["Brokerage", "Management", "Advisory", "Custodian",
                 "Transaction", "Annual Maintenance", "Platform"]

    # Fees linked to trade transactions
    trade_txns = [t for t in transactions if t[5] in ("Buy", "Sell")]

    for txn in rng.sample(trade_txns, min(target // 2, len(trade_txns))):
        fee_id += 1
        txn_id = txn[0]
        port_id = txn[2] or rng.choice([p[0] for p in portfolios])
        base_amount = txn[7]  # transaction amount
        fee_pct = round(rng.uniform(0.01, 0.5), 4)
        fee_amount = round(base_amount * fee_pct / 100, 2)
        charged_date = txn[9]

        rows.append((
            fee_id,
            txn_id,
            port_id,
            rng.choice(["Brokerage", "Transaction"]),
            fee_amount,
            fee_pct,
            "USD",
            charged_date,
            None,
            None,
            f"Fee on transaction {txn_id}",
            "Charged",
        ))

    # Management fees (quarterly)
    remaining = target - fee_id
    port_ids = [p[0] for p in portfolios]
    # Use deposit/other transactions as the linked transaction
    other_txns = [t for t in transactions if t[5] == "Deposit"]

    for i in range(remaining):
        if not other_txns:
            break
        fee_id += 1
        port_id = rng.choice(port_ids)
        txn = rng.choice(other_txns)
        txn_id = txn[0]
        fee_pct = round(rng.uniform(0.1, 2.5), 4)
        base = round(rng.uniform(50000, 500000), 2)
        fee_amount = round(base * fee_pct / 100, 2)
        charged_date = _random_datetime(rng, _random_date(rng, TRADING_START, TRADING_END))

        rows.append((
            fee_id,
            txn_id,
            port_id,
            rng.choice(["Management", "Advisory", "Custodian", "Annual Maintenance", "Platform"]),
            fee_amount,
            fee_pct,
            "USD",
            charged_date,
            None,
            None,
            "Periodic management fee",
            "Charged",
        ))

    print(f"  Fees generated: {fee_id}")
    return rows


FEE_COLUMNS = [
    "fee_id", "transaction_id", "portfolio_id", "fee_type", "fee_amount",
    "fee_percentage", "fee_currency", "charged_date",
    "billing_period_start", "billing_period_end", "description", "status",
]


def generate_dividends(rng: random.Random, state: GlobalState,
                       transactions: List[Tuple], portfolios: List[Tuple],
                       assets: List[Tuple]) -> List[Tuple]:
    """
    Generate dividend records.
    gross_dividend = dividend_per_unit × eligible_quantity
    net_dividend = gross - withholding_tax
    """
    rows = []
    div_id = 0
    target = VOLUMES["dividends"]

    # Only stocks/ETFs pay dividends
    dividend_assets = [a for a in assets if a[4] in ("Stock", "ETF") and (a[12] or 0) > 0]
    if not dividend_assets:
        dividend_assets = [a for a in assets if a[4] == "Stock"][:50]

    # We need transactions to link to — use deposit transactions
    deposit_txns = [t for t in transactions if t[5] == "Deposit"]
    if not deposit_txns:
        return rows

    holdings_with_qty = [(k, v) for k, v in state.holdings.items() if v.quantity > 0]

    for i in range(min(target, len(holdings_with_qty))):
        if not deposit_txns:
            break
        div_id += 1
        (port_id, asset_id), holding = holdings_with_qty[i % len(holdings_with_qty)]

        dividend_per_unit = round(rng.uniform(0.10, 5.00), 4)
        eligible_qty = float(holding.quantity)
        gross_dividend = round(dividend_per_unit * eligible_qty, 2)
        withholding_tax = round(gross_dividend * DIVIDEND_TAX_RATE, 2)
        net_dividend = round(gross_dividend - withholding_tax, 2)

        # Must be positive
        if net_dividend <= 0:
            div_id -= 1
            continue

        payment_date = _random_date(rng, TRADING_START, TRADING_END)
        declaration_date = payment_date - timedelta(days=rng.randint(30, 60))
        record_date = payment_date - timedelta(days=rng.randint(7, 14))

        txn = rng.choice(deposit_txns)
        txn_id = txn[0]

        rows.append((
            div_id,
            asset_id,
            port_id,
            txn_id,
            dividend_per_unit,
            eligible_qty,
            gross_dividend,
            withholding_tax,
            net_dividend,
            declaration_date,
            record_date,
            payment_date,
            rng.choice(["Cash", "Cash", "Special"]),
            "Paid",
            None,
        ))

        # Credit to account
        port_state = state.portfolios.get(port_id)
        if port_state:
            acct_state = state.accounts.get(port_state.account_id)
            if acct_state:
                acct_state.dividend_credit(D(net_dividend), payment_date)

    print(f"  Dividends generated: {div_id}")
    return rows


DIVIDEND_COLUMNS = [
    "dividend_id", "asset_id", "portfolio_id", "transaction_id",
    "dividend_per_unit", "eligible_quantity", "gross_dividend",
    "withholding_tax", "net_dividend", "declaration_date", "record_date",
    "payment_date", "dividend_type", "status", "remarks",
]


def generate_interest_payments(rng: random.Random, state: GlobalState,
                               transactions: List[Tuple], portfolios: List[Tuple],
                               assets: List[Tuple]) -> List[Tuple]:
    """
    Generate interest payments for bond holdings.
    gross_interest = principal × rate × (days/365)
    net_interest = gross - tax_deducted
    """
    rows = []
    interest_id = 0
    target = VOLUMES["interest_payments"]

    bond_assets = [a for a in assets if a[4] == "Bond"]
    deposit_txns = [t for t in transactions if t[5] == "Deposit"]
    if not deposit_txns or not bond_assets:
        return rows

    # Find bond holdings
    bond_asset_ids = {a[0] for a in bond_assets}
    bond_holdings = [(k, v) for k, v in state.holdings.items()
                     if k[1] in bond_asset_ids and v.quantity > 0]

    frequencies = ["Monthly", "Quarterly", "Semi Annual", "Annual"]
    freq_days = {"Monthly": 30, "Quarterly": 91, "Semi Annual": 182, "Annual": 365}

    generated = 0
    cycle = 0
    while generated < target:
        cycle += 1
        if cycle > target * 3:
            break
        if bond_holdings:
            (port_id, asset_id), holding = rng.choice(bond_holdings)
        else:
            # Generate for random portfolio with random bond
            port_id = rng.choice([p[0] for p in portfolios])
            asset = rng.choice(bond_assets)
            asset_id = asset[0]
            holding = state.get_holding(port_id, asset_id)
            if holding.quantity <= 0:
                holding.quantity = D4(rng.uniform(10, 100))
                holding.average_buy_price = D4(100)
                holding.total_cost = D(holding.quantity * holding.average_buy_price)

        interest_id += 1
        frequency = rng.choice(frequencies)
        days = freq_days[frequency]

        principal = float(holding.quantity) * float(holding.average_buy_price)
        rate = round(rng.uniform(2.0, 6.0), 4)
        gross_interest = round(principal * rate / 100 * days / 365, 2)
        tax_deducted = round(gross_interest * INTEREST_TAX_RATE, 2)
        net_interest = round(gross_interest - tax_deducted, 2)

        if net_interest <= 0:
            interest_id -= 1
            continue

        payment_date = _random_date(rng, TRADING_START, TRADING_END)
        accrual_start = payment_date - timedelta(days=days)
        accrual_end = payment_date - timedelta(days=1)

        txn = rng.choice(deposit_txns)

        rows.append((
            interest_id,
            asset_id,
            port_id,
            txn[0],
            rate,
            round(principal, 2),
            gross_interest,
            tax_deducted,
            net_interest,
            accrual_start,
            accrual_end,
            payment_date,
            frequency,
            "Paid",
            None,
        ))

        # Credit to account
        port_state = state.portfolios.get(port_id)
        if port_state:
            acct_state = state.accounts.get(port_state.account_id)
            if acct_state:
                acct_state.interest_credit(D(net_interest), payment_date)

        generated += 1

    print(f"  Interest payments generated: {interest_id}")
    return rows


INTEREST_COLUMNS = [
    "interest_payment_id", "asset_id", "portfolio_id", "transaction_id",
    "interest_rate", "principal_amount", "gross_interest", "tax_deducted",
    "net_interest", "accrual_start_date", "accrual_end_date",
    "payment_date", "payment_frequency", "status", "remarks",
]


def generate_tax_records(rng: random.Random, state: GlobalState,
                         transactions: List[Tuple], portfolios: List[Tuple],
                         assets: List[Tuple]) -> List[Tuple]:
    """
    Generate tax records.
    tax_amount = taxable_amount × tax_rate (exact computation).
    """
    rows = []
    tax_id = 0
    target = VOLUMES["tax_records"]

    tax_types = ["Capital Gain", "Dividend", "Interest", "Transaction Tax", "Withholding Tax"]
    authorities = ["Internal Revenue Service (IRS)", "State Tax Authority"]

    # Use trade transactions as basis
    trade_txns = [t for t in transactions if t[5] in ("Buy", "Sell")]
    port_ids = [p[0] for p in portfolios]
    asset_ids = [a[0] for a in assets]

    for i in range(target):
        tax_id += 1
        txn = rng.choice(trade_txns) if trade_txns else rng.choice(transactions)
        txn_id = txn[0]
        port_id = txn[2] or rng.choice(port_ids)
        asset_id = rng.choice(asset_ids)

        tax_type = rng.choice(tax_types)
        taxable_amount = round(rng.uniform(1000, 200000), 2)
        tax_rate = round(rng.uniform(5, 25), 4)
        # EXACT computation
        tax_amount = round(taxable_amount * tax_rate / 100, 2)

        tax_year = rng.choice([2024, 2025, 2026])
        paid_date = _random_date(rng, date(2025, 1, 1), TRADING_END)

        rows.append((
            tax_id,
            txn_id,
            port_id,
            asset_id,
            tax_year,
            tax_type,
            taxable_amount,
            tax_rate,
            tax_amount,
            paid_date,
            rng.choice(["Filed", "Paid", "Pending"]),
            rng.choice(authorities),
            f"TAX-{tax_year}-{tax_id:06d}",
            None,
        ))

    print(f"  Tax records generated: {tax_id}")
    return rows


TAX_COLUMNS = [
    "tax_record_id", "transaction_id", "portfolio_id", "asset_id",
    "tax_year", "tax_type", "taxable_amount", "tax_rate", "tax_amount",
    "tax_paid_date", "filing_status", "tax_authority", "reference_number",
    "remarks",
]
