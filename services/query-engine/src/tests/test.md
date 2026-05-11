# SQL Test Cases

## 1. top_advisors_latest_aum

**Question**  
Show the top 10 advisors by total AUM on the latest snapshot date, along with advisor name, office, region, number of active accounts, and average account AUM.

**Intended SQL**
```sql
WITH latest_snap AS (
  SELECT MAX(snap_dt) AS snap_dt
  FROM dbo.aum_snap
)
SELECT TOP 10
  r.rep_id,
  r.rep_nm,
  r.ofc_cd,
  r.rgn_cd,
  COUNT(DISTINCT a.acct_id) AS active_account_count,
  SUM(s.aum_val) AS total_aum,
  AVG(CAST(s.aum_val AS DECIMAL(18,2))) AS avg_account_aum
FROM dbo.aum_snap s
JOIN latest_snap ls
  ON s.snap_dt = ls.snap_dt
JOIN dbo.acct_master a
  ON a.acct_id = s.acct_id
JOIN dbo.rep_master r
  ON r.rep_id = s.rep_id
WHERE r.rep_stts_cd = 'AC'
GROUP BY r.rep_id, r.rep_nm, r.ofc_cd, r.rgn_cd
ORDER BY total_aum DESC, r.rep_id;
```

---

## 2. office_rank_within_region

**Question**  
For each office, show total AUM, number of advisors, number of accounts, average AUM per account, and rank offices within each region by total AUM.

**Intended SQL**
```sql
WITH latest_snap AS (
  SELECT MAX(snap_dt) AS snap_dt
  FROM dbo.aum_snap
),
office_rollup AS (
  SELECT
    r.rgn_cd,
    r.ofc_cd,
    SUM(s.aum_val) AS total_aum,
    COUNT(DISTINCT r.rep_id) AS advisor_count,
    COUNT(DISTINCT a.acct_id) AS account_count,
    AVG(CAST(s.aum_val AS DECIMAL(18,2))) AS avg_account_aum
  FROM dbo.aum_snap s
  JOIN latest_snap ls
    ON s.snap_dt = ls.snap_dt
  JOIN dbo.acct_master a
    ON a.acct_id = s.acct_id
  JOIN dbo.rep_master r
    ON r.rep_id = s.rep_id
  GROUP BY r.rgn_cd, r.ofc_cd
)
SELECT
  rgn_cd,
  ofc_cd,
  total_aum,
  advisor_count,
  account_count,
  avg_account_aum,
  RANK() OVER (PARTITION BY rgn_cd ORDER BY total_aum DESC) AS office_rank_in_region
FROM office_rollup
ORDER BY rgn_cd, office_rank_in_region, ofc_cd;
```

---

## 3. advisor_aum_drop_vs_previous_snapshot

**Question**  
Find advisors whose total AUM dropped compared to the previous snapshot date, and show the dollar change and percent change.

**Intended SQL**
```sql
WITH snap_dates AS (
  SELECT DISTINCT snap_dt
  FROM dbo.aum_snap
),
ranked_dates AS (
  SELECT
    snap_dt,
    DENSE_RANK() OVER (ORDER BY snap_dt DESC) AS dt_rank
  FROM snap_dates
),
target_dates AS (
  SELECT snap_dt, dt_rank
  FROM ranked_dates
  WHERE dt_rank IN (1, 2)
),
advisor_aum AS (
  SELECT
    s.rep_id,
    td.dt_rank,
    SUM(s.aum_val) AS total_aum
  FROM dbo.aum_snap s
  JOIN target_dates td
    ON s.snap_dt = td.snap_dt
  GROUP BY s.rep_id, td.dt_rank
),
pivoted AS (
  SELECT
    rep_id,
    MAX(CASE WHEN dt_rank = 1 THEN total_aum END) AS latest_aum,
    MAX(CASE WHEN dt_rank = 2 THEN total_aum END) AS previous_aum
  FROM advisor_aum
  GROUP BY rep_id
)
SELECT
  r.rep_id,
  r.rep_nm,
  p.previous_aum,
  p.latest_aum,
  (p.latest_aum - p.previous_aum) AS dollar_change,
  CASE
    WHEN p.previous_aum IS NULL OR p.previous_aum = 0 THEN NULL
    ELSE ((p.latest_aum - p.previous_aum) * 100.0) / p.previous_aum
  END AS percent_change
FROM pivoted p
JOIN dbo.rep_master r
  ON r.rep_id = p.rep_id
WHERE p.previous_aum IS NOT NULL
  AND p.latest_aum < p.previous_aum
ORDER BY dollar_change ASC, r.rep_id;
```

---

## 4. accounts_above_advisor_average

**Question**  
Show accounts whose latest AUM is above their advisor’s average account AUM, including advisor name, account id, latest AUM, advisor average, and difference.

**Intended SQL**
```sql
WITH latest_snap AS (
  SELECT MAX(snap_dt) AS snap_dt
  FROM dbo.aum_snap
),
account_aum AS (
  SELECT
    s.rep_id,
    s.acct_id,
    SUM(s.aum_val) AS acct_aum
  FROM dbo.aum_snap s
  JOIN latest_snap ls
    ON s.snap_dt = ls.snap_dt
  GROUP BY s.rep_id, s.acct_id
),
advisor_avg AS (
  SELECT
    rep_id,
    AVG(CAST(acct_aum AS DECIMAL(18,2))) AS advisor_avg_aum
  FROM account_aum
  GROUP BY rep_id
)
SELECT
  r.rep_id,
  r.rep_nm,
  aa.acct_id,
  aa.acct_aum AS latest_aum,
  av.advisor_avg_aum,
  aa.acct_aum - av.advisor_avg_aum AS aum_diff
FROM account_aum aa
JOIN advisor_avg av
  ON av.rep_id = aa.rep_id
JOIN dbo.rep_master r
  ON r.rep_id = aa.rep_id
WHERE aa.acct_aum > av.advisor_avg_aum
ORDER BY aum_diff DESC, aa.acct_id;
```

---

## 5. offices_all_advisors_have_3_accounts

**Question**  
Find offices where every advisor has at least 3 active accounts and the office’s total latest AUM exceeds 1000000.

**Intended SQL**
```sql
WITH latest_snap AS (
  SELECT MAX(snap_dt) AS snap_dt
  FROM dbo.aum_snap
),
advisor_account_counts AS (
  SELECT
    r.ofc_cd,
    r.rep_id,
    COUNT(DISTINCT a.acct_id) AS account_count,
    SUM(s.aum_val) AS advisor_total_aum
  FROM dbo.rep_master r
  JOIN dbo.acct_master a
    ON a.rep_id = r.rep_id
  JOIN dbo.aum_snap s
    ON s.acct_id = a.acct_id
   AND s.rep_id = r.rep_id
  JOIN latest_snap ls
    ON s.snap_dt = ls.snap_dt
  WHERE r.rep_stts_cd = 'AC'
  GROUP BY r.ofc_cd, r.rep_id
),
office_rollup AS (
  SELECT
    ofc_cd,
    SUM(advisor_total_aum) AS office_total_aum,
    MIN(account_count) AS min_accounts_per_advisor
  FROM advisor_account_counts
  GROUP BY ofc_cd
)
SELECT
  ofc_cd,
  office_total_aum,
  min_accounts_per_advisor
FROM office_rollup
WHERE min_accounts_per_advisor >= 3
  AND office_total_aum > 1000000
ORDER BY office_total_aum DESC, ofc_cd;
```
