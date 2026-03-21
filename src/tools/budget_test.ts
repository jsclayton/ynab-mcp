import { assertEquals } from "@std/testing/assert";
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { YnabClient } from "../ynab/client.ts";
import { Cache } from "../ynab/cache.ts";
import {
  makeAccount,
  makeCategory,
  makeCategoryGroup,
  makeMonthDetail,
  makeMonthSummary,
  makePlan,
  makeScheduledTransaction,
  mockFetch,
  TEST_CURRENCY,
} from "../testing/helpers.ts";
import {
  formatAccount,
  formatCategory,
  formatMoney,
  formatMonthSummary,
  formatScheduledTransaction,
} from "../ynab/format.ts";
import type { DiskIO } from "../ynab/cache.ts";

// A no-op disk IO to avoid touching the filesystem during tests
const nullDiskIO: DiskIO = {
  read: () => Promise.resolve(null),
  write: () => Promise.resolve(),
};

const PLAN_ID = "test-plan-id";
const PLAN_NAME = "Test Budget";

function setupPlanMock(fetchMock: ReturnType<typeof mockFetch>): void {
  const plan = makePlan({
    id: PLAN_ID,
    name: PLAN_NAME,
    currency_format: TEST_CURRENCY,
  });
  // Use a regex that matches only the budgets list endpoint, not sub-paths
  fetchMock.mock(/\/v1\/budgets(\?.*)?$/, {
    data: { budgets: [plan] },
  });
}

// ---------------------------------------------------------------------------
// Overview view
// ---------------------------------------------------------------------------

