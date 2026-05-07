CREATE DATABASE LPL_POC;

USE LPL_POC;

CREATE TABLE dbo.rep_master (
    rep_id          VARCHAR(20)     NOT NULL PRIMARY KEY,
    rep_nm          VARCHAR(100)    NOT NULL,
    rep_stts_cd     CHAR(2)         NOT NULL,
    ofc_cd          VARCHAR(20)     NULL,
    brn_cd          VARCHAR(20)     NULL,
    rgn_cd          VARCHAR(20)     NULL,
    affl_dt         DATE            NOT NULL,
    trm_dt          DATE            NULL,
    rep_typ_cd      CHAR(3)         NOT NULL,
    prdcr_cd        VARCHAR(20)     NULL,
    email_addr      VARCHAR(150)    NULL,
    crd_nbr         VARCHAR(20)     NULL,
    CONSTRAINT chk_rep_stts CHECK (rep_stts_cd IN ('AC','IA','SU','TR'))
);

CREATE TABLE dbo.office_master (
    ofc_cd          VARCHAR(20)     NOT NULL PRIMARY KEY,
    ofc_nm          VARCHAR(150)    NOT NULL,
    ofc_stts_cd     CHAR(2)         NOT NULL,
    ofc_typ_cd      CHAR(3)         NULL,
    st_cd           CHAR(2)         NULL,
    city_nm         VARCHAR(100)    NULL,
    zip_cd          VARCHAR(10)     NULL,
    osj_flg         CHAR(1)         NOT NULL DEFAULT 'N',
    rgn_cd          VARCHAR(20)     NULL
);

CREATE TABLE dbo.client_master (
    clnt_id         VARCHAR(20)     NOT NULL PRIMARY KEY,
    clnt_nm         VARCHAR(150)    NOT NULL,
    clnt_typ_cd     CHAR(3)         NOT NULL,
    stts_cd         CHAR(2)         NOT NULL,
    st_cd           CHAR(2)         NULL,
    zip_cd          VARCHAR(10)     NULL,
    dob_dt          DATE            NULL,
    rel_dt          DATE            NOT NULL,
    net_wrth_cd     CHAR(3)         NULL,
    ann_inc_cd      CHAR(3)         NULL
);

CREATE TABLE dbo.acct_master (
    acct_id         VARCHAR(20)     NOT NULL PRIMARY KEY,
    acct_nm         VARCHAR(150)    NOT NULL,
    acct_typ_cd     CHAR(4)         NOT NULL,
    acct_stts_cd    CHAR(2)         NOT NULL,
    rep_id          VARCHAR(20)     NOT NULL,
    clnt_id         VARCHAR(20)     NOT NULL,
    opn_dt          DATE            NOT NULL,
    cls_dt          DATE            NULL,
    rgstn_cd        VARCHAR(10)     NULL,
    trd_dt          DATE            NULL,
    inv_obj_cd      CHAR(3)         NULL,
    mgd_flg         CHAR(1)         NOT NULL DEFAULT 'N',
    CONSTRAINT fk_acct_rep  FOREIGN KEY (rep_id)  REFERENCES dbo.rep_master(rep_id),
    CONSTRAINT fk_acct_clnt FOREIGN KEY (clnt_id) REFERENCES dbo.client_master(clnt_id)
);

CREATE TABLE dbo.sec_master (
    sec_id          VARCHAR(20)     NOT NULL PRIMARY KEY,
    tckr_sym        VARCHAR(20)     NULL,
    sec_nm          VARCHAR(200)    NOT NULL,
    cusip           VARCHAR(9)      NULL,
    sec_typ_cd      CHAR(4)         NOT NULL,
    asst_cls_cd     CHAR(4)         NOT NULL,
    exch_cd         VARCHAR(10)     NULL,
    stts_cd         CHAR(2)         NOT NULL
);

