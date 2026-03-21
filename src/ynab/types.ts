// YNAB API v1 response types
// All monetary values are in "milliunits" (amount * 1000)

export interface CurrencyFormat {
  iso_code: string;
  example_format: string;
  decimal_digits: number;
  decimal_separator: string;
  symbol_first: boolean;
  symbol: string;
  display_symbol: boolean;
  group_separator: string;
}

export interface Plan {
  id: string;
  name: string;
  last_modified_on: string;
  first_month: string;
  last_month: string;
  date_format: { format: string };
  currency_format: CurrencyFormat;
}

export interface Account {
  id: string;
  name: string;
  type: string;
  on_budget: boolean;
  closed: boolean;
  balance: number;
  cleared_balance: number;
  uncleared_balance: number;
  transfer_payee_id: string;
  deleted: boolean;
}

export interface CategoryGroup {
  id: string;
  name: string;
  hidden: boolean;
  deleted: boolean;
  categories: Category[];
}

export interface Category {
  id: string;
  category_group_id: string;
  category_group_name?: string;
  name: string;
  hidden: boolean;
  budgeted: number;
  activity: number;
  balance: number;
  goal_type: string | null;
  goal_target: number | null;
  goal_target_month: string | null;
  goal_percentage_complete: number | null;
  goal_months_to_budget: number | null;
  goal_under_funded: number | null;
  goal_overall_funded: number | null;
  goal_overall_left: number | null;
  goal_day: number | null;
  goal_cadence: number | null;
  goal_cadence_frequency: number | null;
  goal_creation_month: string | null;
  goal_needs_whole_amount: boolean | null;
  deleted: boolean;
  original_category_group_id?: string;
  note: string | null;
}

export interface Payee {
  id: string;
  name: string;
  transfer_account_id: string | null;
  deleted: boolean;
}

export interface SubTransaction {
  id: string;
  transaction_id: string;
  amount: number;
  memo: string | null;
  payee_id: string | null;
  payee_name: string | null;
  category_id: string | null;
  category_name: string | null;
  transfer_account_id: string | null;
  transfer_transaction_id: string | null;
  deleted: boolean;
}

export interface Transaction {
  id: string;
  date: string;
  amount: number;
  memo: string | null;
  cleared: "cleared" | "uncleared" | "reconciled";
  approved: boolean;
  flag_color: string | null;
  flag_name: string | null;
  account_id: string;
  account_name: string;
  payee_id: string | null;
  payee_name: string | null;
  category_id: string | null;
  category_name: string | null;
  transfer_account_id: string | null;
  transfer_transaction_id: string | null;
  matched_transaction_id: string | null;
  import_id: string | null;
  import_payee_name: string | null;
  import_payee_name_original: string | null;
  debt_transaction_type: string | null;
  deleted: boolean;
  subtransactions: SubTransaction[];
}

export interface ScheduledTransaction {
  id: string;
  date_first: string;
  date_next: string;
  frequency: string;
  amount: number;
  memo: string | null;
  flag_color: string | null;
  flag_name: string | null;
  account_id: string;
  account_name: string;
  payee_id: string | null;
  payee_name: string | null;
  category_id: string | null;
  category_name: string | null;
  subtransactions: SubTransaction[];
  deleted: boolean;
}

export interface MonthDetail {
  month: string;
  note: string | null;
  income: number;
  budgeted: number;
  activity: number;
  to_be_budgeted: number;
  age_of_money: number | null;
  deleted: boolean;
  categories: Category[];
}

export interface MonthSummary {
  month: string;
  note: string | null;
  income: number;
  budgeted: number;
  activity: number;
  to_be_budgeted: number;
  age_of_money: number | null;
  deleted: boolean;
}

// API response envelope
export interface YnabResponse<T> {
  data: T;
}

// API error shape
export interface YnabError {
  error: {
    id: string;
    name: string;
    detail: string;
  };
}

// Delta/incremental sync wrapper
export interface DeltaResponse<T> {
  server_knowledge: number;
  [key: string]: T[] | number;
}

// Budget settings
export interface BudgetSettings {
  date_format: { format: string };
  currency_format: CurrencyFormat;
}
