/*==============================================================*/
/* DATABASE: Investment Banking and Portfolio Management        */
/*==============================================================*/

IF DB_ID('InvestmentBankingPortfolioManagement') IS NOT NULL
BEGIN
    DROP DATABASE InvestmentBankingPortfolioManagement;
END
GO

CREATE DATABASE InvestmentBankingPortfolioManagement;
GO

USE InvestmentBankingPortfolioManagement;
GO

/*==============================================================*/
/* TABLE: branches                                              */
/*==============================================================*/

CREATE TABLE branches (
    branch_id INT IDENTITY(1,1) PRIMARY KEY,

    branch_code NVARCHAR(15) NOT NULL UNIQUE,
    branch_name NVARCHAR(150) NOT NULL,

    country NVARCHAR(100) NOT NULL,
    state NVARCHAR(100) NOT NULL,
    city NVARCHAR(100) NOT NULL,

    address_line1 NVARCHAR(255) NOT NULL,
    address_line2 NVARCHAR(255) NULL,

    postal_code NVARCHAR(20) NOT NULL,

    phone_number NVARCHAR(20) NOT NULL,
    email NVARCHAR(150) NOT NULL,

    branch_type NVARCHAR(50) NOT NULL,

    opening_date DATE NOT NULL,

    manager_name NVARCHAR(150) NULL,

    employee_count INT NOT NULL DEFAULT 0,

    status NVARCHAR(20) NOT NULL DEFAULT 'Active',

    created_at DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    updated_at DATETIME2 NOT NULL DEFAULT SYSDATETIME(),

    CONSTRAINT CK_Branch_Status
        CHECK (status IN ('Active','Inactive','Closed')),

    CONSTRAINT CK_Branch_Type
        CHECK (branch_type IN
        (
            'Retail',
            'Corporate',
            'Private Banking',
            'Investment Banking',
            'Wealth Management'
        ))
);
GO

CREATE INDEX IX_Branches_Country
ON branches(country);
GO

CREATE INDEX IX_Branches_State
ON branches(state);
GO

CREATE INDEX IX_Branches_City
ON branches(city);
GO

CREATE INDEX IX_Branches_Type
ON branches(branch_type);
GO

/*==============================================================*/
/* TABLE: relationship_managers                                 */
/*==============================================================*/

CREATE TABLE relationship_managers (
    manager_id INT IDENTITY(1,1) PRIMARY KEY,

    branch_id INT NOT NULL,

    employee_code NVARCHAR(20) NOT NULL UNIQUE,

    first_name NVARCHAR(100) NOT NULL,
    last_name NVARCHAR(100) NOT NULL,

    gender NVARCHAR(20) NOT NULL,

    date_of_birth DATE NOT NULL,

    email NVARCHAR(150) NOT NULL UNIQUE,
    phone_number NVARCHAR(20) NOT NULL,

    hire_date DATE NOT NULL,

    designation NVARCHAR(100) NOT NULL,

    experience_years DECIMAL(4,1) NOT NULL DEFAULT 0,

    license_number NVARCHAR(50) NOT NULL UNIQUE,

    annual_salary DECIMAL(18,2) NOT NULL,

    commission_percentage DECIMAL(5,2) NOT NULL DEFAULT 0,

    client_capacity INT NOT NULL DEFAULT 100,

    current_client_count INT NOT NULL DEFAULT 0,

    performance_rating DECIMAL(3,2) NULL,

    status NVARCHAR(20) NOT NULL DEFAULT 'Active',

    created_at DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    updated_at DATETIME2 NOT NULL DEFAULT SYSDATETIME(),

    CONSTRAINT FK_RM_Branch
        FOREIGN KEY (branch_id)
        REFERENCES branches(branch_id),

    CONSTRAINT CK_RM_Gender
        CHECK (gender IN ('Male','Female','Other')),

    CONSTRAINT CK_RM_Status
        CHECK (status IN ('Active','Inactive','Resigned','Retired')),

    CONSTRAINT CK_RM_Salary
        CHECK (annual_salary >= 0),

    CONSTRAINT CK_RM_Commission
        CHECK (commission_percentage BETWEEN 0 AND 100),

    CONSTRAINT CK_RM_Rating
        CHECK (
            performance_rating IS NULL
            OR performance_rating BETWEEN 0 AND 5
        ),

    CONSTRAINT CK_RM_Client_Count
        CHECK (current_client_count <= client_capacity)
);
GO

CREATE INDEX IX_RM_Branch
ON relationship_managers(branch_id);
GO

CREATE INDEX IX_RM_Designation
ON relationship_managers(designation);
GO

CREATE INDEX IX_RM_Status
ON relationship_managers(status);
GO

CREATE INDEX IX_RM_HireDate
ON relationship_managers(hire_date);
GO

CREATE INDEX IX_RM_Rating
ON relationship_managers(performance_rating);
GO

/*==============================================================*/
/* TABLE: clients                                                */
/*==============================================================*/

CREATE TABLE clients (
    client_id INT IDENTITY(1,1) PRIMARY KEY,

    relationship_manager_id INT NOT NULL,
    branch_id INT NOT NULL,

    client_code NVARCHAR(20) NOT NULL UNIQUE,

    first_name NVARCHAR(100) NOT NULL,
    last_name NVARCHAR(100) NOT NULL,

    gender NVARCHAR(20) NOT NULL,

    date_of_birth DATE NOT NULL,

    email NVARCHAR(150) NOT NULL UNIQUE,
    phone_number NVARCHAR(20) NOT NULL,

    pan_number NVARCHAR(20) NOT NULL UNIQUE,
    national_id NVARCHAR(30) NULL,

    occupation NVARCHAR(100) NOT NULL,

    annual_income DECIMAL(18,2) NOT NULL,

    net_worth DECIMAL(18,2) NOT NULL,

    investment_experience NVARCHAR(30) NOT NULL,

    preferred_currency NVARCHAR(10) NOT NULL,

    tax_residency_country NVARCHAR(100) NOT NULL,

    address_line1 NVARCHAR(255) NOT NULL,
    address_line2 NVARCHAR(255) NULL,

    city NVARCHAR(100) NOT NULL,
    state NVARCHAR(100) NOT NULL,
    country NVARCHAR(100) NOT NULL,

    postal_code NVARCHAR(20) NOT NULL,

    client_since DATE NOT NULL,

    status NVARCHAR(20) NOT NULL DEFAULT 'Active',

    created_at DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    updated_at DATETIME2 NOT NULL DEFAULT SYSDATETIME(),

    CONSTRAINT FK_Clients_Manager
        FOREIGN KEY (relationship_manager_id)
        REFERENCES relationship_managers(manager_id),

    CONSTRAINT FK_Clients_Branch
        FOREIGN KEY (branch_id)
        REFERENCES branches(branch_id),

    CONSTRAINT CK_Client_Gender
        CHECK (gender IN ('Male','Female','Other')),

    CONSTRAINT CK_Client_Status
        CHECK (status IN ('Active','Inactive','Suspended','Closed')),

    CONSTRAINT CK_Client_Income
        CHECK (annual_income >= 0),

    CONSTRAINT CK_Client_NetWorth
        CHECK (net_worth >= 0),

    CONSTRAINT CK_Client_Experience
        CHECK (
            investment_experience IN
            (
                'Beginner',
                'Intermediate',
                'Advanced',
                'Professional'
            )
        )
);
GO