CREATE TABLE dbo.aum_snap (
    snap_id         BIGINT          NOT NULL PRIMARY KEY,
    acct_id         VARCHAR(20)     NOT NULL,
    rep_id          VARCHAR(20)     NOT NULL,
    snap_dt         DATE            NOT NULL,
    aum_val         DECIMAL(18,2)   NOT NULL,
    mkt_val         DECIMAL(18,2)   NOT NULL,
    csh_val         DECIMAL(18,2)   NULL,
    unrlzd_gl       DECIMAL(18,2)   NULL,
    asst_allc_cd    CHAR(3)         NULL,
    CONSTRAINT fk_aum_acct FOREIGN KEY (acct_id) REFERENCES dbo.acct_master(acct_id),
    CONSTRAINT fk_aum_rep  FOREIGN KEY (rep_id)  REFERENCES dbo.rep_master(rep_id)
);

CREATE TABLE dbo.hldg_dtl (
    hldg_id         BIGINT          NOT NULL PRIMARY KEY,
    acct_id         VARCHAR(20)     NOT NULL,
    snap_dt         DATE            NOT NULL,
    sec_id          VARCHAR(20)     NOT NULL,
    qty_hld         DECIMAL(18,4)   NOT NULL,
    mkt_prc         DECIMAL(18,4)   NOT NULL,
    mkt_val         DECIMAL(18,2)   NOT NULL,
    cst_bss         DECIMAL(18,2)   NULL,
    unrlzd_gl       DECIMAL(18,2)   NULL,
    asst_cls_cd     CHAR(4)         NULL,
    CONSTRAINT fk_hldg_acct FOREIGN KEY (acct_id) REFERENCES dbo.acct_master(acct_id),
    CONSTRAINT fk_hldg_sec  FOREIGN KEY (sec_id)  REFERENCES dbo.sec_master(sec_id)
);

INSERT INTO dbo.office_master 
    (ofc_cd, ofc_nm, ofc_stts_cd, ofc_typ_cd, st_cd, city_nm, zip_cd, osj_flg, rgn_cd)
VALUES
    ('OFC001', 'Boston Financial Group',          'AC', 'OSJ', 'MA', 'Boston',       '02101', 'Y', 'NE'),
    ('OFC002', 'Manhattan Wealth Partners',        'AC', 'OSJ', 'NY', 'New York',     '10001', 'Y', 'NE'),
    ('OFC003', 'Hartford Advisory Group',          'AC', 'SOB', 'CT', 'Hartford',     '06101', 'N', 'NE'),
    ('OFC004', 'Atlanta Capital Advisors',         'AC', 'OSJ', 'GA', 'Atlanta',      '30301', 'Y', 'SE'),
    ('OFC005', 'Miami Wealth Management',          'AC', 'SOB', 'FL', 'Miami',        '33101', 'N', 'SE'),
    ('OFC006', 'Charlotte Financial Services',     'AC', 'OSJ', 'NC', 'Charlotte',    '28201', 'Y', 'SE'),
    ('OFC007', 'Chicago Investment Group',         'AC', 'OSJ', 'IL', 'Chicago',      '60601', 'Y', 'MW'),
    ('OFC008', 'Detroit Wealth Advisors',          'AC', 'SOB', 'MI', 'Detroit',      '48201', 'N', 'MW'),
    ('OFC009', 'Minneapolis Financial Partners',   'AC', 'OSJ', 'MN', 'Minneapolis',  '55401', 'Y', 'MW'),
    ('OFC010', 'Dallas Advisory Services',         'AC', 'OSJ', 'TX', 'Dallas',       '75201', 'Y', 'SW'),
    ('OFC011', 'Houston Wealth Group',             'AC', 'SOB', 'TX', 'Houston',      '77001', 'N', 'SW'),
    ('OFC012', 'Phoenix Capital Partners',         'AC', 'OSJ', 'AZ', 'Phoenix',      '85001', 'Y', 'SW'),
    ('OFC013', 'Los Angeles Wealth Management',    'AC', 'OSJ', 'CA', 'Los Angeles',  '90001', 'Y', 'WE'),
    ('OFC014', 'San Francisco Advisory Group',     'AC', 'OSJ', 'CA', 'San Francisco','94101', 'Y', 'WE'),
    ('OFC015', 'Seattle Financial Services',       'AC', 'SOB', 'WA', 'Seattle',      '98101', 'N', 'WE'),
    ('OFC016', 'Denver Investment Partners',       'AC', 'OSJ', 'CO', 'Denver',       '80201', 'Y', 'WE'),
    ('OFC017', 'Nashville Wealth Advisors',        'IA', 'SOB', 'TN', 'Nashville',    '37201', 'N', 'SE'),
    ('OFC018', 'Portland Financial Group',         'AC', 'SOB', 'OR', 'Portland',     '97201', 'N', 'WE'),
    ('OFC019', 'Philadelphia Capital Advisors',    'AC', 'OSJ', 'PA', 'Philadelphia', '19101', 'Y', 'NE'),
    ('OFC020', 'St Louis Advisory Services',       'AC', 'SOB', 'MO', 'St Louis',     '63101', 'N', 'MW');

