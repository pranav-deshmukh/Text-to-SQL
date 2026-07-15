"""
Phase 2: Generate people data — relationship managers, clients, accounts, KYC, risk profiles.
"""

import random
from datetime import date, timedelta
from decimal import Decimal
from typing import List, Tuple

from data.names import (
    MALE_FIRST_NAMES, FEMALE_FIRST_NAMES, LAST_NAMES,
    OCCUPATIONS, DESIGNATIONS,
)
from data.locations import US_CITIES, US_STREET_NAMES
from config import VOLUMES, FIRM_START_DATE
from state import GlobalState, AccountState, D


def _random_date(rng: random.Random, start: date, end: date) -> date:
    delta = (end - start).days
    return start + timedelta(days=rng.randint(0, max(0, delta)))


def _random_phone(rng: random.Random) -> str:
    return f"+1-{rng.randint(200,999)}-{rng.randint(100,999)}-{rng.randint(1000,9999)}"


def _random_pan(rng: random.Random) -> str:
    letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    return "".join(rng.choices(letters, k=5)) + str(rng.randint(1000, 9999)) + rng.choice(letters)


def generate_relationship_managers(rng: random.Random, state: GlobalState) -> List[Tuple]:
    """Generate 500 relationship managers across 25 branches."""
    rows = []
    count = VOLUMES["relationship_managers"]
    num_branches = VOLUMES["branches"]

    used_emails = set()
    used_codes = set()
    used_licenses = set()

    for i in range(count):
        manager_id = i + 1
        branch_id = (i % num_branches) + 1

        gender = rng.choice(["Male", "Female"])
        if gender == "Male":
            first = rng.choice(MALE_FIRST_NAMES)
        else:
            first = rng.choice(FEMALE_FIRST_NAMES)
        last = rng.choice(LAST_NAMES)

        # Unique email
        email_base = f"{first.lower()}.{last.lower()}"
        email = f"{email_base}{i}@capitalpartners.com"
        while email in used_emails:
            email = f"{email_base}{rng.randint(100,9999)}@capitalpartners.com"
        used_emails.add(email)

        # Unique employee code
        emp_code = f"EMP{i+1:05d}"

        # Unique license
        license_num = f"LIC-{rng.randint(100000, 999999)}-{i+1}"

        dob = _random_date(rng, date(1965, 1, 1), date(1995, 12, 31))
        hire_date = _random_date(rng, FIRM_START_DATE, date(2024, 12, 31))
        exp_years = round(rng.uniform(1, 25), 1)
        designation = rng.choice(DESIGNATIONS)
        salary = round(rng.uniform(80000, 350000), 2)
        commission = round(rng.uniform(0.5, 3.0), 2)
        capacity = rng.randint(30, 100)
        rating = round(rng.uniform(2.5, 5.0), 2)

        state.rm_client_counts[manager_id] = 0

        rows.append((
            manager_id,
            branch_id,
            emp_code,
            first,
            last,
            gender,
            dob,
            email,
            _random_phone(rng),
            hire_date,
            designation,
            exp_years,
            license_num,
            salary,
            commission,
            capacity,
            0,              # current_client_count (will be patched)
            rating,
            "Active",
        ))

    return rows


RM_COLUMNS = [
    "manager_id", "branch_id", "employee_code", "first_name", "last_name",
    "gender", "date_of_birth", "email", "phone_number", "hire_date",
    "designation", "experience_years", "license_number", "annual_salary",
    "commission_percentage", "client_capacity", "current_client_count",
    "performance_rating", "status",
]


