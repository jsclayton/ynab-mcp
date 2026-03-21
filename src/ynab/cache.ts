import type { YnabClient } from "./client.ts";
import type {
  Account,
  CategoryGroup,
  CurrencyFormat,
  MonthSummary,
  Payee,
} from "./types.ts";

// ---------------------------------------------------------------------------
// Disk I/O abstraction
// ---------------------------------------------------------------------------

export interface DiskIO {
  read(path: string): Promise<string | null>;
  write(path: string, content: string): Promise<void>;
}

export const denoDiskIO: DiskIO = {
  async read(path: string): Promise<string | null> {
    try {
      return await Deno.readTextFile(path);
    } catch {
      return null;
    }
  },
  async write(path: string, content: string): Promise<void> {
    try {
      const dir = path.substring(0, path.lastIndexOf("/"));
      await Deno.mkdir(dir, { recursive: true });
      await Deno.writeTextFile(path, content);
    } catch {
      // Silently fail — disk persistence is optional
    }
  },
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PlanCache {
  accounts: Account[];
  categoryGroups: CategoryGroup[];
  payees: Payee[];
  months: MonthSummary[];
  currencyFormat: CurrencyFormat | null;
  serverKnowledge: {
    accounts: number | undefined;
    categories: number | undefined;
    payees: number | undefined;
  };
  lastFetched: number;
}

const TTL = 5 * 60 * 1000; // 5 minutes safety net

// ---------------------------------------------------------------------------
// Merge helper
// ---------------------------------------------------------------------------

function mergeItems<T extends { id: string; deleted: boolean }>(
  existing: T[],
  updates: T[],
): T[] {
  const map = new Map<string, T>();

  for (const item of existing) {
    map.set(item.id, item);
  }

  for (const item of updates) {
    if (item.deleted) {
      map.delete(item.id);
    } else {
      map.set(item.id, item);
    }
  }

  return Array.from(map.values());
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

export class Cache {
  private plans: Map<string, PlanCache> = new Map();
  private client: YnabClient;
  private cachePath: string | undefined;
  private diskIO: DiskIO;

  constructor(client: YnabClient, cachePath?: string, diskIO?: DiskIO) {
    this.client = client;
    this.cachePath = cachePath;
    this.diskIO = diskIO ?? denoDiskIO;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** Get accounts for a plan, using delta sync */
  async getAccounts(planId: string): Promise<Account[]> {
    const cache = await this.ensureCache(planId);
    const now = Date.now();

    if (cache.accounts.length > 0 && now - cache.lastFetched < TTL) {
      return cache.accounts;
    }

    const result = await this.client.getAccounts(
      planId,
      cache.serverKnowledge.accounts,
    );

    if (cache.serverKnowledge.accounts !== undefined) {
      // Delta merge
      cache.accounts = mergeItems(cache.accounts, result.accounts);
    } else {
      // First fetch — use as-is (filter out deleted)
      cache.accounts = result.accounts.filter((a) => !a.deleted);
    }

    cache.serverKnowledge.accounts = result.server_knowledge;
    cache.lastFetched = now;
    await this.saveToDisk(planId);

    return cache.accounts;
  }

  /** Get category groups for a plan, using delta sync */
  async getCategoryGroups(planId: string): Promise<CategoryGroup[]> {
    const cache = await this.ensureCache(planId);
    const now = Date.now();

    if (cache.categoryGroups.length > 0 && now - cache.lastFetched < TTL) {
      return cache.categoryGroups;
    }

    const result = await this.client.getCategories(
      planId,
      cache.serverKnowledge.categories,
    );

    if (cache.serverKnowledge.categories !== undefined) {
      // Delta merge — category groups contain nested categories
      cache.categoryGroups = mergeCategoryGroups(
        cache.categoryGroups,
        result.category_groups,
      );
    } else {
      // First fetch
      cache.categoryGroups = result.category_groups.filter((g) => !g.deleted);
      for (const group of cache.categoryGroups) {
        group.categories = group.categories.filter((c) => !c.deleted);
      }
    }

    cache.serverKnowledge.categories = result.server_knowledge;
    cache.lastFetched = now;
    await this.saveToDisk(planId);

    return cache.categoryGroups;
  }

  /** Get payees for a plan, using delta sync */
  async getPayees(planId: string): Promise<Payee[]> {
    const cache = await this.ensureCache(planId);
    const now = Date.now();

    if (cache.payees.length > 0 && now - cache.lastFetched < TTL) {
      return cache.payees;
    }

    const result = await this.client.getPayees(
      planId,
      cache.serverKnowledge.payees,
    );

    if (cache.serverKnowledge.payees !== undefined) {
      // Delta merge
      cache.payees = mergeItems(cache.payees, result.payees);
    } else {
      // First fetch
      cache.payees = result.payees.filter((p) => !p.deleted);
    }

    cache.serverKnowledge.payees = result.server_knowledge;
    cache.lastFetched = now;
    await this.saveToDisk(planId);

    return cache.payees;
  }

  /** Get currency format for a plan */
  async getCurrencyFormat(planId: string): Promise<CurrencyFormat> {
    const cache = await this.ensureCache(planId);

    if (cache.currencyFormat) {
      return cache.currencyFormat;
    }

    const { budgets } = await this.client.getPlans();
    const plan = budgets.find((b) => b.id === planId);

    if (!plan) {
      throw new Error(`Plan ${planId} not found`);
    }

    cache.currencyFormat = plan.currency_format;
    return cache.currencyFormat;
  }

  /** Invalidate cache for a plan (called after mutations) */
  invalidate(planId: string): void {
    const cache = this.plans.get(planId);
    if (cache) {
      cache.lastFetched = 0;
    }
  }

  /** Load cache from disk if cachePath is set */
  async loadFromDisk(planId: string): Promise<void> {
    if (!this.cachePath) return;

    try {
      const filePath = `${this.cachePath}/${planId}.json`;
      const content = await this.diskIO.read(filePath);
      if (!content) return;

      const data = JSON.parse(content) as Omit<PlanCache, "currencyFormat">;

      const cache = this.ensureCacheSync(planId);
      cache.accounts = data.accounts ?? [];
      cache.categoryGroups = data.categoryGroups ?? [];
      cache.payees = data.payees ?? [];
      cache.months = data.months ?? [];
      cache.serverKnowledge = data.serverKnowledge ?? {
        accounts: undefined,
        categories: undefined,
        payees: undefined,
      };
      cache.lastFetched = data.lastFetched ?? 0;
    } catch {
      // Disk read failed — fall back to memory-only
    }
  }

  /** Save cache to disk if cachePath is set */
  async saveToDisk(planId: string): Promise<void> {
    if (!this.cachePath) return;

    const cache = this.plans.get(planId);
    if (!cache) return;

    try {
      const filePath = `${this.cachePath}/${planId}.json`;
      const data: Omit<PlanCache, "currencyFormat"> = {
        accounts: cache.accounts,
        categoryGroups: cache.categoryGroups,
        payees: cache.payees,
        months: cache.months,
        serverKnowledge: cache.serverKnowledge,
        lastFetched: cache.lastFetched,
      };
      await this.diskIO.write(filePath, JSON.stringify(data));
    } catch {
      // Disk write failed — silently ignore
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private ensureCacheSync(planId: string): PlanCache {
    let cache = this.plans.get(planId);
    if (!cache) {
      cache = {
        accounts: [],
        categoryGroups: [],
        payees: [],
        months: [],
        currencyFormat: null,
        serverKnowledge: {
          accounts: undefined,
          categories: undefined,
          payees: undefined,
        },
        lastFetched: 0,
      };
      this.plans.set(planId, cache);
    }
    return cache;
  }

  private async ensureCache(planId: string): Promise<PlanCache> {
    if (!this.plans.has(planId)) {
      await this.loadFromDisk(planId);
    }
    return this.ensureCacheSync(planId);
  }
}

// ---------------------------------------------------------------------------
// Category group merge helper
// ---------------------------------------------------------------------------

/**
 * Merge category groups from a delta response into existing cached groups.
 *
 * A delta response for categories returns full category groups, but may only
 * include the categories within each group that actually changed. We need to:
 * 1. Update/add groups (match by id)
 * 2. Within each group, merge categories (update existing, add new, remove deleted)
 * 3. Remove groups marked as deleted
 */
function mergeCategoryGroups(
  existing: CategoryGroup[],
  updates: CategoryGroup[],
): CategoryGroup[] {
  const groupMap = new Map<string, CategoryGroup>();

  // Index existing groups
  for (const group of existing) {
    groupMap.set(group.id, { ...group, categories: [...group.categories] });
  }

  // Apply updates
  for (const updatedGroup of updates) {
    if (updatedGroup.deleted) {
      groupMap.delete(updatedGroup.id);
      continue;
    }

    const existingGroup = groupMap.get(updatedGroup.id);
    if (existingGroup) {
      // Merge categories within the group
      existingGroup.name = updatedGroup.name;
      existingGroup.hidden = updatedGroup.hidden;
      existingGroup.categories = mergeItems(
        existingGroup.categories,
        updatedGroup.categories,
      );
    } else {
      // New group
      groupMap.set(updatedGroup.id, {
        ...updatedGroup,
        categories: updatedGroup.categories.filter((c) => !c.deleted),
      });
    }
  }

  return Array.from(groupMap.values());
}