INSERT INTO dbo.rep_master 
    (rep_id, rep_nm, rep_stts_cd, ofc_cd, brn_cd, rgn_cd, affl_dt, trm_dt, rep_typ_cd, prdcr_cd, email_addr, crd_nbr)
VALUES
    ('REP001', 'James Mitchell',      'AC', 'OFC001', 'BRN001', 'NE', '2015-03-15', NULL,         'IAR', 'PRD001', 'j.mitchell@lpl.com',    '1234561'),
    ('REP002', 'Sarah Chen',          'AC', 'OFC002', 'BRN002', 'NE', '2017-06-01', NULL,         'HYB', 'PRD002', 's.chen@lpl.com',         '1234562'),
    ('REP003', 'Robert Williams',     'AC', 'OFC003', 'BRN003', 'NE', '2014-09-20', NULL,         'BD',  'PRD003', 'r.williams@lpl.com',     '1234563'),
    ('REP004', 'Maria Garcia',        'AC', 'OFC004', 'BRN004', 'SE', '2018-01-10', NULL,         'IAR', 'PRD004', 'm.garcia@lpl.com',       '1234564'),
    ('REP005', 'David Thompson',      'AC', 'OFC005', 'BRN005', 'SE', '2016-11-05', NULL,         'HYB', 'PRD005', 'd.thompson@lpl.com',     '1234565'),
    ('REP006', 'Jennifer Adams',      'AC', 'OFC006', 'BRN006', 'SE', '2019-04-22', NULL,         'IAR', 'PRD006', 'j.adams@lpl.com',        '1234566'),
    ('REP007', 'Michael Brown',       'AC', 'OFC007', 'BRN007', 'MW', '2013-07-30', NULL,         'HYB', 'PRD007', 'm.brown@lpl.com',        '1234567'),
    ('REP008', 'Lisa Anderson',       'AC', 'OFC008', 'BRN008', 'MW', '2020-02-14', NULL,         'IAR', 'PRD008', 'l.anderson@lpl.com',     '1234568'),
    ('REP009', 'Christopher Lee',     'AC', 'OFC009', 'BRN009', 'MW', '2015-08-18', NULL,         'BD',  'PRD009', 'c.lee@lpl.com',          '1234569'),
    ('REP010', 'Amanda Wilson',       'AC', 'OFC010', 'BRN010', 'SW', '2017-03-25', NULL,         'IAR', 'PRD010', 'a.wilson@lpl.com',       '1234570'),
    ('REP011', 'Kevin Martinez',      'AC', 'OFC011', 'BRN011', 'SW', '2016-06-12', NULL,         'HYB', 'PRD011', 'k.martinez@lpl.com',     '1234571'),
    ('REP012', 'Rachel Taylor',       'AC', 'OFC012', 'BRN012', 'SW', '2018-10-08', NULL,         'IAR', 'PRD012', 'r.taylor@lpl.com',       '1234572'),
    ('REP013', 'Daniel Harris',       'AC', 'OFC013', 'BRN013', 'WE', '2012-05-14', NULL,         'HYB', 'PRD013', 'd.harris@lpl.com',       '1234573'),
    ('REP014', 'Michelle Clark',      'AC', 'OFC014', 'BRN014', 'WE', '2019-09-01', NULL,         'IAR', 'PRD014', 'm.clark@lpl.com',        '1234574'),
    ('REP015', 'Steven Rodriguez',    'AC', 'OFC015', 'BRN015', 'WE', '2021-01-20', NULL,         'BD',  'PRD015', 's.rodriguez@lpl.com',    '1234575'),
    ('REP016', 'Patricia Lewis',      'AC', 'OFC016', 'BRN016', 'WE', '2014-12-03', NULL,         'IAR', 'PRD016', 'p.lewis@lpl.com',        '1234576'),
    ('REP017', 'Thomas Walker',       'IA', 'OFC017', 'BRN017', 'SE', '2011-04-17', '2023-06-30', 'HYB', 'PRD017', 't.walker@lpl.com',       '1234577'),
    ('REP018', 'Nancy Hall',          'AC', 'OFC018', 'BRN018', 'WE', '2020-07-22', NULL,         'IAR', 'PRD018', 'n.hall@lpl.com',         '1234578'),
    ('REP019', 'Charles Young',       'AC', 'OFC019', 'BRN019', 'NE', '2016-02-28', NULL,         'BD',  'PRD019', 'c.young@lpl.com',        '1234579'),
    ('REP020', 'Barbara King',        'TR', 'OFC020', 'BRN020', 'MW', '2013-11-11', '2024-01-15', 'IAR', 'PRD020', 'b.king@lpl.com',         '1234580');


