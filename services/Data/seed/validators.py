"""
Post-insert validation queries.
Runs SQL assertions to verify cross-table mathematical consistency.
"""

from typing import List, Tuple
import pyodbc


VALIDATION_QUERIES = [
    # 1. Portfolio market value = sum of holdings market value
    (
        "Portfolio market_value vs holdings sum",
        """
        SELECT p.portfolio_id,
               p.current_market_value AS portfolio_value,
               ISNULL(h.total_mv, 0) AS holdings_sum,
               p.current_market_value - ISNULL(h.total_mv, 0) AS diff
        FROM [portfolio].[portfolios] p
        LEFT JOIN (
            SELECT portfolio_id, SUM(current_market_value) AS total_mv
            FROM [portfolio].[portfolio_holdings]
            GROUP BY portfolio_id
        ) h ON p.portfolio_id = h.portfolio_id
        WHERE ABS(p.current_market_value - ISNULL(h.total_mv, 0)) > 0.02
              AND p.current_market_value > 0
        """
    ),

    # 2. Portfolio total_invested = sum of holdings total_cost
    (
        "Portfolio invested vs holdings cost sum",
        """
        SELECT p.portfolio_id,
               p.total_invested_amount AS portfolio_invested,
               ISNULL(h.total_cost, 0) AS holdings_cost,
               p.total_invested_amount - ISNULL(h.total_cost, 0) AS diff
        FROM [portfolio].[portfolios] p
        LEFT JOIN (
            SELECT portfolio_id, SUM(total_cost) AS total_cost
            FROM [portfolio].[portfolio_holdings]
            GROUP BY portfolio_id
        ) h ON p.portfolio_id = h.portfolio_id
        WHERE ABS(p.total_invested_amount - ISNULL(h.total_cost, 0)) > 0.02
              AND p.total_invested_amount > 0
        """
    ),

    # 3. Portfolio unrealized P&L = market_value - invested
    (
        "Portfolio unrealized P&L consistency",
        """
        SELECT portfolio_id,
               unrealized_profit_loss,
               current_market_value - total_invested_amount AS computed,
               unrealized_profit_loss - (current_market_value - total_invested_amount) AS diff
        FROM [portfolio].[portfolios]
        WHERE ABS(unrealized_profit_loss - (current_market_value - total_invested_amount)) > 0.02
              AND total_invested_amount > 0
        """
    ),

    # 4. Holding: current_market_value = quantity × current_market_price
    (
        "Holding market value = qty × price",
        """
        SELECT holding_id,
               current_market_value,
               CAST(quantity * current_market_price AS DECIMAL(18,2)) AS computed,
               current_market_value - CAST(quantity * current_market_price AS DECIMAL(18,2)) AS diff
        FROM [portfolio].[portfolio_holdings]
        WHERE ABS(current_market_value - CAST(quantity * current_market_price AS DECIMAL(18,2))) > 0.02
        """
    ),

    # 5. Holding: unrealized P&L = market_value - total_cost
    (
        "Holding unrealized P&L = market_value - cost",
        """
        SELECT holding_id,
               unrealized_profit_loss,
               current_market_value - total_cost AS computed,
               unrealized_profit_loss - (current_market_value - total_cost) AS diff
        FROM [portfolio].[portfolio_holdings]
        WHERE ABS(unrealized_profit_loss - (current_market_value - total_cost)) > 0.02
        """
    ),

    # 6. Trade: gross_amount = executed_quantity × executed_price
    (
        "Trade gross = qty × price",
        """
        SELECT trade_id,
               gross_amount,
               CAST(executed_quantity * executed_price AS DECIMAL(18,2)) AS computed,
               gross_amount - CAST(executed_quantity * executed_price AS DECIMAL(18,2)) AS diff
        FROM [trading].[executed_trades]
        WHERE ABS(gross_amount - CAST(executed_quantity * executed_price AS DECIMAL(18,2))) > 0.02
        """
    ),

    # 7. Order: total_order_value = quantity × requested_price
    (
        "Order value = qty × price",
        """
        SELECT order_id,
               total_order_value,
               CAST(quantity * requested_price AS DECIMAL(18,2)) AS computed,
               total_order_value - CAST(quantity * requested_price AS DECIMAL(18,2)) AS diff
        FROM [trading].[buy_sell_orders]
        WHERE ABS(total_order_value - CAST(quantity * requested_price AS DECIMAL(18,2))) > 0.02
        """
    ),

    # 8. Dividend: gross = per_unit × quantity, net = gross - tax
    (
        "Dividend math consistency",
        """
        SELECT dividend_id,
               gross_dividend,
               CAST(dividend_per_unit * eligible_quantity AS DECIMAL(18,2)) AS computed_gross,
               net_dividend,
               gross_dividend - withholding_tax AS computed_net
        FROM [finance].[dividends]
        WHERE ABS(gross_dividend - CAST(dividend_per_unit * eligible_quantity AS DECIMAL(18,2))) > 0.02
           OR ABS(net_dividend - (gross_dividend - withholding_tax)) > 0.02
        """
    ),

    # 9. Interest: net = gross - tax
    (
        "Interest net = gross - tax",
        """
        SELECT interest_payment_id,
               net_interest,
               gross_interest - tax_deducted AS computed,
               net_interest - (gross_interest - tax_deducted) AS diff
        FROM [finance].[interest_payments]
        WHERE ABS(net_interest - (gross_interest - tax_deducted)) > 0.02
        """
    ),

    # 10. Tax: tax_amount = taxable_amount × tax_rate / 100
    (
        "Tax amount = taxable × rate",
        """
        SELECT tax_record_id,
               tax_amount,
               CAST(taxable_amount * tax_rate / 100 AS DECIMAL(18,2)) AS computed,
               tax_amount - CAST(taxable_amount * tax_rate / 100 AS DECIMAL(18,2)) AS diff
        FROM [finance].[tax_records]
        WHERE ABS(tax_amount - CAST(taxable_amount * tax_rate / 100 AS DECIMAL(18,2))) > 0.02
        """
    ),

    # 11. Statement: closing = opening + deposits - withdrawals + trades - fees + dividends + interest - taxes
    (
        "Statement closing balance derivation",
        """
        SELECT statement_id,
               closing_balance,
               opening_balance + total_deposits - total_withdrawals
               + total_trade_amount - total_fees + total_dividends
               + total_interest - total_taxes AS computed,
               closing_balance - (opening_balance + total_deposits - total_withdrawals
               + total_trade_amount - total_fees + total_dividends
               + total_interest - total_taxes) AS diff
        FROM [finance].[account_statements]
        WHERE ABS(closing_balance - (opening_balance + total_deposits - total_withdrawals
               + total_trade_amount - total_fees + total_dividends
               + total_interest - total_taxes)) > 0.02
        """
    ),

    # 12. Performance: total_pnl = unrealized + realized, market_value = invested + total_pnl
    (
        "Performance P&L consistency",
        """
        SELECT performance_id,
               total_profit_loss,
               unrealized_profit_loss + realized_profit_loss AS computed_pnl,
               market_value,
               invested_amount + total_profit_loss AS computed_mv
        FROM [portfolio].[portfolio_performance]
        WHERE ABS(total_profit_loss - (unrealized_profit_loss + realized_profit_loss)) > 0.02
           OR ABS(market_value - (invested_amount + total_profit_loss)) > 0.02
        """
    ),

    # 13. Market prices: high >= max(open, close) and low <= min(open, close)
    (
        "Market price OHLC integrity",
        """
        SELECT market_price_id, opening_price, highest_price, lowest_price, closing_price
        FROM [trading].[market_prices]
        WHERE highest_price < opening_price
           OR highest_price < closing_price
           OR lowest_price > opening_price
           OR lowest_price > closing_price
        """
    ),

    # 14. RM client count = actual count
    (
        "RM client count accuracy",
        """
        SELECT rm.manager_id,
               rm.current_client_count,
               ISNULL(c.actual_count, 0) AS actual_count,
               rm.current_client_count - ISNULL(c.actual_count, 0) AS diff
        FROM [customer].[relationship_managers] rm
        LEFT JOIN (
            SELECT relationship_manager_id, COUNT(*) AS actual_count
            FROM [customer].[clients]
            WHERE status = 'Active'
            GROUP BY relationship_manager_id
        ) c ON rm.manager_id = c.relationship_manager_id
        WHERE rm.current_client_count != ISNULL(c.actual_count, 0)
        """
    ),

    # 15. Watchlist total_assets = count of items
    (
        "Watchlist item count accuracy",
        """
        SELECT w.watchlist_id,
               w.total_assets,
               ISNULL(i.item_count, 0) AS actual_count,
               w.total_assets - ISNULL(i.item_count, 0) AS diff
        FROM [portfolio].[watchlists] w
        LEFT JOIN (
            SELECT watchlist_id, COUNT(*) AS item_count
            FROM [portfolio].[watchlist_items]
            GROUP BY watchlist_id
        ) i ON w.watchlist_id = i.watchlist_id
        WHERE w.total_assets != ISNULL(i.item_count, 0)
        """
    ),
]


def run_validations(conn: pyodbc.Connection) -> bool:
    """Run all validation queries. Returns True if all pass."""
    cursor = conn.cursor()
    all_passed = True

    print("\n" + "=" * 70)
    print("  DATA INTEGRITY VALIDATION")
    print("=" * 70)

    for name, query in VALIDATION_QUERIES:
        try:
            cursor.execute(query)
            violations = cursor.fetchall()
            if violations:
                print(f"  FAIL: {name} — {len(violations)} violations found")
                # Show first 3 violations
                for v in violations[:3]:
                    print(f"        {v}")
                all_passed = False
            else:
                print(f"  PASS: {name}")
        except Exception as e:
            print(f"  ERROR: {name} — {e}")
            all_passed = False

    print("=" * 70)
    if all_passed:
        print("  ALL VALIDATIONS PASSED!")
    else:
        print("  SOME VALIDATIONS FAILED — check output above")
    print("=" * 70 + "\n")

    cursor.close()
    return all_passed
