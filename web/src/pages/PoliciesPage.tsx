import { Shield } from "lucide-react";

export function PoliciesPage() {
  return (
    <div className="pageContent">
      <div className="pageHeader">
        <div>
          <h2>Policies</h2>
          <p>Safety rules that gate or block MCP tool calls</p>
        </div>
      </div>

      <div className="mcSection">
        <div className="mcSectionHeader">
          <div className="mcSectionTitle">
            <Shield size={15} style={{ color: "var(--teal)" }} />
            <h3>Policy configuration</h3>
          </div>
        </div>

        <div style={{ padding: "24px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
          <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6 }}>
            Policies are defined in a YAML file and passed to Watchtower at startup.
            Each rule matches a server + tool pattern and specifies an action: <code style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>allow</code>, <code style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>require_approval</code>, or <code style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>block</code>.
          </p>

          <pre style={{ background: "rgba(5,8,18,0.5)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 12, lineHeight: 1.6, overflow: "auto", padding: 16 }}>
{`# policy.yaml
rules:
  - server: filesystem
    tool: write_file
    action: require_approval

  - server: filesystem
    tool: delete_*
    action: block

  - server: github
    tool: create_or_update_file
    action: require_approval

  - server: "*"
    tool: "*"
    action: allow`}
          </pre>

          <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6 }}>
            Pass the policy file when starting Watchtower:
          </p>

          <pre style={{ background: "rgba(5,8,18,0.5)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--teal)", fontFamily: "var(--font-mono)", fontSize: 12, overflow: "auto", padding: 14 }}>
{`Watchtower(
    app_name="my-agent",
    policy_path="policy.yaml",
    ui=True,
)`}
          </pre>

          <p style={{ color: "var(--text-faint)", fontSize: 12 }}>
            A visual policy editor with live dry-run preview is on the roadmap (Phase E).
          </p>
        </div>
      </div>
    </div>
  );
}