INSERT INTO dbo.client_master 
    (clnt_id, clnt_nm, clnt_typ_cd, stts_cd, st_cd, zip_cd, dob_dt, rel_dt, net_wrth_cd, ann_inc_cd)
VALUES
    ('CLT001', 'John & Mary Patterson',      'IND', 'AC', 'MA', '02134', '1965-04-12', '2015-04-01', 'D',  'C'),
    ('CLT002', 'Apex Holdings LLC',          'ENT', 'AC', 'NY', '10022', NULL,         '2017-07-15', 'D',  'D'),
    ('CLT003', 'Robert Simmons Trust',       'TR',  'AC', 'CT', '06110', NULL,         '2014-10-20', 'C',  'C'),
    ('CLT004', 'Elena Rodriguez',            'IND', 'AC', 'GA', '30309', '1978-08-25', '2018-02-10', 'B',  'B'),
    ('CLT005', 'William Nguyen',             'IND', 'AC', 'FL', '33139', '1952-11-30', '2016-12-01', 'D',  'C'),
    ('CLT006', 'Sunrise Family Trust',       'TR',  'AC', 'NC', '28202', NULL,         '2019-05-14', 'D',  'D'),
    ('CLT007', 'GreenPath Investments Inc',  'ENT', 'AC', 'IL', '60614', NULL,         '2013-08-22', 'D',  'D'),
    ('CLT008', 'Sandra Kowalski',            'IND', 'AC', 'MI', '48226', '1970-03-18', '2020-03-05', 'B',  'B'),
    ('CLT009', 'Franklin Estate',            'EST', 'AC', 'MN', '55403', NULL,         '2015-09-10', 'D',  'D'),
    ('CLT010', 'Carlos & Ana Mendez',        'IND', 'AC', 'TX', '75219', '1968-06-22', '2017-04-18', 'C',  'C'),
    ('CLT011', 'Horizon Capital Partners',   'ENT', 'AC', 'TX', '77002', NULL,         '2016-07-07', 'D',  'D'),
    ('CLT012', 'Dorothy Chandler',           'IND', 'AC', 'AZ', '85004', '1955-09-14', '2018-11-20', 'C',  'B'),
    ('CLT013', 'Pacific Rim Ventures LLC',   'ENT', 'AC', 'CA', '90012', NULL,         '2012-06-30', 'D',  'D'),
    ('CLT014', 'Grace & Thomas Whitfield',   'IND', 'AC', 'CA', '94102', '1972-01-05', '2019-10-01', 'C',  'C'),
    ('CLT015', 'Northwest Family Office',    'TR',  'AC', 'WA', '98102', NULL,         '2021-02-14', 'D',  'D'),
    ('CLT016', 'Victor Ashworth',            'IND', 'AC', 'CO', '80202', '1948-12-20', '2014-12-15', 'D',  'C'),
    ('CLT017', 'Harold Jenkins',             'IND', 'IA', 'TN', '37203', '1960-07-08', '2011-05-20', 'B',  'B'),
    ('CLT018', 'Cascade Wealth Trust',       'TR',  'AC', 'OR', '97204', NULL,         '2020-08-10', 'C',  'C'),
    ('CLT019', 'Benjamin & Claire Foster',   'IND', 'AC', 'PA', '19103', '1975-02-14', '2016-03-25', 'C',  'C'),
    ('CLT020', 'Midwest Advisory Group LLC', 'ENT', 'AC', 'MO', '63102', NULL,         '2013-12-01', 'D',  'D');


