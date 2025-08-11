// Simple remoteEntry UI for Psyche‑Sim agent
// Exports a minimal mount/unmount API that the frontend can call:
//   import Remote from 'agents/psyche-sim/ui/remoteEntry.js'
//   const { mount, unmount } = Remote
//
// The mount function signature:
//   mount(containerElement, runHandler)
// - containerElement: DOM element to render into
// - runHandler (optional): function(spec) => Promise that runs the agent (provided by frontend)
// If runHandler is not provided, the UI will display a small helper and let the user
// copy a sample curl command to schedule the agent via the orchestrator.

(function () {
  const AGENT_TITLE = "Psyche Simulation";
  const AGENT_DESC = "Run a streaming demo of the Psyche Simulation network (subcomponents + ego).";

  function createButton(text, onClick) {
    const btn = document.createElement("button");
    btn.textContent = text;
    btn.style.padding = "8px 12px";
    btn.style.borderRadius = "6px";
    btn.style.border = "1px solid #333";
    btn.style.cursor = "pointer";
    btn.onclick = onClick;
    return btn;
  }

  function createPre(text) {
    const pre = document.createElement("pre");
    pre.textContent = text;
    pre.style.whiteSpace = "pre-wrap";
    pre.style.background = "#f7f7f7";
    pre.style.padding = "8px";
    pre.style.borderRadius = "6px";
    pre.style.border = "1px solid #eee";
    return pre;
  }

  function mount(container, runHandler) {
    // Clear container
    container.innerHTML = "";

    const title = document.createElement("h3");
    title.textContent = AGENT_TITLE;
    container.appendChild(title);

    const desc = document.createElement("div");
    desc.textContent = AGENT_DESC;
    desc.style.marginBottom = "8px";
    container.appendChild(desc);

    const output = document.createElement("div");
    output.style.margin = "12px 0";
    output.style.maxHeight = "240px";
    output.style.overflow = "auto";
    output.style.background = "#fff";
    output.style.border = "1px solid #eee";
    output.style.padding = "8px";
    output.style.borderRadius = "6px";
    container.appendChild(output);

    function appendLine(line) {
      const el = document.createElement("div");
      el.textContent = line;
      el.style.fontFamily = "monospace";
      el.style.fontSize = "13px";
      el.style.padding = "2px 0";
      output.appendChild(el);
      output.scrollTop = output.scrollHeight;
    }

    // Sample spec we'll send when user clicks Run (can be overridden by runHandler)
    const sampleSpec = {
      spec: {
        prompt: "Quick system check: integrate subsystem signals and summarize.",
        mode: "stream",
        chunk_delay: 0.06,
        agent_id: "mentatlab.psyche-sim"
      },
      context: {}
    };

    const runBtn = createButton("Run Psyche Simulation (Stream)", async () => {
      appendLine("[ui] Starting streaming run...");
      if (typeof runHandler === "function") {
        try {
          // Allow frontend to handle scheduling/stream routing
          await runHandler(sampleSpec.spec);
          appendLine("[ui] Run handed to frontend runHandler.");
        } catch (err) {
          appendLine("[ui] runHandler error: " + String(err));
        }
        return;
      }

      // Fallback: call orchestrator directly (assumes orchestrator at /agents/schedule)
      try {
        appendLine("[ui] Scheduling via /agents/schedule (fallback)...");
        const resp = await fetch("/agents/schedule", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            agent_manifest: null, // frontend/orchestrator should know the manifest; fallback not providing it
            inputs: {
              spec: sampleSpec.spec,
              context: {}
            },
            execution_id: "ui-run-" + Math.floor(Math.random() * 100000),
            skip_validation: true
          })
        });
        const body = await resp.text();
        appendLine("[ui] Orchestrator response: " + body);
      } catch (e) {
        appendLine("[ui] Fallback scheduling failed: " + String(e));
        appendLine("If you have a frontend runHandler, it will integrate the agent manifest and schedule properly.");
      }
    });
    container.appendChild(runBtn);

    const help = document.createElement("div");
    help.style.marginTop = "10px";
    help.innerHTML = "<small>Use the Run button to start a streaming Psyche Simulation. Output will appear above.</small>";
    container.appendChild(help);

    // Provide a sample curl command the user can copy (for environments without runHandler)
    const curlCmd = `curl -sS -X POST http://127.0.0.1:8000/agents/schedule -H "Content-Type: application/json" -d '${JSON.stringify({
      agent_manifest: "USE_MANIFEST_CONTENT_HERE",
      inputs: { spec: sampleSpec.spec, context: {} },
      execution_id: "ui-manual-" + Date.now(),
      skip_validation: false
    })}'`;
    const pre = createPre(curlCmd);
    pre.style.marginTop = "10px";
    container.appendChild(pre);

    // Expose appendLine so host can stream logs into this UI by calling the mount's returned object
    return { appendLine, unmount: () => { container.innerHTML = ""; } };
  }

  // Export for common module systems and window global
  const Remote = { mount };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = Remote;
  } else {
    window.PsycheSimRemote = Remote;
  }
})();