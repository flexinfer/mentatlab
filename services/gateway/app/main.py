from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from . import router_flows
from . import websockets
from . import router_agents
from . import streaming
import os

app = FastAPI(title="MentatLab Gateway with Streaming Support", version="0.2.0")

# Security: CORS Configuration
origins = [
    "http://localhost:3000",  # React dev server
    "http://localhost:5173",  # Vite dev server
    "http://127.0.0.1:3000",
    "http://127.0.0.1:5173",
]

# Add environment-specific origins
if os.getenv("FRONTEND_URL"):
    origins.append(os.getenv("FRONTEND_URL"))

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allow_headers=["*", "Cache-Control", "Connection"],  # Add streaming headers
    expose_headers=["*"],
)

# Security: Trusted Host Middleware
trusted_hosts = ["localhost", "127.0.0.1", "*.localhost"]
if os.getenv("TRUSTED_HOSTS"):
    trusted_hosts.extend(os.getenv("TRUSTED_HOSTS").split(","))

app.add_middleware(
    TrustedHostMiddleware,
    allowed_hosts=trusted_hosts
)

# Security Headers Middleware
@app.middleware("http")
async def add_security_headers(request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'"
    return response

app.include_router(websockets.router)
app.include_router(router_agents.router, prefix="/api/v1")
app.include_router(streaming.router, tags=["streaming"])  # Include streaming router without prefix so WebSocket endpoints work

@app.on_event("startup")
async def startup_event():
    """Initialize services on startup."""
    # Initialize streaming manager
    await streaming.streaming_manager.initialize()

@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup services on shutdown."""
    # Cleanup streaming manager
    await streaming.streaming_manager.shutdown()

@app.get("/healthz")
async def healthz():
    return {"status": "ok", "streaming_enabled": True}

@app.get("/")
async def root():
    return {
        "message": "MentatLab Gateway API with Streaming Support",
        "version": "0.2.0",
        "features": ["flows", "agents", "websockets", "streaming", "sse"]
    }

app.include_router(router_flows.router, prefix="/flows")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