CREATE INDEX IX_Clients_Manager
ON clients(relationship_manager_id);
GO

CREATE INDEX IX_Clients_Branch
ON clients(branch_id);
GO

CREATE INDEX IX_Clients_Status
ON clients(status);
GO

CREATE INDEX IX_Clients_Country
ON clients(country);
GO

CREATE INDEX IX_Clients_Income
ON clients(annual_income);
GO

/*==============================================================*/
/* TABLE: risk_profiles                                          */
/*==============================================================*/

CREATE TABLE risk_profiles (
    risk_profile_id INT IDENTITY(1,1) PRIMARY KEY,

    client_id INT NOT NULL,

    risk_level NVARCHAR(30) NOT NULL,

    risk_score DECIMAL(5,2) NOT NULL,

    investment_goal NVARCHAR(100) NOT NULL,

    investment_horizon_years INT NOT NULL,

    liquidity_preference NVARCHAR(30) NOT NULL,

    annual_income DECIMAL(18,2) NOT NULL,

    net_worth DECIMAL(18,2) NOT NULL,

    monthly_investment_capacity DECIMAL(18,2) NOT NULL,

    expected_annual_return DECIMAL(5,2) NOT NULL,

    maximum_loss_tolerance DECIMAL(5,2) NOT NULL,

    assessment_date DATE NOT NULL,

    next_review_date DATE NOT NULL,

    assessed_by_manager_id INT NOT NULL,

    remarks NVARCHAR(500) NULL,

    status NVARCHAR(20) NOT NULL DEFAULT 'Active',

    created_at DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    updated_at DATETIME2 NOT NULL DEFAULT SYSDATETIME(),

    CONSTRAINT FK_Risk_Client
        FOREIGN KEY (client_id)
        REFERENCES clients(client_id),

    CONSTRAINT FK_Risk_Manager
        FOREIGN KEY (assessed_by_manager_id)
        REFERENCES relationship_managers(manager_id),

    CONSTRAINT CK_Risk_Level
        CHECK (
            risk_level IN
            (
                'Low',
                'Moderate',
                'High',
                'Very High'
            )
        ),

    CONSTRAINT CK_Risk_Status
        CHECK (status IN ('Active','Expired')),

    CONSTRAINT CK_Risk_Score
        CHECK (risk_score BETWEEN 0 AND 100),

    CONSTRAINT CK_Risk_Return
        CHECK (expected_annual_return BETWEEN 0 AND 100),

    CONSTRAINT CK_Risk_Loss
        CHECK (maximum_loss_tolerance BETWEEN 0 AND 100),

    CONSTRAINT CK_Risk_Horizon
        CHECK (investment_horizon_years > 0)
);
GO

CREATE INDEX IX_Risk_Client
ON risk_profiles(client_id);
GO

CREATE INDEX IX_Risk_Manager
ON risk_profiles(assessed_by_manager_id);
GO

CREATE INDEX IX_Risk_Level
ON risk_profiles(risk_level);
GO

CREATE INDEX IX_Risk_Status
ON risk_profiles(status);
GO

CREATE INDEX IX_Risk_Assessment_Date
ON risk_profiles(assessment_date);
GO

/*==============================================================*/
/* TABLE: accounts                                               */
/*==============================================================*/

CREATE TABLE accounts (
    account_id INT IDENTITY(1,1) PRIMARY KEY,

    client_id INT NOT NULL,
    branch_id INT NOT NULL,

    account_number NVARCHAR(25) NOT NULL UNIQUE,

    account_type NVARCHAR(50) NOT NULL,

    base_currency NVARCHAR(10) NOT NULL,

    opening_balance DECIMAL(18,2) NOT NULL DEFAULT 0,

    current_balance DECIMAL(18,2) NOT NULL DEFAULT 0,

    available_balance DECIMAL(18,2) NOT NULL DEFAULT 0,

    account_status NVARCHAR(20) NOT NULL DEFAULT 'Active',

    opened_date DATE NOT NULL,

    closed_date DATE NULL,

    nominee_name NVARCHAR(150) NULL,

    nominee_relationship NVARCHAR(100) NULL,

    online_banking_enabled BIT NOT NULL DEFAULT 1,

    overdraft_limit DECIMAL(18,2) NOT NULL DEFAULT 0,

    last_transaction_date DATE NULL,

    created_at DATETIME2 NOT NULL DEFAULT SYSDATETIME(),

    updated_at DATETIME2 NOT NULL DEFAULT SYSDATETIME(),

    CONSTRAINT FK_Accounts_Client
        FOREIGN KEY (client_id)
        REFERENCES clients(client_id),

    CONSTRAINT FK_Accounts_Branch
        FOREIGN KEY (branch_id)
        REFERENCES branches(branch_id),

    CONSTRAINT CK_Account_Type
        CHECK (
            account_type IN
            (
                'Individual',
                'Joint',
                'Corporate',
                'Retirement'
            )
        ),

    CONSTRAINT CK_Account_Status
        CHECK (
            account_status IN
            (
                'Active',
                'Inactive',
                'Frozen',
                'Closed'
            )
        ),

    CONSTRAINT CK_Opening_Balance
        CHECK (opening_balance >= 0),

    CONSTRAINT CK_Current_Balance
        CHECK (current_balance >= 0),

    CONSTRAINT CK_Available_Balance
        CHECK (available_balance >= 0),

    CONSTRAINT CK_Overdraft
        CHECK (overdraft_limit >= 0)
);
GO

CREATE INDEX IX_Accounts_Client
ON accounts(client_id);
GO

CREATE INDEX IX_Accounts_Branch
ON accounts(branch_id);
GO

CREATE INDEX IX_Accounts_Status
ON accounts(account_status);
GO

CREATE INDEX IX_Accounts_Type
ON accounts(account_type);
GO

CREATE INDEX IX_Accounts_LastTransaction
ON accounts(last_transaction_date);
GO

/*==============================================================*/
/* TABLE: kyc_records                                            */
/*==============================================================*/

CREATE TABLE kyc_records (
    kyc_id INT IDENTITY(1,1) PRIMARY KEY,

    client_id INT NOT NULL,

    verification_type NVARCHAR(50) NOT NULL,

    document_type NVARCHAR(50) NOT NULL,

    document_number NVARCHAR(50) NOT NULL,

    issuing_country NVARCHAR(100) NOT NULL,

    issue_date DATE NULL,

    expiry_date DATE NULL,

    verification_date DATE NOT NULL,

    verified_by_manager_id INT NOT NULL,

    verification_status NVARCHAR(30) NOT NULL,

    aml_check_status NVARCHAR(30) NOT NULL,

    pep_status NVARCHAR(30) NOT NULL,

    sanctions_check_status NVARCHAR(30) NOT NULL,

    risk_category NVARCHAR(30) NOT NULL,

    remarks NVARCHAR(500) NULL,

    created_at DATETIME2 NOT NULL DEFAULT SYSDATETIME(),

    updated_at DATETIME2 NOT NULL DEFAULT SYSDATETIME(),

    CONSTRAINT FK_KYC_Client
        FOREIGN KEY (client_id)
        REFERENCES clients(client_id),

    CONSTRAINT FK_KYC_Manager
        FOREIGN KEY (verified_by_manager_id)
        REFERENCES relationship_managers(manager_id),

    CONSTRAINT CK_KYC_Verification_Status
        CHECK (
            verification_status IN
            (
                'Pending',
                'Verified',
                'Rejected',
                'Expired'
            )
        ),

    CONSTRAINT CK_KYC_AML
        CHECK (
            aml_check_status IN
            (
                'Pending',
                'Passed',
                'Failed'
            )
        ),

    CONSTRAINT CK_KYC_PEP
        CHECK (
            pep_status IN
            (
                'Yes',
                'No'
            )
        ),

    CONSTRAINT CK_KYC_Sanctions
        CHECK (
            sanctions_check_status IN
            (
                'Pending',
                'Passed',
                'Failed'
            )
        ),

    CONSTRAINT CK_KYC_Risk
        CHECK (
            risk_category IN
            (
                'Low',
                'Medium',
                'High'
            )
        )
);
GO

