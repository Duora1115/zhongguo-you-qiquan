import { createServerFn } from "@tanstack/react-start";

export const getMarket = createServerFn({ method: "GET" })
  .validator((input: { force?: boolean } | undefined) => ({
    force: Boolean(input?.force),
  }))
  .handler(async ({ data }) => {
    const { loadMarket } = await import("./market.fetch.server");
    return loadMarket(data.force);
  });