def generate_clients(rng: random.Random, state: GlobalState) -> List[Tuple]:
    """Generate 2000 clients distributed across RMs and branches."""
    rows = []
    count = VOLUMES["clients"]
    num_rms = VOLUMES["relationship_managers"]
    num_branches = VOLUMES["branches"]

    used_emails = set()
    used_pans = set()
    used_codes = set()

    for i in range(count):
        client_id = i + 1
        rm_id = (i % num_rms) + 1
        branch_id = (i % num_branches) + 1

        gender = rng.choice(["Male", "Female"])
        if gender == "Male":
            first = rng.choice(MALE_FIRST_NAMES)
        else:
            first = rng.choice(FEMALE_FIRST_NAMES)
        last = rng.choice(LAST_NAMES)

        # Unique client code
        client_code = f"CLT{i+1:06d}"

        # Unique email
        email_base = f"{first.lower()}.{last.lower()}"
        email = f"{email_base}{i}@{rng.choice(['gmail.com', 'yahoo.com', 'outlook.com', 'icloud.com'])}"
        while email in used_emails:
            email = f"{email_base}{rng.randint(100,99999)}@gmail.com"
        used_emails.add(email)

        # Unique PAN
        pan = _random_pan(rng)
        while pan in used_pans:
            pan = _random_pan(rng)
        used_pans.add(pan)

        dob = _random_date(rng, date(1955, 1, 1), date(2000, 12, 31))
        city_data = rng.choice(US_CITIES)
        city, us_state, zip_prefix = city_data
        street_num = rng.randint(100, 9999)
        street = rng.choice(US_STREET_NAMES)
        address = f"{street_num} {street}"
        postal = f"{zip_prefix}{rng.randint(10, 99)}"

        occupation = rng.choice(OCCUPATIONS)
        annual_income = round(rng.uniform(100000, 2000000), 2)
        net_worth = round(rng.uniform(500000, 50000000), 2)
        experience = rng.choice(["Beginner", "Intermediate", "Advanced", "Professional"])
        client_since = _random_date(rng, date(2019, 1, 1), date(2025, 6, 1))

        state.rm_client_counts[rm_id] = state.rm_client_counts.get(rm_id, 0) + 1

        rows.append((
            client_id,
            rm_id,
            branch_id,
            client_code,
            first,
            last,
            gender,
            dob,
            email,
            _random_phone(rng),
            pan,
            None,               # national_id
            occupation,
            annual_income,
            net_worth,
            experience,
            "USD",
            "United States",
            address,
            None,               # address_line2
            city,
            us_state,
            "United States",
            postal,
            client_since,
            "Active",
        ))

    return rows


CLIENT_COLUMNS = [
    "client_id", "relationship_manager_id", "branch_id", "client_code",
    "first_name", "last_name", "gender", "date_of_birth", "email",
    "phone_number", "pan_number", "national_id", "occupation",
    "annual_income", "net_worth", "investment_experience",
    "preferred_currency", "tax_residency_country",
    "address_line1", "address_line2", "city", "state", "country",
    "postal_code", "client_since", "status",
]


def generate_risk_profiles(rng: random.Random, clients: List[Tuple]) -> List[Tuple]:
    """Generate 1 risk profile per client (2000 total)."""
    rows = []

    risk_levels = ["Low", "Moderate", "High", "Very High"]
    goals = [
        "Capital Preservation", "Wealth Growth", "Retirement Planning",
        "Income Generation", "Tax Optimization", "Children's Education",
        "Estate Planning", "Aggressive Growth", "Balanced Growth",
    ]
    liquidity_prefs = ["Low", "Moderate", "High"]

    for i, client in enumerate(clients):
        client_id = client[0]
        annual_income = client[13]
        net_worth = client[14]
        rm_id = client[1]

        risk_level = rng.choice(risk_levels)
        risk_score = {
            "Low": rng.uniform(10, 30),
            "Moderate": rng.uniform(30, 55),
            "High": rng.uniform(55, 80),
            "Very High": rng.uniform(80, 98),
        }[risk_level]

        horizon = rng.randint(1, 30)
        monthly_capacity = round(annual_income * rng.uniform(0.05, 0.25) / 12, 2)
        expected_return = {
            "Low": rng.uniform(4, 8),
            "Moderate": rng.uniform(8, 14),
            "High": rng.uniform(14, 22),
            "Very High": rng.uniform(20, 35),
        }[risk_level]
        max_loss = {
            "Low": rng.uniform(5, 10),
            "Moderate": rng.uniform(10, 20),
            "High": rng.uniform(20, 35),
            "Very High": rng.uniform(30, 50),
        }[risk_level]

        assessment_date = _random_date(rng, date(2024, 1, 1), date(2025, 12, 31))
        next_review = assessment_date + timedelta(days=365)

        rows.append((
            i + 1,
            client_id,
            risk_level,
            round(risk_score, 2),
            rng.choice(goals),
            horizon,
            rng.choice(liquidity_prefs),
            annual_income,
            net_worth,
            monthly_capacity,
            round(expected_return, 2),
            round(max_loss, 2),
            assessment_date,
            next_review,
            rm_id,
            None,           # remarks
            "Active",
        ))

    return rows


RISK_PROFILE_COLUMNS = [
    "risk_profile_id", "client_id", "risk_level", "risk_score",
    "investment_goal", "investment_horizon_years", "liquidity_preference",
    "annual_income", "net_worth", "monthly_investment_capacity",
    "expected_annual_return", "maximum_loss_tolerance",
    "assessment_date", "next_review_date", "assessed_by_manager_id",
    "remarks", "status",
]


