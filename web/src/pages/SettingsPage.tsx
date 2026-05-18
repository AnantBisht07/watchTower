export function SettingsPage() {
  return (
    <div className="pageContent">
      <div className="pageHeader">
        <div>
          <h2>Settings</h2>
          <p>Authentication, webhooks, exporters, and data retention</p>
        </div>
      </div>

      <div className="settingsSection">
        <h3>Authentication</h3>
        <div className="settingsField">
          <label>API Token</label>
          <input
            type="password"
            placeholder="Set WATCHTOWER_API_TOKEN on the server to enable"
            readOnly
          />
          <span className="settingsNote">
            Token is configured server-side via the WATCHTOWER_API_TOKEN environment variable.
            Leave unset for local-only use (no auth required).
          </span>
        </div>
      </div>

      <div className="settingsSection">
        <h3>Webhooks</h3>
        <p style={{ color: "var(--text-faint)", fontSize: 13, marginBottom: 14 }}>
          Configure webhooks in your Watchtower initializer:
        </p>
        <pre style={{ background: "rgba(5,8,18,0.5)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 12, overflow: "auto", padding: 14 }}>
{`Watchtower(
  app_name="my-agent",
  webhooks={
    "approval_required": "https://hooks.slack.com/…",
    "tool_call_rejected": "https://hooks.slack.com/…",
    "run_failed":         "https://my-server.com/hook",
  }
)`}
        </pre>
      </div>

      <div className="settingsSection">
        <h3>Observability exporters</h3>
        <p style={{ color: "var(--text-faint)", fontSize: 13, marginBottom: 14 }}>
          Attach exporters when initializing Watchtower:
        </p>
        <pre style={{ background: "rgba(5,8,18,0.5)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 12, overflow: "auto", padding: 14 }}>
{`from mcp_watchtower.exporters.langfuse import LangfuseExporter
from mcp_watchtower.exporters.langsmith import LangSmithExporter
from mcp_watchtower.exporters.otel import OTelExporter

exporter = LangfuseExporter(public_key="pk-…", secret_key="sk-…")
watchtower.add_exporter(exporter)`}
        </pre>
      </div>

      <div className="settingsSection">
        <h3>Data & storage</h3>
        <div className="settingsField">
          <label>Database path</label>
          <input type="text" defaultValue=".watchtower/watchtower.db" readOnly />
          <span className="settingsNote">
            Set via --db-path CLI flag or WATCHTOWER_DB_PATH environment variable.
          </span>
        </div>
        <div className="settingsField">
          <label>CLI tools</label>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {[
              "mcp-watchtower ui          # open the UI for an existing DB",
              "mcp-watchtower replay <id> # print events for a run",
              "mcp-watchtower export <id> # export run to JSON",
              "mcp-watchtower import file # import an exported run",
            ].map((cmd) => (
              <code key={cmd} style={{ background: "rgba(5,8,18,0.4)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--teal)", display: "block", fontFamily: "var(--font-mono)", fontSize: 12, padding: "5px 10px" }}>
                {cmd}
              </code>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
