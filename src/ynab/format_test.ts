import { assertEquals } from "@std/testing/assert";
import { describe, it } from "@std/testing/bdd";
import {
  dollarsToMilliunits,
  formatAccount,
  formatCategory,
  formatCategoryGroup,
  formatMoney,
  formatMonthSummary,
  formatPlan,
  formatScheduledTransaction,
  formatTransaction,
  milliunitsToDollars,
} from "./format.ts";
import type { CurrencyFormat } from "./types.ts";
import {
  makeAccount,
  makeCategory,
  makeCategoryGroup,
  makeMonthDetail,
  makeMonthSummary,
  makePlan,
  makeScheduledTransaction,
  makeSubTransaction,
  makeTransaction,
  TEST_CURRENCY,
} from "../testing/helpers.ts";

// --- milliunitsToDollars ---

describe("milliunitsToDollars", () => {
  it("converts positive milliunits", () => {
    assertEquals(milliunitsToDollars(1234560), 1234.56);
  });

  it("converts negative milliunits", () => {
    assertEquals(milliunitsToDollars(-50000), -50);
  });

  it("converts zero", () => {
    assertEquals(milliunitsToDollars(0), 0);
  });

  it("converts fractional milliunits", () => {
    assertEquals(milliunitsToDollars(1500), 1.5);
  });
});

// --- dollarsToMilliunits ---

describe("dollarsToMilliunits", () => {
  it("converts positive dollars", () => {
    assertEquals(dollarsToMilliunits(1234.56), 1234560);
  });

  it("converts negative dollars", () => {
    assertEquals(dollarsToMilliunits(-50), -50000);
  });

  it("converts zero", () => {
    assertEquals(dollarsToMilliunits(0), 0);
  });

  it("handles rounding for floating point", () => {
    // 10.999 * 1000 = 10999.000000000002 in floating point
    assertEquals(dollarsToMilliunits(10.999), 10999);
  });
});

// --- formatMoney ---

describe("formatMoney", () => {
  it("formats positive amount", () => {
    assertEquals(formatMoney(1234560, TEST_CURRENCY), "$1,234.56");
  });

  it("formats negative amount in parens", () => {
    assertEquals(formatMoney(-50000, TEST_CURRENCY), "($50.00)");
  });

  it("formats zero", () => {
    assertEquals(formatMoney(0, TEST_CURRENCY), "$0.00");
  });

  it("formats large amount with group separators", () => {
    assertEquals(
      formatMoney(1234567890, TEST_CURRENCY),
      "$1,234,567.89",
    );
  });

  it("uses default USD when no currency provided", () => {
    assertEquals(formatMoney(1234560), "$1,234.56");
  });

  it("formats EUR with comma decimal and period group", () => {
    const eur: CurrencyFormat = {
      iso_code: "EUR",
      example_format: "123.456,78",
      decimal_digits: 2,
      decimal_separator: ",",
      symbol_first: false,
      symbol: "\u20AC",
      display_symbol: true,
      group_separator: ".",
    };
    assertEquals(formatMoney(1234560, eur), "1.234,56 \u20AC");
  });

  it("formats currency with symbol after number and space group separator", () => {
    const sek: CurrencyFormat = {
      iso_code: "SEK",
      example_format: "123 456,78",
      decimal_digits: 2,
      decimal_separator: ",",
      symbol_first: false,
      symbol: "kr",
      display_symbol: true,
      group_separator: " ",
    };
    assertEquals(formatMoney(1234560, sek), "1 234,56 kr");
  });

  it("formats negative amount with non-USD currency", () => {
    const eur: CurrencyFormat = {
      iso_code: "EUR",
      example_format: "123.456,78",
      decimal_digits: 2,
      decimal_separator: ",",
      symbol_first: false,
      symbol: "\u20AC",
      display_symbol: true,
      group_separator: ".",
    };
    assertEquals(formatMoney(-1234560, eur), "(1.234,56 \u20AC)");
  });

  it("formats currency without display symbol", () => {
    const noSymbol: CurrencyFormat = {
      iso_code: "USD",
      example_format: "123,456.78",
      decimal_digits: 2,
      decimal_separator: ".",
      symbol_first: true,
      symbol: "$",
      display_symbol: false,
      group_separator: ",",
    };
    assertEquals(formatMoney(1234560, noSymbol), "1,234.56");
  });
});

