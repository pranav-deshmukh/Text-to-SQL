"""
Phase 3: Generate market price data using geometric random walk.
Ensures: low <= open,close <= high for every row.
"""

import random
import math
from datetime import date, timedelta
from decimal import Decimal
from typing import List, Tuple, Dict

from data.stocks import (
    US_STOCKS, US_ETFS, US_BONDS, US_MUTUAL_FUNDS,
    STOCK_PRICE_RANGES, DEFAULT_STOCK_PRICE_RANGE,
    DEFAULT_ETF_PRICE_RANGE, DEFAULT_BOND_PRICE_RANGE, DEFAULT_MF_NAV_RANGE,
)
from config import VOLUMES, MARKET_DATA_START, MARKET_DATA_END
from state import GlobalState, D4


def _get_trading_days(start: date, end: date) -> List[date]:
    """Get weekdays (Mon-Fri) between start and end."""
    days = []
    current = start
    while current <= end:
        if current.weekday() < 5:  # Mon=0, Fri=4
            days.append(current)
        current += timedelta(days=1)
    return days


def _generate_price_series(rng: random.Random, start_price: float, num_days: int,
                           volatility: float = 0.02, drift: float = 0.0001) -> List[dict]:
    """
    Generate OHLCV series using geometric Brownian motion.
    Guarantees: low <= min(open, close) and high >= max(open, close).
    """
    series = []
    price = start_price

    for day_idx in range(num_days):
        # Daily return using GBM
        daily_return = math.exp(drift + volatility * rng.gauss(0, 1))
        close = price * daily_return

        # Open is near previous close with small gap
        open_price = price * (1 + rng.uniform(-0.005, 0.005))

        # High and low
        day_range = abs(close - open_price) + abs(price * volatility * rng.uniform(0.2, 1.5))
        high = max(open_price, close) + rng.uniform(0, day_range * 0.5)
        low = min(open_price, close) - rng.uniform(0, day_range * 0.5)

        # Enforce minimum price of 0.01
        low = max(0.01, low)
        open_price = max(0.01, open_price)
        close = max(0.01, close)
        high = max(high, max(open_price, close))  # high >= max(open, close)
        low = min(low, min(open_price, close))    # low <= min(open, close)

        volume = int(rng.uniform(100000, 50000000))

        series.append({
            "open": round(open_price, 4),
            "high": round(high, 4),
            "low": round(low, 4),
            "close": round(close, 4),
            "volume": volume,
        })

        price = close  # next day opens near this close

    return series


def _get_start_price(ticker: str, asset_type: str, rng: random.Random) -> float:
    """Get a realistic starting price for the asset."""
    if asset_type == "Stock":
        price_range = STOCK_PRICE_RANGES.get(ticker, DEFAULT_STOCK_PRICE_RANGE)
        return rng.uniform(price_range[0], price_range[1])
    elif asset_type == "ETF":
        return rng.uniform(*DEFAULT_ETF_PRICE_RANGE)
    elif asset_type == "Bond":
        return rng.uniform(*DEFAULT_BOND_PRICE_RANGE)
    else:  # Mutual Fund
        return rng.uniform(*DEFAULT_MF_NAV_RANGE)


def generate_market_prices(rng: random.Random, state: GlobalState, assets: List[Tuple]) -> List[Tuple]:
    """
    Generate market prices for all assets.
    - Top 100 most-active assets: full date range
    - Remaining assets: last 30 trading days only
    """
    rows = []
    market_price_id = 0

    all_trading_days = _get_trading_days(MARKET_DATA_START, MARKET_DATA_END)
    recent_days = all_trading_days[-30:] if len(all_trading_days) > 30 else all_trading_days

    active_count = VOLUMES["market_prices_active_assets"]

    for idx, asset in enumerate(assets):
        asset_id = asset[0]
        ticker = asset[2]
        asset_type = asset[4]

        # Determine how many days of data
        if idx < active_count:
            days_to_use = all_trading_days
            volatility = 0.02
        else:
            days_to_use = recent_days
            volatility = 0.015

        # Bonds have much lower volatility
        if asset_type == "Bond":
            volatility = 0.003
        elif asset_type == "Mutual Fund":
            volatility = 0.01

        start_price = _get_start_price(ticker, asset_type, rng)
        series = _generate_price_series(rng, start_price, len(days_to_use), volatility=volatility)

        for day_idx, trading_day in enumerate(days_to_use):
            market_price_id += 1
            day_data = series[day_idx]

            pe_ratio = round(rng.uniform(8, 60), 2) if asset_type == "Stock" else None
            div_yield = round(rng.uniform(0, 5), 2) if asset_type in ("Stock", "ETF") else None
            mkt_cap = round(rng.uniform(1e9, 3e12), 2) if asset_type == "Stock" else None

            rows.append((
                market_price_id,
                asset_id,
                trading_day,
                day_data["open"],
                day_data["high"],
                day_data["low"],
                day_data["close"],
                day_data["close"],   # adjusted_close = close for simplicity
                day_data["volume"],
                mkt_cap,
                pe_ratio,
                div_yield,
            ))

        # Store latest closing price in state
        if series:
            state.latest_prices[asset_id] = D4(series[-1]["close"])

    print(f"  Total market_prices rows: {market_price_id}")
    return rows


MARKET_PRICE_COLUMNS = [
    "market_price_id", "asset_id", "price_date", "opening_price",
    "highest_price", "lowest_price", "closing_price", "adjusted_close_price",
    "volume", "market_cap", "pe_ratio", "dividend_yield",
]