CREATE INDEX IX_KYC_Client
ON kyc_records(client_id);
GO

CREATE INDEX IX_KYC_Manager
ON kyc_records(verified_by_manager_id);
GO

CREATE INDEX IX_KYC_Status
ON kyc_records(verification_status);
GO

CREATE INDEX IX_KYC_DocumentType
ON kyc_records(document_type);
GO

CREATE INDEX IX_KYC_RiskCategory
ON kyc_records(risk_category);
GO

/*==============================================================*/
/* TABLE: exchanges                                              */
/*==============================================================*/

CREATE TABLE exchanges (
    exchange_id INT IDENTITY(1,1) PRIMARY KEY,

    exchange_code NVARCHAR(20) NOT NULL UNIQUE,

    exchange_name NVARCHAR(150) NOT NULL,

    country NVARCHAR(100) NOT NULL,

    city NVARCHAR(100) NOT NULL,

    currency NVARCHAR(10) NOT NULL,

    timezone_name NVARCHAR(100) NOT NULL,

    regulator NVARCHAR(150) NOT NULL,

    founded_year SMALLINT NOT NULL,

    website NVARCHAR(200) NULL,

    market_open_time TIME NOT NULL,

    market_close_time TIME NOT NULL,

    trading_days NVARCHAR(50) NOT NULL,

    status NVARCHAR(20) NOT NULL DEFAULT 'Active',

    created_at DATETIME2 NOT NULL DEFAULT SYSDATETIME(),

    updated_at DATETIME2 NOT NULL DEFAULT SYSDATETIME(),

    CONSTRAINT CK_Exchange_Status
        CHECK (
            status IN
            (
                'Active',
                'Inactive'
            )
        ),

    CONSTRAINT CK_Exchange_Year
        CHECK (
            founded_year BETWEEN 1700 AND YEAR(GETDATE())
        )
);
GO

CREATE INDEX IX_Exchange_Country
ON exchanges(country);
GO

CREATE INDEX IX_Exchange_City
ON exchanges(city);
GO

CREATE INDEX IX_Exchange_Currency
ON exchanges(currency);
GO

CREATE INDEX IX_Exchange_Status
ON exchanges(status);
GO

/*==============================================================*/
/* TABLE: assets                                                 */
/*==============================================================*/

CREATE TABLE assets (
    asset_id INT IDENTITY(1,1) PRIMARY KEY,

    exchange_id INT NOT NULL,

    asset_symbol NVARCHAR(25) NOT NULL UNIQUE,

    asset_name NVARCHAR(200) NOT NULL,

    asset_type NVARCHAR(30) NOT NULL,

    sector NVARCHAR(100) NOT NULL,

    industry NVARCHAR(100) NOT NULL,

    isin NVARCHAR(20) NOT NULL UNIQUE,

    currency NVARCHAR(10) NOT NULL,

    listing_date DATE NOT NULL,

    face_value DECIMAL(18,2) NOT NULL,

    market_cap DECIMAL(20,2) NULL,

    dividend_yield DECIMAL(6,2) NULL,

    expense_ratio DECIMAL(6,2) NULL,

    coupon_rate DECIMAL(6,2) NULL,

    maturity_date DATE NULL,

    credit_rating NVARCHAR(20) NULL,

    status NVARCHAR(20) NOT NULL DEFAULT 'Active',

    created_at DATETIME2 NOT NULL DEFAULT SYSDATETIME(),

    updated_at DATETIME2 NOT NULL DEFAULT SYSDATETIME(),

    CONSTRAINT FK_Assets_Exchange
        FOREIGN KEY (exchange_id)
        REFERENCES exchanges(exchange_id),

    CONSTRAINT CK_Asset_Type
        CHECK (
            asset_type IN
            (
                'Stock',
                'Bond',
                'Mutual Fund',
                'ETF'
            )
        ),

    CONSTRAINT CK_Asset_Status
        CHECK (
            status IN
            (
                'Active',
                'Suspended',
                'Delisted'
            )
        ),

    CONSTRAINT CK_Face_Value
        CHECK (
            face_value >= 0
        ),

    CONSTRAINT CK_Market_Cap
        CHECK (
            market_cap IS NULL
            OR market_cap >= 0
        ),

    CONSTRAINT CK_Dividend_Yield
        CHECK (
            dividend_yield IS NULL
            OR dividend_yield BETWEEN 0 AND 100
        ),

    CONSTRAINT CK_Expense_Ratio
        CHECK (
            expense_ratio IS NULL
            OR expense_ratio BETWEEN 0 AND 100
        ),

    CONSTRAINT CK_Coupon_Rate
        CHECK (
            coupon_rate IS NULL
            OR coupon_rate BETWEEN 0 AND 100
        )
);
GO

CREATE INDEX IX_Assets_Exchange
ON assets(exchange_id);
GO

CREATE INDEX IX_Assets_Type
ON assets(asset_type);
GO

CREATE INDEX IX_Assets_Sector
ON assets(sector);
GO

CREATE INDEX IX_Assets_Industry
ON assets(industry);
GO

CREATE INDEX IX_Assets_Status
ON assets(status);
GO

CREATE INDEX IX_Assets_Currency
ON assets(currency);
GO

/*==============================================================*/
/* TABLE: portfolios                                             */
/*==============================================================*/

CREATE TABLE portfolios (
    portfolio_id INT IDENTITY(1,1) PRIMARY KEY,

    client_id INT NOT NULL,

    account_id INT NOT NULL,

    portfolio_code NVARCHAR(25) NOT NULL UNIQUE,

    portfolio_name NVARCHAR(150) NOT NULL,

    portfolio_type NVARCHAR(50) NOT NULL,

    investment_objective NVARCHAR(200) NOT NULL,

    base_currency NVARCHAR(10) NOT NULL,

    inception_date DATE NOT NULL,

    total_invested_amount DECIMAL(18,2) NOT NULL DEFAULT 0,

    current_market_value DECIMAL(18,2) NOT NULL DEFAULT 0,

    unrealized_profit_loss DECIMAL(18,2) NOT NULL DEFAULT 0,

    realized_profit_loss DECIMAL(18,2) NOT NULL DEFAULT 0,

    annual_management_fee DECIMAL(5,2) NOT NULL DEFAULT 0,

    benchmark_index NVARCHAR(100) NULL,

    portfolio_status NVARCHAR(20) NOT NULL DEFAULT 'Active',

    created_at DATETIME2 NOT NULL DEFAULT SYSDATETIME(),

    updated_at DATETIME2 NOT NULL DEFAULT SYSDATETIME(),

    CONSTRAINT FK_Portfolio_Client
        FOREIGN KEY (client_id)
        REFERENCES clients(client_id),

    CONSTRAINT FK_Portfolio_Account
        FOREIGN KEY (account_id)
        REFERENCES accounts(account_id),

    CONSTRAINT CK_Portfolio_Type
        CHECK (
            portfolio_type IN
            (
                'Growth',
                'Income',
                'Balanced',
                'Retirement',
                'Tax Saving',
                'Custom'
            )
        ),

    CONSTRAINT CK_Portfolio_Status
        CHECK (
            portfolio_status IN
            (
                'Active',
                'Inactive',
                'Closed'
            )
        ),

    CONSTRAINT CK_Portfolio_Investment
        CHECK (total_invested_amount >= 0),

    CONSTRAINT CK_Portfolio_Market_Value
        CHECK (current_market_value >= 0),

    CONSTRAINT CK_Portfolio_Fee
        CHECK (annual_management_fee BETWEEN 0 AND 100)
);
GO

