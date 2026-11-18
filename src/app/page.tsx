import { randomInt } from "node:crypto";
import { connection } from "next/server";
import { Landing } from "@/components/landing/Landing";
import { Proof } from "@/components/landing/Proof";
import { DEMO_SEED } from "@/engine/demoMarket";
import { SCENARIOS } from "@/engine/scenarios";
import { AGENT_MODELS, crowdCounts } from "@/lib/models";

/** The landing page (D-083): a fresh random seed per visit for the launcher, so it renders per request. */
export default async function Home() {
  await connection();
  const crowd = crowdCounts();
  return (
    <Landing
      initialSeed={randomInt(1, 100_000)}
      demoSeed={DEMO_SEED}
      agents={crowd.total}
      models={AGENT_MODELS.map((m) => ({ ...m, count: crowd.byType[m.type] ?? 0 }))}
      scenarios={SCENARIOS.filter((s) => s.id !== "demo").map((s) => ({ id: s.id, title: s.title, teaches: s.teaches }))}
      build={{ version: process.env.NEXT_PUBLIC_APP_VERSION ?? "", sha: process.env.NEXT_PUBLIC_GIT_SHA ?? "" }}
      proof={<Proof />}
    />
  );
}
