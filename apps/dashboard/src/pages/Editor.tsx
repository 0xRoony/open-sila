import {
  acceptsMany,
  canConnect,
  compileProject,
  convertsTo,
  customKey,
  defaultData,
  getNode,
  listNodes,
  itemPort,
  outputsOf,
  portLabel,
  setDatabase,
  type Database,
  type FieldValue,
  type Flow,
  type PortType,
  type Project,
} from "@open-sila/core";
import {
  Background,
  BackgroundVariant,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  useNodesInitialized,
  useUpdateNodeInternals,
  type Connection,
  type Edge,
  type IsValidConnection,
  type Node,
} from "@xyflow/react";
import {
  AlignCenterHorizontal,
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  ArrowLeft,
  Database as DatabaseIcon,
  History,
  ListTree,
  Redo2,
  Save,
  Undo2,
  type LucideIcon,
  Blocks,
  Check,
  ClipboardPaste,
  Code,
  Copy,
  CopyPlus,
  Maximize,
  MousePointer2,
  Scissors,
  SlidersHorizontal,
  Trash2,
  Unlink,
  WandSparkles,
  Workflow,
  Download,
  KeyRound,
  LoaderCircle,
  PanelBottom,
  PanelLeft,
  PanelRight,
  Play,
  RotateCw,
  Square,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent as ReactMouseEvent } from "react";
import {
  api,
  ApiError,
  subscribe,
  type BotState,
  type LogEntry,
  type NetworkRecord,
  type RunRecord,
  type RunSummary,
  type StepRecord,
} from "../api";
import { preview as previewValue } from "../components/JsonView";
import { ActivityBar, openSidebar } from "../components/ActivityBar";
import { BrandIcon } from "../components/BrandIcon";
import { CanvasToolbar } from "../components/CanvasToolbar";
import { CodeDialog } from "../components/CodeDialog";
import { ConsolePanel } from "../components/ConsolePanel";
import { ExportMenu } from "../components/ExportMenu";
import { ContextMenu, type MenuEntry } from "../components/ContextMenu";
import { FlowNode } from "../components/FlowNode";
import { Inspector } from "../components/Inspector";
import { Outline } from "../components/Outline";
import { DataPanel } from "../components/DataPanel";
import { TriggerTools } from "../components/TriggerTools";
import { Logo } from "../components/Logo";
import { Loader } from "../components/Loader";
import { HistoryPanel } from "../components/HistoryPanel";
import { CommandPalette, type Command } from "../components/CommandPalette";
import { DRAG_TYPE, Palette } from "../components/Palette";
import { Resizer } from "../components/Resizer";
import { SecretsDialog } from "../components/SecretsDialog";
import { SilaEdge } from "../components/SilaEdge";
import { Sidebar } from "../components/Sidebar";
import { StatusBar } from "../components/StatusBar";
import { ViewMenu } from "../components/ViewMenu";
import { edgeClass, fromFlow, newId, portType, toFlow, type SilaNode } from "../flow";
import { ADD_PORT, addEntry, growable, listItems } from "../growable";
import { autoArrange } from "../layout";
import { PlatformContext } from "../platform";
import { setPreferences, usePreferences, useResolvedTheme, type Preferences } from "../preferences";
import { nodeIcon } from "../icons";
import { panelLimits, useWindowSize } from "../panels";
import { linkHandler } from "../router";

const nodeTypes = { sila: FlowNode };
const edgeTypes = { sila: SilaEdge };

const CONVERSION_LABEL: Partial<Record<PortType, string>> = { string: "as text", number: "as number", boolean: "as yes/no", user: "as user" };

let clipboard: { nodes: SilaNode[]; edges: Edge[] } | null = null;

type MenuState =
  | { kind: "pane"; x: number; y: number; at: { x: number; y: number } }
  | { kind: "node"; x: number; y: number; nodeId: string }
  | { kind: "edge"; x: number; y: number; edgeId: string };
type AlignMode = "left" | "center" | "right" | "top" | "middle" | "bottom" | "row" | "column";

type SaveState = "saved" | "saving" | "unsaved" | "failed";

interface History {
  past: string[];
  future: string[];
  current: string;
}

function historyKey(projectId: string): string {
  return `open-sila:history:${projectId}`;
}

function loadHistory(projectId: string, current: string): History {
  try {
    const saved = JSON.parse(sessionStorage.getItem(historyKey(projectId)) ?? "null") as History | null;
    if (saved && saved.current === current && Array.isArray(saved.past) && Array.isArray(saved.future)) return saved;
  } catch {
    return { past: [], future: [], current };
  }
  return { past: [], future: [], current };
}

function saveHistory(projectId: string, history: History): void {
  try {
    sessionStorage.setItem(historyKey(projectId), JSON.stringify({ ...history, past: history.past.slice(-30), future: history.future.slice(-30) }));
  } catch {
    return;
  }
}

const SIDEBAR_TITLES = { nodes: "Nodes", outline: "Outline", data: "Data", history: "History" } as const;

const RUN_LABEL: Record<BotState, string> = { stopped: "Stopped", starting: "Starting", running: "Running", crashed: "Crashed" };

const SAVE_LABEL: Record<SaveState, string> = { saved: "Saved", saving: "Saving…", unsaved: "Unsaved", failed: "Save failed" };

export function EditorPage({ id }: { id: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .project(id)
      .then(setProject)
      .catch((reason: Error) => setError(reason.message));
  }, [id]);

  if (error) {
    return (
      <div className="center">
        <div className="panel stack">
          <p className="error">{error}</p>
          <a href="/" onClick={linkHandler("/")}>
            Back to projects
          </a>
        </div>
      </div>
    );
  }
  if (!project) return <div className="center"><Loader label="Opening the flow" /></div>;

  return (
    <ReactFlowProvider>
      <Editor initial={project} />
    </ReactFlowProvider>
  );
}

function typingInField(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null;
  return Boolean(target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)));
}

