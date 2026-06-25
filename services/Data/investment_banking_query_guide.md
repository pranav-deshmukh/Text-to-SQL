# Investment Banking Database Query Guide

This guide explains the seeded `InvestmentBankingPortfolioManagement` database in practical terms so you can query it efficiently in the Text-to-SQL setup.

## What This Database Represents

This is a US-focused investment banking and portfolio management dataset with realistic customers, accounts, portfolios, trades, holdings, income events, taxes, statements, and notifications.

The data is not random junk data. It was seeded with consistency rules so cross-table totals line up.

Examples:
- Portfolio market value matches the sum of holdings market values.
- Portfolio invested amount matches the sum of holding costs.
- Unrealized P&L equals market value minus invested amount.
- Order value equals quantity times requested price.
- Trade gross amount equals executed quantity times executed price.
- Dividend net equals gross minus withholding tax.
- Interest net equals gross minus tax deducted.
- Tax amount equals taxable amount times tax rate.
- Account statement closing balance follows the stored line-item formula.
- Relationship manager client counts and watchlist asset counts are back-patched from detail rows.

## Seeded Data Shape

These are the main row counts from the successful seed run.

| Area | Table | Approx Rows |
|---|---|---:|
| Master data | `master_data.branches` | 25 |
| Master data | `master_data.exchanges` | 5 |
| Master data | `master_data.assets` | 364 |
| Customer | `customer.relationship_managers` | 500 |
| Customer | `customer.clients` | 2,000 |
| Customer | `customer.risk_profiles` | 2,000 |
| Customer | `customer.accounts` | 2,500 |
| Customer | `customer.kyc_records` | 2,000 |
| Trading | `trading.market_prices` | 46,120 |
| Trading | `trading.buy_sell_orders` | 2,000 |
| Trading | `trading.executed_trades` | 1,786 |
| Portfolio | `portfolio.portfolios` | 2,500 |
| Portfolio | `portfolio.portfolio_holdings` | 1,278 |
| Portfolio | `portfolio.portfolio_performance` | 2,000 |
| Portfolio | `portfolio.watchlists` | 500 |
| Portfolio | `portfolio.watchlist_items` | 2,000 |
| Finance | `finance.transactions` | 1,945 |
| Finance | `finance.fees` | 500 |
| Finance | `finance.dividends` | 500 |
| Finance | `finance.interest_payments` | 500 |
| Finance | `finance.tax_records` | 500 |
| Finance | `finance.account_statements` | 500 |
| Security | `security.notifications` | 2,000 |
| Security | `security.audit_logs` | 2,000 |

## US-Only Seed Characteristics

The seed was intentionally constrained to US-style data.

- Client and manager names are realistic human names.
- Addresses are US-based cities, states, ZIP-style postal codes, and US street names.
- Exchanges are US exchanges such as NYSE and NASDAQ.
- Assets are real US stocks, ETFs, bonds, and mutual funds.
- Currency is effectively USD throughout almost all practical analysis.
- Tax residency and geography are US-focused.

## Business Areas and Best Tables

Use this section to decide where to start your query.

### 1. Customer and Relationship Coverage
Use these when the question is about who the clients are, who manages them, where they belong, and what their risk profile looks like.

Main tables:
- `customer.clients`
- `customer.relationship_managers`
- `master_data.branches`
- `customer.risk_profiles`
- `customer.kyc_records`

Typical questions:
- Which relationship managers handle the most clients?
- Which branches have the highest-income clients?
- Which clients are high risk or have very high net worth?
- Which KYC records are verified, expired, or high-risk?

### 2. Accounts and Cash Activity
Use these when the question is about cash balances, deposits, withdrawals, or statement-level movement.

Main tables:
- `customer.accounts`
- `finance.transactions`
- `finance.account_statements`

Typical questions:
- What is the current balance by account, branch, or client?
- Which accounts had the largest withdrawals?
- How much fee, tax, dividend, and interest activity is in statements?

### 3. Portfolios and Holdings
Use these when the question is about invested value, holdings, exposure, unrealized or realized P&L.

Main tables:
- `portfolio.portfolios`
- `portfolio.portfolio_holdings`
- `portfolio.portfolio_performance`
- `master_data.assets`

Typical questions:
- Top portfolios by market value or return
- Exposure by sector, asset type, or exchange
- Which holdings drive the most profit or loss?

### 4. Trading Activity
Use these when the question is about orders and executed trades.

Main tables:
- `trading.buy_sell_orders`
- `trading.executed_trades`
- `master_data.assets`
- `portfolio.portfolios`
- `customer.accounts`

