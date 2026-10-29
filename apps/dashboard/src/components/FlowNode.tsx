import {
  fieldsFor,
  getNode,
  inputsOf,
  outputsOf,
  portLabel,
  type FieldValue,
  type NodeDefinition,
  type Platform,
  type PortDef,
} from "@open-sila/core";
import { Handle, Position, useConnection, useReactFlow, useStore, useUpdateNodeInternals, type NodeProps } from "@xyflow/react";
import { Plus } from "lucide-react";
import { memo, useEffect, useMemo } from "react";
import type { SilaNode } from "../flow";
import { nodeIcon } from "../icons";
import { usePlatform } from "../platform";
import { ADD_PORT, addEntry, growable } from "../growable";
import { BrandIcon } from "./BrandIcon";

const COMMANDS = new Set(["discord.slashCommand", "telegram.command"]);

function summary(definition: NodeDefinition, values: Record<string, FieldValue>, platform: Platform): string {
  if (COMMANDS.has(definition.type)) return values.name ? `/${values.name}` : "";
  const first = fieldsFor(definition, platform).find(
    (field) => field.kind !== "boolean" && field.kind !== "select" && values[field.id] !== undefined && values[field.id] !== "",
  );
  if (!first) return "";
  const value = String(values[first.id]).split("\n")[0];
  return value.length > 48 ? `${value.slice(0, 48)}…` : value;
}

function Port({ port, side, platform, linked }: { port: PortDef; side: "in" | "out"; platform: Platform; linked: boolean }) {
  const label = portLabel(port, platform);
  const hideLabel = port.type === "exec" && (port.label === "Run" || port.label === "Next");
  return (
    <div className={`port-row port-${side} ${port.field ? "port-field" : ""}`} title={`${label} (${port.type})`}>
      <Handle
        type={side === "in" ? "target" : "source"}
        position={side === "in" ? Position.Left : Position.Right}
        id={port.id}
        className={`handle handle-${port.type} ${linked ? "linked" : ""}`}
      />
      <span>{hideLabel ? "" : label}</span>
    </div>
  );
}

function FlowNodeView({ id, data, selected }: NodeProps<SilaNode>) {
  const definition = getNode(data.kind);
  const platform = usePlatform();
  const updateNodeInternals = useUpdateNodeInternals();
  const { updateNodeData } = useReactFlow<SilaNode>();
  const grow = growable(definition);
  const connecting = useConnection((connection) => connection.inProgress);
  const sending = useStore((state) =>
    state.edges
      .filter((edge) => edge.source === id)
      .map((edge) => edge.sourceHandle)
      .join("|"),
  );
  const wired = useStore((state) =>
    state.edges
      .filter((edge) => edge.target === id)
      .map((edge) => edge.targetHandle)
      .join("|"),
  );
  const allInputs = useMemo(() => (definition ? inputsOf(definition, data.values) : []), [definition, data.values]);
  const showFields = selected || connecting;
  const inputs = useMemo(() => {
    const linked = new Set(wired.split("|"));
    return allInputs.filter((port) => !port.field || showFields || linked.has(port.id));
  }, [allInputs, showFields, wired]);
  const hiddenFields = allInputs.length - inputs.length;
  const outputs = useMemo(() => (definition ? outputsOf(definition, data.values) : []), [definition, data.values]);
  const portKey = [...inputs, ...outputs].map((port) => port.id).join("|") + (grow ? `|${ADD_PORT}` : "");

  useEffect(() => {
    updateNodeInternals(id);
  }, [id, portKey, updateNodeInternals]);

  if (!definition) return <div className="flow-node issue-error">Unknown node: {data.kind}</div>;

  if (data.kind === "core.note") {
    return (
      <div className={`sticky-note note-${String(data.values.color ?? "yellow")} ${selected ? "selected" : ""}`}>
        <textarea
          className="nodrag nowheel"
          aria-label="Note"
          value={String(data.values.text ?? "")}
          onChange={(event) => {
            const text = event.target.value;
            updateNodeData(id, (node) => ({ values: { ...node.data.values, text } }));
          }}
        />
      </div>
    );
  }

  const Icon = nodeIcon(definition.icon, definition.category);
  const text = summary(definition, data.values, platform);
  const only = definition.platforms.length === 1 ? definition.platforms[0] : undefined;
  const rows = Math.max(inputs.length, outputs.length);
  const linkedIn = new Set(wired.split("|"));
  const linkedOut = new Set(sending.split("|"));

  return (
    <div
      className={[
        "flow-node",
        `category-${definition.category}`,
        selected ? "selected" : "",
        data.issue ? `issue-${data.issue}` : "",
        data.active ? "active" : "",
      ].join(" ")}
    >
      <header>
        <span className="node-icon">
          <Icon size={13} strokeWidth={2.2} />
        </span>
        <span className="node-title">{definition.label}</span>
        {only && (
          <span className="node-brand" title={`${only === "discord" ? "Discord" : "Telegram"} only`}>
            <BrandIcon platform={only} size={11} />
          </span>
        )}
      </header>
      {text && <div className="node-summary">{text}</div>}
      <div className="node-ports">
        {Array.from({ length: rows }, (_, index) => (
          <div className="port-pair" key={index}>
            {inputs[index] ? <Port port={inputs[index]} side="in" platform={platform} linked={linkedIn.has(inputs[index].id)} /> : <span />}
            {outputs[index] ? <Port port={outputs[index]} side="out" platform={platform} linked={linkedOut.has(outputs[index].id)} /> : <span />}
          </div>
        ))}
      </div>
      {grow && (
        <div className="port-row port-in port-add">
          <Handle type="target" position={Position.Left} id={ADD_PORT} className="handle handle-add" />
          <button
            className="add-entry nodrag"
            onClick={(event) => {
              event.stopPropagation();
              updateNodeData(id, (node) => {
                const next = addEntry(grow, node.data.values);
                return next ? { values: next.values } : {};
              });
            }}
            title={`Add a ${grow.noun}. You can also drop a wire here.`}
          >
            <Plus size={11} /> Add {grow.noun}
          </button>
        </div>
      )}
      {hiddenFields > 0 && (
        <div className="node-more" title="Select the node or drag a wire to connect its settings">
          +{hiddenFields} {hiddenFields === 1 ? "setting" : "settings"} can be connected
        </div>
      )}
    </div>
  );
}

export const FlowNode = memo(FlowNodeView);
