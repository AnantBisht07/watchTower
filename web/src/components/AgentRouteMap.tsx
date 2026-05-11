import {
  Bot,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  GitBranch,
  RadioTower,
  Server,
  ShieldCheck
} from "lucide-react";
import type { ReactNode } from "react";
import type { RouteNode } from "../types";

const iconByNode: Record<RouteNode["key"], ReactNode> = {
  task: <FileText size={18} />,
  agent: <Bot size={18} />,
  watchtower: <RadioTower size={18} />,
  policy: <ClipboardCheck size={18} />,
  approval: <ShieldCheck size={18} />,
  mcp: <Server size={18} />,
  result: <CheckCircle2 size={18} />
};

type AgentRouteMapProps = {
  nodes: RouteNode[];
};

export function AgentRouteMap({ nodes }: AgentRouteMapProps) {
  return (
    <section className="routeMapCard">
      <div className="sectionHeader">
        <div>
          <p className="eyebrow">Agent route map</p>
          <h2>Watchtower intercepts before MCP execution</h2>
        </div>
        <div className="routeLegend">
          <GitBranch size={15} />
          Safety Gate
        </div>
      </div>

      <div className="routeMap" aria-label="Agent execution route">
        {nodes.map((node, index) => (
          <div className={`routeStep ${node.status}`} key={node.key}>
            <div className="routeConnector" aria-hidden="true" />
            <div className="routeNodeIcon">{iconByNode[node.key]}</div>
            <strong>{node.label}</strong>
            <span>{node.detail}</span>
            {node.badge ? <em>{node.badge}</em> : null}
            {index < nodes.length - 1 ? <div className="routeArrow" aria-hidden="true" /> : null}
          </div>
        ))}
      </div>
    </section>
  );
}
