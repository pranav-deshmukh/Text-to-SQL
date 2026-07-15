"""
Phase 1: Generate reference/master data — branches, exchanges, assets.
"""

import random
from datetime import date, timedelta
from typing import List, Tuple

from data.locations import BRANCH_LOCATIONS
from data.stocks import (
    US_STOCKS, US_ETFS, US_BONDS, US_MUTUAL_FUNDS,
    STOCK_PRICE_RANGES, DEFAULT_STOCK_PRICE_RANGE,
    DEFAULT_ETF_PRICE_RANGE, DEFAULT_BOND_PRICE_RANGE, DEFAULT_MF_NAV_RANGE,
)
from config import VOLUMES, FIRM_START_DATE


BRANCH_TYPES = ["Retail", "Corporate", "Private Banking", "Investment Banking", "Wealth Management"]

EXCHANGE_DATA = [
    ("NYSE", "New York Stock Exchange", "United States", "New York", "USD", "America/New_York", "SEC", 1792, "https://www.nyse.com", "09:30:00", "16:00:00", "Mon-Fri"),
    ("NASDAQ", "Nasdaq Stock Market", "United States", "New York", "USD", "America/New_York", "SEC", 1971, "https://www.nasdaq.com", "09:30:00", "16:00:00", "Mon-Fri"),
    ("CBOE", "Chicago Board Options Exchange", "United States", "Chicago", "USD", "America/Chicago", "SEC", 1973, "https://www.cboe.com", "09:30:00", "16:00:00", "Mon-Fri"),
    ("AMEX", "NYSE American (AMEX)", "United States", "New York", "USD", "America/New_York", "SEC", 1908, "https://www.nyse.com/markets/nyse-american", "09:30:00", "16:00:00", "Mon-Fri"),
    ("ARCA", "NYSE Arca", "United States", "New York", "USD", "America/New_York", "SEC", 1882, "https://www.nyse.com/markets/nyse-arca", "04:00:00", "20:00:00", "Mon-Fri"),
]


def generate_branches(rng: random.Random) -> List[Tuple]:
    """Generate branch records."""
    rows = []
    count = VOLUMES["branches"]

    for i in range(count):
        loc = BRANCH_LOCATIONS[i % len(BRANCH_LOCATIONS)]
        address, city, state, zip_code = loc

        branch_code = f"BR-{state[:2].upper()}{i+1:03d}"
        branch_name = f"Capital Partners {city} {'Main' if i < 10 else 'Regional'} Branch"
        branch_type = BRANCH_TYPES[i % len(BRANCH_TYPES)]
        phone = f"+1-{rng.randint(200,999)}-{rng.randint(100,999)}-{rng.randint(1000,9999)}"
        email = f"branch.{city.lower().replace(' ', '').replace('.', '')}@capitalpartners.com"
        opening_date = FIRM_START_DATE + timedelta(days=rng.randint(0, 365))
        manager_name = f"Branch Manager {i+1}"
        emp_count = rng.randint(15, 80)

        rows.append((
            i + 1,                  # branch_id
            branch_code,
            branch_name,
            "United States",        # country
            state,
            city,
            address,                # address_line1
            None,                   # address_line2
            zip_code,
            phone,
            email,
            branch_type,
            opening_date,
            manager_name,
            emp_count,
            "Active",
        ))

    return rows


BRANCH_COLUMNS = [
    "branch_id", "branch_code", "branch_name", "country", "state", "city",
    "address_line1", "address_line2", "postal_code", "phone_number", "email",
    "branch_type", "opening_date", "manager_name", "employee_count", "status",
]


def generate_exchanges(rng: random.Random) -> List[Tuple]:
    """Generate exchange records."""
    rows = []
    for i, ex in enumerate(EXCHANGE_DATA):
        rows.append((
            i + 1,      # exchange_id
            ex[0],      # exchange_code
            ex[1],      # exchange_name
            ex[2],      # country
            ex[3],      # city
            ex[4],      # currency
            ex[5],      # timezone_name
            ex[6],      # regulator
            ex[7],      # founded_year
            ex[8],      # website
            ex[9],      # market_open_time
            ex[10],     # market_close_time
            ex[11],     # trading_days
            "Active",   # status
        ))
    return rows


