"""
In-memory state tracker. Tracks account balances, portfolio holdings,
and all computed aggregates so everything stays consistent.
"""

from dataclasses import dataclass, field
from decimal import Decimal, ROUND_HALF_UP
from datetime import date, datetime
from typing import Dict, List, Optional, Tuple


def D(val) -> Decimal:
    """Convert to Decimal with 2 decimal places."""
    return Decimal(str(val)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def D4(val) -> Decimal:
    """Convert to Decimal with 4 decimal places."""
    return Decimal(str(val)).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)


@dataclass
class HoldingState:
    """Tracks a single portfolio-asset holding."""
    portfolio_id: int
    asset_id: int
    quantity: Decimal = Decimal("0")
    total_cost: Decimal = Decimal("0")
    average_buy_price: Decimal = Decimal("0")
    realized_pnl: Decimal = Decimal("0")
    first_purchase_date: Optional[date] = None
    last_purchase_date: Optional[date] = None

    def buy(self, qty: Decimal, price: Decimal, trade_date: date):
        new_cost = D(qty * price)
        self.total_cost = D(self.total_cost + new_cost)
        self.quantity = D4(self.quantity + qty)
        if self.quantity > 0:
            self.average_buy_price = D4(self.total_cost / self.quantity)
        if self.first_purchase_date is None:
            self.first_purchase_date = trade_date
        self.last_purchase_date = trade_date

    def sell(self, qty: Decimal, price: Decimal, trade_date: date) -> Decimal:
        """Returns realized P&L from this sale."""
        sell_proceeds = D(qty * price)
        cost_basis = D(qty * self.average_buy_price)
        realized = D(sell_proceeds - cost_basis)
        self.realized_pnl = D(self.realized_pnl + realized)
        self.quantity = D4(self.quantity - qty)
        self.total_cost = D(self.quantity * self.average_buy_price)
        return realized


@dataclass
class AccountState:
    """Tracks account balance movements."""
    account_id: int
    client_id: int
    branch_id: int
    opening_balance: Decimal = Decimal("0")
    current_balance: Decimal = Decimal("0")
    total_deposits: Decimal = Decimal("0")
    total_withdrawals: Decimal = Decimal("0")
    total_buy: Decimal = Decimal("0")
    total_sell: Decimal = Decimal("0")
    total_dividends: Decimal = Decimal("0")
    total_interest: Decimal = Decimal("0")
    total_fees: Decimal = Decimal("0")
    total_taxes: Decimal = Decimal("0")
    last_transaction_date: Optional[date] = None

    def deposit(self, amount: Decimal, txn_date: date):
        self.current_balance = D(self.current_balance + amount)
        self.total_deposits = D(self.total_deposits + amount)
        self.last_transaction_date = txn_date

    def withdraw(self, amount: Decimal, txn_date: date):
        self.current_balance = D(self.current_balance - amount)
        self.total_withdrawals = D(self.total_withdrawals + amount)
        self.last_transaction_date = txn_date

    def buy_debit(self, amount: Decimal, txn_date: date):
        self.current_balance = D(self.current_balance - amount)
        self.total_buy = D(self.total_buy + amount)
        self.last_transaction_date = txn_date

    def sell_credit(self, amount: Decimal, txn_date: date):
        self.current_balance = D(self.current_balance + amount)
        self.total_sell = D(self.total_sell + amount)
        self.last_transaction_date = txn_date

    def dividend_credit(self, amount: Decimal, txn_date: date):
        self.current_balance = D(self.current_balance + amount)
        self.total_dividends = D(self.total_dividends + amount)
        self.last_transaction_date = txn_date

    def interest_credit(self, amount: Decimal, txn_date: date):
        self.current_balance = D(self.current_balance + amount)
        self.total_interest = D(self.total_interest + amount)
        self.last_transaction_date = txn_date

    def fee_debit(self, amount: Decimal, txn_date: date):
        self.current_balance = D(self.current_balance - amount)
        self.total_fees = D(self.total_fees + amount)
        self.last_transaction_date = txn_date

    def tax_debit(self, amount: Decimal, txn_date: date):
        self.current_balance = D(self.current_balance - amount)
        self.total_taxes = D(self.total_taxes + amount)
        self.last_transaction_date = txn_date

    def verify_balance(self) -> bool:
        expected = D(
            self.opening_balance
            + self.total_deposits
            - self.total_withdrawals
            - self.total_buy
            + self.total_sell
            + self.total_dividends
            + self.total_interest
            - self.total_fees
            - self.total_taxes
        )
        return self.current_balance == expected


@dataclass
class PortfolioState:
    """Tracks portfolio-level aggregates."""
    portfolio_id: int
    client_id: int
    account_id: int
    total_invested: Decimal = Decimal("0")
    current_market_value: Decimal = Decimal("0")
    unrealized_pnl: Decimal = Decimal("0")
    realized_pnl: Decimal = Decimal("0")


class GlobalState:
    """Central state manager for the entire seeding process."""

    def __init__(self):
        # ID counters (since IDENTITY columns, we track what gets inserted)
        self.next_ids: Dict[str, int] = {}

        # Entity states
        self.accounts: Dict[int, AccountState] = {}
        self.portfolios: Dict[int, PortfolioState] = {}
        self.holdings: Dict[Tuple[int, int], HoldingState] = {}  # (portfolio_id, asset_id)

        # Latest market prices per asset
        self.latest_prices: Dict[int, Decimal] = {}

        # RM client counts
        self.rm_client_counts: Dict[int, int] = {}

        # Watchlist item counts
        self.watchlist_item_counts: Dict[int, int] = {}

        # Transaction counter for references
        self.transaction_counter = 0
        self.order_counter = 0
        self.trade_counter = 0

    def get_holding(self, portfolio_id: int, asset_id: int) -> HoldingState:
        key = (portfolio_id, asset_id)
        if key not in self.holdings:
            self.holdings[key] = HoldingState(portfolio_id=portfolio_id, asset_id=asset_id)
        return self.holdings[key]

    def update_portfolio_from_holdings(self, portfolio_id: int):
        """Recompute portfolio aggregates from its holdings."""
        port = self.portfolios[portfolio_id]
        total_cost = Decimal("0")
        total_market = Decimal("0")
        total_realized = Decimal("0")

        for (pid, aid), h in self.holdings.items():
            if pid == portfolio_id and h.quantity > 0:
                total_cost += h.total_cost
                price = self.latest_prices.get(aid, h.average_buy_price)
                market_val = D(h.quantity * price)
                total_market += market_val
                total_realized += h.realized_pnl

        port.total_invested = D(total_cost)
        port.current_market_value = D(total_market)
        port.unrealized_pnl = D(total_market - total_cost)
        port.realized_pnl = D(total_realized)

    def next_txn_ref(self) -> str:
        self.transaction_counter += 1
        return f"TXN{self.transaction_counter:08d}"

    def next_order_number(self) -> str:
        self.order_counter += 1
        return f"ORD{self.order_counter:08d}"

    def next_trade_number(self) -> str:
        self.trade_counter += 1
        return f"TRD{self.trade_counter:08d}"