Typical questions:
- Buy vs sell activity by branch, client, or asset
- Most traded assets
- Brokerage and tax paid on executed trades
- Settlement status or order funnel analysis

### 5. Income, Fees, and Taxes
Use these when the question is about dividends, interest, fees, and tax.

Main tables:
- `finance.dividends`
- `finance.interest_payments`
- `finance.fees`
- `finance.tax_records`
- `finance.transactions`

Typical questions:
- Which portfolios earned the most dividend income?
- Which portfolios paid the most fees or taxes?
- What is net yield after withholding tax?

### 6. Market and Price History
Use these when the question is about historical prices or price-driven analysis.

Main tables:
- `trading.market_prices`
- `master_data.assets`
- `master_data.exchanges`

Typical questions:
- Latest price for an asset
- Price change over time
- Top movers by date range
- Volume spikes

## Important Join Paths

These are the most useful join routes.

### Client to Branch and Manager
```sql
customer.clients c
JOIN customer.relationship_managers rm
  ON c.relationship_manager_id = rm.manager_id
JOIN master_data.branches b
  ON c.branch_id = b.branch_id
```

### Client to Account to Portfolio
```sql
customer.clients c
JOIN customer.accounts a
  ON c.client_id = a.client_id
JOIN portfolio.portfolios p
  ON a.account_id = p.account_id
```

### Portfolio to Holdings to Assets
```sql
portfolio.portfolios p
JOIN portfolio.portfolio_holdings h
  ON p.portfolio_id = h.portfolio_id
JOIN master_data.assets ast
  ON h.asset_id = ast.asset_id
```

### Orders to Trades to Asset
```sql
trading.buy_sell_orders o
LEFT JOIN trading.executed_trades t
  ON o.order_id = t.order_id
JOIN master_data.assets ast
  ON o.asset_id = ast.asset_id
```

### Accounts to Transactions
```sql
customer.accounts a
JOIN finance.transactions ft
  ON a.account_id = ft.account_id
```

## How Data Is Saved and What That Means for Querying

These points matter a lot when prompting a Text-to-SQL system.

### Portfolio totals are summary fields
`portfolio.portfolios` stores summary values such as:
- `total_invested_amount`
- `current_market_value`
- `unrealized_profit_loss`
- `realized_profit_loss`

These are already consistent with `portfolio.portfolio_holdings` after back-patching.

Use `portfolio.portfolios` when you want fast portfolio-level answers.
Use `portfolio.portfolio_holdings` when you want asset-level detail or exposure analysis.

### Holdings are current-state rows, not full history
`portfolio.portfolio_holdings` reflects the latest accumulated position by portfolio and asset.

Use it for:
- current exposure
- current quantity
- average buy price
- current unrealized and realized P&L at holding level

Do not use it alone if you need trade timing or full trade history. For that, use `trading.executed_trades`.

### Orders and trades are different
`trading.buy_sell_orders` stores requested orders.
`trading.executed_trades` stores only executed trades.

Use orders when you need funnel questions:
- pending vs executed vs cancelled
- order intent
- order category

Use trades when you need money movement questions:
- actual execution price
- gross amount
- brokerage
- tax
- settlement status

### Transactions are financial ledger-style events
`finance.transactions` includes:
- deposits
- withdrawals
- buys
- sells
- dividend
- interest
- fee
- tax
- transfer

If the question is about account money movement, start here.
If the question is about portfolio asset exposure, start at holdings or trades instead.

### Market prices are date-grained
`trading.market_prices` is one row per asset per price date.

Use:
- latest date per asset for current price-style questions
- date filters for historical trend questions

When asking in natural language, be explicit whether you mean:
- latest available close
- average close over a period
- highest or lowest price in a period

### Statements are report-style summaries
`finance.account_statements` is pre-aggregated statement data for a statement period.

Use it when the user wants statement-period answers such as:
- total fees in statements
- closing balances by month or statement period
- statement-level inflow/outflow reporting

Do not use statements for trade-level analysis.

## How To Ask Efficiently in Text-to-SQL

When prompting the system, be precise about the business grain.

### Good prompt patterns
- "Top 10 portfolios by current market value"
- "Show clients in California with net worth above 5 million and moderate or high risk"
- "For each branch, total number of active clients and average account balance"
- "Which assets generated the highest realized profit across all portfolios?"
- "Show monthly dividend income by portfolio in 2026"
- "Compare executed buy vs sell gross amounts by asset sector"

