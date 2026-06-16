# Python Script: Generate Interconnected Banking CSV Files

import csv
import random
from datetime import datetime, timedelta
from pathlib import Path

# =========================
# CONFIGURATION
# =========================
NUM_ACCOUNTS = 50
MIN_TRANSACTIONS = 100
MAX_TRANSACTIONS = 150
OUTPUT_FOLDER = "generated_accounts"
START_DATE = datetime(2024, 1, 1)
END_DATE = datetime(2026, 5, 1)

random.seed(42)  # Consistent random data

# =========================
# SAMPLE DATA
# =========================
FIRST_NAMES = [
    "Aarav", "Vivaan", "Aditya", "Krishna", "Ishaan", "Rohan", "Aryan",
    "Kabir", "Vihaan", "Rahul", "Saanvi", "Ananya", "Diya", "Aisha",
    "Meera", "Priya", "Kavya", "Ritika", "Neha", "Simran"
]

LAST_NAMES = [
    "Sharma", "Verma", "Patel", "Reddy", "Nair", "Singh", "Gupta",
    "Kumar", "Joshi", "Mehta", "Iyer", "Kapoor", "Das", "Chopra"
]

TRANSACTION_TYPES = [
    "UPI", "IMPS", "NEFT", "RTGS", "Bank Transfer"
]

LOAN_TYPES = [
    "Home Loan", "Car Loan", "Education Loan", "Personal Loan", "None"
]

# =========================
# HELPERS
# =========================
def random_name():
    return f"{random.choice(FIRST_NAMES)} {random.choice(LAST_NAMES)}"


def random_account_number(existing):
    while True:
        acc = str(random.randint(1000000000, 9999999999))
        if acc not in existing:
            return acc


def random_datetime(start, end):
    delta = end - start
    random_seconds = random.randint(0, int(delta.total_seconds()))
    return start + timedelta(seconds=random_seconds)


# =========================
# CREATE ACCOUNTS
# =========================
accounts = {}
account_numbers = set()

for _ in range(NUM_ACCOUNTS):
    acc_no = random_account_number(account_numbers)
    account_numbers.add(acc_no)

    savings = round(random.uniform(10000, 500000), 2)
    fd = round(random.uniform(0, 1000000), 2)

    loan_type = random.choice(LOAN_TYPES)
    if loan_type == "None":
        loan_amount = 0
    else:
        loan_amount = round(random.uniform(50000, 2000000), 2)

    accounts[acc_no] = {
        "name": random_name(),
        "savings": savings,
        "fd": fd,
        "loan_type": loan_type,
        "loan_amount": loan_amount,
        "transactions": []
    }


# =========================
# GENERATE TRANSACTIONS
# =========================
serial_counter = {acc: 1 for acc in accounts}

account_list = list(accounts.keys())

for sender_acc in account_list:
    transaction_count = random.randint(MIN_TRANSACTIONS, MAX_TRANSACTIONS)

    for _ in range(transaction_count):
        receiver_acc = random.choice(account_list)

        while receiver_acc == sender_acc:
            receiver_acc = random.choice(account_list)

        amount = round(random.uniform(100, 150000), 2)
        txn_time = random_datetime(START_DATE, END_DATE)
        txn_type = random.choice(TRANSACTION_TYPES)

        sender_name = accounts[sender_acc]["name"]
        receiver_name = accounts[receiver_acc]["name"]

        # OUTGOING transaction for sender
        sender_row = {
            "Sl No": serial_counter[sender_acc],
            "Transaction Type": "DEBIT",
            "Mode": txn_type,
            "From Account": sender_acc,
            "From Name": sender_name,
            "To Account": receiver_acc,
            "To Name": receiver_name,
            "Amount": amount,
            "Date": txn_time.strftime("%Y-%m-%d"),
            "Time": txn_time.strftime("%H:%M:%S"),
            "Savings Balance": round(accounts[sender_acc]["savings"] - amount, 2),
            "FD Amount": accounts[sender_acc]["fd"],
            "Loan Type": accounts[sender_acc]["loan_type"],
            "Outstanding Loan": accounts[sender_acc]["loan_amount"]
        }

        accounts[sender_acc]["transactions"].append(sender_row)
        serial_counter[sender_acc] += 1

        # Update sender savings
        accounts[sender_acc]["savings"] -= amount

        # INCOMING transaction for receiver
        receiver_row = {
            "Sl No": serial_counter[receiver_acc],
            "Transaction Type": "CREDIT",
            "Mode": txn_type,
            "From Account": sender_acc,
            "From Name": sender_name,
            "To Account": receiver_acc,
            "To Name": receiver_name,
            "Amount": amount,
            "Date": txn_time.strftime("%Y-%m-%d"),
            "Time": txn_time.strftime("%H:%M:%S"),
            "Savings Balance": round(accounts[receiver_acc]["savings"] + amount, 2),
            "FD Amount": accounts[receiver_acc]["fd"],
            "Loan Type": accounts[receiver_acc]["loan_type"],
            "Outstanding Loan": accounts[receiver_acc]["loan_amount"]
        }

        accounts[receiver_acc]["transactions"].append(receiver_row)
        serial_counter[receiver_acc] += 1

        # Update receiver savings
        accounts[receiver_acc]["savings"] += amount


# =========================
# SORT TRANSACTIONS BY DATE
# =========================
for acc in accounts:
    accounts[acc]["transactions"].sort(
        key=lambda x: datetime.strptime(
            x["Date"] + " " + x["Time"],
            "%Y-%m-%d %H:%M:%S"
        )
    )

    # Reassign serial numbers after sorting
    for idx, txn in enumerate(accounts[acc]["transactions"], start=1):
        txn["Sl No"] = idx


# =========================
# CREATE OUTPUT DIRECTORY
# =========================
output_path = Path(OUTPUT_FOLDER)
output_path.mkdir(exist_ok=True)


# =========================
# WRITE CSV FILES
# =========================
headers = [
    "Sl No",
    "Transaction Type",
    "Mode",
    "From Account",
    "From Name",
    "To Account",
    "To Name",
    "Amount",
    "Date",
    "Time",
    "Savings Balance",
    "FD Amount",
    "Loan Type",
    "Outstanding Loan"
]

for acc_no, details in accounts.items():
    filename = output_path / f"{acc_no}.csv"

    with open(filename, mode="w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(file, fieldnames=headers)
        writer.writeheader()
        writer.writerows(details["transactions"])

print(f"\nGenerated {NUM_ACCOUNTS} interconnected CSV files inside '{OUTPUT_FOLDER}' folder.")
print("Each account contains realistic linked debit and credit transactions.")