// --- formatTransaction ---

describe("formatTransaction", () => {
  it("formats a basic cleared transaction", () => {
    const txn = makeTransaction({
      id: "txn-test-id",
      date: "2024-01-15",
      amount: -45670,
      payee_name: "Grocery Store",
      category_name: "Groceries",
      cleared: "cleared",
    });
    const result = formatTransaction(txn, TEST_CURRENCY);
    assertEquals(
      result,
      "[txn-test-id]  2024-01-15  ($45.67)  Grocery Store  Groceries  Checking  \u2713",
    );
  });

  it("formats an uncleared transaction with bullet indicator", () => {
    const txn = makeTransaction({
      id: "txn-test-id",
      date: "2024-02-20",
      amount: -12000,
      payee_name: "Coffee Shop",
      category_name: "Dining Out",
      cleared: "uncleared",
    });
    const result = formatTransaction(txn, TEST_CURRENCY);
    assertEquals(
      result,
      "[txn-test-id]  2024-02-20  ($12.00)  Coffee Shop  Dining Out  Checking  \u2022",
    );
  });

  it("formats a reconciled transaction with R indicator", () => {
    const txn = makeTransaction({
      id: "txn-test-id",
      date: "2024-03-01",
      amount: 5000000,
      payee_name: "Employer Inc",
      category_name: "Income",
      cleared: "reconciled",
    });
    const result = formatTransaction(txn, TEST_CURRENCY);
    assertEquals(
      result,
      "[txn-test-id]  2024-03-01  $5,000.00  Employer Inc  Income  Checking  R",
    );
  });

  it("shows unapproved indicator when not approved", () => {
    const txn = makeTransaction({
      id: "txn-test-id",
      date: "2024-01-15",
      amount: -45670,
      payee_name: "Grocery Store",
      category_name: "Groceries",
      cleared: "uncleared",
      approved: false,
    });
    const result = formatTransaction(txn, TEST_CURRENCY);
    assertEquals(
      result,
      "[txn-test-id]  2024-01-15  ($45.67)  Grocery Store  Groceries  Checking  \u2691 \u2022",
    );
  });

  it("shows bank payee when different from payee name", () => {
    const txn = makeTransaction({
      id: "txn-test-id",
      date: "2024-01-15",
      amount: -45670,
      payee_name: "Grocery Store",
      category_name: "Groceries",
      cleared: "cleared",
      import_payee_name: "GROCERY STORE #1234",
    });
    const result = formatTransaction(txn, TEST_CURRENCY);
    assertEquals(
      result,
      "[txn-test-id]  2024-01-15  ($45.67)  Grocery Store  Groceries  Checking  \u2713\n    Bank payee: GROCERY STORE #1234",
    );
  });

  it("does not show bank payee when same as payee name", () => {
    const txn = makeTransaction({
      import_payee_name: "Grocery Store",
      payee_name: "Grocery Store",
    });
    const result = formatTransaction(txn, TEST_CURRENCY);
    assertEquals(result.includes("Bank payee:"), false);
  });

  it("shows matched transaction id when present", () => {
    const txn = makeTransaction({
      id: "txn-test-id",
      date: "2024-01-15",
      amount: -45670,
      payee_name: "Grocery Store",
      category_name: "Groceries",
      cleared: "cleared",
      matched_transaction_id: "matched-123",
    });
    const result = formatTransaction(txn, TEST_CURRENCY);
    assertEquals(
      result,
      "[txn-test-id]  2024-01-15  ($45.67)  Grocery Store  Groceries  Checking  \u2713\n    Matched: [matched-123]",
    );
  });

  it("includes memo on a new indented line", () => {
    const txn = makeTransaction({
      id: "txn-test-id",
      date: "2024-01-15",
      amount: -45670,
      payee_name: "Grocery Store",
      category_name: "Groceries",
      cleared: "cleared",
      memo: "Weekly groceries",
    });
    const result = formatTransaction(txn, TEST_CURRENCY);
    assertEquals(
      result,
      "[txn-test-id]  2024-01-15  ($45.67)  Grocery Store  Groceries  Checking  \u2713\n    Memo: Weekly groceries",
    );
  });

  it("shows dash for null payee", () => {
    const txn = makeTransaction({
      id: "txn-test-id",
      date: "2024-01-15",
      amount: -10000,
      payee_name: null,
      category_name: "Groceries",
      cleared: "cleared",
    });
    const result = formatTransaction(txn, TEST_CURRENCY);
    assertEquals(
      result,
      "[txn-test-id]  2024-01-15  ($10.00)  \u2014  Groceries  Checking  \u2713",
    );
  });

  it("shows Uncategorized for null category", () => {
    const txn = makeTransaction({
      id: "txn-test-id",
      date: "2024-01-15",
      amount: -10000,
      payee_name: "Store",
      category_name: null,
      cleared: "cleared",
    });
    const result = formatTransaction(txn, TEST_CURRENCY);
    assertEquals(
      result,
      "[txn-test-id]  2024-01-15  ($10.00)  Store  Uncategorized  Checking  \u2713",
    );
  });

  it("formats transaction with subtransactions", () => {
    const txn = makeTransaction({
      id: "txn-test-id",
      date: "2024-01-15",
      amount: -75000,
      payee_name: "Walmart",
      category_name: "Split",
      cleared: "cleared",
      subtransactions: [
        makeSubTransaction({
          amount: -50000,
          payee_name: null,
          category_name: "Groceries",
          memo: "Food items",
        }),
        makeSubTransaction({
          amount: -25000,
          payee_name: null,
          category_name: "Household",
          memo: null,
        }),
      ],
    });
    const result = formatTransaction(txn, TEST_CURRENCY);
    const lines = result.split("\n");
    assertEquals(lines.length, 3);
    assertEquals(
      lines[0],
      "[txn-test-id]  2024-01-15  ($75.00)  Walmart  Split  Checking  \u2713",
    );
    // Subtransaction with null payee_name inherits parent payee
    assertEquals(
      lines[1],
      "    ($50.00)  Walmart  Groceries  (Food items)",
    );
    assertEquals(lines[2], "    ($25.00)  Walmart  Household");
  });

  it("does not add memo line for empty string memo", () => {
    const txn = makeTransaction({ memo: "" });
    const result = formatTransaction(txn, TEST_CURRENCY);
    assertEquals(result.includes("Memo:"), false);
  });
});