INSERT INTO dbo.acct_master 
    (acct_id, acct_nm, acct_typ_cd, acct_stts_cd, rep_id, clnt_id, opn_dt, cls_dt, rgstn_cd, trd_dt, inv_obj_cd, mgd_flg)
VALUES
    ('ACC001', 'Patterson Joint Brokerage',          'JTWT', 'AC', 'REP001', 'CLT001', '2015-04-01', NULL,         'JTWT', '2024-11-15', 'GRW', 'N'),
    ('ACC002', 'Patterson IRA',                      'IRA',  'AC', 'REP001', 'CLT001', '2015-04-01', NULL,         'IRA',  '2024-10-20', 'INC', 'Y'),
    ('ACC003', 'Apex Holdings Managed Account',      'MGAC', 'AC', 'REP002', 'CLT002', '2017-07-15', NULL,         'CORP', '2024-11-01', 'GRW', 'Y'),
    ('ACC004', 'Simmons Trust Brokerage',            'BROK', 'AC', 'REP003', 'CLT003', '2014-10-20', NULL,         'TR',   '2024-09-30', 'BAL', 'N'),
    ('ACC005', 'Rodriguez Individual Account',       'INDV', 'AC', 'REP004', 'CLT004', '2018-02-10', NULL,         'INDV', '2024-11-10', 'GRW', 'Y'),
    ('ACC006', 'Nguyen Roth IRA',                    'RIRA', 'AC', 'REP005', 'CLT005', '2016-12-01', NULL,         'RIRA', '2024-10-05', 'INC', 'N'),
    ('ACC007', 'Sunrise Trust Managed',              'MGAC', 'AC', 'REP006', 'CLT006', '2019-05-14', NULL,         'TR',   '2024-11-20', 'BAL', 'Y'),
    ('ACC008', 'GreenPath Corporate Brokerage',      'BROK', 'AC', 'REP007', 'CLT007', '2013-08-22', NULL,         'CORP', '2024-08-15', 'GRW', 'N'),
    ('ACC009', 'Kowalski Traditional IRA',           'IRA',  'AC', 'REP008', 'CLT008', '2020-03-05', NULL,         'IRA',  '2024-11-08', 'CPN', 'Y'),
    ('ACC010', 'Franklin Estate Account',            'BROK', 'AC', 'REP009', 'CLT009', '2015-09-10', NULL,         'EST',  '2024-07-22', 'INC', 'N'),
    ('ACC011', 'Mendez Joint Managed Account',       'MGAC', 'AC', 'REP010', 'CLT010', '2017-04-18', NULL,         'JTWT', '2024-11-15', 'BAL', 'Y'),
    ('ACC012', 'Horizon Capital Investment Account', 'BROK', 'AC', 'REP011', 'CLT011', '2016-07-07', NULL,         'CORP', '2024-10-30', 'GRW', 'N'),
    ('ACC013', 'Chandler Retirement Account',        'IRA',  'AC', 'REP012', 'CLT012', '2018-11-20', NULL,         'IRA',  '2024-09-12', 'CPN', 'Y'),
    ('ACC014', 'Pacific Rim Corporate Account',      'MGAC', 'AC', 'REP013', 'CLT013', '2012-06-30', NULL,         'CORP', '2024-11-18', 'GRW', 'Y'),
    ('ACC015', 'Whitfield Joint Brokerage',          'JTWT', 'AC', 'REP014', 'CLT014', '2019-10-01', NULL,         'JTWT', '2024-10-25', 'BAL', 'N'),
    ('ACC016', 'Northwest Family Office Account',    'MGAC', 'AC', 'REP015', 'CLT015', '2021-02-14', NULL,         'TR',   '2024-11-05', 'GRW', 'Y'),
    ('ACC017', 'Ashworth Individual Managed',        'MGAC', 'AC', 'REP016', 'CLT016', '2014-12-15', NULL,         'INDV', '2024-10-10', 'INC', 'Y'),
    ('ACC018', 'Jenkins Brokerage Account',          'BROK', 'CL', 'REP017', 'CLT017', '2011-05-20', '2023-06-30', 'INDV', NULL,         'BAL', 'N'),
    ('ACC019', 'Foster Joint Account',               'JTWT', 'AC', 'REP019', 'CLT019', '2016-03-25', NULL,         'JTWT', '2024-11-12', 'GRW', 'N'),
    ('ACC020', 'Midwest Advisory Corporate Managed', 'MGAC', 'AC', 'REP009', 'CLT020', '2013-12-01', NULL,         'CORP', '2024-11-20', 'GRW', 'Y');

