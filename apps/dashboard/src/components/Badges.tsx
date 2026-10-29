import type { Platform } from "@open-sila/core";
import type { BotState } from "../api";
import { BrandIcon } from "./BrandIcon";

const STATE_LABEL: Record<BotState, string> = {
  stopped: "Stopped",
  starting: "Starting",
  running: "Running",
  crashed: "Crashed",
};

export function PlatformBadge({ platform }: { platform: Platform }) {
  return (
    <span className={`platform platform-${platform}`}>
      <BrandIcon platform={platform} size={13} />
      {platform === "discord" ? "Discord" : "Telegram"}
    </span>
  );
}

export function StatePill({ state }: { state: BotState }) {
  return <span className={`state state-${state}`}>{STATE_LABEL[state]}</span>;
}
