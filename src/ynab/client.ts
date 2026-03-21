import type {
  Account,
  Category,
  CategoryGroup,
  MonthDetail,
  MonthSummary,
  Payee,
  Plan,
  ScheduledTransaction,
  Transaction,
  YnabError,
} from "./types.ts";

const BASE_URL = "https://api.ynab.com/v1";

export interface TransactionParams {
  since_date?: string;
  type?: "uncategorized" | "unapproved";
  last_knowledge_of_server?: number;
}

export class YnabClient {
  private token: string;
  private rateLimitRemaining: number | null = null;

  constructor(token: string) {
    this.token = token;
  }

  /** Number of API requests remaining in the current rate-limit window, or null if unknown. */
  getRateLimitRemaining(): number | null {
    return this.rateLimitRemaining;
  }

  // ---------------------------------------------------------------------------
  // Core request helper
  // ---------------------------------------------------------------------------

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${BASE_URL}${path}`;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/json",
    };

    const init: RequestInit = { method, headers };

    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }

    const response = await fetch(url, init);

    // Track rate limit from response headers
    const rateLimitHeader = response.headers.get("X-Rate-Limit");
    if (rateLimitHeader) {
      // YNAB returns "current/limit" e.g. "36/200"
      const parts = rateLimitHeader.split("/");
      if (parts.length === 2) {
        const current = parseInt(parts[0], 10);
        const limit = parseInt(parts[1], 10);
        if (!isNaN(current) && !isNaN(limit)) {
          this.rateLimitRemaining = limit - current;
        }
      }
    }

    if (!response.ok) {
      await this.handleError(response);
    }

    const json = await response.json();
    // Unwrap YNAB response envelope: { data: T }
    return json.data as T;
  }

  private async handleError(response: Response): Promise<never> {
    let detail = "";
    try {
      const json = (await response.json()) as YnabError;
      detail = json.error?.detail ?? "";
    } catch {
      // body may not be JSON
    }

    switch (response.status) {
      case 400:
        throw new Error(
          `Bad request: ${detail || "The request was malformed"}`,
        );
      case 401:
        throw new Error(
          `Authentication failed: ${
            detail ||
            "Invalid or expired access token. Visit https://app.ynab.com/settings/developer to get a new one."
          }`,
        );
      case 403:
        throw new Error(
          `Forbidden: ${
            detail || "You do not have permission to access this resource"
          }`,
        );
      case 404:
        throw new Error(
          `Not found: ${detail || "The requested resource was not found"}`,
        );
      case 409:
        throw new Error(
          `Conflict: ${
            detail || "The request conflicts with the current state"
          }`,
        );
      case 429: {
        const retryAfter = response.headers.get("Retry-After");
        const retryMsg = retryAfter
          ? ` Retry after ${retryAfter} seconds.`
          : "";
        throw new Error(
          `Rate limit exceeded: ${detail || "Too many requests."}${retryMsg}`,
        );
      }
      case 500:
        throw new Error(
          `YNAB server error: ${
            detail || "An internal error occurred on YNAB's side"
          }`,
        );
      case 503:
        throw new Error(
          `YNAB service unavailable: ${
            detail || "The YNAB API is temporarily unavailable"
          }`,
        );
      default:
        throw new Error(
          `YNAB API error (${response.status}): ${
            detail || response.statusText
          }`,
        );
    }
  }

  // ---------------------------------------------------------------------------
  // Helper to build query strings
  // ---------------------------------------------------------------------------

  private buildQuery(
    params: Record<string, string | number | undefined>,
  ): string {
    const entries = Object.entries(params).filter(
      (entry): entry is [string, string | number] => entry[1] !== undefined,
    );
    if (entries.length === 0) return "";
    const qs = entries
      .map(([k, v]) =>
        `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`
      )
      .join("&");
    return `?${qs}`;
  }

  // ---------------------------------------------------------------------------
  // Budgets / Plans
  // ---------------------------------------------------------------------------

  getPlans(): Promise<{ budgets: Plan[] }> {
    return this.request("GET", "/budgets");
  }

  getPlan(
    planId: string,
    lastKnowledgeOfServer?: number,
  ): Promise<{ budget: Plan; server_knowledge: number }> {
    const qs = this.buildQuery({
      last_knowledge_of_server: lastKnowledgeOfServer,
    });
    return this.request("GET", `/budgets/${planId}${qs}`);
  }

  // ---------------------------------------------------------------------------
  // Accounts
  // ---------------------------------------------------------------------------

  getAccounts(
    planId: string,
    lastKnowledgeOfServer?: number,
  ): Promise<{ accounts: Account[]; server_knowledge: number }> {
    const qs = this.buildQuery({
      last_knowledge_of_server: lastKnowledgeOfServer,
    });
    return this.request("GET", `/budgets/${planId}/accounts${qs}`);
  }

  // ---------------------------------------------------------------------------
  // Categories
  // ---------------------------------------------------------------------------

  getCategories(
    planId: string,
    lastKnowledgeOfServer?: number,
  ): Promise<{ category_groups: CategoryGroup[]; server_knowledge: number }> {
    const qs = this.buildQuery({
      last_knowledge_of_server: lastKnowledgeOfServer,
    });
    return this.request("GET", `/budgets/${planId}/categories${qs}`);
  }

  getCategory(
    planId: string,
    categoryId: string,
  ): Promise<{ category: Category }> {
    return this.request("GET", `/budgets/${planId}/categories/${categoryId}`);
  }

  updateCategory(
    planId: string,
    categoryId: string,
    data: Partial<Pick<Category, "name" | "note" | "goal_type">>,
  ): Promise<{ category: Category }> {
    return this.request(
      "PATCH",
      `/budgets/${planId}/categories/${categoryId}`,
      {
        category: data,
      },
    );
  }

  updateMonthCategory(
    planId: string,
    month: string,
    categoryId: string,
    data: { budgeted: number },
  ): Promise<{ category: Category }> {
    return this.request(
      "PATCH",
      `/budgets/${planId}/months/${month}/categories/${categoryId}`,
      data,
    );
  }

  createCategory(
    _planId: string,
    _data: unknown,
  ): Promise<never> {
    throw new Error(
      "Creating categories is not supported by the YNAB API. Create categories in the YNAB app instead.",
    );
  }

  // ---------------------------------------------------------------------------
  // Payees
  // ---------------------------------------------------------------------------

  getPayees(
    planId: string,
    lastKnowledgeOfServer?: number,
  ): Promise<{ payees: Payee[]; server_knowledge: number }> {
    const qs = this.buildQuery({
      last_knowledge_of_server: lastKnowledgeOfServer,
    });
    return this.request("GET", `/budgets/${planId}/payees${qs}`);
  }

  updatePayee(
    planId: string,
    payeeId: string,
    data: Partial<Pick<Payee, "name">>,
  ): Promise<{ payee: Payee }> {
    return this.request("PATCH", `/budgets/${planId}/payees/${payeeId}`, {
      payee: data,
    });
  }

  // ---------------------------------------------------------------------------
  // Months
  // ---------------------------------------------------------------------------

  getMonths(
    planId: string,
  ): Promise<{ months: MonthSummary[] }> {
    return this.request("GET", `/budgets/${planId}/months`);
  }

  getMonth(
    planId: string,
    month: string,
  ): Promise<{ month: MonthDetail }> {
    return this.request("GET", `/budgets/${planId}/months/${month}`);
  }

  // ---------------------------------------------------------------------------
  // Transactions
  // ---------------------------------------------------------------------------

  getTransactions(
    planId: string,
    params?: TransactionParams,
  ): Promise<{ transactions: Transaction[]; server_knowledge: number }> {
    const qs = this.buildQuery({
      since_date: params?.since_date,
      type: params?.type,
      last_knowledge_of_server: params?.last_knowledge_of_server,
    });
    return this.request("GET", `/budgets/${planId}/transactions${qs}`);
  }

  getTransactionsByAccount(
    planId: string,
    accountId: string,
    params?: TransactionParams,
  ): Promise<{ transactions: Transaction[]; server_knowledge: number }> {
    const qs = this.buildQuery({
      since_date: params?.since_date,
      type: params?.type,
      last_knowledge_of_server: params?.last_knowledge_of_server,
    });
    return this.request(
      "GET",
      `/budgets/${planId}/accounts/${accountId}/transactions${qs}`,
    );
  }

  getTransactionsByCategory(
    planId: string,
    categoryId: string,
    params?: TransactionParams,
  ): Promise<{ transactions: Transaction[]; server_knowledge: number }> {
    const qs = this.buildQuery({
      since_date: params?.since_date,
      type: params?.type,
      last_knowledge_of_server: params?.last_knowledge_of_server,
    });
    return this.request(
      "GET",
      `/budgets/${planId}/categories/${categoryId}/transactions${qs}`,
    );
  }

  getTransactionsByPayee(
    planId: string,
    payeeId: string,
    params?: TransactionParams,
  ): Promise<{ transactions: Transaction[]; server_knowledge: number }> {
    const qs = this.buildQuery({
      since_date: params?.since_date,
      type: params?.type,
      last_knowledge_of_server: params?.last_knowledge_of_server,
    });
    return this.request(
      "GET",
      `/budgets/${planId}/payees/${payeeId}/transactions${qs}`,
    );
  }

  createTransactions(
    planId: string,
    transactions: Partial<Transaction>[],
  ): Promise<{
    transaction_ids: string[];
    transactions: Transaction[];
    duplicate_import_ids: string[];
    server_knowledge: number;
  }> {
    return this.request("POST", `/budgets/${planId}/transactions`, {
      transactions,
    });
  }

  updateTransactions(
    planId: string,
    transactions: Partial<Transaction>[],
  ): Promise<{
    transactions: Transaction[];
    server_knowledge: number;
  }> {
    return this.request("PATCH", `/budgets/${planId}/transactions`, {
      transactions,
    });
  }

  deleteTransaction(
    planId: string,
    transactionId: string,
  ): Promise<{ transaction: Transaction }> {
    return this.request(
      "DELETE",
      `/budgets/${planId}/transactions/${transactionId}`,
    );
  }

  importTransactions(
    planId: string,
  ): Promise<{ transaction_ids: string[] }> {
    return this.request("POST", `/budgets/${planId}/transactions/import`);
  }

  // ---------------------------------------------------------------------------
  // Scheduled Transactions
  // ---------------------------------------------------------------------------

  getScheduledTransactions(
    planId: string,
  ): Promise<{ scheduled_transactions: ScheduledTransaction[] }> {
    return this.request(
      "GET",
      `/budgets/${planId}/scheduled_transactions`,
    );
  }

  createScheduledTransaction(
    planId: string,
    data: Partial<ScheduledTransaction>,
  ): Promise<{ scheduled_transaction: ScheduledTransaction }> {
    return this.request("POST", `/budgets/${planId}/scheduled_transactions`, {
      scheduled_transaction: data,
    });
  }

  updateScheduledTransaction(
    planId: string,
    scheduledTransactionId: string,
    data: Partial<ScheduledTransaction>,
  ): Promise<{ scheduled_transaction: ScheduledTransaction }> {
    return this.request(
      "PUT",
      `/budgets/${planId}/scheduled_transactions/${scheduledTransactionId}`,
      { scheduled_transaction: data },
    );
  }

  deleteScheduledTransaction(
    planId: string,
    scheduledTransactionId: string,
  ): Promise<{ scheduled_transaction: ScheduledTransaction }> {
    return this.request(
      "DELETE",
      `/budgets/${planId}/scheduled_transactions/${scheduledTransactionId}`,
    );
  }
}