CREATE INDEX IX_Portfolios_Client
ON portfolios(client_id);
GO

CREATE INDEX IX_Portfolios_Account
ON portfolios(account_id);
GO

CREATE INDEX IX_Portfolios_Status
ON portfolios(portfolio_status);
GO

CREATE INDEX IX_Portfolios_Type
ON portfolios(portfolio_type);
GO

CREATE INDEX IX_Portfolios_Value
ON portfolios(current_market_value);
GO

/*==============================================================*/
/* TABLE: market_prices                                          */
/*==============================================================*/

CREATE TABLE market_prices (
    market_price_id BIGINT IDENTITY(1,1) PRIMARY KEY,

    asset_id INT NOT NULL,

    price_date DATE NOT NULL,

    opening_price DECIMAL(18,4) NOT NULL,

    highest_price DECIMAL(18,4) NOT NULL,

    lowest_price DECIMAL(18,4) NOT NULL,

    closing_price DECIMAL(18,4) NOT NULL,

    adjusted_close_price DECIMAL(18,4) NULL,

    volume BIGINT NOT NULL,

    market_cap DECIMAL(20,2) NULL,

    pe_ratio DECIMAL(10,2) NULL,

    dividend_yield DECIMAL(8,2) NULL,

    created_at DATETIME2 NOT NULL DEFAULT SYSDATETIME(),

    CONSTRAINT FK_MarketPrice_Asset
        FOREIGN KEY (asset_id)
        REFERENCES assets(asset_id),

    CONSTRAINT UQ_MarketPrice
        UNIQUE(asset_id, price_date),

    CONSTRAINT CK_OpenPrice
        CHECK (opening_price >= 0),

    CONSTRAINT CK_HighPrice
        CHECK (highest_price >= opening_price),

    CONSTRAINT CK_LowPrice
        CHECK (lowest_price >= 0),

    CONSTRAINT CK_ClosePrice
        CHECK (closing_price >= 0),

    CONSTRAINT CK_Volume
        CHECK (volume >= 0)
);
GO

CREATE INDEX IX_MarketPrices_Asset
ON market_prices(asset_id);
GO

CREATE INDEX IX_MarketPrices_Date
ON market_prices(price_date);
GO

CREATE INDEX IX_MarketPrices_Asset_Date
ON market_prices(asset_id, price_date DESC);
GO

CREATE INDEX IX_MarketPrices_ClosePrice
ON market_prices(closing_price);
GO

CREATE INDEX IX_MarketPrices_Volume
ON market_prices(volume);
GO

/*==============================================================*/
/* TABLE: buy_sell_orders                                        */
/*==============================================================*/

CREATE TABLE buy_sell_orders (
    order_id BIGINT IDENTITY(1,1) PRIMARY KEY,

    portfolio_id INT NOT NULL,
    account_id INT NOT NULL,
    asset_id INT NOT NULL,

    order_number NVARCHAR(30) NOT NULL UNIQUE,

    order_type NVARCHAR(10) NOT NULL,

    order_category NVARCHAR(20) NOT NULL,

    quantity DECIMAL(18,4) NOT NULL,

    requested_price DECIMAL(18,4) NOT NULL,

    total_order_value DECIMAL(18,2) NOT NULL,

    stop_loss_price DECIMAL(18,4) NULL,

    target_price DECIMAL(18,4) NULL,

    order_status NVARCHAR(20) NOT NULL,

    placed_at DATETIME2 NOT NULL,

    expiry_date DATETIME2 NULL,

    remarks NVARCHAR(300) NULL,

    created_at DATETIME2 NOT NULL DEFAULT SYSDATETIME(),

    CONSTRAINT FK_Order_Portfolio
        FOREIGN KEY (portfolio_id)
        REFERENCES portfolios(portfolio_id),

    CONSTRAINT FK_Order_Account
        FOREIGN KEY (account_id)
        REFERENCES accounts(account_id),

    CONSTRAINT FK_Order_Asset
        FOREIGN KEY (asset_id)
        REFERENCES assets(asset_id),

    CONSTRAINT CK_Order_Type
        CHECK (
            order_type IN
            (
                'Buy',
                'Sell'
            )
        ),

    CONSTRAINT CK_Order_Category
        CHECK (
            order_category IN
            (
                'Market',
                'Limit',
                'Stop Loss',
                'Stop Limit'
            )
        ),

    CONSTRAINT CK_Order_Status
        CHECK (
            order_status IN
            (
                'Pending',
                'Executed',
                'Cancelled',
                'Rejected',
                'Expired'
            )
        ),

    CONSTRAINT CK_Order_Quantity
        CHECK (quantity > 0),

    CONSTRAINT CK_Order_Price
        CHECK (requested_price >= 0)
);
GO

CREATE INDEX IX_Order_Portfolio
ON buy_sell_orders(portfolio_id);
GO

CREATE INDEX IX_Order_Account
ON buy_sell_orders(account_id);
GO

CREATE INDEX IX_Order_Asset
ON buy_sell_orders(asset_id);
GO

CREATE INDEX IX_Order_Status
ON buy_sell_orders(order_status);
GO

CREATE INDEX IX_Order_PlacedAt
ON buy_sell_orders(placed_at);
GO

/*==============================================================*/
/* TABLE: executed_trades                                        */
/*==============================================================*/

CREATE TABLE executed_trades (
    trade_id BIGINT IDENTITY(1,1) PRIMARY KEY,

    order_id BIGINT NOT NULL,

    asset_id INT NOT NULL,

    portfolio_id INT NOT NULL,

    trade_number NVARCHAR(30) NOT NULL UNIQUE,

    executed_quantity DECIMAL(18,4) NOT NULL,

    executed_price DECIMAL(18,4) NOT NULL,

    gross_amount DECIMAL(18,2) NOT NULL,

    brokerage_amount DECIMAL(18,2) NOT NULL DEFAULT 0,

    tax_amount DECIMAL(18,2) NOT NULL DEFAULT 0,

    net_amount DECIMAL(18,2) NOT NULL,

    execution_time DATETIME2 NOT NULL,

    settlement_date DATE NOT NULL,

    settlement_status NVARCHAR(20) NOT NULL,

    exchange_trade_reference NVARCHAR(50) NULL,

    created_at DATETIME2 NOT NULL DEFAULT SYSDATETIME(),

    CONSTRAINT FK_Trade_Order
        FOREIGN KEY (order_id)
        REFERENCES buy_sell_orders(order_id),

    CONSTRAINT FK_Trade_Asset
        FOREIGN KEY (asset_id)
        REFERENCES assets(asset_id),

    CONSTRAINT FK_Trade_Portfolio
        FOREIGN KEY (portfolio_id)
        REFERENCES portfolios(portfolio_id),

    CONSTRAINT CK_Trade_Qty
        CHECK (executed_quantity > 0),

    CONSTRAINT CK_Trade_Price
        CHECK (executed_price >= 0),

    CONSTRAINT CK_Trade_Status
        CHECK (
            settlement_status IN
            (
                'Pending',
                'Settled',
                'Failed'
            )
        )
);
GO

