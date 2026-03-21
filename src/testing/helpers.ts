import type {
  Account,
  Category,
  CategoryGroup,
  CurrencyFormat,
  MonthDetail,
  MonthSummary,
  Payee,
  Plan,
  ScheduledTransaction,
  SubTransaction,
  Transaction,
} from "../ynab/types.ts";

/** Default USD currency format for tests */
export const TEST_CURRENCY: CurrencyFormat = {
  iso_code: "USD",
  example_format: "123,456.78",
  decimal_digits: 2,
  decimal_separator: ".",
  symbol_first: true,
  symbol: "$",
  display_symbol: true,
  group_separator: ",",
};

// --- Mock Fetch ---

export interface MockFetchCall {
  url: string;
  init?: RequestInit;
}

export interface MockHandler {
  pattern: string | RegExp;
  method?: string;
  response: unknown;
  status?: number;
  headers?: Record<string, string>;
}

export function mockFetch() {
  const originalFetch = globalThis.fetch;
  const handlers: MockHandler[] = [];
  const calls: MockFetchCall[] = [];

  globalThis.fetch = (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
      ? input.toString()
      : input.url;
    const method = init?.method ?? "GET";
    calls.push({ url, init });

    for (const handler of handlers) {
      const urlMatch = typeof handler.pattern === "string"
        ? url.includes(handler.pattern)
        : handler.pattern.test(url);
      const methodMatch = !handler.method || handler.method === method;

      if (urlMatch && methodMatch) {
        return Promise.resolve(
          new Response(JSON.stringify(handler.response), {
            status: handler.status ?? 200,
            headers: {
              "Content-Type": "application/json",
              ...handler.headers,
            },
          }),
        );
      }
    }

    return Promise.reject(
      new Error(`Unexpected fetch call: ${method} ${url}`),
    );
  };

  return {
    mock(
      pattern: string | RegExp,
      response: unknown,
      options?: {
        method?: string;
        status?: number;
        headers?: Record<string, string>;
      },
    ) {
      handlers.push({
        pattern,
        response,
        status: options?.status,
        method: options?.method,
        headers: options?.headers,
      });
    },
    get calls() {
      return calls;
    },
    restore() {
      globalThis.fetch = originalFetch;
    },
  };
}

// --- Fixture Factories ---

export function makePlan(overrides?: Partial<Plan>): Plan {
  return {
    id: crypto.randomUUID(),
    name: "My Budget",
    last_modified_on: "2024-06-15T12:30:00+00:00",
    first_month: "2024-01-01",
    last_month: "2024-12-01",
    date_format: { format: "MM/DD/YYYY" },
    currency_format: { ...TEST_CURRENCY },
    ...overrides,
  };
}

export function makeAccount(overrides?: Partial<Account>): Account {
  return {
    id: crypto.randomUUID(),
    name: "Checking",
    type: "checking",
    on_budget: true,
    closed: false,
    balance: 1234560,
    cleared_balance: 1200000,
    uncleared_balance: 34560,
    transfer_payee_id: crypto.randomUUID(),
    deleted: false,
    ...overrides,
  };
}

export function makeCategory(overrides?: Partial<Category>): Category {
  return {
    id: crypto.randomUUID(),
    category_group_id: crypto.randomUUID(),
    category_group_name: "Everyday Expenses",
    name: "Groceries",
    hidden: false,
    budgeted: 500000,
    activity: -345670,
    balance: 154330,
    goal_type: null,
    goal_target: null,
    goal_target_month: null,
    goal_percentage_complete: null,
    goal_months_to_budget: null,
    goal_under_funded: null,
    goal_overall_funded: null,
    goal_overall_left: null,
    goal_day: null,
    goal_cadence: null,
    goal_cadence_frequency: null,
    goal_creation_month: null,
    goal_needs_whole_amount: null,
    deleted: false,
    note: null,
    ...overrides,
  };
}

export function makeCategoryGroup(
  overrides?: Partial<CategoryGroup>,
): CategoryGroup {
  return {
    id: crypto.randomUUID(),
    name: "Everyday Expenses",
    hidden: false,
    deleted: false,
    categories: [makeCategory()],
    ...overrides,
  };
}

export function makePayee(overrides?: Partial<Payee>): Payee {
  return {
    id: crypto.randomUUID(),
    name: "Grocery Store",
    transfer_account_id: null,
    deleted: false,
    ...overrides,
  };
}

export function makeTransaction(overrides?: Partial<Transaction>): Transaction {
  return {
    id: crypto.randomUUID(),
    date: "2024-01-15",
    amount: -45670,
    memo: null,
    cleared: "cleared",
    approved: true,
    flag_color: null,
    flag_name: null,
    account_id: crypto.randomUUID(),
    account_name: "Checking",
    payee_id: crypto.randomUUID(),
    payee_name: "Grocery Store",
    category_id: crypto.randomUUID(),
    category_name: "Groceries",
    transfer_account_id: null,
    transfer_transaction_id: null,
    matched_transaction_id: null,
    import_id: null,
    import_payee_name: null,
    import_payee_name_original: null,
    debt_transaction_type: null,
    deleted: false,
    subtransactions: [],
    ...overrides,
  };
}

export function makeSubTransaction(
  overrides?: Partial<SubTransaction>,
): SubTransaction {
  return {
    id: crypto.randomUUID(),
    transaction_id: crypto.randomUUID(),
    amount: -25000,
    memo: null,
    payee_id: null,
    payee_name: null,
    category_id: crypto.randomUUID(),
    category_name: "Groceries",
    transfer_account_id: null,
    transfer_transaction_id: null,
    deleted: false,
    ...overrides,
  };
}

export function makeScheduledTransaction(
  overrides?: Partial<ScheduledTransaction>,
): ScheduledTransaction {
  return {
    id: crypto.randomUUID(),
    date_first: "2024-01-15",
    date_next: "2024-02-15",
    frequency: "monthly",
    amount: -100000,
    memo: null,
    flag_color: null,
    flag_name: null,
    account_id: crypto.randomUUID(),
    account_name: "Checking",
    payee_id: crypto.randomUUID(),
    payee_name: "Netflix",
    category_id: crypto.randomUUID(),
    category_name: "Entertainment",
    subtransactions: [],
    deleted: false,
    ...overrides,
  };
}

export function makeMonthDetail(overrides?: Partial<MonthDetail>): MonthDetail {
  return {
    month: "2024-01-01",
    note: null,
    income: 5000000,
    budgeted: 4500000,
    activity: -3200000,
    to_be_budgeted: 500000,
    age_of_money: 45,
    deleted: false,
    categories: [makeCategory()],
    ...overrides,
  };
}

export function makeMonthSummary(
  overrides?: Partial<MonthSummary>,
): MonthSummary {
  return {
    month: "2024-01-01",
    note: null,
    income: 5000000,
    budgeted: 4500000,
    activity: -3200000,
    to_be_budgeted: 500000,
    age_of_money: 45,
    deleted: false,
    ...overrides,
  };
}
