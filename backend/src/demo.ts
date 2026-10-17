import { createPlugin } from "./index.js";

const { tools } = createPlugin();
const get = tools.find((t) => t.name === "get_trust_passport")!;
const record = tools.find((t) => t.name === "record_successful_spend")!;
const ctx = { grantId: "demo-grant" };

const show = (label: string, p: any) =>
  console.log(
    `\n== ${label} ==\n` +
      `Score: ${p.score}/100  Tier: ${p.tier}  Status: ${p.status}\n` +
      `Clean spends: ${p.successfulSpends}  Clean volume: $${p.cleanVolumeUsd}\n` +
      `${p.summary}`,
  );

show("1. Before any activity", await get.handler({}, ctx));

for (const amount of [5, 8, 4]) {
  await record.handler({ amount_usd: amount, category: "api-credits", max_amount_usd: 25, time_window: "24h" }, ctx);
  console.log(`\n+ recorded clean spend of $${amount}`);
}

show("2. After 3 clean constrained spends", await get.handler({}, ctx));

console.log("\nAny service can now require a minimum Trust Passport score before accepting payment from this agent.");