CREATE INDEX IX_Trade_Order
ON executed_trades(order_id);
GO

CREATE INDEX IX_Trade_Asset
ON executed_trades(asset_id);
GO

CREATE INDEX IX_Trade_Portfolio
ON executed_trades(portfolio_id);
GO

CREATE INDEX IX_Trade_Date
ON executed_trades(execution_time);
GO

CREATE INDEX IX_Trade_Status
ON executed_trades(settlement_status);
GO

/*==============================================================*/
/* TABLE: portfolio_holdings                                    */
/*==============================================================*/

CREATE TABLE portfolio_holdings (
    holding_id BIGINT IDENTITY(1,1) PRIMARY KEY,

    portfolio_id INT NOT NULL,
    asset_id INT NOT NULL,

    quantity DECIMAL(18,4) NOT NULL,

    average_buy_price DECIMAL(18,4) NOT NULL,

    current_market_price DECIMAL(18,4) NOT NULL,

    total_cost DECIMAL(18,2) NOT NULL,

    current_market_value DECIMAL(18,2) NOT NULL,

    unrealized_profit_loss DECIMAL(18,2) NOT NULL,

    realized_profit_loss DECIMAL(18,2) NOT NULL DEFAULT 0,

    first_purchase_date DATE NOT NULL,

    last_purchase_date DATE NOT NULL,

    last_updated DATETIME2 NOT NULL DEFAULT SYSDATETIME(),

    CONSTRAINT FK_Holding_Portfolio
        FOREIGN KEY (portfolio_id)
        REFERENCES portfolios(portfolio_id),

    CONSTRAINT FK_Holding_Asset
        FOREIGN KEY (asset_id)
        REFERENCES assets(asset_id),

    CONSTRAINT UQ_Portfolio_Asset
        UNIQUE(portfolio_id, asset_id),

    CONSTRAINT CK_Holding_Quantity
        CHECK (quantity >= 0),

    CONSTRAINT CK_Holding_AvgPrice
        CHECK (average_buy_price >= 0),

    CONSTRAINT CK_Holding_CurrentPrice
        CHECK (current_market_price >= 0),

    CONSTRAINT CK_Holding_TotalCost
        CHECK (total_cost >= 0),

    CONSTRAINT CK_Holding_CurrentValue
        CHECK (current_market_value >= 0)
);
GO

CREATE INDEX IX_Holding_Portfolio
ON portfolio_holdings(portfolio_id);
GO

CREATE INDEX IX_Holding_Asset
ON portfolio_holdings(asset_id);
GO

CREATE INDEX IX_Holding_Portfolio_Asset
ON portfolio_holdings(portfolio_id, asset_id);
GO

/*==============================================================*/
/* TABLE: transactions                                           */
/*==============================================================*/

CREATE TABLE transactions (
    transaction_id BIGINT IDENTITY(1,1) PRIMARY KEY,

    account_id INT NOT NULL,

    portfolio_id INT NULL,

    trade_id BIGINT NULL,

    transaction_reference NVARCHAR(40) NOT NULL UNIQUE,

    transaction_type NVARCHAR(30) NOT NULL,

    payment_method NVARCHAR(30) NOT NULL,

    amount DECIMAL(18,2) NOT NULL,

    currency NVARCHAR(10) NOT NULL,

    transaction_date DATETIME2 NOT NULL,

    description NVARCHAR(300) NULL,

    status NVARCHAR(20) NOT NULL,

    created_at DATETIME2 NOT NULL DEFAULT SYSDATETIME(),

    CONSTRAINT FK_Transaction_Account
        FOREIGN KEY (account_id)
        REFERENCES accounts(account_id),

    CONSTRAINT FK_Transaction_Portfolio
        FOREIGN KEY (portfolio_id)
        REFERENCES portfolios(portfolio_id),

    CONSTRAINT FK_Transaction_Trade
        FOREIGN KEY (trade_id)
        REFERENCES executed_trades(trade_id),

    CONSTRAINT CK_Transaction_Type
        CHECK (
            transaction_type IN
            (
                'Deposit',
                'Withdrawal',
                'Buy',
                'Sell',
                'Dividend',
                'Interest',
                'Fee',
                'Tax',
                'Transfer'
            )
        ),

    CONSTRAINT CK_Transaction_Status
        CHECK (
            status IN
            (
                'Pending',
                'Completed',
                'Failed',
                'Cancelled'
            )
        ),

    CONSTRAINT CK_Transaction_Amount
        CHECK (amount >= 0)
);
GO

CREATE INDEX IX_Transaction_Account
ON transactions(account_id);
GO

CREATE INDEX IX_Transaction_Portfolio
ON transactions(portfolio_id);
GO

CREATE INDEX IX_Transaction_Trade
ON transactions(trade_id);
GO

CREATE INDEX IX_Transaction_Date
ON transactions(transaction_date);
GO

CREATE INDEX IX_Transaction_Type
ON transactions(transaction_type);
GO

CREATE INDEX IX_Transaction_Status
ON transactions(status);
GO

/*==============================================================*/
/* TABLE: fees                                                   */
/*==============================================================*/

CREATE TABLE fees (
    fee_id BIGINT IDENTITY(1,1) PRIMARY KEY,

    transaction_id BIGINT NOT NULL,

    portfolio_id INT NOT NULL,

    fee_type NVARCHAR(50) NOT NULL,

    fee_amount DECIMAL(18,2) NOT NULL,

    fee_percentage DECIMAL(8,4) NULL,

    fee_currency NVARCHAR(10) NOT NULL,

    charged_date DATETIME2 NOT NULL,

    billing_period_start DATE NULL,

    billing_period_end DATE NULL,

    description NVARCHAR(300) NULL,

    status NVARCHAR(20) NOT NULL DEFAULT 'Charged',

    created_at DATETIME2 NOT NULL DEFAULT SYSDATETIME(),

    CONSTRAINT FK_Fees_Transaction
        FOREIGN KEY (transaction_id)
        REFERENCES transactions(transaction_id),

    CONSTRAINT FK_Fees_Portfolio
        FOREIGN KEY (portfolio_id)
        REFERENCES portfolios(portfolio_id),

    CONSTRAINT CK_Fee_Type
        CHECK (
            fee_type IN
            (
                'Brokerage',
                'Management',
                'Advisory',
                'Custodian',
                'Transaction',
                'Annual Maintenance',
                'Platform',
                'Other'
            )
        ),

    CONSTRAINT CK_Fee_Status
        CHECK (
            status IN
            (
                'Charged',
                'Waived',
                'Refunded'
            )
        ),

    CONSTRAINT CK_Fee_Amount
        CHECK (fee_amount >= 0),

    CONSTRAINT CK_Fee_Percentage
        CHECK (
            fee_percentage IS NULL
            OR fee_percentage BETWEEN 0 AND 100
        )
);
GO