INSERT INTO dbo.sec_master 
    (sec_id, tckr_sym, sec_nm, cusip, sec_typ_cd, asst_cls_cd, exch_cd, stts_cd)
VALUES
    ('SEC001', 'AAPL',  'Apple Inc',                             '037833100', 'STCK', 'EQTY', 'NASDAQ', 'AC'),
    ('SEC002', 'MSFT',  'Microsoft Corporation',                 '594918104', 'STCK', 'EQTY', 'NASDAQ', 'AC'),
    ('SEC003', 'SPY',   'SPDR S&P 500 ETF Trust',               '78462F103', 'ETFD', 'ETFD', 'NYSE',   'AC'),
    ('SEC004', 'BND',   'Vanguard Total Bond Market ETF',        '921937835', 'ETFD', 'FIXD', 'NASDAQ', 'AC'),
    ('SEC005', 'VWELX', 'Vanguard Wellington Fund',              '921945834', 'MFND', 'MFND', NULL,     'AC'),
    ('SEC006', 'AGG',   'iShares Core US Aggregate Bond ETF',   '464287226', 'ETFD', 'FIXD', 'NYSE',   'AC'),
    ('SEC007', 'GOOGL', 'Alphabet Inc Class A',                  '02079K305', 'STCK', 'EQTY', 'NASDAQ', 'AC'),
    ('SEC008', 'JNJ',   'Johnson & Johnson',                     '478160104', 'STCK', 'EQTY', 'NYSE',   'AC'),
    ('SEC009', 'VTI',   'Vanguard Total Stock Market ETF',       '922908769', 'ETFD', 'ETFD', 'NYSE',   'AC'),
    ('SEC010', 'PIMIX', 'PIMCO Income Fund Institutional',       '72201F589', 'MFND', 'FIXD', NULL,     'AC'),
    ('SEC011', 'AMZN',  'Amazon.com Inc',                        '023135106', 'STCK', 'EQTY', 'NASDAQ', 'AC'),
    ('SEC012', 'GLD',   'SPDR Gold Shares',                      '78463V107', 'ETFD', 'ALTR', 'NYSE',   'AC'),
    ('SEC013', 'JPST',  'JPMorgan Ultra-Short Income ETF',       '46641Q332', 'ETFD', 'FIXD', 'NYSE',   'AC'),
    ('SEC014', 'FXAIX', 'Fidelity 500 Index Fund',               '315911750', 'MFND', 'MFND', NULL,     'AC'),
    ('SEC015', 'V',     'Visa Inc Class A',                      '92826C839', 'STCK', 'EQTY', 'NYSE',   'AC'),
    ('SEC016', 'TLT',   'iShares 20+ Year Treasury Bond ETF',    '464287440', 'ETFD', 'FIXD', 'NASDAQ', 'AC'),
    ('SEC017', 'BRKA',  'Berkshire Hathaway Inc Class A',        '084670702', 'STCK', 'EQTY', 'NYSE',   'AC'),
    ('SEC018', 'VBTLX', 'Vanguard Total Bond Market Index Fund', '921937835', 'MFND', 'FIXD', NULL,     'AC'),
    ('SEC019', 'QQQ',   'Invesco QQQ Trust Series 1',            '46090E103', 'ETFD', 'ETFD', 'NASDAQ', 'AC'),
    ('SEC020', 'IVV',   'iShares Core S&P 500 ETF',              '464287251', 'ETFD', 'ETFD', 'NYSE',   'AC');