### Clarify these dimensions when possible
- Time window: today, latest available, this year, monthly, quarter, statement period
- Grain: client, account, portfolio, holding, trade, branch, manager, asset
- Metric: gross amount, net amount, market value, realized P&L, unrealized P&L, fee, tax
- Status: active accounts, executed trades, verified KYC, settled trades

### Questions that are ambiguous unless you specify more
- "What is portfolio performance?"
- "Which clients are best?"
- "Show account returns"
- "Which assets did well?"

Better versions:
- "Top 20 portfolios by yearly_return_percent from portfolio_performance"
- "Clients with the highest current portfolio market value"
- "Accounts with the largest closing balance in statements generated in 2026"
- "Assets with highest average unrealized profit in current holdings"

## Natural-Language Mapping Tips

If you want a specific style of answer, use these mappings.

- "Current portfolio value" usually maps to `portfolio.portfolios.current_market_value`.
- "Invested amount" usually maps to `portfolio.portfolios.total_invested_amount`.
- "Current holding value" usually maps to `portfolio.portfolio_holdings.current_market_value`.
- "Gain/loss" may mean realized or unrealized. Specify which one.
- "Trade amount" may mean order value, gross trade amount, or net trade amount. Specify which one.
- "Return" may mean a percentage from `portfolio.portfolio_performance` or a dollar P&L from portfolios or holdings.
- "Balance" may mean current account balance or statement closing balance. Specify which one.

## Sample Complex Queries

### 1. Top branches by total client portfolio market value
```sql
SELECT TOP 10
    b.branch_name,
    b.city,
    b.state,
    COUNT(DISTINCT c.client_id) AS client_count,
    COUNT(DISTINCT p.portfolio_id) AS portfolio_count,
    SUM(p.current_market_value) AS total_market_value,
    AVG(p.current_market_value) AS avg_portfolio_value
FROM master_data.branches b
JOIN customer.clients c
    ON b.branch_id = c.branch_id
JOIN portfolio.portfolios p
    ON c.client_id = p.client_id
WHERE c.status = 'Active'
  AND p.portfolio_status = 'Active'
GROUP BY b.branch_name, b.city, b.state
ORDER BY total_market_value DESC;
```

### 2. Sector exposure by branch
```sql
SELECT
    b.branch_name,
    ast.sector,
    SUM(h.current_market_value) AS sector_market_value,
    SUM(h.unrealized_profit_loss) AS sector_unrealized_pnl,
    COUNT(DISTINCT h.portfolio_id) AS portfolio_count
FROM portfolio.portfolio_holdings h
JOIN portfolio.portfolios p
    ON h.portfolio_id = p.portfolio_id
JOIN customer.clients c
    ON p.client_id = c.client_id
JOIN master_data.branches b
    ON c.branch_id = b.branch_id
JOIN master_data.assets ast
    ON h.asset_id = ast.asset_id
GROUP BY b.branch_name, ast.sector
ORDER BY b.branch_name, sector_market_value DESC;
```

### 3. Relationship managers with high-value books and risk mix
```sql
SELECT TOP 25
    rm.manager_id,
    rm.first_name,
    rm.last_name,
    rm.designation,
    rm.current_client_count,
    COUNT(DISTINCT rp.client_id) AS profiled_clients,
    SUM(CASE WHEN rp.risk_level = 'Low' THEN 1 ELSE 0 END) AS low_risk_clients,
    SUM(CASE WHEN rp.risk_level = 'Moderate' THEN 1 ELSE 0 END) AS moderate_risk_clients,
    SUM(CASE WHEN rp.risk_level = 'High' THEN 1 ELSE 0 END) AS high_risk_clients,
    SUM(CASE WHEN rp.risk_level = 'Very High' THEN 1 ELSE 0 END) AS very_high_risk_clients,
    SUM(p.current_market_value) AS total_book_market_value
FROM customer.relationship_managers rm
JOIN customer.clients c
    ON rm.manager_id = c.relationship_manager_id
LEFT JOIN customer.risk_profiles rp
    ON c.client_id = rp.client_id
LEFT JOIN portfolio.portfolios p
    ON c.client_id = p.client_id
GROUP BY
    rm.manager_id,
    rm.first_name,
    rm.last_name,
    rm.designation,
    rm.current_client_count
ORDER BY total_book_market_value DESC;
```

