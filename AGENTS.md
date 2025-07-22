This introduces the core concepts, shows how to scaffold a new agent (aka Cog‑Pak), and spells out the folder conventions that the rest of the repo will expect.

# MentatLab Agents (Cog‑Paks)
*Last updated: 2025‑07‑22*

MentatLab agents are **self‑contained, container‑runnable micro‑services** that expose a well‑defined interface to the canvas.  
Each agent is packaged as a **Cog‑Pak**—a directory (or tarball/OCI image) containing:

* `manifest.yaml` – declarative contract (inputs, outputs, image, UI module)  
* `Dockerfile` – how to build the runtime image  
* `src/` – the actual code (Python, JS, Rust… your choice)  
* optional `ui/` – a micro‑frontend bundle if the node needs a custom React panel  

The MentatLab engine translates edges on the canvas into **Kubernetes Jobs** (or Deployments for long‑running modes) and streams logs, traces, and token metrics back to the UI.

---

## 1 Quick Start: Your First Agent

Below builds the canonical “echo” agent that simply returns whatever text it receives.

### 1.1 Create the folder

```bash
mkdir -p agents/echo
cd agents/echo
```
1.2 Write manifest.yaml

id: flexinfer.echo               # must be globally unique
version: 0.1.0
image: harbor.lan/library/echo:0.1.0
runtime: python3.12
description: "Return the input text unchanged."
inputs:
  - name: text
    type: string
outputs:
  - name: text
    type: string
longRunning: false               # will run as a short‑lived Job
ui:
  remoteEntry: https://cdn.flexinfer.ai/echo/0.1.0/remoteEntry.js

1.3 Add a minimal implementation

src/main.py:

import sys, json
payload = json.load(sys.stdin)          # MentatLab passes a single‑line JSON blob
print(json.dumps({"text": payload["text"]}))

1.4 Dockerfile

FROM python:3.12-slim
COPY src/ /app/
WORKDIR /app
ENTRYPOINT ["python", "main.py"]

1.5 Build & push

docker build -t harbor.lan/library/echo:0.1.0 .
docker push harbor.lan/library/echo:0.1.0

That’s all. Drop the folder anywhere under agents/ and commit; CI will pick it up (see Section 6: CI hooks).

⸻

2 Anatomy of a manifest.yaml

Key fields:
	•	id Reverse‑DNS style. Use your GitHub handle or company domain as the prefix.
	•	version SemVer 2.0; breaking changes bump major.
	•	image OCI reference with explicit tag or digest.
	•	inputs / outputs Each pin needs name + type. Primitive types: string, number, boolean, json, binary.
	•	longRunning true → K8s Deployment; false → Job.
	•	ui.remoteEntry Optional URL to a UMD/Module Federation bundle exposing a React component named NodePanel.

A complete JSON Schema lives at schemas/manifest.schema.json.

⸻

3 Directory Layout Convention

mentatlab/
├── agents/
│   ├── echo/
│   │   ├── manifest.yaml
│   │   ├── Dockerfile
│   │   └── src/
│   └── ...
├── helm/                 # chart for the platform itself
├── cmd/mentatctl/        # CLI
└── docs/
    └── agents.md         # ← you are here

CI looks for agents/*/manifest.yaml; if found it will:
	1.	Lint against the schema.
	2.	Build the Docker image (unless tag already exists in Harbor).
	3.	Push to the registry.
	4.	Run kind‑test flow to ensure the node can start in a sandbox cluster.

⸻

4 Lifecycle Hooks

An agent can implement any of these optional executables inside the container:

Hook	When it runs	Purpose
/prestart	Before main process	Download models, warm caches, run migrations.
/health	Every 30 s (HTTP GET)	Return 200 OK for as‑ready; else Job marked failed.
/postrun	After successful exit	Upload artefacts, clean temp storage.

Scripts must be executable. Any non‑zero exit code fails the run.

⸻

5 Logging, Metrics & Cost
	•	Write JSON lines to stdout. Non‑JSON will still appear in logs but won’t be parsed.
	•	Stdout MUST include a final record of this shape (keys can be null):

{
  "mentat_meta": {
    "tokens_input": 512,
    "tokens_output": 128,
    "seconds": 3.21,
    "model": "llama3:70b"
  }
}

The engine picks it up and pushes a Prometheus counter mentat_tokens_total{agent_id="flexinfer.echo", direction="input"} etc.

⸻

6 CI Hooks (GitHub Actions)

When you push to any branch:
	1.	lint‑agents – Validate manifests.
	2.	build‑agent‑images – Docker Buildx + multi‑arch if Dockerfile timestamp changed.
	3.	kind‑e2e – Spin up a KinD cluster, install Helm chart, run samples/flow‑smoke.mlab.
	4.	publish‑cog‑pak – Attach .mlab & image digest as release asset on tag push.

Workflows live in .github/workflows/agents‑*.yml.

⸻

7 Testing Locally

mentatctl dev run agents/echo/manifest.yaml \
  --input text="Hello Mentat!" --follow

--follow tails logs just like kubectl logs -f.

⸻

8 Submitting to The Library
	1.	Fork flexinfer/mentatlab.
	2.	Add your agent under agents/.
	3.	Open a PR describing: purpose, inputs/outputs, resource needs, licence.
	4.	The core team reviews security & style.
	5.	Once merged, your agent shows up in the in‑app search within ~10 min.

⸻

9 Roadmap for Agents (excerpt from PLAN.md)
	•	Sprint 5 – Plug‑in SDK stabilisation, semver freeze.
	•	Beta – Support for multi‑modal tensor streams (audio/wav, image/jpeg).
	•	v1.0 – WebAssembly runtimes, signed attestation on manifest.yaml.

⸻

10 FAQ

<details>
<summary>Can I call external APIs from an agent?</summary>


Yes, but remember the container runs in a locked‑down network namespace—no inbound ports, outbound egress allowed. Add a concise cost breakdown in the mentat_meta block if you charge tokens or $$.

</details>


<details>
<summary>How do I share environment secrets (e.g., `OPENAI_API_KEY`)?</summary>


Declare env: entries in manifest.yaml; the platform injects sealed secrets at runtime. Never bake secrets in the image.

</details>


<details>
<summary>What if my agent needs a GPU?</summary>


Add resources.gpu: true to the manifest; MentatLab sets the nvidia.com/gpu: 1 request.
Use nodeSelector/tolerations as needed.

</details>



⸻

Happy hacking! Open issues or join #mentats on Discord if you hit snags.