INSERT INTO dbo.aum_snap 
    (snap_id, acct_id, rep_id, snap_dt, aum_val, mkt_val, csh_val, unrlzd_gl, asst_allc_cd)
VALUES
    (1,  'ACC001', 'REP001', '2024-11-30',  1250000.00,  1220000.00,  30000.00,   185000.00,  'EQ'),
    (2,  'ACC002', 'REP001', '2024-11-30',  3400000.00,  3380000.00,  20000.00,   620000.00,  'FI'),
    (3,  'ACC003', 'REP002', '2024-11-30', 18500000.00, 18200000.00, 300000.00,  3200000.00,  'EQ'),
    (4,  'ACC004', 'REP003', '2024-11-30',  5200000.00,  5150000.00,  50000.00,   780000.00,  'BAL'),
    (5,  'ACC005', 'REP004', '2024-11-30',  2800000.00,  2750000.00,  50000.00,   430000.00,  'EQ'),
    (6,  'ACC006', 'REP005', '2024-11-30',   980000.00,   960000.00,  20000.00,    95000.00,  'FI'),
    (7,  'ACC007', 'REP006', '2024-11-30',  7600000.00,  7500000.00, 100000.00,  1150000.00,  'BAL'),
    (8,  'ACC008', 'REP007', '2024-11-30', 42000000.00, 41500000.00, 500000.00,  8500000.00,  'EQ'),
    (9,  'ACC009', 'REP008', '2024-11-30',  1100000.00,  1080000.00,  20000.00,    75000.00,  'FI'),
    (10, 'ACC010', 'REP009', '2024-11-30',  8900000.00,  8750000.00, 150000.00,  1200000.00,  'BAL'),
    (11, 'ACC011', 'REP010', '2024-11-30',  4300000.00,  4250000.00,  50000.00,   680000.00,  'BAL'),
    (12, 'ACC012', 'REP011', '2024-11-30', 22000000.00, 21800000.00, 200000.00,  4100000.00,  'EQ'),
    (13, 'ACC013', 'REP012', '2024-11-30',  1650000.00,  1620000.00,  30000.00,   120000.00,  'FI'),
    (14, 'ACC014', 'REP013', '2024-11-30', 95000000.00, 94000000.00,1000000.00, 22000000.00,  'EQ'),
    (15, 'ACC015', 'REP014', '2024-11-30',  3100000.00,  3050000.00,  50000.00,   420000.00,  'BAL'),
    (16, 'ACC016', 'REP015', '2024-11-30',  1800000.00,  1780000.00,  20000.00,   210000.00,  'EQ'),
    (17, 'ACC017', 'REP016', '2024-11-30', 12500000.00, 12300000.00, 200000.00,  2800000.00,  'FI'),
    (18, 'ACC019', 'REP019', '2024-11-30',  2200000.00,  2170000.00,  30000.00,   315000.00,  'EQ'),
    (19, 'ACC020', 'REP009', '2024-11-30', 31000000.00, 30500000.00, 500000.00,  5500000.00,  'EQ'),
    (20, 'ACC003', 'REP002', '2024-10-31', 17900000.00, 17600000.00, 300000.00,  2900000.00,  'EQ');


INSERT INTO dbo.aum_snap 
    (snap_id, acct_id, rep_id, snap_dt, aum_val, mkt_val, csh_val, unrlzd_gl, asst_allc_cd)