CREATE INDEX IX_Fees_Transaction
ON fees(transaction_id);
GO

CREATE INDEX IX_Fees_Portfolio
ON fees(portfolio_id);
GO

CREATE INDEX IX_Fees_Type
ON fees(fee_type);
GO

CREATE INDEX IX_Fees_Date
ON fees(charged_date);
GO

/*==============================================================*/
/* TABLE: dividends                                              */
/*==============================================================*/

CREATE TABLE dividends (
    dividend_id BIGINT IDENTITY(1,1) PRIMARY KEY,

    asset_id INT NOT NULL,

    portfolio_id INT NOT NULL,

    transaction_id BIGINT NOT NULL,

    dividend_per_unit DECIMAL(18,4) NOT NULL,

    eligible_quantity DECIMAL(18,4) NOT NULL,

    gross_dividend DECIMAL(18,2) NOT NULL,

    withholding_tax DECIMAL(18,2) NOT NULL DEFAULT 0,

    net_dividend DECIMAL(18,2) NOT NULL,

    declaration_date DATE NOT NULL,

    record_date DATE NOT NULL,

    payment_date DATE NOT NULL,

    dividend_type NVARCHAR(30) NOT NULL,

    status NVARCHAR(20) NOT NULL DEFAULT 'Paid',

    remarks NVARCHAR(300) NULL,

    created_at DATETIME2 NOT NULL DEFAULT SYSDATETIME(),

    CONSTRAINT FK_Dividend_Asset
        FOREIGN KEY (asset_id)
        REFERENCES assets(asset_id),

    CONSTRAINT FK_Dividend_Portfolio
        FOREIGN KEY (portfolio_id)
        REFERENCES portfolios(portfolio_id),

    CONSTRAINT FK_Dividend_Transaction
        FOREIGN KEY (transaction_id)
        REFERENCES transactions(transaction_id),

    CONSTRAINT CK_Dividend_Type
        CHECK (
            dividend_type IN
            (
                'Cash',
                'Stock',
                'Special'
            )
        ),

    CONSTRAINT CK_Dividend_Status
        CHECK (
            status IN
            (
                'Declared',
                'Paid',
                'Cancelled'
            )
        ),

    CONSTRAINT CK_Dividend_Amount
        CHECK (
            gross_dividend >= 0
            AND net_dividend >= 0
        )
);
GO

CREATE INDEX IX_Dividend_Asset
ON dividends(asset_id);
GO

CREATE INDEX IX_Dividend_Portfolio
ON dividends(portfolio_id);
GO

CREATE INDEX IX_Dividend_Transaction
ON dividends(transaction_id);
GO

CREATE INDEX IX_Dividend_PaymentDate
ON dividends(payment_date);
GO

/*==============================================================*/
/* TABLE: interest_payments                                     */
/*==============================================================*/

CREATE TABLE interest_payments (
    interest_payment_id BIGINT IDENTITY(1,1) PRIMARY KEY,

    asset_id INT NOT NULL,

    portfolio_id INT NOT NULL,

    transaction_id BIGINT NOT NULL,

    interest_rate DECIMAL(8,4) NOT NULL,

    principal_amount DECIMAL(18,2) NOT NULL,

    gross_interest DECIMAL(18,2) NOT NULL,

    tax_deducted DECIMAL(18,2) NOT NULL DEFAULT 0,

    net_interest DECIMAL(18,2) NOT NULL,

    accrual_start_date DATE NOT NULL,

    accrual_end_date DATE NOT NULL,

    payment_date DATE NOT NULL,

    payment_frequency NVARCHAR(20) NOT NULL,

    status NVARCHAR(20) NOT NULL DEFAULT 'Paid',

    remarks NVARCHAR(300) NULL,

    created_at DATETIME2 NOT NULL DEFAULT SYSDATETIME(),

    CONSTRAINT FK_Interest_Asset
        FOREIGN KEY (asset_id)
        REFERENCES assets(asset_id),

    CONSTRAINT FK_Interest_Portfolio
        FOREIGN KEY (portfolio_id)
        REFERENCES portfolios(portfolio_id),

    CONSTRAINT FK_Interest_Transaction
        FOREIGN KEY (transaction_id)
        REFERENCES transactions(transaction_id),

    CONSTRAINT CK_Interest_Frequency
        CHECK (
            payment_frequency IN
            (
                'Monthly',
                'Quarterly',
                'Semi Annual',
                'Annual',
                'At Maturity'
            )
        ),

    CONSTRAINT CK_Interest_Status
        CHECK (
            status IN
            (
                'Pending',
                'Paid',
                'Cancelled'
            )
        ),

    CONSTRAINT CK_Interest_Rate
        CHECK (interest_rate BETWEEN 0 AND 100),

    CONSTRAINT CK_Interest_Principal
        CHECK (principal_amount >= 0)
);
GO

CREATE INDEX IX_Interest_Asset
ON interest_payments(asset_id);
GO

CREATE INDEX IX_Interest_Portfolio
ON interest_payments(portfolio_id);
GO

CREATE INDEX IX_Interest_Transaction
ON interest_payments(transaction_id);
GO

CREATE INDEX IX_Interest_PaymentDate
ON interest_payments(payment_date);
GO

/*==============================================================*/
/* TABLE: tax_records                                            */
/*==============================================================*/

CREATE TABLE tax_records (
    tax_record_id BIGINT IDENTITY(1,1) PRIMARY KEY,

    transaction_id BIGINT NOT NULL,

    portfolio_id INT NOT NULL,

    asset_id INT NULL,

    tax_year SMALLINT NOT NULL,

    tax_type NVARCHAR(50) NOT NULL,

    taxable_amount DECIMAL(18,2) NOT NULL,

    tax_rate DECIMAL(8,4) NOT NULL,

    tax_amount DECIMAL(18,2) NOT NULL,

    tax_paid_date DATE NULL,

    filing_status NVARCHAR(20) NOT NULL,

    tax_authority NVARCHAR(150) NOT NULL,

    reference_number NVARCHAR(50) NULL,

    remarks NVARCHAR(300) NULL,

    created_at DATETIME2 NOT NULL DEFAULT SYSDATETIME(),

    CONSTRAINT FK_Tax_Transaction
        FOREIGN KEY (transaction_id)
        REFERENCES transactions(transaction_id),

    CONSTRAINT FK_Tax_Portfolio
        FOREIGN KEY (portfolio_id)
        REFERENCES portfolios(portfolio_id),

    CONSTRAINT FK_Tax_Asset
        FOREIGN KEY (asset_id)
        REFERENCES assets(asset_id),

    CONSTRAINT CK_Tax_Type
        CHECK (
            tax_type IN
            (
                'Capital Gain',
                'Dividend',
                'Interest',
                'Transaction Tax',
                'Withholding Tax',
                'Other'
            )
        ),

    CONSTRAINT CK_Tax_Status
        CHECK (
            filing_status IN
            (
                'Pending',
                'Filed',
                'Paid',
                'Overdue'
            )
        ),

    CONSTRAINT CK_Tax_Rate
        CHECK (tax_rate BETWEEN 0 AND 100),

    CONSTRAINT CK_Tax_Amount
        CHECK (
            taxable_amount >= 0
            AND tax_amount >= 0
        )
);
GO

CREATE INDEX IX_Tax_Transaction
ON tax_records(transaction_id);
GO

CREATE INDEX IX_Tax_Portfolio
ON tax_records(portfolio_id);
GO

