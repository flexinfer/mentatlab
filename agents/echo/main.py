#!/usr/bin/env python3
from __future__ import annotations

import sys
from typing import List, Optional

# Try to import the common emit helper; fall back to adjusting sys.path if needed
try:
    from agents.common.emit import log_info, log_error, checkpoint, set_correlation_id
except Exception:
    import os
    import sys as _sys
    _sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
    from agents.common.emit import log_info, log_error, checkpoint, set_correlation_id


def main(argv: Optional[List[str]] = None) -> int:
    if argv is None:
        argv = sys.argv[1:]

    # optional: allow a first arg like --cid=... to set correlation id
    if argv and argv[0].startswith("--cid="):
        cid = argv[0].split("=", 1)[1]
        if cid:
            try:
                set_correlation_id(cid)
            except Exception:
                pass
        argv = argv[1:]

    # Start checkpoint
    try:
        checkpoint("start", 0.0, {"args_count": len(argv)})
        log_info("echo: start", {"args_count": len(argv)})
    except Exception:
        pass

    # Emit one stderr line for demonstration; the orchestrator will treat this as error stream
    try:
        sys.stderr.write("[echo] demonstration stderr line\n")
        sys.stderr.flush()
    except Exception:
        pass

    # For each arg, emit an info log line
    for i, arg in enumerate(argv):
        try:
            log_info("echo: arg", {"index": i, "value": arg})
        except Exception:
            # do not fail because of logging issues
            pass

    # End checkpoint
    try:
        checkpoint("end", 1.0, {"args_count": len(argv)})
        log_info("echo: done", {"args_count": len(argv)})
    except Exception:
        pass

    return 0


if __name__ == "__main__":
    raise SystemExit(main())