VALUES
    (21, 'ACC001', 'REP001', '2024-10-31',  1190000.00,  1165000.00,  25000.00,  165000.00, 'EQ'),
    (22, 'ACC002', 'REP001', '2024-10-31',  3250000.00,  3230000.00,  20000.00,  580000.00, 'FI'),
    (23, 'ACC008', 'REP007', '2024-10-31', 40100000.00, 39600000.00, 500000.00, 7800000.00, 'EQ'),
    (24, 'ACC014', 'REP013', '2024-10-31', 91000000.00, 90000000.00,1000000.00,20500000.00, 'EQ');
GO

INSERT INTO dbo.hldg_dtl 
    (hldg_id, acct_id, snap_dt, sec_id, qty_hld, mkt_prc, mkt_val, cst_bss, unrlzd_gl, asst_cls_cd)
VALUES
    (1,  'ACC001', '2024-11-30', 'SEC001',   500.0000,  229.87,  114935.00,   85000.00,  29935.00, 'EQTY'),
    (2,  'ACC001', '2024-11-30', 'SEC003',  2000.0000,  574.12, 1148240.00,  980000.00, 168240.00, 'ETFD'),
    (3,  'ACC002', '2024-11-30', 'SEC004',  8000.0000,   73.45,  587600.00,  560000.00,  27600.00, 'FIXD'),
    (4,  'ACC002', '2024-11-30', 'SEC010',  5000.0000,  100.12,  500600.00,  480000.00,  20600.00, 'FIXD'),
    (5,  'ACC003', '2024-11-30', 'SEC001',  5000.0000,  229.87, 1149350.00,  850000.00, 299350.00, 'EQTY'),
    (6,  'ACC003', '2024-11-30', 'SEC007',  3000.0000,  175.34,  526020.00,  420000.00, 106020.00, 'EQTY'),
    (7,  'ACC003', '2024-11-30', 'SEC009', 20000.0000,  238.56, 4771200.00, 3900000.00, 871200.00, 'ETFD'),
    (8,  'ACC005', '2024-11-30', 'SEC002',  1500.0000,  415.22,  622830.00,  510000.00, 112830.00, 'EQTY'),
    (9,  'ACC005', '2024-11-30', 'SEC019',  3000.0000,  493.85, 1481550.00, 1200000.00, 281550.00, 'ETFD'),
    (10, 'ACC008', '2024-11-30', 'SEC001', 15000.0000,  229.87, 3447900.00, 2500000.00, 947900.00, 'EQTY'),
    (11, 'ACC008', '2024-11-30', 'SEC017',    80.0000,  689000, 55120000.00,48000000.00,7120000.00,'EQTY'),
    (12, 'ACC011', '2024-11-30', 'SEC009',  8000.0000,  238.56, 1908480.00, 1600000.00, 308480.00, 'ETFD'),
    (13, 'ACC011', '2024-11-30', 'SEC006',  5000.0000,   96.14,  480700.00,  450000.00,  30700.00, 'FIXD'),
    (14, 'ACC013', '2024-11-30', 'SEC016',  4000.0000,   88.23,  352920.00,  340000.00,  12920.00, 'FIXD'),
    (15, 'ACC013', '2024-11-30', 'SEC018',  5000.0000,  100.45,  502250.00,  490000.00,  12250.00, 'FIXD'),
    (16, 'ACC014', '2024-11-30', 'SEC001', 50000.0000,  229.87,11493500.00, 8500000.00,2993500.00, 'EQTY'),
    (17, 'ACC014', '2024-11-30', 'SEC003', 30000.0000,  574.12,17223600.00,13000000.00,4223600.00, 'ETFD'),
    (18, 'ACC017', '2024-11-30', 'SEC004', 20000.0000,   73.45, 1469000.00, 1400000.00,  69000.00, 'FIXD'),
    (19, 'ACC017', '2024-11-30', 'SEC006', 15000.0000,   96.14, 1442100.00, 1380000.00,  62100.00, 'FIXD'),
    (20, 'ACC020', '2024-11-30', 'SEC009', 40000.0000,  238.56, 9542400.00, 7800000.00,1742400.00, 'ETFD');