// --- formatAccount ---

describe("formatAccount", () => {
  it("formats a normal account with balances", () => {
    const account = makeAccount({
      id: "acc-test-id",
      name: "Checking",
      type: "checking",
      balance: 1234560,
      cleared_balance: 1200000,
      uncleared_balance: 34560,
      closed: false,
    });
    const result = formatAccount(account, TEST_CURRENCY);
    assertEquals(
      result,
      "[acc-test-id]  Checking (checking) \u2014 $1,234.56  [cleared: $1,200.00  uncleared: $34.56]",
    );
  });

  it("appends (closed) for closed accounts", () => {
    const account = makeAccount({
      id: "acc-test-id",
      name: "Old Savings",
      type: "savings",
      balance: 0,
      cleared_balance: 0,
      uncleared_balance: 0,
      closed: true,
    });
    const result = formatAccount(account, TEST_CURRENCY);
    assertEquals(
      result,
      "[acc-test-id]  Old Savings (savings) \u2014 $0.00  [cleared: $0.00  uncleared: $0.00] (closed)",
    );
  });

  it("formats zero balance account", () => {
    const account = makeAccount({
      id: "acc-test-id",
      name: "Empty",
      type: "checking",
      balance: 0,
      cleared_balance: 0,
      uncleared_balance: 0,
    });
    const result = formatAccount(account, TEST_CURRENCY);
    assertEquals(
      result,
      "[acc-test-id]  Empty (checking) \u2014 $0.00  [cleared: $0.00  uncleared: $0.00]",
    );
  });
});