function Editor({ initial }: { initial: Project }) {
  const start = useMemo(() => fromFlow(initial.flow), [initial]);
  const [nodes, setNodes, onNodesChange] = useNodesState<SilaNode>(start.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(start.edges);
  const [name, setName] = useState(initial.name);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [bot, setBot] = useState<BotState>("stopped");
  const [port, setPort] = useState<number | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [latest, setLatest] = useState<Record<string, StepRecord>>({});
  const [network, setNetwork] = useState<NetworkRecord[]>([]);
  const [selectedRun, setSelectedRun] = useState<RunRecord | null>(null);
  const selectedRunId = useRef<string | null>(null);
  const [runningFlow, setRunningFlow] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [dialog, setDialog] = useState<"secrets" | "code" | null>(null);
  const [secretHint, setSecretHint] = useState<string | undefined>();
  const [database, setDatabaseState] = useState<Database | undefined>(initial.flow.database);
  setDatabase(database);
  const [active, setActive] = useState<Record<string, number>>({});
  const [online, setOnline] = useState(true);
  const preferences = usePreferences();
  const windowSize = useWindowSize();
  const limits = panelLimits(windowSize, preferences);
  const theme = useResolvedTheme();
  const {
    screenToFlowPosition,
    setCenter,
    fitView,
    getNode: getFlowNode,
    getInternalNode,
    deleteElements,
    getViewport,
    setViewport,
    getIntersectingNodes,
  } = useReactFlow<SilaNode>();
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [palette, setPalette] = useState(false);
  const [selectBox, setSelectBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [pressing, setPressing] = useState(false);
  const history = useRef(loadHistory(initial.id, JSON.stringify(initial.flow)));
  const [historySize, setHistorySize] = useState({ past: history.current.past.length, future: history.current.future.length });
  const reconnected = useRef(true);
  const wrapper = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const updateNodeInternals = useUpdateNodeInternals();
  const measured = useNodesInitialized();
  const fitted = useRef(false);

  useEffect(() => {
    if (!measured || fitted.current) return;
    const element = wrapper.current;
    if (!element) return;
    const fit = () => {
      if (fitted.current || element.clientWidth < 50 || element.clientHeight < 50) return;
      fitted.current = true;
      void fitView({ padding: 0.2, maxZoom: 1, duration: 250 });
    };
    const observer = new ResizeObserver(() => requestAnimationFrame(fit));
    observer.observe(element);
    requestAnimationFrame(fit);
    return () => observer.disconnect();
  }, [measured, fitView]);
  const nodeIds = useRef<string[]>([]);
  nodeIds.current = nodes.map((node) => node.id);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") requestAnimationFrame(() => updateNodeInternals(nodeIds.current));
    };
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("resize", refresh);
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("resize", refresh);
    };
  }, [updateNodeInternals]);

  const flow = useMemo<Flow>(() => (database ? { ...toFlow(nodes, edges), database } : toFlow(nodes, edges)), [nodes, edges, database]);
  const flowKey = useMemo(() => JSON.stringify(flow), [flow]);
  const savedKey = useRef(JSON.stringify(initial.flow));
  const result = useMemo(() => compileProject({ name, platform: initial.platform, flow }), [flowKey, name]);
  const selected = nodes.filter((node) => node.selected);
  const focused = selected.length === 1 ? selected[0] : undefined;

  const issues = useMemo(() => {
    const map = new Map<string, "error" | "warning">();
    for (const item of result.diagnostics) {
      if (!item.nodeId) continue;
      if (item.level === "error" || !map.has(item.nodeId)) map.set(item.nodeId, item.level);
    }
    return map;
  }, [result]);

  useEffect(() => {
    setNodes((current) =>
      current.map((node) => {
        const issue = issues.get(node.id);
        const isActive = (active[node.id] ?? 0) > Date.now() - 900;
        if (node.data.issue === issue && Boolean(node.data.active) === isActive) return node;
        return { ...node, data: { ...node.data, issue, active: isActive } };
      }),
    );
  }, [issues, active, setNodes]);

  const changeDatabase = useCallback(
    (next: Database | undefined) => {
      setDatabase(next);
      setDatabaseState(next);
      setNodes((current) =>
        current.map((node) => (node.data.kind.startsWith("core.db") ? { ...node, data: { ...node.data, values: { ...node.data.values } } } : node)),
      );
    },
    [setNodes],
  );

  const replaceFlow = useCallback(
    (next: Flow) => {
      const loaded = fromFlow(next);
      setDatabase(next.database);
      setDatabaseState(next.database);
      setNodes(loaded.nodes);
      setEdges(loaded.edges);
      savedKey.current = JSON.stringify(next);
    },
    [setEdges, setNodes],
  );

  const save = useCallback(async () => {
    if (flowKey === savedKey.current) return;
    setSaveState("saving");
    try {
      await api.updateProject(initial.id, { flow: JSON.parse(flowKey) });
      savedKey.current = flowKey;
      setSaveState("saved");
    } catch {
      setSaveState("failed");
    }
  }, [flowKey, initial.id]);

  useEffect(() => {
    if (flowKey === history.current.current) return;
    const timer = setTimeout(() => {
      const state = history.current;
      if (flowKey === state.current) return;
      state.past = [...state.past.slice(-99), state.current];
      state.future = [];
      state.current = flowKey;
      setHistorySize({ past: state.past.length, future: 0 });
      saveHistory(initial.id, state);
    }, 400);
    return () => clearTimeout(timer);
  }, [flowKey]);

  const restore = useCallback(
    (direction: "undo" | "redo") => {
      const state = history.current;
      if (flowKey !== state.current) {
        state.past = [...state.past.slice(-99), state.current];
        state.future = [];
        state.current = flowKey;
      }
      const from = direction === "undo" ? state.past : state.future;
      const target = from.pop();
      if (target === undefined) return;
      (direction === "undo" ? state.future : state.past).push(state.current);
      state.current = target;
      const parsed = JSON.parse(target) as Flow;
      const next = fromFlow(parsed);
      setDatabaseState(parsed.database);
      setNodes((current) => {
        const selected = new Set(current.filter((node) => node.selected).map((node) => node.id));
        return next.nodes.map((node) => (selected.has(node.id) ? { ...node, selected: true } : node));
      });
      setEdges(next.edges);
      setHistorySize({ past: state.past.length, future: state.future.length });
      saveHistory(initial.id, state);
    },
    [flowKey, setEdges, setNodes],
  );

  useEffect(() => {
    if (flowKey === savedKey.current) return;
    setSaveState("unsaved");
    const timer = setTimeout(save, 700);
    return () => clearTimeout(timer);
  }, [flowKey, save]);

  useEffect(() => {
    api.bot(initial.id).then((status) => {
      setBot(status.state);
      setPort(status.port);
      setLogs(status.logs);
    });
    api.runs(initial.id).then((result) => {
      setRuns(result.runs);
      setLatest(result.latest);
    });
    api.network(initial.id).then(setNetwork);
    return subscribe((event) => {
      if (event.projectId !== initial.id) return;
      if (event.type === "status") {
        setBot(event.state);
        if (event.state === "running") void api.bot(initial.id).then((status) => setPort(status.port));
      }
      if (event.type === "log") setLogs((current) => [...current.slice(-499), event.entry]);
      if (event.type === "run") {
        setRuns((current) => [event.run, ...current.filter((run) => run.id !== event.run.id)].slice(0, 200));
        if (selectedRunId.current === event.run.id) {
          setSelectedRun((current) => (current ? { ...current, status: event.run.status, ms: event.run.ms, error: event.run.error } : current));
        }
      }
      if (event.type === "step") {
        setLatest((current) => ({ ...current, [event.step.nodeId]: event.step }));
        if (selectedRunId.current === event.runId) {
          setSelectedRun((current) => {
            if (!current) return current;
            const index = current.steps.findLastIndex((step) => step.nodeId === event.step.nodeId && step.startedAt === event.step.startedAt);
            const steps = index >= 0 ? current.steps.map((step, position) => (position === index ? event.step : step)) : [...current.steps, event.step];
            return { ...current, steps };
          });
        }
      }
      if (event.type === "net") {
        setNetwork((current) => [event.entry, ...current].slice(0, 300));
        if (event.entry.runId && selectedRunId.current === event.entry.runId) {
          setSelectedRun((current) => (current ? { ...current, network: [...current.network, event.entry] } : current));
        }
      }
      if (event.type === "trace") {
        setActive((current) => ({ ...current, [event.nodeId]: Date.now() }));
        setTimeout(() => setActive((current) => ({ ...current })), 950);
      }
    }, setOnline);
  }, [initial.id]);

  const nodeById = useCallback(
    (nodeId: string | null | undefined) => {
      const node = nodes.find((item) => item.id === nodeId);
      return node && { type: node.data.kind, data: node.data.values };
    },
    [nodes],
  );

  const isValidConnection: IsValidConnection = useCallback(
    (connection) => {
      if (connection.source === connection.target || !connection.sourceHandle || !connection.targetHandle) return false;
      const from = portType(nodeById(connection.source), connection.sourceHandle, "output");
      if (connection.targetHandle === ADD_PORT) return Boolean(from && from !== "exec");
      const to = portType(nodeById(connection.target), connection.targetHandle, "input");
      return Boolean(from && to && canConnect(from, to));
    },
    [nodeById],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.sourceHandle || !connection.targetHandle) return;
      const type = portType(nodeById(connection.source), connection.sourceHandle, "output");
      if (connection.targetHandle === ADD_PORT) {
        const target = nodes.find((node) => node.id === connection.target);
        const grow = growable(target && getNode(target.data.kind));
        const source = nodes.find((node) => node.id === connection.source);
        const sourceDefinition = source && getNode(source.data.kind);
        const port = sourceDefinition && outputsOf(sourceDefinition, source.data.values).find((item) => item.id === connection.sourceHandle);
        const base = port ? portLabel(port, initial.platform).replace(/\s+/g, "_").toLowerCase() : undefined;
        if (target && grow?.kind === "keys" && base) {
          const existing = listItems(target.data.values[grow.field.id]).find((item) => item.toLowerCase() === base);
          const reuse = existing && itemPort(grow.prefix, existing);
          const empty =
            reuse && !edges.some((edge) => edge.target === target.id && edge.targetHandle === reuse) && !target.data.values[customKey(reuse)];
          if (reuse && empty) {
            onConnect({ ...connection, targetHandle: reuse });
            return;
          }
        }
        const added = target && grow ? addEntry(grow, target.data.values, base) : null;
        if (!target || !added) return;
        setNodes((current) => current.map((node) => (node.id === target.id ? { ...node, data: { ...node.data, values: added.values } } : node)));
        setEdges((current) => [
          ...current,
          {
            id: newId("e"),
            source: connection.source,
            sourceHandle: connection.sourceHandle,
            target: connection.target,
            targetHandle: added.port,
            className: edgeClass(type),
          },
        ]);
        return;
      }
      const targetNode = nodes.find((node) => node.id === connection.target);
      const targetDefinition = targetNode && getNode(targetNode.data.kind);
      const many = type !== "exec" && targetDefinition && acceptsMany(targetDefinition, connection.targetHandle);
      setEdges((current) => [
        ...current.filter((edge) =>
          type === "exec"
            ? !(edge.source === connection.source && edge.sourceHandle === connection.sourceHandle)
            : many
              ? !(edge.target === connection.target && edge.targetHandle === connection.targetHandle && edge.source === connection.source && edge.sourceHandle === connection.sourceHandle)
              : !(edge.target === connection.target && edge.targetHandle === connection.targetHandle),
        ),
        {
          id: newId("e"),
          source: connection.source,
          sourceHandle: connection.sourceHandle,
          target: connection.target,
          targetHandle: connection.targetHandle,
          className: edgeClass(type),
        },
      ]);
    },
    [edges, initial.platform, nodeById, nodes, setEdges, setNodes],
  );

  const addNode = useCallback(
    (type: string, position?: { x: number; y: number }) => {
      const definition = getNode(type);
      if (!definition) return;
      const bounds = wrapper.current?.getBoundingClientRect();
      const at =
        position ??
        screenToFlowPosition({
          x: (bounds?.left ?? 0) + (bounds?.width ?? 800) / 2 - 115,
          y: (bounds?.top ?? 0) + (bounds?.height ?? 600) / 2 - 60,
        });
      const node: SilaNode = {
        id: newId("n"),
        type: "sila",
        position: at,
        selected: true,
        data: { kind: type, values: defaultData(definition) },
      };
      setNodes((current) => [...current.map((item) => ({ ...item, selected: false })), node]);
    },
    [screenToFlowPosition, setNodes],
  );

  const copy = useCallback(() => {
    if (selected.length === 0) return false;
    const ids = new Set(selected.map((node) => node.id));
    clipboard = {
      nodes: selected.map((node) => ({ ...node, data: { kind: node.data.kind, values: { ...node.data.values } } })),
      edges: edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)),
    };
    return true;
  }, [selected, edges]);

  const paste = useCallback(
    (at?: { x: number; y: number }) => {
      if (!clipboard) return;
      const usable = clipboard.nodes.filter((node) => getNode(node.data.kind)?.platforms.includes(initial.platform));
      if (usable.length === 0) return;
      const left = Math.min(...usable.map((node) => node.position.x));
      const top = Math.min(...usable.map((node) => node.position.y));
      const origin = at ?? { x: left + 40, y: top + 40 };
      const ids = new Map(usable.map((node) => [node.id, newId("n")]));
      const pasted: SilaNode[] = usable.map((node) => ({
        id: ids.get(node.id) as string,
        type: "sila",
        selected: true,
        position: { x: origin.x + node.position.x - left, y: origin.y + node.position.y - top },
        data: { kind: node.data.kind, values: { ...node.data.values } },
      }));
      const links = clipboard.edges
        .filter((edge) => ids.has(edge.source) && ids.has(edge.target))
        .map((edge) => ({ ...edge, id: newId("e"), source: ids.get(edge.source) as string, target: ids.get(edge.target) as string, selected: false }));
      setNodes((current) => [...current.map((item) => ({ ...item, selected: false })), ...pasted]);
      setEdges((current) => [...current, ...links]);
    },
    [initial.platform, setEdges, setNodes],
  );

  const duplicate = useCallback(() => {
    if (copy()) paste();
  }, [copy, paste]);

  const removeSelected = useCallback(() => {
    void deleteElements({ nodes: selected.map((node) => ({ id: node.id })), edges: edges.filter((edge) => edge.selected).map((edge) => ({ id: edge.id })) });
  }, [deleteElements, edges, selected]);

  const disconnect = useCallback(
    (nodeIds: string[]) => {
      const ids = new Set(nodeIds);
      setEdges((current) => current.filter((edge) => !ids.has(edge.source) && !ids.has(edge.target)));
    },
    [setEdges],
  );

  const selectAll = useCallback(() => {
    setNodes((current) => current.map((node) => ({ ...node, selected: true })));
  }, [setNodes]);

  const arrange = useCallback(() => {
    const sizeOf = (nodeId: string) => {
      const measured = getInternalNode(nodeId)?.measured;
      return measured?.width && measured.height ? { width: measured.width, height: measured.height } : undefined;
    };
    setNodes((current) => autoArrange(current, edges, sizeOf));
    requestAnimationFrame(() => void fitView({ padding: 0.2, duration: 300 }));
  }, [edges, fitView, getInternalNode, setNodes]);

  const fit = useCallback(() => void fitView({ padding: 0.2, duration: 300 }), [fitView]);

  const align = useCallback(
    (mode: AlignMode) => {
      setNodes((current) => {
        const chosen = current.filter((node) => node.selected);
        if (chosen.length < 2) return current;
        const boxes = new Map(
          chosen.map((node) => {
            const measured = getInternalNode(node.id)?.measured;
            return [node.id, { x: node.position.x, y: node.position.y, width: measured?.width ?? 230, height: measured?.height ?? 120 }];
          }),
        );
        const all = [...boxes.values()];
        const left = Math.min(...all.map((item) => item.x));
        const top = Math.min(...all.map((item) => item.y));
        const right = Math.max(...all.map((item) => item.x + item.width));
        const bottom = Math.max(...all.map((item) => item.y + item.height));
        const placed = new Map<string, { x: number; y: number }>();
        if (mode === "row" || mode === "column") {
          const horizontal = mode === "row";
          const span = (id: string) => (horizontal ? boxes.get(id)!.width : boxes.get(id)!.height);
          const sorted = [...chosen].sort((a, b) => (horizontal ? a.position.x - b.position.x : a.position.y - b.position.y));
          const total = sorted.reduce((sum, node) => sum + span(node.id), 0);
          const gap = Math.max(24, ((horizontal ? right - left : bottom - top) - total) / Math.max(1, sorted.length - 1));
          let cursor = horizontal ? left : top;
          for (const node of sorted) {
            placed.set(node.id, horizontal ? { x: cursor, y: node.position.y } : { x: node.position.x, y: cursor });
            cursor += span(node.id) + gap;
          }
        } else {
          for (const node of chosen) {
            const size = boxes.get(node.id)!;
            const x = mode === "left" ? left : mode === "right" ? right - size.width : mode === "center" ? (left + right - size.width) / 2 : node.position.x;
            const y = mode === "top" ? top : mode === "bottom" ? bottom - size.height : mode === "middle" ? (top + bottom - size.height) / 2 : node.position.y;
            placed.set(node.id, { x, y });
          }
        }
        return current.map((node) => (placed.has(node.id) ? { ...node, position: placed.get(node.id)! } : node));
      });
    },
    [getInternalNode, setNodes],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (mod && key === "s") {
        event.preventDefault();
        void save();
      } else if (mod && key === "p") {
        event.preventDefault();
        setPalette((open) => !open);
      } else if (mod && key === "k") {
        event.preventDefault();
        setPreferences({ showPalette: true, sidebarView: "nodes" });
        requestAnimationFrame(() => searchRef.current?.focus());
      } else if (mod && event.shiftKey && key === "o") {
        event.preventDefault();
        openSidebar("outline");
      } else if (mod && event.shiftKey && key === "h") {
        event.preventDefault();
        openSidebar("history");
      } else if (mod && event.shiftKey && key === "d") {
        event.preventDefault();
        openSidebar("data");
      } else if (mod && key === "b") {
        event.preventDefault();
        setPreferences(({ showPalette }) => ({ showPalette: !showPalette }));
      } else if (mod && key === "j") {
        event.preventDefault();
        setPreferences(({ showConsole }) => ({ showConsole: !showConsole }));
      } else if (mod && event.shiftKey && key === "m") {
        event.preventDefault();
        setPreferences({ showConsole: true, panelTab: "problems" });
      } else if (mod && key === ".") {
        event.preventDefault();
        setPreferences(({ showInspector }) => ({ showInspector: !showInspector }));
      } else if (typingInField(event)) {
        return;
      } else if (mod && key === "d") {
        event.preventDefault();
        duplicate();
      } else if (mod && key === "c") {
        copy();
      } else if (mod && key === "x") {
        if (copy()) removeSelected();
      } else if (mod && key === "v") {
        event.preventDefault();
        paste();
      } else if (mod && key === "z") {
        event.preventDefault();
        restore(event.shiftKey ? "redo" : "undo");
      } else if (mod && key === "y") {
        event.preventDefault();
        restore("redo");
      } else if (!mod && key === "v") {
        setPreferences({ dragMode: "select" });
      } else if (!mod && key === "h") {
        setPreferences({ dragMode: "pan" });
      } else if (mod && key === "a") {
        event.preventDefault();
        selectAll();
      } else if (event.shiftKey && key === "a") {
        arrange();
      } else if (event.shiftKey && event.code === "Digit1") {
        fit();
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [save, duplicate, arrange, fit, copy, paste, removeSelected, selectAll, restore]);

  useEffect(() => {
    const element = wrapper.current;
    if (!element) return;
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (event.button !== 0 || event.shiftKey || !target.classList.contains("react-flow__pane")) return;
      event.stopPropagation();
      event.preventDefault();
      const start = { x: event.clientX, y: event.clientY };
      const viewport = getViewport();
      const additive = event.ctrlKey || event.metaKey;
      const bounds = element.getBoundingClientRect();
      let mode: "pending" | "pan" | "select" = "pending";
      const beginSelect = () => {
        mode = "select";
        setPressing(true);
        setSelectBox({ left: start.x - bounds.left, top: start.y - bounds.top, width: 0, height: 0 });
      };
      const timer = setTimeout(() => mode === "pending" && beginSelect(), 350);
      const onMove = (move: MouseEvent) => {
        const dx = move.clientX - start.x;
        const dy = move.clientY - start.y;
        if (mode === "pending" && Math.hypot(dx, dy) > 4) {
          clearTimeout(timer);
          if (preferences.dragMode === "select") beginSelect();
          else mode = "pan";
        }
        if (mode === "pan") void setViewport({ x: viewport.x + dx, y: viewport.y + dy, zoom: viewport.zoom });
        if (mode === "select") {
          setSelectBox({
            left: Math.min(start.x, move.clientX) - bounds.left,
            top: Math.min(start.y, move.clientY) - bounds.top,
            width: Math.abs(dx),
            height: Math.abs(dy),
          });
        }
      };
      const onUp = (up: MouseEvent) => {
        clearTimeout(timer);
        removeEventListener("mousemove", onMove);
        removeEventListener("mouseup", onUp);
        setPressing(false);
        setMenu(null);
        if (mode === "select") {
          const a = screenToFlowPosition(start);
          const b = screenToFlowPosition({ x: up.clientX, y: up.clientY });
          const rect = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
          const hits = new Set(getIntersectingNodes(rect, true).map((node) => node.id));
          setNodes((current) => current.map((node) => ({ ...node, selected: hits.has(node.id) || (additive && Boolean(node.selected)) })));
          setEdges((current) => current.map((edge) => ({ ...edge, selected: false })));
          setSelectBox(null);
        } else if (mode === "pending" && !additive) {
          setNodes((current) => current.map((node) => (node.selected ? { ...node, selected: false } : node)));
          setEdges((current) => current.map((edge) => (edge.selected ? { ...edge, selected: false } : edge)));
        }
      };
      addEventListener("mousemove", onMove);
      addEventListener("mouseup", onUp);
    };
    element.addEventListener("mousedown", onMouseDown, true);
    return () => element.removeEventListener("mousedown", onMouseDown, true);
  }, [getIntersectingNodes, getViewport, preferences.dragMode, screenToFlowPosition, setEdges, setNodes, setViewport]);

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    const type = event.dataTransfer.getData(DRAG_TYPE);
    if (type) addNode(type, screenToFlowPosition({ x: event.clientX, y: event.clientY }));
  };

  const updateField = (nodeId: string, field: string, value: FieldValue) => {
    setNodes((current) =>
      current.map((node) =>
        node.id === nodeId ? { ...node, data: { ...node.data, values: { ...node.data.values, [field]: value } } } : node,
      ),
    );
  };

  const removeNode = (nodeId: string) => {
    setNodes((current) => current.filter((node) => node.id !== nodeId));
    setEdges((current) => current.filter((edge) => edge.source !== nodeId && edge.target !== nodeId));
  };

  const focusNode = (nodeId: string) => {
    const node = getFlowNode(nodeId);
    if (!node) return;
    setNodes((current) => current.map((item) => ({ ...item, selected: item.id === nodeId })));
    setPreferences({ showInspector: true });
    void setCenter(node.position.x + 115, node.position.y + 60, { zoom: 1.1, duration: 300 });
  };

  const run = async () => {
    setNotice("");
    await save();
    try {
      const status = await api.startBot(initial.id);
      setBot(status.state);
      setPort(status.port);
      setRunningFlow(flowKey);
    } catch (reason) {
      if (reason instanceof ApiError && reason.message.includes("secrets")) setDialog("secrets");
      setNotice((reason as Error).message);
    }
  };

  const stop = async () => {
    const status = await api.stopBot(initial.id);
    setBot(status.state);
    setRunningFlow(null);
  };

  const rename = async () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === initial.name) return setName(trimmed || initial.name);
    await api.updateProject(initial.id, { name: trimmed });
  };

  const live = bot === "running" || bot === "starting";
  const stale = live && runningFlow !== null && runningFlow !== flowKey;
  const errors = result.diagnostics.filter((item) => item.level === "error").length;
  const warnings = result.diagnostics.length - errors;
  const sources = useMemo(() => {
    const map = new Map<string, { label: string; edgeId: string }[]>();
    if (!focused) return map;
    for (const edge of edges) {
      if (edge.target !== focused.id || !edge.targetHandle) continue;
      const source = nodes.find((node) => node.id === edge.source);
      const definition = source && getNode(source.data.kind);
      const port = definition && outputsOf(definition, source.data.values).find((item) => item.id === edge.sourceHandle);
      const label = `${definition?.label ?? "another node"}${port ? ` · ${portLabel(port, initial.platform)}` : ""}`;
      map.set(edge.targetHandle, [...(map.get(edge.targetHandle) ?? []), { label, edgeId: edge.id }]);
    }
    return map;
  }, [edges, focused, nodes, initial.platform]);
  const nodeLabel = useCallback(
    (nodeId: string) => {
      const node = nodes.find((item) => item.id === nodeId);
      return (node && getNode(node.data.kind)?.label) ?? "Removed node";
    },
    [nodes],
  );
  const styledEdges = useMemo(
    () =>
      edges.map((edge) => {
        const from = portType(nodeById(edge.source), edge.sourceHandle ?? "", "output");
        const to = portType(nodeById(edge.target), edge.targetHandle ?? "", "input");
        const conversion = from && to && convertsTo(from, to) ? CONVERSION_LABEL[to] : undefined;
        const outputs = latest[edge.source]?.outputs as Record<string, unknown> | undefined;
        const value = outputs && edge.sourceHandle && edge.sourceHandle in outputs ? previewValue(outputs[edge.sourceHandle]) : undefined;
        const live = (active[edge.source] ?? 0) > Date.now() - 900;
        return { ...edge, type: "sila", className: `${edge.className ?? ""} ${live ? "live" : ""}`, data: { conversion, value } };
      }),
    [edges, nodeById, latest, active],
  );

  const menuItems = (): MenuEntry[] => {
    if (!menu) return [];
    if (menu.kind === "edge") {
      return [{ label: "Delete connection", icon: Trash2, keys: "Delete", danger: true, onSelect: () => void deleteElements({ edges: [{ id: menu.edgeId }] }) }];
    }
    if (menu.kind === "pane") {
      return [
        { label: "Paste", icon: ClipboardPaste, keys: "Ctrl+V", disabled: !clipboard, onSelect: () => paste(menu.at) },
        { label: "Select all", icon: MousePointer2, keys: "Ctrl+A", disabled: nodes.length === 0, onSelect: selectAll },
        "separator",
        { label: "Arrange nodes", icon: WandSparkles, keys: "Shift+A", disabled: nodes.length === 0, onSelect: arrange },
        { label: "Fit to screen", icon: Maximize, keys: "Shift+1", onSelect: fit },
      ];
    }
    const many = selected.length > 1;
    const targets = many ? selected.map((node) => node.id) : [menu.nodeId];
    return [
      ...(many
        ? []
        : [{ label: "Edit settings", icon: SlidersHorizontal, onSelect: () => setPreferences({ showInspector: true }) } as MenuEntry, "separator" as const]),
      { label: many ? `Duplicate ${selected.length} nodes` : "Duplicate", icon: CopyPlus, keys: "Ctrl+D", onSelect: duplicate },
      { label: "Copy", icon: Copy, keys: "Ctrl+C", onSelect: () => void copy() },
      { label: "Cut", icon: Scissors, keys: "Ctrl+X", onSelect: () => copy() && removeSelected() },
      {
        label: "Remove connections",
        icon: Unlink,
        disabled: !edges.some((edge) => targets.includes(edge.source) || targets.includes(edge.target)),
        onSelect: () => disconnect(targets),
      },
      ...(many
        ? ([
            "separator",
            { label: "Align left", icon: AlignStartVertical, onSelect: () => align("left") },
            { label: "Align top", icon: AlignStartHorizontal, onSelect: () => align("top") },
            { label: "Center vertically", icon: AlignCenterHorizontal, onSelect: () => align("middle") },
            { label: "Distribute horizontally", icon: AlignHorizontalDistributeCenter, onSelect: () => align("row") },
            { label: "Distribute vertically", icon: AlignVerticalDistributeCenter, onSelect: () => align("column") },
          ] as MenuEntry[])
        : []),
      "separator",
      { label: many ? `Delete ${selected.length} nodes` : "Delete", icon: Trash2, keys: "Delete", danger: true, onSelect: removeSelected },
    ];
  };

  const paletteCommands = (): Command[] => {
    const view = (id: string, label: string, keys: string, icon: LucideIcon, sidebarView: Preferences["sidebarView"]): Command => ({
      id,
      label,
      group: "View",
      keys,
      icon,
      run: () => setPreferences({ showPalette: true, sidebarView }),
    });
    const panel = (id: string, label: string, panelTab: Preferences["panelTab"], keys?: string): Command => ({
      id,
      label,
      group: "View",
      keys,
      icon: PanelBottom,
      run: () => setPreferences({ showConsole: true, panelTab }),
    });
    const actions: Command[] = [
      { id: "save", label: "Save", group: "Project", keys: "Ctrl+S", icon: Check, run: () => void save() },
      live
        ? { id: "stop", label: "Stop the bot", group: "Bot", icon: Square, run: () => void stop() }
        : { id: "run", label: "Start the bot", group: "Bot", icon: Play, run: () => void run() },
      { id: "restart", label: "Restart the bot", group: "Bot", icon: RotateCw, run: () => void run() },
      { id: "secrets", label: "Secrets", group: "Project", icon: KeyRound, run: () => setDialog("secrets") },
      { id: "code", label: "Show generated code", group: "Project", icon: Code, run: () => setDialog("code") },
      { id: "version", label: "Save a version", group: "Project", icon: Save, run: () => setPreferences({ showPalette: true, sidebarView: "history" }) },
      { id: "undo", label: "Undo", group: "Edit", keys: "Ctrl+Z", icon: Undo2, run: () => restore("undo") },
      { id: "redo", label: "Redo", group: "Edit", keys: "Ctrl+Shift+Z", icon: Redo2, run: () => restore("redo") },
      { id: "selectAll", label: "Select all", group: "Edit", keys: "Ctrl+A", icon: MousePointer2, run: selectAll },
      { id: "arrange", label: "Arrange nodes", group: "Edit", keys: "Shift+A", icon: WandSparkles, run: arrange },
      { id: "alignLeft", label: "Align selected left", group: "Edit", icon: AlignStartVertical, run: () => align("left") },
      { id: "alignTop", label: "Align selected top", group: "Edit", icon: AlignStartHorizontal, run: () => align("top") },
      { id: "spreadX", label: "Distribute selected horizontally", group: "Edit", icon: AlignHorizontalDistributeCenter, run: () => align("row") },
      { id: "spreadY", label: "Distribute selected vertically", group: "Edit", icon: AlignVerticalDistributeCenter, run: () => align("column") },
      { id: "fit", label: "Fit to screen", group: "View", keys: "Shift+1", icon: Maximize, run: fit },
      view("nodes", "Show nodes", "Ctrl+B", Blocks, "nodes"),
      view("outline", "Show outline", "Ctrl+Shift+O", ListTree, "outline"),
      view("data", "Show database models", "Ctrl+Shift+D", DatabaseIcon, "data"),
      view("history", "Show version history", "Ctrl+Shift+H", History, "history"),
      { id: "console", label: "Toggle console", group: "View", keys: "Ctrl+J", icon: PanelBottom, run: () => toggle("showConsole") },
      panel("runs", "Show runs", "runs"),
      panel("network", "Show network requests", "network"),
      panel("problems", "Show problems", "problems", "Ctrl+Shift+M"),
      { id: "inspector", label: "Toggle inspector", group: "View", keys: "Ctrl+.", icon: PanelRight, run: () => toggle("showInspector") },
    ];
    const go = nodes.map((node) => {
      const definition = getNode(node.data.kind);
      return {
        id: `go:${node.id}`,
        label: nodeLabel(node.id),
        group: "Go to",
        hint: definition?.label,
        icon: nodeIcon(definition?.icon, definition?.category ?? "action"),
        run: () => focusNode(node.id),
      };
    });
    const add = listNodes(initial.platform).map((definition) => ({
      id: `add:${definition.type}`,
      label: definition.label,
      group: "Add",
      hint: definition.description,
      icon: nodeIcon(definition.icon, definition.category),
      run: () => addNode(definition.type),
    }));
    return [...actions, ...go, ...add];
  };

  const openNodeMenu = (event: ReactMouseEvent, node: Node) => {
    event.preventDefault();
    if (!node.selected) setNodes((current) => current.map((item) => ({ ...item, selected: item.id === node.id })));
    setMenu({ kind: "node", x: event.clientX, y: event.clientY, nodeId: node.id });
  };
  const toggle = (key: "showPalette" | "showConsole" | "showInspector") => setPreferences((current) => ({ [key]: !current[key] }));

  return (
    <PlatformContext.Provider value={initial.platform}>
      <div className={`editor ${preferences.panelMaximized && preferences.showConsole ? "panel-maximized" : ""}`}>
        <header className="topbar editor-bar">
          <div className="bar-start">
            <a href="/" className="home-link" onClick={linkHandler("/")} aria-label="Back to projects" title="Back to projects">
              <ArrowLeft size={15} />
              <Logo variant="symbol" size={22} />
            </a>
            <span className="divider" />
            <div className="layout-toggles" role="group" aria-label="Layout">
              <button
                className={`icon-button ${preferences.showPalette ? "on" : ""}`}
                onClick={() => toggle("showPalette")}
                aria-pressed={preferences.showPalette}
                aria-label="Toggle sidebar"
                title="Toggle sidebar (Ctrl+B)"
              >
                <PanelLeft size={16} />
              </button>
              <button
                className={`icon-button ${preferences.showConsole ? "on" : ""}`}
                onClick={() => toggle("showConsole")}
                aria-pressed={preferences.showConsole}
                aria-label="Toggle console panel"
                title="Toggle console panel (Ctrl+J)"
              >
                <PanelBottom size={16} />
              </button>
              <button
                className={`icon-button ${preferences.showInspector ? "on" : ""}`}
                onClick={() => toggle("showInspector")}
                aria-pressed={preferences.showInspector}
                aria-label="Toggle inspector"
                title="Toggle inspector (Ctrl+.)"
              >
                <PanelRight size={16} />
              </button>
            </div>
            <ViewMenu onArrange={arrange} onFit={fit} />
          </div>
          <div className="bar-center">
            <span className="editor-brand">
              <BrandIcon platform={initial.platform} size={16} />
            </span>
            <input
              id="project-title"
              className="title-input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              onBlur={rename}
              onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
              maxLength={80}
              aria-label="Project name"
            />
            <span className={`run-state is-${bot}`}>
              <span className="port-dot" aria-hidden="true" />
              {RUN_LABEL[bot]}
            </span>
            <span className={`save save-${saveState}`}>
              {saveState === "saving" ? <LoaderCircle size={13} /> : saveState === "saved" ? <Check size={13} /> : null}
              {SAVE_LABEL[saveState]}
            </span>
          </div>
          <div className="bar-end">
          <button className="button ghost" onClick={() => setDialog("secrets")}>
            <KeyRound size={15} /> Secrets
          </button>
          <button className="button ghost" onClick={() => setDialog("code")}>
            <Code size={15} /> Code
          </button>
          <ExportMenu projectId={initial.id} canBuild={result.ok} />
          <span className="divider" />
          {live ? (
            <>
              {stale && (
                <button className="button primary" onClick={run}>
                  <RotateCw size={15} /> Restart
                </button>
              )}
              <button className="button danger-outline" onClick={stop}>
                <Square size={12} /> Stop
              </button>
            </>
          ) : (
            <button className="button primary" onClick={run} disabled={!result.ok} title={result.ok ? "Run the bot" : "Fix the problems first"}>
              <Play size={14} /> Run
            </button>
          )}
          </div>
        </header>

        {notice && (
          <div className="notice error" role="alert">
            {notice}
            <button className="link" onClick={() => setNotice("")}>
              Dismiss
            </button>
          </div>
        )}
        {stale && <div className="notice">The flow changed since the bot started. Restart to apply the changes.</div>}

        <div className={`editor-body ${preferences.showPortLabels ? "" : "hide-port-labels"}`}>
          <ActivityBar issues={result.diagnostics.length} />
          {preferences.showPalette && (
            <>
              <Sidebar title={SIDEBAR_TITLES[preferences.sidebarView]} width={limits.sidebar.value}>
                <div className="view-swap" key={preferences.sidebarView}>
                {preferences.sidebarView === "outline" ? (
                  <Outline nodes={nodes} edges={edges} issues={issues} onSelect={focusNode} />
                ) : preferences.sidebarView === "history" ? (
                  <HistoryPanel projectId={initial.id} onBeforeSave={save} onRestore={replaceFlow} />
                ) : preferences.sidebarView === "data" ? (
                  <DataPanel
                    database={database}
                    onChange={changeDatabase}
                    onSecrets={() => {
                      setSecretHint("DATABASE_URL");
                      setDialog("secrets");
                    }}
                  />
                ) : (
                  <Palette platform={initial.platform} searchRef={searchRef} onAdd={(type) => addNode(type)} />
                )}
                </div>
              </Sidebar>
              <Resizer
                direction="horizontal"
                label="Resize sidebar"
                value={limits.sidebar.value}
                min={limits.sidebar.min}
                max={limits.sidebar.max}
                onChange={(paletteWidth) => setPreferences({ paletteWidth })}
              />
            </>
          )}

          <div className="editor-center">
            <div className={`canvas drag-${preferences.dragMode} ${pressing ? "pressing" : ""}`} ref={wrapper} onDrop={onDrop} onDragOver={(event) => event.preventDefault()}>
              <ReactFlow
                nodes={nodes}
                edges={styledEdges}
                nodeTypes={nodeTypes}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                edgeTypes={edgeTypes}
                onReconnectStart={() => {
                  reconnected.current = false;
                }}
                onReconnect={(previous, connection) => {
                  reconnected.current = true;
                  setEdges((current) => current.filter((item) => item.id !== previous.id));
                  onConnect(connection);
                }}
                onReconnectEnd={(_, edge) => {
                  if (!reconnected.current) setEdges((current) => current.filter((item) => item.id !== edge.id));
                  reconnected.current = true;
                }}
                onPaneContextMenu={(event) => {
                  event.preventDefault();
                  setMenu({
                    kind: "pane",
                    x: event.clientX,
                    y: event.clientY,
                    at: screenToFlowPosition({ x: event.clientX, y: event.clientY }),
                  });
                }}
                onNodeContextMenu={openNodeMenu}
                onSelectionContextMenu={(event, selection) => selection[0] && openNodeMenu(event, selection[0])}
                onEdgeContextMenu={(event, edge) => {
                  event.preventDefault();
                  setEdges((current) => current.map((item) => ({ ...item, selected: item.id === edge.id })));
                  setMenu({ kind: "edge", x: event.clientX, y: event.clientY, edgeId: edge.id });
                }}
                onPaneClick={() => setMenu(null)}
                connectionRadius={36}
                panOnDrag={[1]}
                selectionKeyCode="Shift"
                multiSelectionKeyCode={["Control", "Meta"]}
                isValidConnection={isValidConnection}
                deleteKeyCode={["Delete", "Backspace"]}
                snapToGrid={preferences.snapToGrid}
                snapGrid={[20, 20]}
                fitView
                fitViewOptions={{ maxZoom: 1, padding: 0.3 }}
                minZoom={0.2}
                proOptions={{ hideAttribution: true }}
                colorMode={theme}
              >
                <Background
                  variant={preferences.snapToGrid ? BackgroundVariant.Lines : BackgroundVariant.Dots}
                  gap={preferences.snapToGrid ? 20 : 22}
                  size={1.4}
                />
                {preferences.showMinimap && <MiniMap pannable zoomable className="minimap" position="bottom-right" style={{ width: 168, height: 108 }} />}
              </ReactFlow>
              <CanvasToolbar
                onArrange={arrange}
                onUndo={() => restore("undo")}
                onRedo={() => restore("redo")}
                canUndo={historySize.past > 0 || flowKey !== history.current.current}
                canRedo={historySize.future > 0}
              />
              {selectBox && <div className="select-box" style={selectBox} />}
              {nodes.length === 0 && (
                <div className="canvas-empty">
                  <Workflow size={36} />
                  <h2>Start with a trigger</h2>
                  <p>Drag a trigger from the Nodes list, like a command or a message, then connect actions after it.</p>
                  <button className="button primary" onClick={() => openSidebar("nodes")} style={{ pointerEvents: "auto" }}>
                    <Blocks size={15} /> Browse nodes
                  </button>
                </div>
              )}
            </div>

            {preferences.showConsole && (
              <>
                {!preferences.panelMaximized && (
                  <Resizer
                    direction="vertical"
                    label="Resize panel"
                    value={limits.console.value}
                    min={limits.console.min}
                    max={limits.console.max}
                    invert
                    onChange={(consoleHeight) => setPreferences({ consoleHeight })}
                  />
                )}
                <ConsolePanel
                  height={limits.console.value}
                  logs={logs}
                  diagnostics={result.diagnostics}
                  runs={runs}
                  selectedRun={selectedRun}
                  network={network}
                  nodeLabel={nodeLabel}
                  onSelectRun={(runId) => {
                    selectedRunId.current = runId;
                    api.run(initial.id, runId).then(setSelectedRun, () => setSelectedRun(null));
                  }}
                  onSelectNode={focusNode}
                  onClear={(tab) => {
                    if (tab === "console") setLogs([]);
                    if (tab === "network") setNetwork([]);
                    if (tab === "runs") {
                      void api.clearRuns(initial.id);
                      setRuns([]);
                      setLatest({});
                      setSelectedRun(null);
                      selectedRunId.current = null;
                    }
                  }}
                />
              </>
            )}
          </div>

          {preferences.showInspector && (
            <>
              <Resizer
                direction="horizontal"
                label="Resize inspector"
                value={limits.inspector.value}
                min={limits.inspector.min}
                max={limits.inspector.max}
                invert
                onChange={(inspectorWidth) => setPreferences({ inspectorWidth })}
              />
              <Inspector
                key={focused?.id ?? "none"}
                platform={initial.platform}
                node={focused}
                width={limits.inspector.value}
                sources={sources}
                onRemoveEdge={(edgeId) => setEdges((current) => current.filter((edge) => edge.id !== edgeId))}
                onPatch={(patch) =>
                  focused &&
                  setNodes((current) =>
                    current.map((node) => {
                      if (node.id !== focused.id) return node;
                      const values = { ...node.data.values };
                      for (const [key, value] of Object.entries(patch)) {
                        if (value === undefined) delete values[key];
                        else values[key] = value;
                      }
                      return { ...node, data: { ...node.data, values } };
                    }),
                  )
                }
                onRewire={(from, to) =>
                  focused &&
                  setEdges((current) =>
                    to === null
                      ? current.filter((edge) => !(edge.target === focused.id && edge.targetHandle === from))
                      : current.map((edge) => (edge.target === focused.id && edge.targetHandle === from ? { ...edge, targetHandle: to } : edge)),
                  )
                }
                onDisconnect={(port) =>
                  focused && setEdges((current) => current.filter((edge) => !(edge.target === focused.id && edge.targetHandle === port)))
                }
                diagnostics={focused ? result.diagnostics.filter((item) => item.nodeId === focused.id) : []}
                onChange={(field, value) => focused && updateField(focused.id, field, value)}
                onDelete={() => focused && removeNode(focused.id)}
                onDuplicate={duplicate}
                onClose={() => setPreferences({ showInspector: false })}
                lastStep={focused ? latest[focused.id] : undefined}
                tools={focused && <TriggerTools projectId={initial.id} node={focused} live={live} port={port} onSave={save} />}
              />
            </>
          )}
        </div>

        <StatusBar online={online} platform={initial.platform} bot={bot} errors={errors} warnings={warnings} nodes={nodes.length} edges={edges.length} />

        {dialog === "secrets" && (
          <SecretsDialog
            projectId={initial.id}
            platform={initial.platform}
            suggest={secretHint}
            onClose={() => {
              setDialog(null);
              setSecretHint(undefined);
            }}
          />
        )}
        {dialog === "code" && <CodeDialog projectId={initial.id} result={result} onClose={() => setDialog(null)} />}
        {palette && <CommandPalette commands={paletteCommands()} onClose={() => setPalette(false)} />}
        {menu && (
          <ContextMenu
            x={menu.x}
            y={menu.y}
            title={menu.kind === "edge" ? "Connection" : menu.kind === "node" ? (selected.length > 1 ? `${selected.length} nodes` : "Node") : undefined}
            items={menuItems()}
            addNodes={menu.kind === "pane" ? { platform: initial.platform, onAdd: (type) => addNode(type, menu.at) } : undefined}
            onClose={() => setMenu(null)}
          />
        )}
      </div>
    </PlatformContext.Provider>
  );
}
