import type { Platform } from "@open-sila/core";
import { createContext, useContext } from "react";

export const PlatformContext = createContext<Platform>("discord");

export function usePlatform(): Platform {
  return useContext(PlatformContext);
}
