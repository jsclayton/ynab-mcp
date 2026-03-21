import { assertEquals } from "@std/testing/assert";
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { YnabClient } from "../ynab/client.ts";
import { makePlan, mockFetch } from "../testing/helpers.ts";
import { formatPlan } from "../ynab/format.ts";

describe("list_plans", () => {
  let fetchMock: ReturnType<typeof mockFetch>;
  let client: YnabClient;

  beforeEach(() => {
    fetchMock = mockFetch();
    client = new YnabClient("test-token");
  });

  afterEach(() => {
    fetchMock.restore();
  });

  it("returns all plans from the API", async () => {
    const plan1 = makePlan({ name: "Personal Budget" });
    const plan2 = makePlan({ name: "Business Budget" });
    fetchMock.mock("/v1/budgets", {
      data: { budgets: [plan1, plan2] },
    });

    const result = await client.getPlans();
    assertEquals(result.budgets.length, 2);
    assertEquals(result.budgets[0].name, "Personal Budget");
    assertEquals(result.budgets[1].name, "Business Budget");
  });

  it("returns empty list when no plans exist", async () => {
    fetchMock.mock("/v1/budgets", {
      data: { budgets: [] },
    });

    const result = await client.getPlans();
    assertEquals(result.budgets.length, 0);
  });

  it("formats plans with name, last modified date, and ID", () => {
    const plan = makePlan({
      id: "plan-abc-123",
      name: "My Budget",
      last_modified_on: "2024-06-15T12:30:00+00:00",
    });

    const formatted = formatPlan(plan);
    assertEquals(formatted, "My Budget (last modified: 2024-06-15)");

    // Verify ID can be appended for tool output
    const toolOutput = `${formatted}\n  ID: ${plan.id}`;
    assertEquals(
      toolOutput,
      "My Budget (last modified: 2024-06-15)\n  ID: plan-abc-123",
    );
  });

  it("formats multiple plans separated by blank lines", () => {
    const plan1 = makePlan({
      id: "plan-1",
      name: "Personal",
      last_modified_on: "2024-01-10T08:00:00+00:00",
    });
    const plan2 = makePlan({
      id: "plan-2",
      name: "Business",
      last_modified_on: "2024-02-20T16:45:00+00:00",
    });

    const plans = [plan1, plan2];
    const text = plans
      .map((p) => `${formatPlan(p)}\n  ID: ${p.id}`)
      .join("\n\n");

    assertEquals(text.includes("Personal (last modified: 2024-01-10)"), true);
    assertEquals(text.includes("ID: plan-1"), true);
    assertEquals(text.includes("Business (last modified: 2024-02-20)"), true);
    assertEquals(text.includes("ID: plan-2"), true);
  });

  it("preserves plan IDs from API response", async () => {
    const knownId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const plan = makePlan({ id: knownId, name: "Test" });
    fetchMock.mock("/v1/budgets", {
      data: { budgets: [plan] },
    });

    const result = await client.getPlans();
    assertEquals(result.budgets[0].id, knownId);
  });

  it("includes currency format on each plan", async () => {
    const plan = makePlan({
      name: "Euro Budget",
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

    const result = await client.getPlans();
    assertEquals(result.budgets[0].currency_format.iso_code, "EUR");
    assertEquals(result.budgets[0].currency_format.symbol, "\u20AC");
  });
});