EXCHANGE_COLUMNS = [
    "exchange_id", "exchange_code", "exchange_name", "country", "city",
    "currency", "timezone_name", "regulator", "founded_year", "website",
    "market_open_time", "market_close_time", "trading_days", "status",
]


def generate_assets(rng: random.Random) -> List[Tuple]:
    """Generate asset records — mix of stocks, ETFs, bonds, mutual funds to reach 500."""
    rows = []
    asset_id = 0

    # All stocks
    for ticker, name, sector, industry in US_STOCKS:
        asset_id += 1
        exchange_id = rng.choice([1, 2])  # NYSE or NASDAQ
        isin = f"US{rng.randint(1000000000, 9999999999)}{asset_id:02d}"[:12]
        listing_date = date(2010, 1, 1) + timedelta(days=rng.randint(0, 3650))
        face_value = 1.00
        price_range = STOCK_PRICE_RANGES.get(ticker, DEFAULT_STOCK_PRICE_RANGE)
        market_cap = rng.uniform(5e9, 3e12)

        rows.append((
            asset_id,
            exchange_id,
            ticker,
            name,
            "Stock",
            sector,
            industry,
            isin,
            "USD",
            listing_date,
            face_value,
            round(market_cap, 2),
            round(rng.uniform(0, 5), 2),        # dividend_yield
            None,                                 # expense_ratio (stocks don't have)
            None,                                 # coupon_rate
            None,                                 # maturity_date
            None,                                 # credit_rating
            "Active",
        ))

    # All ETFs
    for ticker, name, sector, industry in US_ETFS:
        asset_id += 1
        exchange_id = rng.choice([1, 2, 5])  # NYSE, NASDAQ, ARCA
        isin = f"US{rng.randint(1000000000, 9999999999)}{asset_id:02d}"[:12]
        listing_date = date(2005, 1, 1) + timedelta(days=rng.randint(0, 5000))

        rows.append((
            asset_id,
            exchange_id,
            ticker,
            name,
            "ETF",
            sector,
            industry,
            isin,
            "USD",
            listing_date,
            1.00,
            None,                                 # market_cap
            round(rng.uniform(0, 4), 2),          # dividend_yield
            round(rng.uniform(0.03, 0.75), 2),    # expense_ratio
            None,
            None,
            None,
            "Active",
        ))

    # All Bonds
    for ticker, name, sector, industry in US_BONDS:
        asset_id += 1
        exchange_id = rng.choice([1, 4])  # NYSE or AMEX
        isin = f"US{rng.randint(1000000000, 9999999999)}{asset_id:02d}"[:12]
        listing_date = date(2018, 1, 1) + timedelta(days=rng.randint(0, 2000))
        coupon = round(rng.uniform(1.5, 6.0), 2)
        maturity = date(2027, 1, 1) + timedelta(days=rng.randint(0, 2000))
        ratings = ["AAA", "AA+", "AA", "AA-", "A+", "A", "A-", "BBB+", "BBB"]
        credit_rating = rng.choice(ratings)

        rows.append((
            asset_id,
            exchange_id,
            ticker,
            name,
            "Bond",
            sector,
            industry,
            isin,
            "USD",
            listing_date,
            100.00,         # face value for bonds
            None,
            None,
            None,
            coupon,
            maturity,
            credit_rating,
            "Active",
        ))

    # All Mutual Funds
    for ticker, name, sector, industry in US_MUTUAL_FUNDS:
        asset_id += 1
        exchange_id = 2  # NASDAQ for MFs
        isin = f"US{rng.randint(1000000000, 9999999999)}{asset_id:02d}"[:12]
        listing_date = date(2000, 1, 1) + timedelta(days=rng.randint(0, 7000))

        rows.append((
            asset_id,
            exchange_id,
            ticker,
            name,
            "Mutual Fund",
            sector,
            industry,
            isin,
            "USD",
            listing_date,
            10.00,
            None,
            round(rng.uniform(0, 3), 2),
            round(rng.uniform(0.02, 1.5), 2),    # expense_ratio
            None,
            None,
            None,
            "Active",
        ))

    print(f"  Total assets generated: {asset_id}")
    return rows


ASSET_COLUMNS = [
    "asset_id", "exchange_id", "asset_symbol", "asset_name", "asset_type",
    "sector", "industry", "isin", "currency", "listing_date", "face_value",
    "market_cap", "dividend_yield", "expense_ratio", "coupon_rate",
    "maturity_date", "credit_rating", "status",
]