### 4. Executed trade profitability by asset
```sql
SELECT TOP 25
    ast.asset_symbol,
    ast.asset_name,
    ast.asset_type,
    ast.sector,
    COUNT(*) AS trade_count,
    SUM(t.executed_quantity) AS total_quantity,
    SUM(t.gross_amount) AS total_gross_amount,
    SUM(t.brokerage_amount) AS total_brokerage,
    SUM(t.tax_amount) AS total_trade_tax,
    SUM(CASE WHEN o.order_type = 'Buy' THEN t.gross_amount ELSE 0 END) AS total_buy_gross,
    SUM(CASE WHEN o.order_type = 'Sell' THEN t.gross_amount ELSE 0 END) AS total_sell_gross
FROM trading.executed_trades t
JOIN trading.buy_sell_orders o
    ON t.order_id = o.order_id
JOIN master_data.assets ast
    ON t.asset_id = ast.asset_id
GROUP BY ast.asset_symbol, ast.asset_name, ast.asset_type, ast.sector
ORDER BY total_gross_amount DESC;
```

### 5. Clients whose portfolio value is much larger than annual income
```sql
SELECT TOP 50
    c.client_id,
    c.first_name,
    c.last_name,
    c.city,
    c.state,
    c.annual_income,
    c.net_worth,
    SUM(p.current_market_value) AS total_portfolio_value,
    CAST(SUM(p.current_market_value) / NULLIF(c.annual_income, 0) AS DECIMAL(18,2)) AS portfolio_to_income_ratio
FROM customer.clients c
JOIN portfolio.portfolios p
    ON c.client_id = p.client_id
GROUP BY
    c.client_id,
    c.first_name,
    c.last_name,
    c.city,
    c.state,
    c.annual_income,
    c.net_worth
HAVING SUM(p.current_market_value) > 0
ORDER BY portfolio_to_income_ratio DESC;
```

### 6. Monthly dividend and interest income by portfolio
```sql
SELECT
    portfolio_id,
    YEAR(income_date) AS income_year,
    MONTH(income_date) AS income_month,
    SUM(dividend_income) AS total_dividend_income,
    SUM(interest_income) AS total_interest_income,
    SUM(total_net_income) AS total_net_income
FROM (
    SELECT
        d.portfolio_id,
        d.payment_date AS income_date,
        d.net_dividend AS dividend_income,
        CAST(0 AS DECIMAL(18,2)) AS interest_income,
        d.net_dividend AS total_net_income
    FROM finance.dividends d

    UNION ALL

    SELECT
        i.portfolio_id,
        i.payment_date AS income_date,
        CAST(0 AS DECIMAL(18,2)) AS dividend_income,
        i.net_interest AS interest_income,
        i.net_interest AS total_net_income
    FROM finance.interest_payments i
) x
GROUP BY portfolio_id, YEAR(income_date), MONTH(income_date)
ORDER BY portfolio_id, income_year, income_month;
```

### 7. Portfolio performance vs benchmark
```sql
SELECT TOP 50
    p.portfolio_code,
    p.portfolio_name,
    p.portfolio_type,
    perf.performance_date,
    perf.market_value,
    perf.invested_amount,
    perf.total_profit_loss,
    perf.yearly_return_percent,
    perf.benchmark_return_percent,
    perf.yearly_return_percent - ISNULL(perf.benchmark_return_percent, 0) AS excess_return,
    perf.portfolio_beta,
    perf.portfolio_alpha,
    perf.sharpe_ratio,
    perf.volatility
FROM portfolio.portfolio_performance perf
JOIN portfolio.portfolios p
    ON perf.portfolio_id = p.portfolio_id
ORDER BY excess_return DESC;
```

### 8. Latest market snapshot for all currently held assets
```sql
WITH latest_price AS (
    SELECT
        mp.asset_id,
        mp.price_date,
        mp.closing_price,
        ROW_NUMBER() OVER (
            PARTITION BY mp.asset_id
            ORDER BY mp.price_date DESC
        ) AS rn
    FROM trading.market_prices mp
)
SELECT
    ast.asset_symbol,
    ast.asset_name,
    ast.asset_type,
    ast.sector,
    lp.price_date AS latest_price_date,
    lp.closing_price AS latest_close,
    SUM(h.quantity) AS total_quantity_held,
    SUM(h.current_market_value) AS total_current_market_value
FROM portfolio.portfolio_holdings h
JOIN master_data.assets ast
    ON h.asset_id = ast.asset_id
JOIN latest_price lp
    ON h.asset_id = lp.asset_id
   AND lp.rn = 1
GROUP BY
    ast.asset_symbol,
    ast.asset_name,
    ast.asset_type,
    ast.sector,
    lp.price_date,
    lp.closing_price
ORDER BY total_current_market_value DESC;
```

