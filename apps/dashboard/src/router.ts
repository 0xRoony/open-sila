import { useEffect, useState, type MouseEvent } from "react";

export type SettingsSection = "appearance" | "editor" | "api";

export type Route = { page: "projects" } | { page: "editor"; id: string } | { page: "settings"; section: SettingsSection };

const SECTIONS: SettingsSection[] = ["appearance", "editor", "api"];

function parse(pathname: string, hash: string): Route {
  const editor = pathname.match(/^\/projects\/([a-z0-9]+)\/?$/);
  if (editor) return { page: "editor", id: editor[1] };
  if (pathname.startsWith("/settings")) {
    const section = hash.slice(1) as SettingsSection;
    return { page: "settings", section: SECTIONS.includes(section) ? section : "appearance" };
  }
  return { page: "projects" };
}

export function navigate(path: string): void {
  history.pushState(null, "", path);
  dispatchEvent(new PopStateEvent("popstate"));
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parse(location.pathname, location.hash));
  useEffect(() => {
    const update = () => setRoute(parse(location.pathname, location.hash));
    addEventListener("popstate", update);
    addEventListener("hashchange", update);
    return () => {
      removeEventListener("popstate", update);
      removeEventListener("hashchange", update);
    };
  }, []);
  return route;
}

export function linkHandler(path: string) {
  return (event: MouseEvent) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    navigate(path);
  };
}
