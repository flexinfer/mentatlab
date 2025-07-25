# JSON Schema Definitions

This document contains the JSON Schema definitions for `agent.schema.json` and `flow.schema.json`.

---

## Agent Schema (`schemas/agent.schema.json`)

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "MentatLab Agent Manifest",
  "description": "Defines the structure for an agent's manifest.yaml file.",
  "type": "object",
  "required": [
    "id",
    "version",
    "image",
    "description",
    "inputs",
    "outputs"
  ],
  "properties": {
    "id": {
      "description": "Globally unique, reverse-DNS style identifier for the agent.",
      "type": "string",
      "pattern": "^[a-zA-Z0-9_.-]+$"
    },
    "version": {
      "description": "Semantic Version 2.0 of the agent.",
      "type": "string",
      "pattern": "^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-((?:0|[1-9]\\d*|\\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\\.(?:0|[1-9]\\d*|\\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\\+([0-9a-zA-Z-]+(?:\\.[0-9a-zA-Z-]+)*))?$"
    },
    "image": {
      "description": "OCI container image reference with an explicit tag or digest.",
      "type": "string"
    },
    "runtime": {
      "description": "The runtime environment for the agent, e.g., 'python3.12'.",
      "type": "string"
    },
    "description": {
      "description": "A brief description of the agent's purpose.",
      "type": "string"
    },
    "inputs": {
      "description": "A list of input pins for the agent.",
      "type": "array",
      "items": {
        "$ref": "#/definitions/pin"
      }
    },
    "outputs": {
      "description": "A list of output pins for the agent.",
      "type": "array",
      "items": {
        "$ref": "#/definitions/pin"
      }
    },
    "longRunning": {
      "description": "If true, the agent runs as a long-lived K8s Deployment; otherwise, it runs as a short-lived Job.",
      "type": "boolean",
      "default": false
    },
    "ui": {
      "type": "object",
      "properties": {
        "remoteEntry": {
          "description": "URL to a UMD/Module Federation bundle exposing a React component named NodePanel.",
          "type": "string",
          "format": "uri"
        }
      }
    },
    "resources": {
        "type": "object",
        "properties": {
            "gpu": {
                "type": "boolean"
            }
        }
    },
    "env": {
        "type": "array",
        "items": {
            "type": "string"
        }
    }
  },
  "definitions": {
    "pin": {
      "type": "object",
      "required": [
        "name",
        "type"
      ],
      "properties": {
        "name": {
          "type": "string"
        },
        "type": {
          "type": "string",
          "enum": [
            "string",
            "number",
            "boolean",
            "json",
            "binary"
          ]
        }
      }
    }
  }
}
```

---

## Flow Schema (`schemas/flow.schema.json`)

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "MentatLab Flow",
  "description": "Defines the structure for a *.mlab flow file.",
  "type": "object",
  "required": [
    "apiVersion",
    "kind",
    "meta",
    "graph"
  ],
  "properties": {
    "apiVersion": {
      "description": "Schema version for the flow file.",
      "type": "string",
      "pattern": "^v1(alpha|beta)?\\d*$"
    },
    "kind": {
      "description": "The type of the document, which is always 'Flow'.",
      "type": "string",
      "const": "Flow"
    },
    "meta": {
      "type": "object",
      "required": [
        "id",
        "name",
        "version",
        "createdAt"
      ],
      "properties": {
        "id": {
          "description": "Unique identifier for the flow within the workspace.",
          "type": "string"
        },
        "name": {
          "description": "Human-readable name for the flow.",
          "type": "string"
        },
        "description": {
          "description": "A brief description of the flow's purpose.",
          "type": "string"
        },
        "version": {
          "description": "Semantic version of the flow.",
          "type": "string"
        },
        "createdBy": {
          "description": "The user or entity that created the flow.",
          "type": "string"
        },
        "createdAt": {
          "description": "The timestamp when the flow was created.",
          "type": "string",
          "format": "date-time"
        }
      }
    },
    "graph": {
      "type": "object",
      "required": [
        "nodes",
        "edges"
      ],
      "properties": {
        "nodes": {
          "type": "array",
          "items": {
            "$ref": "#/definitions/node"
          }
        },
        "edges": {
          "type": "array",
          "items": {
            "$ref": "#/definitions/edge"
          }
        }
      }
    },
    "layout": {
      "type": "object",
      "properties": {
        "zoom": {
          "type": "number"
        },
        "viewport": {
          "$ref": "#/definitions/position"
        }
      }
    },
    "runConfig": {
      "type": "object",
      "properties": {
        "maxTokens": {
          "type": "integer"
        },
        "temperature": {
          "type": "number"
        },
        "secrets": {
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      }
    }
  },
  "definitions": {
    "position": {
      "type": "object",
      "properties": {
        "x": {
          "type": "number"
        },
        "y": {
          "type": "number"
        }
      }
    },
    "node": {
      "type": "object",
      "required": [
        "id",
        "type",
        "position"
      ],
      "properties": {
        "id": {
          "type": "string"
        },
        "type": {
          "type": "string"
        },
        "position": {
          "$ref": "#/definitions/position"
        },
        "outputs": {
          "type": "object"
        },
        "params": {
          "type": "object"
        }
      }
    },
    "edge": {
      "type": "object",
      "required": [
        "from",
        "to"
      ],
      "properties": {
        "from": {
          "type": "string",
          "pattern": "^[^.]+\\.[^.]+$"
        },
        "to": {
          "type": "string",
          "pattern": "^[^.]+\\.[^.]+$"
        }
      }
    }
  }
}