// --- formatCategory ---

describe("formatCategory", () => {
  it("formats basic category with budget/spent/available", () => {
    const cat = makeCategory({
      id: "cat-test-id",
      name: "Groceries",
      budgeted: 500000,
      activity: -345670,
      balance: 154330,
    });
    const result = formatCategory(cat, TEST_CURRENCY);
    assertEquals(
      result,
      "[cat-test-id]  Groceries \u2014 Budgeted: $500.00  Spent: ($345.67)  Available: $154.33",
    );
  });

  it("includes goal info when goal_type is set", () => {
    const cat = makeCategory({
      id: "cat-test-id",
      name: "Vacation",
      budgeted: 200000,
      activity: 0,
      balance: 200000,
      goal_type: "TBD",
      goal_target: 2000000,
      goal_target_month: "2024-06-01",
      goal_percentage_complete: 10,
      goal_under_funded: 0,
    });
    const result = formatCategory(cat, TEST_CURRENCY);
    const lines = result.split("\n");
    assertEquals(lines.length, 2);
    assertEquals(
      lines[0],
      "[cat-test-id]  Vacation \u2014 Budgeted: $200.00  Spent: $0.00  Available: $200.00",
    );
    assertEquals(
      lines[1],
      "    Goal: Target by Date  Target: $2,000.00  By: 2024-06-01  10% complete",
    );
  });

  it("appends (hidden) for hidden category", () => {
    const cat = makeCategory({
      id: "cat-test-id",
      name: "Old Category",
      hidden: true,
      budgeted: 0,
      activity: 0,
      balance: 0,
    });
    const result = formatCategory(cat, TEST_CURRENCY);
    assertEquals(
      result,
      "[cat-test-id]  Old Category \u2014 Budgeted: $0.00  Spent: $0.00  Available: $0.00 (hidden)",
    );
  });

  it("shows underfunded amount in goal info", () => {
    const cat = makeCategory({
      id: "cat-test-id",
      name: "Rent",
      budgeted: 500000,
      activity: 0,
      balance: 500000,
      goal_type: "MF",
      goal_target: 1500000,
      goal_under_funded: 1000000,
    });
    const result = formatCategory(cat, TEST_CURRENCY);
    const lines = result.split("\n");
    assertEquals(lines.length, 2);
    assertEquals(
      lines[1],
      "    Goal: Monthly Funding  Target: $1,500.00  Underfunded: $1,000.00",
    );
  });
});

// --- formatCategoryGroup ---

describe("formatCategoryGroup", () => {
  it("formats group name as header with indented categories", () => {
    const group = makeCategoryGroup({
      name: "Everyday Expenses",
      categories: [
        makeCategory({
          id: "cat-1",
          name: "Groceries",
          budgeted: 500000,
          activity: -200000,
          balance: 300000,
        }),
        makeCategory({
          id: "cat-2",
          name: "Dining Out",
          budgeted: 100000,
          activity: -50000,
          balance: 50000,
        }),
      ],
    });
    const result = formatCategoryGroup(group, TEST_CURRENCY);
    const lines = result.split("\n");
    assertEquals(lines.length, 3);
    assertEquals(lines[0], "Everyday Expenses");
    assertEquals(
      lines[1],
      "  [cat-1]  Groceries \u2014 Budgeted: $500.00  Spent: ($200.00)  Available: $300.00",
    );
    assertEquals(
      lines[2],
      "  [cat-2]  Dining Out \u2014 Budgeted: $100.00  Spent: ($50.00)  Available: $50.00",
    );
  });

  it("formats group with no categories", () => {
    const group = makeCategoryGroup({
      name: "Empty Group",
      categories: [],
    });
    const result = formatCategoryGroup(group, TEST_CURRENCY);
    assertEquals(result, "Empty Group");
  });
});