CREATE INDEX IX_Tax_Asset
ON tax_records(asset_id);
GO

CREATE INDEX IX_Tax_Year
ON tax_records(tax_year);
GO

CREATE INDEX IX_Tax_Type
ON tax_records(tax_type);
GO

CREATE INDEX IX_Tax_Status
ON tax_records(filing_status);
GO

/*==============================================================*/
/* TABLE: watchlists                                             */
/*==============================================================*/

CREATE TABLE watchlists (
    watchlist_id INT IDENTITY(1,1) PRIMARY KEY,

    client_id INT NOT NULL,

    watchlist_name NVARCHAR(100) NOT NULL,

    description NVARCHAR(300) NULL,

    is_default BIT NOT NULL DEFAULT 0,

    display_order INT NOT NULL DEFAULT 1,

    total_assets INT NOT NULL DEFAULT 0,

    last_viewed_at DATETIME2 NULL,

    status NVARCHAR(20) NOT NULL DEFAULT 'Active',

    created_at DATETIME2 NOT NULL DEFAULT SYSDATETIME(),

    updated_at DATETIME2 NOT NULL DEFAULT SYSDATETIME(),

    CONSTRAINT FK_Watchlist_Client
        FOREIGN KEY (client_id)
        REFERENCES clients(client_id),

    CONSTRAINT CK_Watchlist_Status
        CHECK (
            status IN
            (
                'Active',
                'Archived'
            )
        ),

    CONSTRAINT CK_Watchlist_DisplayOrder
        CHECK (display_order > 0),

    CONSTRAINT CK_Watchlist_TotalAssets
        CHECK (total_assets >= 0)
);
GO

CREATE INDEX IX_Watchlist_Client
ON watchlists(client_id);
GO

CREATE INDEX IX_Watchlist_Status
ON watchlists(status);
GO

CREATE INDEX IX_Watchlist_LastViewed
ON watchlists(last_viewed_at);
GO

/*==============================================================*/
/* TABLE: watchlist_items                                        */
/*==============================================================*/

CREATE TABLE watchlist_items (
    watchlist_item_id BIGINT IDENTITY(1,1) PRIMARY KEY,

    watchlist_id INT NOT NULL,

    asset_id INT NOT NULL,

    target_buy_price DECIMAL(18,4) NULL,

    target_sell_price DECIMAL(18,4) NULL,

    alert_enabled BIT NOT NULL DEFAULT 1,

    notes NVARCHAR(300) NULL,

    added_on DATETIME2 NOT NULL DEFAULT SYSDATETIME(),

    last_alert_sent DATETIME2 NULL,

    CONSTRAINT FK_WatchlistItems_Watchlist
        FOREIGN KEY (watchlist_id)
        REFERENCES watchlists(watchlist_id),

    CONSTRAINT FK_WatchlistItems_Asset
        FOREIGN KEY (asset_id)
        REFERENCES assets(asset_id),

    CONSTRAINT UQ_Watchlist_Asset
        UNIQUE (watchlist_id, asset_id),

    CONSTRAINT CK_TargetBuyPrice
        CHECK (
            target_buy_price IS NULL
            OR target_buy_price >= 0
        ),

    CONSTRAINT CK_TargetSellPrice
        CHECK (
            target_sell_price IS NULL
            OR target_sell_price >= 0
        )
);
GO

CREATE INDEX IX_WatchlistItems_Watchlist
ON watchlist_items(watchlist_id);
GO

CREATE INDEX IX_WatchlistItems_Asset
ON watchlist_items(asset_id);
GO

CREATE INDEX IX_WatchlistItems_AddedOn
ON watchlist_items(added_on);
GO

CREATE INDEX IX_WatchlistItems_LastAlert
ON watchlist_items(last_alert_sent);
GO

/*==============================================================*/
/* TABLE: notifications                                          */
/*==============================================================*/

CREATE TABLE notifications (
    notification_id BIGINT IDENTITY(1,1) PRIMARY KEY,

    client_id INT NOT NULL,

    account_id INT NULL,

    portfolio_id INT NULL,

    notification_type NVARCHAR(50) NOT NULL,

    notification_title NVARCHAR(200) NOT NULL,

    notification_message NVARCHAR(1000) NOT NULL,

    priority NVARCHAR(20) NOT NULL DEFAULT 'Medium',

    delivery_channel NVARCHAR(30) NOT NULL,

    is_read BIT NOT NULL DEFAULT 0,

    sent_at DATETIME2 NOT NULL,

    read_at DATETIME2 NULL,

    expiry_date DATETIME2 NULL,

    created_at DATETIME2 NOT NULL DEFAULT SYSDATETIME(),

    CONSTRAINT FK_Notification_Client
        FOREIGN KEY (client_id)
        REFERENCES clients(client_id),

    CONSTRAINT FK_Notification_Account
        FOREIGN KEY (account_id)
        REFERENCES accounts(account_id),

    CONSTRAINT FK_Notification_Portfolio
        FOREIGN KEY (portfolio_id)
        REFERENCES portfolios(portfolio_id),

    CONSTRAINT CK_Notification_Type
        CHECK (
            notification_type IN
            (
                'Trade',
                'Dividend',
                'Interest',
                'Fee',
                'Tax',
                'KYC',
                'System',
                'Portfolio',
                'Price Alert'
            )
        ),

    CONSTRAINT CK_Notification_Priority
        CHECK (
            priority IN
            (
                'Low',
                'Medium',
                'High',
                'Critical'
            )
        ),

    CONSTRAINT CK_Notification_Channel
        CHECK (
            delivery_channel IN
            (
                'Email',
                'SMS',
                'Push',
                'In App'
            )
        )
);
GO

CREATE INDEX IX_Notification_Client
ON notifications(client_id);
GO

CREATE INDEX IX_Notification_Account
ON notifications(account_id);
GO

CREATE INDEX IX_Notification_Portfolio
ON notifications(portfolio_id);
GO

CREATE INDEX IX_Notification_Type
ON notifications(notification_type);
GO

CREATE INDEX IX_Notification_Read
ON notifications(is_read);
GO

/*==============================================================*/
/* TABLE: audit_logs                                             */
/*==============================================================*/

CREATE TABLE audit_logs (
    audit_log_id BIGINT IDENTITY(1,1) PRIMARY KEY,

    client_id INT NULL,

    account_id INT NULL,

    portfolio_id INT NULL,

    manager_id INT NULL,

    action_type NVARCHAR(100) NOT NULL,

    table_name NVARCHAR(100) NOT NULL,

    record_id BIGINT NOT NULL,

    old_value NVARCHAR(MAX) NULL,

    new_value NVARCHAR(MAX) NULL,

    ip_address NVARCHAR(50) NULL,

    device_info NVARCHAR(300) NULL,

    action_timestamp DATETIME2 NOT NULL DEFAULT SYSDATETIME(),

    CONSTRAINT FK_Audit_Client
        FOREIGN KEY (client_id)
        REFERENCES clients(client_id),

    CONSTRAINT FK_Audit_Account
        FOREIGN KEY (account_id)
        REFERENCES accounts(account_id),

    CONSTRAINT FK_Audit_Portfolio
        FOREIGN KEY (portfolio_id)
        REFERENCES portfolios(portfolio_id),

    CONSTRAINT FK_Audit_Manager
        FOREIGN KEY (manager_id)
        REFERENCES relationship_managers(manager_id)
);
GO

