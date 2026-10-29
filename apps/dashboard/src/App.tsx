import { FolderKanban, Monitor, Moon, Plug, Settings, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { api, ApiError } from "./api";
import { Logo } from "./components/Logo";
import { Loader } from "./components/Loader";
import { EditorPage } from "./pages/Editor";
import { ProjectsPage } from "./pages/Projects";
import { SettingsPage } from "./pages/Settings";
import { setPreferences, useApplyTheme, usePreferences, type ThemeMode } from "./preferences";
import { linkHandler, useRoute } from "./router";

type SessionState = { status: "loading" } | { status: "signed-out" } | { status: "ready"; version: string } | { status: "offline" };

const NEXT_THEME: Record<ThemeMode, ThemeMode> = { system: "dark", dark: "light", light: "system" };
const THEME_ICON = { system: Monitor, dark: Moon, light: Sun };

export function App() {
  useApplyTheme();
  const route = useRoute();
  const [session, setSession] = useState<SessionState>({ status: "loading" });

  useEffect(() => {
    api
      .session()
      .then((result) => setSession({ status: "ready", version: result.version }))
      .catch((error) => setSession({ status: error instanceof ApiError && error.status === 401 ? "signed-out" : "offline" }));
  }, []);

  if (session.status === "loading") return <div className="center"><Loader /></div>;
  if (session.status !== "ready") return <SignIn offline={session.status === "offline"} />;
  if (route.page === "editor") return <EditorPage id={route.id} />;

  return (
    <div className="shell">
      <header className="topbar">
        <a href="/" className="brand" onClick={linkHandler("/")}>
          <Logo variant="lockup" size={24} />
        </a>
        <nav className="tabs">
          <a href="/" className={route.page === "projects" ? "active" : ""} onClick={linkHandler("/")}>
            <FolderKanban size={15} />
            <span>Projects</span>
          </a>
          <a href="/settings#api" className={route.page === "settings" && route.section === "api" ? "active" : ""} onClick={linkHandler("/settings#api")}>
            <Plug size={15} />
            <span>API &amp; MCP</span>
          </a>
          <a
            href="/settings#appearance"
            className={route.page === "settings" && route.section !== "api" ? "active" : ""}
            onClick={linkHandler("/settings#appearance")}
          >
            <Settings size={15} />
            <span>Settings</span>
          </a>
        </nav>
        <div className="topbar-end">
          <ThemeToggle />
          <span className="muted small">v{session.version}</span>
        </div>
      </header>
      <main className="page">{route.page === "settings" ? <SettingsPage section={route.section} /> : <ProjectsPage />}</main>
    </div>
  );
}

function ThemeToggle() {
  const { theme } = usePreferences();
  const Icon = THEME_ICON[theme];
  return (
    <button
      className="icon-button"
      onClick={() => setPreferences({ theme: NEXT_THEME[theme] })}
      aria-label={`Theme: ${theme}. Switch to ${NEXT_THEME[theme]}`}
      title={`Theme: ${theme}`}
    >
      <Icon size={16} />
    </button>
  );
}

function SignIn({ offline }: { offline: boolean }) {
  return (
    <div className="center">
      <div className="signin">
        <Logo variant="lockup" size={40} />
        <h1>{offline ? "Server not reachable" : "Sign in to Open Sila"}</h1>
        {offline ? (
          <p className="muted">
            Start the server with <code>npm start</code>, then reload this page.
          </p>
        ) : (
          <p className="muted">
            Open the sign-in link printed in the terminal where the server is running. It looks like{" "}
            <code>http://127.0.0.1:4590/login?token=…</code>
          </p>
        )}
        <button className="button primary" onClick={() => location.reload()}>
          {offline ? "Try again" : "I opened the link, reload"}
        </button>
      </div>
    </div>
  );
}
