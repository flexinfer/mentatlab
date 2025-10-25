/**
 * Web Worker for parsing SSE (Server-Sent Events) messages
 *
 * Moves expensive JSON parsing and event normalization off the main thread
 * to prevent UI blocking during high-volume streaming.
 */

interface ParseRequest {
  id: string;
  type: 'parse';
  data: string;
  eventType?: string;
}

interface ParseResponse {
  id: string;
  type: 'parsed';
  result: any;
  error?: string;
}

interface ParsedEvent {
  id?: string;
  event?: string;
  data: any;
  retry?: number;
}

/**
 * Parse SSE message format:
 *
 * id: 123
 * event: log
 * data: {"message": "hello"}
 *
 * or simple:
 *
 * data: {"message": "hello"}
 */
function parseSSEMessage(raw: string): ParsedEvent | null {
  const lines = raw.split('\n');
  const result: ParsedEvent = {
    data: null,
  };

  let dataLines: string[] = [];

  for (const line of lines) {
    if (!line.trim()) continue;

    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;

    const field = line.substring(0, colonIndex).trim();
    const value = line.substring(colonIndex + 1).trim();

    switch (field) {
      case 'id':
        result.id = value;
        break;
      case 'event':
        result.event = value;
        break;
      case 'data':
        dataLines.push(value);
        break;
      case 'retry':
        result.retry = parseInt(value, 10);
        break;
    }
  }

  // Join multi-line data
  if (dataLines.length > 0) {
    const dataStr = dataLines.join('\n');
    try {
      result.data = JSON.parse(dataStr);
    } catch {
      // If JSON parsing fails, keep as string
      result.data = dataStr;
    }
  }

  return result.data !== null ? result : null;
}

/**
 * Normalize parsed event to standard format
 */
function normalizeEvent(parsed: ParsedEvent, seq: number): any {
  return {
    seq,
    id: parsed.id,
    type: parsed.event || 'message',
    ts: parsed.data?.ts || parsed.data?.timestamp || new Date().toISOString(),
    level: parsed.data?.level,
    nodeId: parsed.data?.node_id || parsed.data?.nodeId,
    data: parsed.data,
  };
}

// Sequence counter for events
let eventSeq = 0;

// Message handler
self.onmessage = (event: MessageEvent<ParseRequest>) => {
  const { id, type, data, eventType } = event.data;

  if (type === 'parse') {
    try {
      // Parse SSE message
      const parsed = parseSSEMessage(data);

      if (!parsed) {
        const response: ParseResponse = {
          id,
          type: 'parsed',
          result: null,
          error: 'Failed to parse SSE message',
        };
        self.postMessage(response);
        return;
      }

      // Override event type if provided
      if (eventType) {
        parsed.event = eventType;
      }

      // Normalize to standard format
      const normalized = normalizeEvent(parsed, eventSeq++);

      const response: ParseResponse = {
        id,
        type: 'parsed',
        result: normalized,
      };

      self.postMessage(response);
    } catch (error) {
      const response: ParseResponse = {
        id,
        type: 'parsed',
        result: null,
        error: error instanceof Error ? error.message : String(error),
      };
      self.postMessage(response);
    }
  }
};

// Export empty object for TypeScript
export {};