CREATE INDEX IX_Audit_Client
ON audit_logs(client_id);
GO

CREATE INDEX IX_Audit_Account
ON audit_logs(account_id);
GO

CREATE INDEX IX_Audit_Portfolio
ON audit_logs(portfolio_id);
GO

CREATE INDEX IX_Audit_Manager
ON audit_logs(manager_id);
GO

CREATE INDEX IX_Audit_Table
ON audit_logs(table_name);
GO

CREATE INDEX IX_Audit_Action
ON audit_logs(action_type);
GO

CREATE INDEX IX_Audit_Time
ON audit_logs(action_timestamp);
GO

/*==============================================================*/
/* TABLE: account_statements                                     */
/*==============================================================*/

CREATE TABLE account_statements (
    statement_id BIGINT IDENTITY(1,1) PRIMARY KEY,

    account_id INT NOT NULL,

    statement_number NVARCHAR(30) NOT NULL UNIQUE,

    statement_period_start DATE NOT NULL,

    statement_period_end DATE NOT NULL,

    opening_balance DECIMAL(18,2) NOT NULL,

    total_deposits DECIMAL(18,2) NOT NULL DEFAULT 0,

    total_withdrawals DECIMAL(18,2) NOT NULL DEFAULT 0,

    total_trade_amount DECIMAL(18,2) NOT NULL DEFAULT 0,

    total_fees DECIMAL(18,2) NOT NULL DEFAULT 0,

    total_dividends DECIMAL(18,2) NOT NULL DEFAULT 0,

    total_interest DECIMAL(18,2) NOT NULL DEFAULT 0,

    total_taxes DECIMAL(18,2) NOT NULL DEFAULT 0,

    closing_balance DECIMAL(18,2) NOT NULL,

    generated_on DATETIME2 NOT NULL DEFAULT SYSDATETIME(),

    generated_by NVARCHAR(100) NOT NULL,

    statement_status NVARCHAR(20) NOT NULL DEFAULT 'Generated',

    remarks NVARCHAR(500) NULL,

    CONSTRAINT FK_Statement_Account
        FOREIGN KEY (account_id)
        REFERENCES accounts(account_id),

    CONSTRAINT CK_Statement_Status
        CHECK (
            statement_status IN
            (
                'Generated',
                'Sent',
                'Downloaded',
                'Archived'
            )
        ),

    CONSTRAINT CK_Statement_Period
        CHECK (
            statement_period_end >= statement_period_start
        )
);
GO

CREATE INDEX IX_Statement_Account
ON account_statements(account_id);
GO

CREATE INDEX IX_Statement_Period
ON account_statements(statement_period_start, statement_period_end);
GO

CREATE INDEX IX_Statement_Status
ON account_statements(statement_status);
GO

CREATE INDEX IX_Statement_GeneratedOn
ON account_statements(generated_on);
GO

/*==============================================================*/
/* TABLE: portfolio_performance                                  */
/*==============================================================*/

CREATE TABLE portfolio_performance (
    performance_id BIGINT IDENTITY(1,1) PRIMARY KEY,

    portfolio_id INT NOT NULL,

    performance_date DATE NOT NULL,

    invested_amount DECIMAL(18,2) NOT NULL,

    market_value DECIMAL(18,2) NOT NULL,

    unrealized_profit_loss DECIMAL(18,2) NOT NULL,

    realized_profit_loss DECIMAL(18,2) NOT NULL,

    total_profit_loss DECIMAL(18,2) NOT NULL,

    daily_return_percent DECIMAL(8,4) NOT NULL,

    monthly_return_percent DECIMAL(8,4) NOT NULL,

    yearly_return_percent DECIMAL(8,4) NOT NULL,

    benchmark_return_percent DECIMAL(8,4) NULL,

    portfolio_beta DECIMAL(8,4) NULL,

    portfolio_alpha DECIMAL(8,4) NULL,

    sharpe_ratio DECIMAL(8,4) NULL,

    volatility DECIMAL(8,4) NULL,

    created_at DATETIME2 NOT NULL DEFAULT SYSDATETIME(),

    CONSTRAINT FK_Performance_Portfolio
        FOREIGN KEY (portfolio_id)
        REFERENCES portfolios(portfolio_id),

    CONSTRAINT UQ_Performance_Date
        UNIQUE(portfolio_id, performance_date)
);
GO

CREATE INDEX IX_Performance_Portfolio
ON portfolio_performance(portfolio_id);
GO

CREATE INDEX IX_Performance_Date
ON portfolio_performance(performance_date);
GO

CREATE INDEX IX_Performance_Portfolio_Date
ON portfolio_performance(portfolio_id, performance_date);
GO

CREATE INDEX IX_Performance_Return
ON portfolio_performance(yearly_return_percent);
GO

CREATE SCHEMA master_data;
GO

CREATE SCHEMA customer;
GO

CREATE SCHEMA portfolio;
GO

CREATE SCHEMA trading;
GO

CREATE SCHEMA finance;
GO

CREATE SCHEMA security;
GO 

/*==============================================================*/
/* MASTER DATA                                                   */
/*==============================================================*/

ALTER SCHEMA master_data TRANSFER dbo.branches;
GO

ALTER SCHEMA master_data TRANSFER dbo.exchanges;
GO

ALTER SCHEMA master_data TRANSFER dbo.assets;
GO

/*==============================================================*/
/* CUSTOMER                                                      */
/*==============================================================*/

ALTER SCHEMA customer TRANSFER dbo.relationship_managers;
GO

ALTER SCHEMA customer TRANSFER dbo.clients;
GO

ALTER SCHEMA customer TRANSFER dbo.accounts;
GO

ALTER SCHEMA customer TRANSFER dbo.kyc_records;
GO

ALTER SCHEMA customer TRANSFER dbo.risk_profiles;
GO

/*==============================================================*/
/* PORTFOLIO                                                     */
/*==============================================================*/

ALTER SCHEMA portfolio TRANSFER dbo.portfolios;
GO

ALTER SCHEMA portfolio TRANSFER dbo.portfolio_holdings;
GO

ALTER SCHEMA portfolio TRANSFER dbo.portfolio_performance;
GO

ALTER SCHEMA portfolio TRANSFER dbo.watchlists;
GO

ALTER SCHEMA portfolio TRANSFER dbo.watchlist_items;
GO

/*==============================================================*/
/* TRADING                                                       */
/*==============================================================*/

ALTER SCHEMA trading TRANSFER dbo.buy_sell_orders;
GO

ALTER SCHEMA trading TRANSFER dbo.executed_trades;
GO

ALTER SCHEMA trading TRANSFER dbo.market_prices;
GO

/*==============================================================*/
/* FINANCE                                                       */
/*==============================================================*/

ALTER SCHEMA finance TRANSFER dbo.transactions;
GO

ALTER SCHEMA finance TRANSFER dbo.fees;
GO

ALTER SCHEMA finance TRANSFER dbo.dividends;
GO

ALTER SCHEMA finance TRANSFER dbo.interest_payments;
GO

ALTER SCHEMA finance TRANSFER dbo.tax_records;
GO

ALTER SCHEMA finance TRANSFER dbo.account_statements;
GO

/*==============================================================*/
/* SECURITY                                                      */
/*==============================================================*/

ALTER SCHEMA security TRANSFER dbo.audit_logs;
GO

ALTER SCHEMA security TRANSFER dbo.notifications;
GO