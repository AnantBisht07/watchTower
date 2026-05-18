import { Activity, CheckSquare, LayoutDashboard, PlaySquare, Server, Settings, Shield } from "lucide-react";

export type NavView = "mission" | "runs" | "servers" | "approvals" | "policies" | "settings";

type NavItemDef = {
  id: NavView;
  label: string;
  icon: React.ReactNode;
};

const NAV_ITEMS: NavItemDef[] = [
  { id: "mission",   label: "Mission Control", icon: <LayoutDashboard size={16} /> },
  { id: "runs",      label: "Runs",            icon: <PlaySquare size={16} /> },
  { id: "servers",   label: "Servers",         icon: <Server size={16} /> },
  { id: "approvals", label: "Approvals",       icon: <CheckSquare size={16} /> },
  { id: "policies",  label: "Policies",        icon: <Shield size={16} /> },
  { id: "settings",  label: "Settings",        icon: <Settings size={16} /> },
];

type SideNavProps = {
  active: NavView;
  pendingCount: number;
  onNavigate: (view: NavView) => void;
};

export function SideNav({ active, pendingCount, onNavigate }: SideNavProps) {
  return (
    <nav className="sideNav">
      <div className="navBrand">
        <div className="navBrandMark">
          <Activity size={16} />
        </div>
        <div>
          <h1>Watchtower</h1>
          <small>MCP Control</small>
        </div>
      </div>

      {NAV_ITEMS.map((item) => (
        <button
          key={item.id}
          className={`navItem ${active === item.id ? "active" : ""}`}
          type="button"
          onClick={() => onNavigate(item.id)}
        >
          {item.icon}
          {item.label}
          {item.id === "approvals" && pendingCount > 0 ? (
            <span className="navBadge">{pendingCount > 99 ? "99+" : pendingCount}</span>
          ) : null}
        </button>
      ))}

      <div className="navSpacer" />
      <hr className="navDivider" />
      <div style={{ padding: "0 6px", color: "var(--text-faint)", fontSize: "11px" }}>
        v0.1.0
      </div>
    </nav>
  );
}