// --- formatMonthSummary ---

describe("formatMonthSummary", () => {
  it("formats full month summary with all fields", () => {
    const month = makeMonthSummary({
      month: "2024-01-01",
      income: 5000000,
      budgeted: 4500000,
      activity: -3200000,
      to_be_budgeted: 500000,
      age_of_money: 45,
    });
    const result = formatMonthSummary(month, TEST_CURRENCY);
    assertEquals(
      result,
      "January 2024 \u2014 Income: $5,000.00  Budgeted: $4,500.00  Activity: ($3,200.00)  TBB: $500.00  Age of Money: 45 days",
    );
  });

  it("includes age of money when present", () => {
    const month = makeMonthSummary({ age_of_money: 30 });
    const result = formatMonthSummary(month, TEST_CURRENCY);
    assertEquals(result.includes("Age of Money: 30 days"), true);
  });

  it("omits age of money when null", () => {
    const month = makeMonthSummary({ age_of_money: null });
    const result = formatMonthSummary(month, TEST_CURRENCY);
    assertEquals(result.includes("Age of Money"), false);
  });

  it("works with MonthDetail type", () => {
    const month = makeMonthDetail({
      month: "2024-06-01",
      income: 6000000,
      budgeted: 5500000,
      activity: -4000000,
      to_be_budgeted: 1000000,
      age_of_money: 60,
    });
    const result = formatMonthSummary(month, TEST_CURRENCY);
    assertEquals(
      result,
      "June 2024 \u2014 Income: $6,000.00  Budgeted: $5,500.00  Activity: ($4,000.00)  TBB: $1,000.00  Age of Money: 60 days",
    );
  });
});

// --- formatScheduledTransaction ---

describe("formatScheduledTransaction", () => {
  it("formats a basic scheduled transaction", () => {
    const st = makeScheduledTransaction({
      id: "st-test-id",
      frequency: "monthly",
      amount: -100000,
      payee_name: "Netflix",
      category_name: "Entertainment",
      date_next: "2024-02-15",
    });
    const result = formatScheduledTransaction(st, TEST_CURRENCY);
    assertEquals(
      result,
      "[st-test-id]  Every month \u2014 ($100.00)  Netflix  Entertainment  Next: 2024-02-15",
    );
  });

  it("formats with null payee as dash", () => {
    const st = makeScheduledTransaction({
      payee_name: null,
      category_name: "Bills",
    });
    const result = formatScheduledTransaction(st, TEST_CURRENCY);
    assertEquals(result.includes("\u2014 ($100.00)  \u2014  Bills"), true);
  });

  it("formats with null category as Uncategorized", () => {
    const st = makeScheduledTransaction({ category_name: null });
    const result = formatScheduledTransaction(st, TEST_CURRENCY);
    assertEquals(result.includes("Uncategorized"), true);
  });

  it("formats weekly frequency", () => {
    const st = makeScheduledTransaction({ frequency: "weekly" });
    const result = formatScheduledTransaction(st, TEST_CURRENCY);
    assertEquals(result.includes("Every week"), true);
  });

  it("includes memo when present", () => {
    const st = makeScheduledTransaction({ memo: "Subscription" });
    const result = formatScheduledTransaction(st, TEST_CURRENCY);
    assertEquals(result.includes("\n    Memo: Subscription"), true);
  });
});

// --- formatPlan ---

describe("formatPlan", () => {
  it("formats a basic plan summary", () => {
    const plan = makePlan({
      name: "My Budget",
      last_modified_on: "2024-01-15T10:30:00+00:00",
    });
    const result = formatPlan(plan);
    assertEquals(result, "My Budget (last modified: 2024-01-15)");
  });

  it("handles plan name with special characters", () => {
    const plan = makePlan({
      name: "John & Jane's Budget",
      last_modified_on: "2024-12-31T23:59:59+00:00",
    });
    const result = formatPlan(plan);
    assertEquals(
      result,
      "John & Jane's Budget (last modified: 2024-12-31)",
    );
  });
});
