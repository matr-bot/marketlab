import { ScenarioStudioMarket, type CompiledScenario, type StudioAssetFrame } from "@/engine/scenarioStudio";

type Inbound = { readonly type: "start"; readonly compiled: CompiledScenario } | { readonly type: "step"; readonly ticks: number };
type Outbound = { readonly type: "frames"; readonly assets: StudioAssetFrame[] } | { readonly type: "error"; readonly message: string };
interface WorkerScope { onmessage: ((event: MessageEvent<Inbound>) => void) | null; postMessage(message: Outbound): void }
const scope = globalThis as unknown as WorkerScope;
let market: ScenarioStudioMarket | null = null;

scope.onmessage = (event) => {
  try {
    if (event.data.type === "start") {
      market = new ScenarioStudioMarket(event.data.compiled);
      scope.postMessage({ type: "frames", assets: market.frames() });
    } else if (market !== null) {
      market.advance(Math.max(0, Math.min(100, Math.floor(event.data.ticks))));
      scope.postMessage({ type: "frames", assets: market.frames() });
    }
  } catch (error) {
    scope.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) });
  }
};
