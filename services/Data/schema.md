-- dbo.rep_master
-- Business purpose: Master record for every financial advisor/rep affiliated with LPL.
-- One row per advisor. Central table — almost every query joins through here.

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

-- dbo.office_master
-- Business purpose: Physical office locations where advisors operate.
-- LPL has thousands of OSJ (Office of Supervisory Jurisdiction) locations.

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

-- dbo.acct_master
-- Business purpose: Master record for every client account held at LPL.
-- One row per account. Accounts belong to clients, managed by advisors.

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
    CONSTRAINT fk_acct_rep FOREIGN KEY (rep_id) REFERENCES dbo.rep_master(rep_id)
);

-- dbo.client_master
-- Business purpose: Master record for LPL clients (end investors).
-- One client can have multiple accounts across multiple advisors.

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


-- dbo.aum_snap
-- Business purpose: Monthly snapshot of assets under management per account.
-- This is the PRIMARY table for all AUM queries. 
-- CRITICAL: Always use latest snap_dt unless user specifies otherwise.

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

-- dbo.hldg_dtl
-- Business purpose: Individual security holdings per account per snapshot.
-- Detail behind dbo.aum_snap. Use when user asks about specific securities held.

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