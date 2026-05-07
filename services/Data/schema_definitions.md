rep_id:       "Unique advisor/rep identifier. Primary key. Used to join to all account and transaction tables."
rep_nm:       "Full legal name of the financial advisor."
rep_stts_cd:  "Advisor status. AC=Active, IA=Inactive, SU=Suspended, TR=Terminated."
ofc_cd:       "Office code. Links to dbo.office_master. Represents the advisor's registered branch office."
brn_cd:       "Branch code. Links to dbo.branch_master. Supervisory branch."
rgn_cd:       "Region code. LPL internal geographic region (Northeast, Southeast, Midwest, West, etc.)."
affl_dt:      "Date advisor affiliated/onboarded with LPL."
trm_dt:       "Termination date. NULL means advisor is still active. Always check rep_stts_cd alongside this."
rep_typ_cd:   "Rep type. IAR=Investment Advisor Rep, BD=Broker-Dealer only, HYB=Hybrid RIA."
prdcr_cd:     "Producer code. Used for commission tracking and payout calculations."
crd_nbr:      "FINRA CRD number. Regulatory identifier. Do NOT expose in general user-facing queries."



ofc_cd:       "Office code. Primary key. Foreign key from dbo.rep_master.ofc_cd."
ofc_nm:       "Full office name."
ofc_stts_cd:  "Office status. AC=Active, IA=Inactive."
ofc_typ_cd:   "Office type. OSJ=Office of Supervisory Jurisdiction, SOB=Satellite Office of Branch."
st_cd:        "US state abbreviation (e.g., CA, TX, NY)."
osj_flg:      "Y/N flag. Y means this office is an OSJ — supervisory office. Used for compliance queries."
rgn_cd:       "LPL internal region. Matches rgn_cd on rep_master."



acct_id:      "Account number. Primary key. LPL-assigned unique account identifier."
acct_nm:      "Account title/name as registered."
acct_typ_cd:  "Account type. INDV=Individual, JTWT=Joint Tenants With Rights of Survivorship, IRA=Traditional IRA, RIRA=Roth IRA, BROK=Brokerage, MGAC=Managed Account."
acct_stts_cd: "Account status. AC=Active, CL=Closed, FR=Frozen, PE=Pending."
rep_id:       "Advisor who manages this account. Foreign key to dbo.rep_master."
clnt_id:      "Client identifier. Foreign key to dbo.client_master. Multiple accounts can share a client."
opn_dt:       "Date account was opened."
cls_dt:       "Date account was closed. NULL means account is still open."
rgstn_cd:     "Registration code. Legal registration type for the account."
inv_obj_cd:   "Investment objective. GRW=Growth, INC=Income, BAL=Balanced, CPN=Capital Preservation."
mgd_flg:      "Y=Managed/advisory account (fee-based). N=Brokerage/commission-based account."



clnt_id:      "Client identifier. Primary key."
clnt_nm:      "Client full name or entity name."
clnt_typ_cd:  "Client type. IND=Individual, ENT=Entity/Corporate, TR=Trust, EST=Estate."
stts_cd:      "Client status. AC=Active, IA=Inactive."
dob_dt:       "Date of birth. SENSITIVE — do not include in general result sets. Used only for age-based calculations."
net_wrth_cd:  "Net worth range code. Used for suitability. A=Under 100K, B=100K-500K, C=500K-1M, D=Over 1M."
ann_inc_cd:   "Annual income range code. Suitability field."


snap_dt:      "Snapshot date. AUM is captured monthly, typically month-end. ALWAYS filter using MAX(snap_dt) for current values unless user asks for historical. Example: WHERE snap_dt = (SELECT MAX(snap_dt) FROM dbo.aum_snap)"
aum_val:      "Total assets under management for the account at snapshot date. In USD. This is the primary AUM metric."
mkt_val:      "Total market value of all holdings. May differ from aum_val if account has pending transactions."
csh_val:      "Cash and cash equivalents held in the account at snapshot date."
unrlzd_gl:    "Unrealized gain or loss on current holdings. Positive=gain, Negative=loss."
asst_allc_cd: "Asset allocation category. EQ=Equity-heavy, FI=Fixed Income-heavy, BAL=Balanced, ALT=Alternative."


sec_id:       "Security identifier. Foreign key to dbo.sec_master. Internal LPL security ID."
qty_hld:      "Quantity of shares/units held."
mkt_prc:      "Market price per unit at snapshot date."
mkt_val:      "Total market value (qty_hld × mkt_prc)."
cst_bss:      "Cost basis — original purchase value. Used for gain/loss calculations."
asst_cls_cd:  "Asset class. EQTY=Equity, FIXD=Fixed Income, MFND=Mutual Fund, ETFD=ETF, CASH=Cash, ALTR=Alternative."