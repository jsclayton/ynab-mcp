import type {
  Account,
  Category,
  CategoryGroup,
  CurrencyFormat,
  MonthDetail,
  MonthSummary,
  Plan,
  ScheduledTransaction,
  Transaction,
} from "./types.ts";

const DEFAULT_CURRENCY: CurrencyFormat = {
  iso_code: "USD",
  example_format: "123,456.78",
  decimal_digits: 2,
  decimal_separator: ".",
  symbol_first: true,
  symbol: "$",
  display_symbol: true,
  group_separator: ",",
};

/** Convert milliunits to dollars (number). 1234560 -> 1234.56 */
export function milliunitsToDollars(milliunits: number): number {
  return milliunits / 1000;
}

/** Convert dollars to milliunits. 1234.56 -> 1234560 */
export function dollarsToMilliunits(dollars: number): number {
  return Math.round(dollars * 1000);
}

/**
 * Format milliunits as currency string using the given currency format.
 * Negative amounts shown in parens: ($50.00)
 * Uses group separator for thousands.
 */
export function formatMoney(
  milliunits: number,
  currency?: CurrencyFormat,
): string {
  const fmt = currency ?? DEFAULT_CURRENCY;
  const isNegative = milliunits < 0;
  const absDollars = Math.abs(milliunitsToDollars(milliunits));

  // Split into integer and fractional parts with correct decimal digits
  const fixed = absDollars.toFixed(fmt.decimal_digits);
  const [intPart, decPart] = fixed.split(".");

  // Apply group separator to the integer part (groups of 3 from the right)
  let grouped = "";
  const digits = intPart;
  const len = digits.length;
  for (let i = 0; i < len; i++) {
    if (i > 0 && (len - i) % 3 === 0) {
      grouped += fmt.group_separator;
    }
    grouped += digits[i];
  }

  // Build the numeric string
  let numStr = grouped;
  if (fmt.decimal_digits > 0 && decPart !== undefined) {
    numStr += fmt.decimal_separator + decPart;
  }

  // Apply symbol
  let result: string;
  if (fmt.display_symbol) {
    if (fmt.symbol_first) {
      result = fmt.symbol + numStr;
    } else {
      result = numStr + " " + fmt.symbol;
    }
  } else {
    result = numStr;
  }

  if (isNegative) {
    return "(" + result + ")";
  }
  return result;
}

/**
 * Format a single transaction into a compact string.
 * Format: "[id]  2024-01-15  $45.67  Grocery Store  Groceries  checkmark"
 * Cleared indicators: checkmark = cleared, bullet = uncleared, R = reconciled
 * If memo exists, add it on a new indented line.
 * If subtransactions exist, list them indented.
 */
export function formatTransaction(
  txn: Transaction,
  currency?: CurrencyFormat,
): string {
  const payee = txn.payee_name ?? "\u2014";
  const category = txn.category_name ?? "Uncategorized";
  const account = txn.account_name;
  const approvedIndicator = txn.approved ? "" : "\u2691 ";
  const clearedIndicator = txn.cleared === "cleared"
    ? "\u2713"
    : txn.cleared === "reconciled"
    ? "R"
    : "\u2022";
  const amount = formatMoney(txn.amount, currency);

  let line =
    `[${txn.id}]  ${txn.date}  ${amount}  ${payee}  ${category}  ${account}  ${approvedIndicator}${clearedIndicator}`;

  if (
    txn.import_payee_name != null && txn.import_payee_name.length > 0 &&
    txn.import_payee_name !== txn.payee_name
  ) {
    line += `\n    Bank payee: ${txn.import_payee_name}`;
  }

  if (txn.matched_transaction_id != null) {
    line += `\n    Matched: [${txn.matched_transaction_id}]`;
  }

  if (txn.memo != null && txn.memo.length > 0) {
    line += `\n    Memo: ${txn.memo}`;
  }

  if (txn.subtransactions && txn.subtransactions.length > 0) {
    for (const sub of txn.subtransactions) {
      const subPayee = sub.payee_name ?? payee;
      const subCategory = sub.category_name ?? "Uncategorized";
      const subAmount = formatMoney(sub.amount, currency);
      line += `\n    ${subAmount}  ${subPayee}  ${subCategory}`;
      if (sub.memo != null && sub.memo.length > 0) {
        line += `  (${sub.memo})`;
      }
    }
  }

  return line;
}

/**
 * Format an account into a compact string.
 * Format: "Checking (checking) -- $1,234.56  [cleared: $1,200.00  uncleared: $34.56]"
 * Closed accounts: append " (closed)"
 */
export function formatAccount(
  account: Account,
  currency?: CurrencyFormat,
): string {
  const balance = formatMoney(account.balance, currency);
  const cleared = formatMoney(account.cleared_balance, currency);
  const uncleared = formatMoney(account.uncleared_balance, currency);
  let line =
    `[${account.id}]  ${account.name} (${account.type}) \u2014 ${balance}  [cleared: ${cleared}  uncleared: ${uncleared}]`;
  if (account.closed) {
    line += " (closed)";
  }
  return line;
}

