import http from "http";
import https from "https";
import { URL } from "url";

export type SSEEvent = { event: string; data: any; id?: string };

type OnEventCb = (ev: SSEEvent) => void;
type OnOpenCb = () => void;

export function openSSE(urlStr: string, options?: { headers?: Record<string, string> }) {
  const url = new URL(urlStr);
  const isHttps = url.protocol === "https:";
  const client = isHttps ? https : http;

  const headers: Record<string, string> = {
    Accept: "text/event-stream",
    ...options?.headers
  };

  const req = client.request(
    {
      method: "GET",
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      headers
    },
    (res) => {
      // handled below by onResponse
    }
  );

  let onOpenCb: OnOpenCb | null = null;
  const onEventCbs: OnEventCb[] = [];

  let resRef: http.IncomingMessage | null = null;
  let buffer = "";

  const closed = { val: false };

  req.on("response", (res: http.IncomingMessage) => {
    resRef = res;
    if (res.statusCode === 200) {
      if (onOpenCb) onOpenCb();
    }
    res.setEncoding("utf8");
    res.on("data", (chunk: string) => {
      buffer += chunk;
      // Process full SSE records separated by blank line
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        processBlock(raw);
      }
    });
    res.on("end", () => {
      // flush any remaining (rare)
      if (buffer.trim()) {
        processBlock(buffer);
        buffer = "";
      }
    });
  });

  req.on("error", () => {
    // ignore - tests will fail via timeouts/assertions if needed
  });

  req.end();

  function processBlock(block: string) {
    // SSE block: lines separated by \n (may have \r)
    const lines = block.split(/\n/).map((l) => l.replace(/\r$/, ""));
    let id: string | undefined;
    let event = "message";
    const dataLines: string[] = [];

    for (const line of lines) {
      if (line.length === 0) continue;
      if (line.startsWith(":")) {
        // comment/heartbeat - ignore
        continue;
      }
      const [field, ...rest] = line.split(":");
      const value = rest.join(":").trimStart();
      if (field === "id") {
        id = value;
      } else if (field === "event") {
        event = value || "message";
      } else if (field === "data") {
        dataLines.push(value);
      }
    }

    if (dataLines.length === 0) {
      // no data to emit; ignore
      return;
    }

    const dataStr = dataLines.join("\n");
    let parsed: any = dataStr;
    try {
      parsed = JSON.parse(dataStr);
    } catch {
      // keep string if JSON parse fails
      parsed = dataStr;
    }

    const ev: SSEEvent = { event, data: parsed };
    if (id) ev.id = id;

    for (const cb of onEventCbs) {
      try {
        cb(ev);
      } catch {
        // swallow callback errors for robustness
      }
    }
  }

  return {
    close: () => {
      if (closed.val) return;
      closed.val = true;
      try {
        if (resRef && typeof (resRef as any).destroy === "function") {
          (resRef as any).destroy();
        }
        req.destroy();
      } catch {
        // ignore
      }
    },
    onEvent: (cb: OnEventCb) => {
      onEventCbs.push(cb);
    },
    onOpen: (cb: OnOpenCb) => {
      onOpenCb = cb;
    }
  };
}