def generate_accounts(rng: random.Random, state: GlobalState, clients: List[Tuple]) -> List[Tuple]:
    """Generate 2500 accounts (some clients get 2 accounts)."""
    rows = []
    account_id = 0
    target = VOLUMES["accounts"]
    num_branches = VOLUMES["branches"]

    account_types = ["Individual", "Joint", "Corporate", "Retirement"]

    # First, give every client at least 1 account
    for client in clients:
        account_id += 1
        client_id = client[0]
        branch_id = client[2]
        acct_number = f"ACC{account_id:08d}"
        acct_type = rng.choice(account_types)
        opening_bal = round(rng.uniform(50000, 2000000), 2)
        opened_date = _random_date(rng, date(2019, 6, 1), date(2025, 3, 1))

        state.accounts[account_id] = AccountState(
            account_id=account_id,
            client_id=client_id,
            branch_id=branch_id,
            opening_balance=D(opening_bal),
            current_balance=D(opening_bal),
        )

        rows.append((
            account_id,
            client_id,
            branch_id,
            acct_number,
            acct_type,
            "USD",
            opening_bal,
            opening_bal,        # current_balance = opening initially
            opening_bal,        # available_balance
            "Active",
            opened_date,
            None,               # closed_date
            None,               # nominee_name
            None,               # nominee_relationship
            1,                  # online_banking_enabled
            round(rng.uniform(0, 100000), 2),  # overdraft_limit
            None,               # last_transaction_date
        ))

    # Give some clients a second account to reach 2500
    extra_needed = target - len(rows)
    extra_clients = rng.sample(range(len(clients)), min(extra_needed, len(clients)))

    for idx in extra_clients[:extra_needed]:
        account_id += 1
        client = clients[idx]
        client_id = client[0]
        branch_id = client[2]
        acct_number = f"ACC{account_id:08d}"
        acct_type = rng.choice(["Joint", "Retirement"])
        opening_bal = round(rng.uniform(25000, 500000), 2)
        opened_date = _random_date(rng, date(2020, 1, 1), date(2025, 6, 1))

        state.accounts[account_id] = AccountState(
            account_id=account_id,
            client_id=client_id,
            branch_id=branch_id,
            opening_balance=D(opening_bal),
            current_balance=D(opening_bal),
        )

        rows.append((
            account_id,
            client_id,
            branch_id,
            acct_number,
            acct_type,
            "USD",
            opening_bal,
            opening_bal,
            opening_bal,
            "Active",
            opened_date,
            None,
            None,
            None,
            1,
            round(rng.uniform(0, 50000), 2),
            None,
        ))

    return rows


ACCOUNT_COLUMNS = [
    "account_id", "client_id", "branch_id", "account_number", "account_type",
    "base_currency", "opening_balance", "current_balance", "available_balance",
    "account_status", "opened_date", "closed_date", "nominee_name",
    "nominee_relationship", "online_banking_enabled", "overdraft_limit",
    "last_transaction_date",
]


def generate_kyc_records(rng: random.Random, clients: List[Tuple]) -> List[Tuple]:
    """Generate 1 KYC record per client."""
    rows = []
    doc_types = ["Passport", "Driver's License", "State ID", "Social Security Card"]
    num_rms = VOLUMES["relationship_managers"]

    for i, client in enumerate(clients):
        client_id = client[0]
        rm_id = client[1]

        doc_type = rng.choice(doc_types)
        doc_number = f"{doc_type[:3].upper()}-{rng.randint(100000000, 999999999)}"
        verification_date = _random_date(rng, date(2023, 1, 1), date(2025, 12, 31))
        issue_date = verification_date - timedelta(days=rng.randint(365, 3650))
        expiry_date = verification_date + timedelta(days=rng.randint(365, 3650))

        rows.append((
            i + 1,
            client_id,
            "Identity",
            doc_type,
            doc_number,
            "United States",
            issue_date,
            expiry_date,
            verification_date,
            rm_id,
            "Verified",
            "Passed",
            "No",
            "Passed",
            rng.choice(["Low", "Medium", "High"]),
            None,
        ))

    return rows


KYC_COLUMNS = [
    "kyc_id", "client_id", "verification_type", "document_type",
    "document_number", "issuing_country", "issue_date", "expiry_date",
    "verification_date", "verified_by_manager_id", "verification_status",
    "aml_check_status", "pep_status", "sanctions_check_status",
    "risk_category", "remarks",
]