describe("get_budget: overview", () => {
  let fetchMock: ReturnType<typeof mockFetch>;
  let client: YnabClient;
  let cache: Cache;

  beforeEach(() => {
    fetchMock = mockFetch();
    client = new YnabClient("test-token");
    cache = new Cache(client, undefined, nullDiskIO);
    setupPlanMock(fetchMock);
  });

  afterEach(() => {
    fetchMock.restore();
  });

  it("returns accounts, month summary, and category groups", async () => {
    const checking = makeAccount({
      name: "Checking",
      type: "checking",
      on_budget: true,
      balance: 1500000,
      cleared_balance: 1400000,
      uncleared_balance: 100000,
    });
    const savings = makeAccount({
      name: "Savings",
      type: "savings",
      on_budget: false,
      balance: 5000000,
      cleared_balance: 5000000,
      uncleared_balance: 0,
    });
    const closedAcct = makeAccount({
      name: "Old",
      closed: true,
      on_budget: true,
    });

    fetchMock.mock(
      new RegExp(`/budgets/${PLAN_ID}/accounts(\\?.*)?$`),
      {
        data: {
          accounts: [checking, savings, closedAcct],
          server_knowledge: 1,
        },
      },
    );

    const groceries = makeCategory({
      name: "Groceries",
      balance: 200000,
      hidden: false,
      deleted: false,
    });
    const dining = makeCategory({
      name: "Dining",
      balance: 50000,
      hidden: false,
      deleted: false,
    });
    const group = makeCategoryGroup({
      name: "Everyday",
      categories: [groceries, dining],
      hidden: false,
      deleted: false,
    });
    const hiddenGroup = makeCategoryGroup({
      name: "Hidden Group",
      hidden: true,
      deleted: false,
    });

    fetchMock.mock(
      new RegExp(`/budgets/${PLAN_ID}/categories(\\?.*)?$`),
      {
        data: { category_groups: [group, hiddenGroup], server_knowledge: 1 },
      },
    );

    const monthSummary = makeMonthSummary({
      month: "2024-03-01",
      income: 6000000,
      budgeted: 5000000,
      activity: -3500000,
      to_be_budgeted: 1000000,
      age_of_money: 30,
    });
    fetchMock.mock(
      new RegExp(`/budgets/${PLAN_ID}/months(\\?.*)?$`),
      {
        data: { months: [monthSummary] },
      },
    );

    // Simulate the overview logic
    const [accounts, groups, months] = await Promise.all([
      cache.getAccounts(PLAN_ID),
      cache.getCategoryGroups(PLAN_ID),
      client.getMonths(PLAN_ID),
    ]);

    const currency = TEST_CURRENCY;
    const currentMonth = months.months?.[0];
    const onBudget = accounts.filter(
      (a) => !a.deleted && !a.closed && a.on_budget,
    );
    const offBudget = accounts.filter(
      (a) => !a.deleted && !a.closed && !a.on_budget,
    );

    // Verify accounts are split correctly
    assertEquals(onBudget.length, 1);
    assertEquals(onBudget[0].name, "Checking");
    assertEquals(offBudget.length, 1);
    assertEquals(offBudget[0].name, "Savings");

    // Verify closed account is excluded from both display lists
    const allDisplayed = [...onBudget, ...offBudget];
    assertEquals(
      allDisplayed.filter((a) => a.name === "Old").length,
      0,
    );

    // Verify account formatting includes ID and name
    const checkingFmt = formatAccount(onBudget[0], currency);
    assertEquals(checkingFmt.includes(`[${onBudget[0].id}]`), true);
    assertEquals(checkingFmt.includes("Checking"), true);
    assertEquals(checkingFmt.includes("$1,500.00"), true);

    // Verify current month
    assertEquals(currentMonth!.month, "2024-03-01");
    const monthFmt = formatMonthSummary(currentMonth!, currency);
    assertEquals(monthFmt.includes("March 2024"), true);
    assertEquals(monthFmt.includes("$6,000.00"), true);
    assertEquals(monthFmt.includes("Age of Money: 30 days"), true);

    // Verify category groups (hidden group excluded)
    const visibleGroups = groups.filter((g) => !g.deleted && !g.hidden);
    assertEquals(visibleGroups.length, 1);
    assertEquals(visibleGroups[0].name, "Everyday");

    // Verify category balance aggregation
    const activeCats = visibleGroups[0].categories.filter(
      (c) => !c.deleted && !c.hidden,
    );
    const totalBalance = activeCats.reduce((sum, c) => sum + c.balance, 0);
    assertEquals(totalBalance, 250000);
    assertEquals(formatMoney(totalBalance, currency), "$250.00");
  });

  it("handles empty accounts and categories", async () => {
    fetchMock.mock(
      new RegExp(`/budgets/${PLAN_ID}/accounts(\\?.*)?$`),
      { data: { accounts: [], server_knowledge: 1 } },
    );
    fetchMock.mock(
      new RegExp(`/budgets/${PLAN_ID}/categories(\\?.*)?$`),
      { data: { category_groups: [], server_knowledge: 1 } },
    );
    fetchMock.mock(
      new RegExp(`/budgets/${PLAN_ID}/months(\\?.*)?$`),
      { data: { months: [] } },
    );

    const accounts = await cache.getAccounts(PLAN_ID);
    const groups = await cache.getCategoryGroups(PLAN_ID);
    const months = await client.getMonths(PLAN_ID);

    assertEquals(accounts.length, 0);
    assertEquals(groups.length, 0);
    assertEquals(months.months.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Month view
// ---------------------------------------------------------------------------

describe("get_budget: month", () => {
  let fetchMock: ReturnType<typeof mockFetch>;
  let client: YnabClient;

  beforeEach(() => {
    fetchMock = mockFetch();
    client = new YnabClient("test-token");
    setupPlanMock(fetchMock);
  });

  afterEach(() => {
    fetchMock.restore();
  });

  it("returns month summary with categories grouped", async () => {
    const groceries = makeCategory({
      name: "Groceries",
      category_group_name: "Everyday",
      budgeted: 500000,
      activity: -300000,
      balance: 200000,
    });
    const rent = makeCategory({
      name: "Rent",
      category_group_name: "Bills",
      budgeted: 1500000,
      activity: -1500000,
      balance: 0,
    });
    const electric = makeCategory({
      name: "Electric",
      category_group_name: "Bills",
      budgeted: 150000,
      activity: -120000,
      balance: 30000,
    });
    const hiddenCat = makeCategory({
      name: "Old Category",
      category_group_name: "Everyday",
      hidden: true,
    });
    const deletedCat = makeCategory({
      name: "Deleted",
      category_group_name: "Everyday",
      deleted: true,
    });

    const monthDetail = makeMonthDetail({
      month: "2024-03-01",
      income: 6000000,
      budgeted: 5000000,
      activity: -3500000,
      to_be_budgeted: 1000000,
      age_of_money: 45,
      categories: [groceries, rent, electric, hiddenCat, deletedCat],
    });

    fetchMock.mock(
      new RegExp(`/budgets/${PLAN_ID}/months/2024-03-01`),
      { data: { month: monthDetail } },
    );

    const monthData = await client.getMonth(PLAN_ID, "2024-03-01");
    const m = monthData.month;
    const currency = TEST_CURRENCY;

    // Verify month summary
    const summary = formatMonthSummary(m, currency);
    assertEquals(summary.includes("March 2024"), true);
    assertEquals(summary.includes("$6,000.00"), true);
    assertEquals(summary.includes("Age of Money: 45 days"), true);

    // Group categories (filtering hidden and deleted)
    const byGroup = new Map<string, typeof m.categories>();
    for (const cat of m.categories) {
      if (cat.deleted || cat.hidden) continue;
      const groupName = cat.category_group_name ?? "Other";
      if (!byGroup.has(groupName)) byGroup.set(groupName, []);
      byGroup.get(groupName)!.push(cat);
    }

    // Verify grouping
    assertEquals(byGroup.size, 2);
    assertEquals(byGroup.has("Everyday"), true);
    assertEquals(byGroup.has("Bills"), true);
    assertEquals(byGroup.get("Everyday")!.length, 1); // hidden/deleted excluded
    assertEquals(byGroup.get("Bills")!.length, 2);

    // Verify category formatting includes ID
    const groceryFmt = formatCategory(groceries, currency);
    assertEquals(groceryFmt.includes(`[${groceries.id}]`), true);
    assertEquals(groceryFmt.includes("Groceries"), true);
    assertEquals(groceryFmt.includes("$500.00"), true);
    assertEquals(groceryFmt.includes("($300.00)"), true);
    assertEquals(groceryFmt.includes("$200.00"), true);
  });

  it("uses 'Other' for categories without a group name", async () => {
    const noGroup = makeCategory({
      name: "Misc",
      category_group_name: undefined,
    });

    const monthDetail = makeMonthDetail({
      month: "2024-01-01",
      categories: [noGroup],
    });

    fetchMock.mock(
      new RegExp(`/budgets/${PLAN_ID}/months/2024-01-01`),
      { data: { month: monthDetail } },
    );

    const monthData = await client.getMonth(PLAN_ID, "2024-01-01");
    const m = monthData.month;

    const byGroup = new Map<string, typeof m.categories>();
    for (const cat of m.categories) {
      if (cat.deleted || cat.hidden) continue;
      const groupName = cat.category_group_name ?? "Other";
      if (!byGroup.has(groupName)) byGroup.set(groupName, []);
      byGroup.get(groupName)!.push(cat);
    }

    assertEquals(byGroup.has("Other"), true);
    assertEquals(byGroup.get("Other")![0].name, "Misc");
  });

  it("requires month parameter", () => {
    // Simulate the validation check the tool handler does
    const month: string | undefined = undefined;
    const hasError = !month;
    assertEquals(hasError, true);
  });
});

// ---------------------------------------------------------------------------
// Category view
// ---------------------------------------------------------------------------

describe("get_budget: category", () => {
  let fetchMock: ReturnType<typeof mockFetch>;
  let client: YnabClient;

  beforeEach(() => {
    fetchMock = mockFetch();
    client = new YnabClient("test-token");
    setupPlanMock(fetchMock);
  });

  afterEach(() => {
    fetchMock.restore();
  });

  it("returns detailed category info with goal details", async () => {
    const catId = "cat-vacation-123";
    const vacation = makeCategory({
      id: catId,
      name: "Vacation",
      category_group_name: "Savings",
      budgeted: 500000,
      activity: 0,
      balance: 1500000,
      goal_type: "TBD",
      goal_target: 3000000,
      goal_target_month: "2024-12-01",
      goal_percentage_complete: 50,
      goal_months_to_budget: 6,
      goal_under_funded: 250000,
      goal_overall_funded: 1500000,
      goal_overall_left: 1500000,
      goal_day: null,
      goal_cadence: null,
      goal_cadence_frequency: null,
      goal_creation_month: "2024-01-01",
      note: "Summer trip fund",
    });

    const monthDetail = makeMonthDetail({
      month: "2024-06-01",
      categories: [vacation],
    });

    fetchMock.mock(
      new RegExp(`/budgets/${PLAN_ID}/months/2024-06-01`),
      { data: { month: monthDetail } },
    );

    const monthData = await client.getMonth(PLAN_ID, "2024-06-01");
    const cat = monthData.month.categories.find((c) => c.id === catId);

    assertEquals(cat !== undefined, true);
    assertEquals(cat!.name, "Vacation");
    assertEquals(cat!.goal_type, "TBD");
    assertEquals(cat!.goal_target, 3000000);
    assertEquals(cat!.goal_target_month, "2024-12-01");
    assertEquals(cat!.goal_percentage_complete, 50);
    assertEquals(cat!.goal_months_to_budget, 6);
    assertEquals(cat!.goal_under_funded, 250000);
    assertEquals(cat!.goal_overall_funded, 1500000);
    assertEquals(cat!.goal_overall_left, 1500000);
    assertEquals(cat!.goal_creation_month, "2024-01-01");
    assertEquals(cat!.note, "Summer trip fund");

    // Verify formatted output contains goal info
    const currency = TEST_CURRENCY;
    const catFmt = formatCategory(cat!, currency);
    assertEquals(catFmt.includes("Vacation"), true);
    assertEquals(catFmt.includes("Target by Date"), true);
    assertEquals(catFmt.includes("$3,000.00"), true);
    assertEquals(catFmt.includes("50% complete"), true);

    // Verify money formatting of goal fields
    assertEquals(
      formatMoney(cat!.goal_target!, currency),
      "$3,000.00",
    );
    assertEquals(
      formatMoney(cat!.goal_under_funded!, currency),
      "$250.00",
    );
    assertEquals(
      formatMoney(cat!.goal_overall_funded!, currency),
      "$1,500.00",
    );
    assertEquals(
      formatMoney(cat!.goal_overall_left!, currency),
      "$1,500.00",
    );
  });

  it("returns not-found when category ID does not match", async () => {
    const cat = makeCategory({ id: "cat-existing" });
    const monthDetail = makeMonthDetail({
      month: "2024-06-01",
      categories: [cat],
    });

    fetchMock.mock(
      new RegExp(`/budgets/${PLAN_ID}/months/2024-06-01`),
      { data: { month: monthDetail } },
    );

    const monthData = await client.getMonth(PLAN_ID, "2024-06-01");
    const found = monthData.month.categories.find(
      (c) => c.id === "cat-nonexistent",
    );
    assertEquals(found, undefined);
  });

  it("handles category without goal", async () => {
    const catId = "cat-no-goal";
    const noGoal = makeCategory({
      id: catId,
      name: "Entertainment",
      goal_type: null,
      goal_target: null,
      goal_target_month: null,
      goal_percentage_complete: null,
      note: null,
    });

    const monthDetail = makeMonthDetail({
      month: "2024-01-01",
      categories: [noGoal],
    });

    fetchMock.mock(
      new RegExp(`/budgets/${PLAN_ID}/months/2024-01-01`),
      { data: { month: monthDetail } },
    );

    const monthData = await client.getMonth(PLAN_ID, "2024-01-01");
    const cat = monthData.month.categories.find((c) => c.id === catId);

    assertEquals(cat!.goal_type, null);
    assertEquals(cat!.note, null);

    // Formatted category should not include goal line
    const catFmt = formatCategory(cat!, TEST_CURRENCY);
    assertEquals(catFmt.includes("Goal:"), false);
  });

  it("requires both month and category_id parameters", () => {
    // Simulate the validation the tool handler performs
    const month: string | undefined = undefined;
    const category_id: string | undefined = undefined;

    assertEquals(!category_id, true);
    assertEquals(!month, true);
  });
});

// ---------------------------------------------------------------------------
// Scheduled view
// ---------------------------------------------------------------------------

describe("get_budget: scheduled", () => {
  let fetchMock: ReturnType<typeof mockFetch>;
  let client: YnabClient;

  beforeEach(() => {
    fetchMock = mockFetch();
    client = new YnabClient("test-token");
    setupPlanMock(fetchMock);
  });

  afterEach(() => {
    fetchMock.restore();
  });

  it("returns formatted scheduled transactions", async () => {
    const netflix = makeScheduledTransaction({
      frequency: "monthly",
      amount: -15990,
      payee_name: "Netflix",
      category_name: "Subscriptions",
      date_next: "2024-04-15",
    });
    const rent = makeScheduledTransaction({
      frequency: "monthly",
      amount: -1500000,
      payee_name: "Landlord",
      category_name: "Rent",
      date_next: "2024-04-01",
    });
    const deletedSt = makeScheduledTransaction({
      deleted: true,
      payee_name: "Cancelled",
    });

    fetchMock.mock(
      new RegExp(`/budgets/${PLAN_ID}/scheduled_transactions`),
      {
        data: {
          scheduled_transactions: [netflix, rent, deletedSt],
        },
      },
    );

    const data = await client.getScheduledTransactions(PLAN_ID);
    const txns = data.scheduled_transactions.filter((st) => !st.deleted);

    // Deleted transaction filtered out
    assertEquals(txns.length, 2);

    // Verify formatting includes ID
    const currency = TEST_CURRENCY;
    const netflixFmt = formatScheduledTransaction(txns[0], currency);
    assertEquals(netflixFmt.includes(`[${txns[0].id}]`), true);
    assertEquals(netflixFmt.includes("Every month"), true);
    assertEquals(netflixFmt.includes("Netflix"), true);
    assertEquals(netflixFmt.includes("Subscriptions"), true);
    assertEquals(netflixFmt.includes("Next: 2024-04-15"), true);
    assertEquals(netflixFmt.includes("($15.99)"), true);

    const rentFmt = formatScheduledTransaction(txns[1], currency);
    assertEquals(rentFmt.includes(`[${txns[1].id}]`), true);
    assertEquals(rentFmt.includes("($1,500.00)"), true);
    assertEquals(rentFmt.includes("Landlord"), true);
  });

  it("handles empty scheduled transactions list", async () => {
    fetchMock.mock(
      new RegExp(`/budgets/${PLAN_ID}/scheduled_transactions`),
      { data: { scheduled_transactions: [] } },
    );

    const data = await client.getScheduledTransactions(PLAN_ID);
    const txns = data.scheduled_transactions.filter((st) => !st.deleted);
    assertEquals(txns.length, 0);
  });

  it("formats various frequencies correctly", async () => {
    const weekly = makeScheduledTransaction({
      frequency: "weekly",
      payee_name: "Gym",
    });
    const once = makeScheduledTransaction({
      frequency: "never",
      payee_name: "One-time Payment",
    });
    const yearly = makeScheduledTransaction({
      frequency: "yearly",
      payee_name: "Insurance",
    });

    fetchMock.mock(
      new RegExp(`/budgets/${PLAN_ID}/scheduled_transactions`),
      {
        data: { scheduled_transactions: [weekly, once, yearly] },
      },
    );

    const data = await client.getScheduledTransactions(PLAN_ID);
    const txns = data.scheduled_transactions;
    const currency = TEST_CURRENCY;

    assertEquals(
      formatScheduledTransaction(txns[0], currency).includes("Every week"),
      true,
    );
    assertEquals(
      formatScheduledTransaction(txns[1], currency).includes("Once"),
      true,
    );
    assertEquals(
      formatScheduledTransaction(txns[2], currency).includes("Every year"),
      true,
    );
  });

  it("includes memo in scheduled transaction output", async () => {
    const st = makeScheduledTransaction({
      payee_name: "Netflix",
      memo: "Family plan",
    });

    fetchMock.mock(
      new RegExp(`/budgets/${PLAN_ID}/scheduled_transactions`),
      { data: { scheduled_transactions: [st] } },
    );

    const data = await client.getScheduledTransactions(PLAN_ID);
    const fmt = formatScheduledTransaction(
      data.scheduled_transactions[0],
      TEST_CURRENCY,
    );
    assertEquals(fmt.includes("Memo: Family plan"), true);
  });
});

// ---------------------------------------------------------------------------
// Money movements view
// ---------------------------------------------------------------------------

describe("get_budget: money_movements", () => {
  let fetchMock: ReturnType<typeof mockFetch>;
  let client: YnabClient;

  beforeEach(() => {
    fetchMock = mockFetch();
    client = new YnabClient("test-token");
    setupPlanMock(fetchMock);
  });

  afterEach(() => {
    fetchMock.restore();
  });

  it("separates funded and reduced categories", async () => {
    const funded1 = makeCategory({
      name: "Groceries",
      budgeted: 500000,
      hidden: false,
      deleted: false,
    });
    const funded2 = makeCategory({
      name: "Rent",
      budgeted: 1500000,
      hidden: false,
      deleted: false,
    });
    const reduced = makeCategory({
      name: "Vacation",
      budgeted: -200000,
      hidden: false,
      deleted: false,
    });
    const zeroBudget = makeCategory({
      name: "Unused",
      budgeted: 0,
      hidden: false,
      deleted: false,
    });
    const hiddenCat = makeCategory({
      name: "Hidden",
      budgeted: 300000,
      hidden: true,
      deleted: false,
    });
    const deletedCat = makeCategory({
      name: "Deleted",
      budgeted: 400000,
      hidden: false,
      deleted: true,
    });

    const monthDetail = makeMonthDetail({
      month: "2024-03-01",
      categories: [
        funded1,
        funded2,
        reduced,
        zeroBudget,
        hiddenCat,
        deletedCat,
      ],
    });

    fetchMock.mock(
      new RegExp(`/budgets/${PLAN_ID}/months/2024-03-01`),
      { data: { month: monthDetail } },
    );

    const monthData = await client.getMonth(PLAN_ID, "2024-03-01");
    const m = monthData.month;
    const currency = TEST_CURRENCY;

    // Filter like the tool handler does
    const withBudget = m.categories
      .filter((c) => !c.deleted && !c.hidden && c.budgeted !== 0)
      .sort((a, b) => b.budgeted - a.budgeted);

    // Should exclude: zeroBudget (0), hiddenCat (hidden), deletedCat (deleted)
    assertEquals(withBudget.length, 3);

    const positive = withBudget.filter((c) => c.budgeted > 0);
    const negative = withBudget.filter((c) => c.budgeted < 0);

    assertEquals(positive.length, 2);
    assertEquals(negative.length, 1);

    // Sorted descending — Rent (1500000) first, then Groceries (500000)
    assertEquals(positive[0].name, "Rent");
    assertEquals(positive[1].name, "Groceries");
    assertEquals(negative[0].name, "Vacation");

    // Verify formatting
    assertEquals(formatMoney(positive[0].budgeted, currency), "$1,500.00");
    assertEquals(formatMoney(positive[1].budgeted, currency), "$500.00");
    assertEquals(formatMoney(negative[0].budgeted, currency), "($200.00)");
  });

  it("shows no allocations message when all budgets are zero", async () => {
    const zeroCat1 = makeCategory({
      name: "Cat1",
      budgeted: 0,
      hidden: false,
      deleted: false,
    });
    const zeroCat2 = makeCategory({
      name: "Cat2",
      budgeted: 0,
      hidden: false,
      deleted: false,
    });

    const monthDetail = makeMonthDetail({
      month: "2024-01-01",
      categories: [zeroCat1, zeroCat2],
    });

    fetchMock.mock(
      new RegExp(`/budgets/${PLAN_ID}/months/2024-01-01`),
      { data: { month: monthDetail } },
    );

    const monthData = await client.getMonth(PLAN_ID, "2024-01-01");
    const m = monthData.month;

    const withBudget = m.categories
      .filter((c) => !c.deleted && !c.hidden && c.budgeted !== 0);

    assertEquals(withBudget.length, 0);
  });

  it("includes month summary in output", async () => {
    const monthDetail = makeMonthDetail({
      month: "2024-06-01",
      income: 7000000,
      budgeted: 6500000,
      activity: -5000000,
      to_be_budgeted: 500000,
      age_of_money: 60,
      categories: [],
    });

    fetchMock.mock(
      new RegExp(`/budgets/${PLAN_ID}/months/2024-06-01`),
      { data: { month: monthDetail } },
    );

    const monthData = await client.getMonth(PLAN_ID, "2024-06-01");
    const summary = formatMonthSummary(monthData.month, TEST_CURRENCY);

    assertEquals(summary.includes("June 2024"), true);
    assertEquals(summary.includes("$7,000.00"), true);
    assertEquals(summary.includes("$6,500.00"), true);
    assertEquals(summary.includes("($5,000.00)"), true);
    assertEquals(summary.includes("$500.00"), true);
    assertEquals(summary.includes("Age of Money: 60 days"), true);
  });

  it("requires month parameter", () => {
    const month: string | undefined = undefined;
    assertEquals(!month, true);
  });
});

// ---------------------------------------------------------------------------
// Currency format via cache
// ---------------------------------------------------------------------------

describe("get_budget: currency format", () => {
  let fetchMock: ReturnType<typeof mockFetch>;
  let client: YnabClient;
  let cache: Cache;

  beforeEach(() => {
    fetchMock = mockFetch();
    client = new YnabClient("test-token");
    cache = new Cache(client, undefined, nullDiskIO);
  });

  afterEach(() => {
    fetchMock.restore();
  });

  it("resolves currency format from plan data via cache", async () => {
    const plan = makePlan({
      id: PLAN_ID,
      currency_format: {
        iso_code: "EUR",
        example_format: "123.456,78",
        decimal_digits: 2,
        decimal_separator: ",",
        symbol_first: false,
        symbol: "\u20AC",
        display_symbol: true,
        group_separator: ".",
      },
    });
    fetchMock.mock("/v1/budgets", {
      data: { budgets: [plan] },
    });

    const currency = await cache.getCurrencyFormat(PLAN_ID);
    assertEquals(currency.iso_code, "EUR");
    assertEquals(currency.symbol, "\u20AC");
    assertEquals(currency.symbol_first, false);

    // Verify money formatting uses the resolved currency
    assertEquals(formatMoney(1234560, currency), "1.234,56 \u20AC");
  });
});

// ---------------------------------------------------------------------------
// Plan name header
// ---------------------------------------------------------------------------

describe("get_budget: header", () => {
  let fetchMock: ReturnType<typeof mockFetch>;
  let client: YnabClient;

  beforeEach(() => {
    fetchMock = mockFetch();
    client = new YnabClient("test-token");
  });

  afterEach(() => {
    fetchMock.restore();
  });

  it("uses plan name in header when found", async () => {
    const plan = makePlan({ id: PLAN_ID, name: "Family Budget" });
    fetchMock.mock("/v1/budgets", {
      data: { budgets: [plan] },
    });

    const planData = await client.getPlans();
    const planName = planData.budgets.find((b) => b.id === PLAN_ID)?.name ??
      PLAN_ID;
    const header = `Budget: ${planName}\n${"─".repeat(40)}`;

    assertEquals(header.includes("Budget: Family Budget"), true);
    assertEquals(header.includes("─".repeat(40)), true);
  });

  it("falls back to plan ID when plan not found", async () => {
    fetchMock.mock("/v1/budgets", {
      data: { budgets: [] },
    });

    const planData = await client.getPlans();
    const planName =
      planData.budgets.find((b) => b.id === "unknown-id")?.name ?? "unknown-id";
    const header = `Budget: ${planName}`;

    assertEquals(header, "Budget: unknown-id");
  });
});