### 9. Order funnel by asset type and status
```sql
SELECT
    ast.asset_type,
    o.order_status,
    COUNT(*) AS order_count,
    SUM(o.total_order_value) AS total_requested_value,
    AVG(o.requested_price) AS avg_requested_price,
    AVG(o.quantity) AS avg_quantity
FROM trading.buy_sell_orders o
JOIN master_data.assets ast
    ON o.asset_id = ast.asset_id
GROUP BY ast.asset_type, o.order_status
ORDER BY ast.asset_type, order_count DESC;
```

### 10. Fee and tax burden by portfolio
```sql
SELECT TOP 50
    p.portfolio_code,
    p.portfolio_name,
    p.current_market_value,
    SUM(ISNULL(f.fee_amount, 0)) AS total_fees,
    SUM(ISNULL(t.tax_amount, 0)) AS total_taxes,
    SUM(ISNULL(f.fee_amount, 0)) + SUM(ISNULL(t.tax_amount, 0)) AS total_cost_burden,
    CAST(
        (SUM(ISNULL(f.fee_amount, 0)) + SUM(ISNULL(t.tax_amount, 0)))
        / NULLIF(p.current_market_value, 0) * 100
        AS DECIMAL(18,4)
    ) AS burden_pct_of_market_value
FROM portfolio.portfolios p
LEFT JOIN finance.fees f
    ON p.portfolio_id = f.portfolio_id
LEFT JOIN finance.tax_records t
    ON p.portfolio_id = t.portfolio_id
GROUP BY p.portfolio_code, p.portfolio_name, p.current_market_value
ORDER BY total_cost_burden DESC;
```

### 11. Accounts with the largest activity in statements
```sql
SELECT TOP 50
    a.account_number,
    c.first_name,
    c.last_name,
    a.current_balance,
    SUM(s.total_deposits) AS stmt_deposits,
    SUM(s.total_withdrawals) AS stmt_withdrawals,
    SUM(s.total_trade_amount) AS stmt_trade_amount,
    SUM(s.total_fees) AS stmt_fees,
    SUM(s.total_dividends) AS stmt_dividends,
    SUM(s.total_interest) AS stmt_interest,
    MAX(s.closing_balance) AS max_stmt_closing_balance
FROM finance.account_statements s
JOIN customer.accounts a
    ON s.account_id = a.account_id
JOIN customer.clients c
    ON a.client_id = c.client_id
GROUP BY a.account_number, c.first_name, c.last_name, a.current_balance
ORDER BY stmt_trade_amount DESC;
```

### 12. High-value clients with KYC and risk context
```sql
SELECT TOP 100
    c.client_id,
    c.first_name,
    c.last_name,
    c.city,
    c.state,
    c.annual_income,
    c.net_worth,
    rp.risk_level,
    rp.risk_score,
    k.verification_status,
    k.aml_check_status,
    k.risk_category,
    SUM(p.current_market_value) AS total_portfolio_market_value
FROM customer.clients c
LEFT JOIN customer.risk_profiles rp
    ON c.client_id = rp.client_id
LEFT JOIN customer.kyc_records k
    ON c.client_id = k.client_id
LEFT JOIN portfolio.portfolios p
    ON c.client_id = p.client_id
GROUP BY
    c.client_id,
    c.first_name,
    c.last_name,
    c.city,
    c.state,
    c.annual_income,
    c.net_worth,
    rp.risk_level,
    rp.risk_score,
    k.verification_status,
    k.aml_check_status,
    k.risk_category
ORDER BY total_portfolio_market_value DESC;
```

## Suggested Prompt Templates for Text-to-SQL

Use templates like these when you want better generated SQL.

- "At the portfolio level, show the top 20 active portfolios by current market value, invested amount, unrealized P&L, and realized P&L."
- "At the client level, find high-net-worth clients in California with high or very high risk profiles and total portfolio market value above 1 million."
- "At the trade level, compare executed buy and sell gross amounts by sector for 2026."
- "At the holding level, show sector exposure for each branch using current market value."
- "At the statement level, summarize deposits, withdrawals, trade amount, fees, dividends, and closing balance by account."
- "Using latest available market prices, list the top held assets by total current market value."

## Final Querying Guidance

If you want the most reliable answers:
- Use `portfolio.portfolios` for summary portfolio metrics.
- Use `portfolio.portfolio_holdings` for current exposure by asset.
- Use `trading.executed_trades` for actual executed money flow.
- Use `finance.transactions` for account-level cash movement.
- Use `trading.market_prices` for time-series price questions.
- Use `finance.account_statements` for statement-period reporting.
- Ask explicitly whether you want gross, net, realized, unrealized, current, or historical values.

If you want, I can also add a second companion file with 50 natural-language prompt examples tailored for your Text-to-SQL testing.