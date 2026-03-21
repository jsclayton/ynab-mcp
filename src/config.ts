export interface Config {
  accessToken: string;
  readOnly: boolean;
  defaultPlanId: string | undefined;
  cachePath: string | undefined;
}

export function loadConfig(): Config {
  const accessToken = Deno.env.get("YNAB_ACCESS_TOKEN");
  if (!accessToken) {
    throw new Error(
      "YNAB_ACCESS_TOKEN is required. Get one at https://app.ynab.com/settings/developer",
    );
  }

  return {
    accessToken,
    readOnly: Deno.env.get("YNAB_READ_ONLY") === "true",
    defaultPlanId: Deno.env.get("YNAB_DEFAULT_PLAN_ID") || undefined,
    cachePath: Deno.env.get("YNAB_CACHE_PATH") || undefined,
  };
}