/**
 * Format a category with budget details.
 * Format: "Groceries -- Budgeted: $500.00  Spent: ($345.67)  Available: $154.33"
 * If has goal, append goal info on next line.
 */
export function formatCategory(
  category: Category,
  currency?: CurrencyFormat,
): string {
  const budgeted = formatMoney(category.budgeted, currency);
  const spent = formatMoney(category.activity, currency);
  const available = formatMoney(category.balance, currency);

  let line =
    `[${category.id}]  ${category.name} \u2014 Budgeted: ${budgeted}  Spent: ${spent}  Available: ${available}`;

  if (category.hidden) {
    line += " (hidden)";
  }

  if (category.goal_type != null) {
    const goalParts: string[] = [`Goal: ${formatGoalType(category.goal_type)}`];
    if (category.goal_target != null) {
      goalParts.push(`Target: ${formatMoney(category.goal_target, currency)}`);
    }
    if (category.goal_target_month != null) {
      goalParts.push(`By: ${category.goal_target_month}`);
    }
    if (category.goal_percentage_complete != null) {
      goalParts.push(`${category.goal_percentage_complete}% complete`);
    }
    if (category.goal_under_funded != null && category.goal_under_funded > 0) {
      goalParts.push(
        `Underfunded: ${formatMoney(category.goal_under_funded, currency)}`,
      );
    }
    line += "\n    " + goalParts.join("  ");
  }

  return line;
}

function formatGoalType(goalType: string): string {
  switch (goalType) {
    case "TB":
      return "Target Balance";
    case "TBD":
      return "Target by Date";
    case "MF":
      return "Monthly Funding";
    case "NEED":
      return "Spending Target";
    case "DEBT":
      return "Debt Payment";
    default:
      return goalType;
  }
}

/**
 * Format a category group with its categories.
 * Group name as header, then indented categories.
 */
export function formatCategoryGroup(
  group: CategoryGroup,
  currency?: CurrencyFormat,
): string {
  const lines: string[] = [group.name];
  if (group.categories && group.categories.length > 0) {
    for (const cat of group.categories) {
      lines.push("  " + formatCategory(cat, currency));
    }
  }
  return lines.join("\n");
}

/**
 * Format a month summary.
 * "January 2024 -- Income: $5,000.00  Budgeted: $4,500.00  Activity: ($3,200.00)  TBB: $500.00"
 * If age_of_money, append "Age of Money: X days"
 */
export function formatMonthSummary(
  month: MonthSummary | MonthDetail,
  currency?: CurrencyFormat,
): string {
  const monthLabel = formatMonthLabel(month.month);
  const income = formatMoney(month.income, currency);
  const budgeted = formatMoney(month.budgeted, currency);
  const activity = formatMoney(month.activity, currency);
  const tbb = formatMoney(month.to_be_budgeted, currency);

  let line =
    `${monthLabel} \u2014 Income: ${income}  Budgeted: ${budgeted}  Activity: ${activity}  TBB: ${tbb}`;

  if (month.age_of_money != null) {
    line += `  Age of Money: ${month.age_of_money} days`;
  }

  return line;
}

function formatMonthLabel(monthStr: string): string {
  // monthStr is typically "2024-01-01" or "2024-01"
  const parts = monthStr.split("-");
  if (parts.length < 2) return monthStr;

  const year = parts[0];
  const monthNum = parseInt(parts[1], 10);
  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const name = monthNames[monthNum - 1] ?? parts[1];
  return `${name} ${year}`;
}

/**
 * Format a scheduled transaction.
 * "Every month -- $100.00  Netflix  Entertainment  Next: 2024-02-15"
 */
export function formatScheduledTransaction(
  st: ScheduledTransaction,
  currency?: CurrencyFormat,
): string {
  const amount = formatMoney(st.amount, currency);
  const payee = st.payee_name ?? "\u2014";
  const category = st.category_name ?? "Uncategorized";
  const freq = formatFrequency(st.frequency);

  let line =
    `[${st.id}]  ${freq} \u2014 ${amount}  ${payee}  ${category}  Next: ${st.date_next}`;

  if (st.memo != null && st.memo.length > 0) {
    line += `\n    Memo: ${st.memo}`;
  }

  return line;
}

function formatFrequency(frequency: string): string {
  switch (frequency) {
    case "never":
      return "Once";
    case "daily":
      return "Every day";
    case "weekly":
      return "Every week";
    case "everyOtherWeek":
      return "Every other week";
    case "twiceAMonth":
      return "Twice a month";
    case "every4Weeks":
      return "Every 4 weeks";
    case "monthly":
      return "Every month";
    case "everyOtherMonth":
      return "Every other month";
    case "every3Months":
      return "Every 3 months";
    case "every4Months":
      return "Every 4 months";
    case "twiceAYear":
      return "Twice a year";
    case "yearly":
      return "Every year";
    case "everyOtherYear":
      return "Every other year";
    default:
      return frequency;
  }
}

/**
 * Format a plan (budget) summary.
 * "My Budget (last modified: 2024-01-15)"
 */
export function formatPlan(plan: Plan): string {
  const lastMod = plan.last_modified_on.split("T")[0];
  return `${plan.name} (last modified: ${lastMod})`;
}
