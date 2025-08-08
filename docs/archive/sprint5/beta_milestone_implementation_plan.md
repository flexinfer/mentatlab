# Beta Milestone Implementation Plan
## Multimodal Support & Streaming Inference API

*Version: 1.0*  
*Date: August 2, 2025*  
*Timeline: Q3-Q4 2025 (16 weeks)*  
*Dependencies: Sprint 5 K8s Infrastructure*

---

## Executive Summary

This implementation plan details the 16-week development schedule for MentatLab's Beta milestone, which introduces multimodal capabilities (audio, image, video) and streaming inference APIs. Building on Sprint 5's Kubernetes scheduling and SDK v1.0 foundation, this milestone transforms MentatLab from a text-only platform to a comprehensive multimodal AI orchestration system.

### Key Deliverables
1. **Multimodal Support**: Audio (WAV), image (JPEG/PNG), video streams
2. **Streaming Inference**: WebSocket/SSE real-time data flow
3. **Large File Handling**: S3-compatible storage integration
4. **Example Agents**: Production-ready multimodal agent implementations

### Success Criteria
- Support files up to 1GB for video processing
- Achieve <100ms streaming latency
- Maintain backward compatibility with text agents
- 99.9% streaming uptime

---

## Phase 1: Core Infrastructure (Weeks 1-4)

### Week 1-2: Schema Extensions & Storage Design

#### 1.1 Manifest Schema Extensions

**Technical Specification:**
```yaml
# Update schemas/agent.schema.json
definitions:
  pin:
    properties:
      type:
        enum: 
          - "string"
          - "number" 
          - "boolean"
          - "json"
          - "binary"
          - "audio"    # NEW
          - "image"    # NEW
          - "video"    # NEW
          - "stream"   # NEW
      metadata:      # NEW
        type: "object"
        properties:
          mimeType: {type: "string"}
          encoding: {type: "string"}
          sampleRate: {type: "integer"}
          channels: {type: "integer"}
          width: {type: "integer"}
          height: {type: "integer"}
          fps: {type: "number"}
          duration: {type: "number"}
          maxSize: {type: "string"}
```

**Implementation Tasks:**
- [ ] Update `schemas/agent.schema.json` with multimodal pin types
- [ ] Extend `services/gateway/app/models.py` with MultimodalPin class
- [ ] Update manifest validation in `services/orchestrator/app/manifest_validator.py`
- [ ] Create backward compatibility tests

#### 1.2 S3-Compatible Storage Integration

**Architecture Design:**
```python
# services/storage/app/storage_manager.py
class StorageManager:
    def __init__(self):
        self.s3_client = boto3.client('s3', 
            endpoint_url=os.getenv('S3_ENDPOINT'),
            aws_access_key_id=os.getenv('S3_ACCESS_KEY'),
            aws_secret_access_key=os.getenv('S3_SECRET_KEY')
        )
        self.bucket_name = os.getenv('S3_BUCKET', 'mentatlab-media')
    
    def generate_key(self, workspace_id: str, flow_id: str, 
                    execution_id: str, node_id: str, 
                    pin_name: str, ext: str) -> str:
        timestamp = int(time.time() * 1000)
        return f"{workspace_id}/{flow_id}/{execution_id}/{node_id}/{pin_name}_{timestamp}.{ext}"
    
    async def upload(self, file_data: bytes, metadata: dict) -> dict:
        # Validate file type and size
        # Upload to S3 with metadata
        # Return reference object
```

**Implementation Tasks:**
- [ ] Deploy MinIO instance for development
- [ ] Create storage service with S3 client
- [ ] Implement file upload/download APIs
- [ ] Create reference generation system
- [ ] Add storage cleanup jobs

### Week 3-4: Reference-Based Data Flow

#### 1.3 Multimodal Edge Processor

**Technical Specification:**
```python
# services/orchestrator/app/multimodal_edge_processor.py
class MultimodalEdgeProcessor:
    async def process_edge_data(self, edge: Edge, data: Any) -> Any:
        source_pin = self.get_source_pin(edge)
        
        if source_pin.type in ['audio', 'image', 'video']:
            if isinstance(data, dict) and 'ref' in data:
                # Validate reference
                return await self.validate_reference(data)
            else:
                # Upload raw data
                ref = await self.storage.upload(data, source_pin.metadata)
                return self.create_reference(ref, source_pin.type)
        
        return data  # Traditional data types
```

**Implementation Tasks:**
- [ ] Create MultimodalEdgeProcessor class
- [ ] Integrate with existing edge processing pipeline
- [ ] Implement reference validation
- [ ] Add metadata propagation
- [ ] Create reference caching layer

#### 1.4 Orchestrator Multimodal Support

**K8s Job Configuration Updates:**
```python
# services/orchestrator/app/k8s_scheduler.py
def create_multimodal_job(self, agent_manifest: dict, 
                         input_refs: dict) -> V1Job:
    # Calculate resource requirements based on input
    resources = self.calculate_resources(agent_manifest, input_refs)
    
    # Add volume mounts for large file processing
    volumes = self.create_ephemeral_volumes(resources)
    
    # Configure environment variables with S3 credentials
    env_vars = self.create_storage_env_vars()
    
    return self.create_k8s_job(
        resources=resources,
        volumes=volumes,
        env_vars=env_vars
    )
```

**Implementation Tasks:**
- [ ] Extend K8s job creation for multimodal agents
- [ ] Implement dynamic resource calculation
- [ ] Add ephemeral storage volume support
- [ ] Create S3 credential injection
- [ ] Update job monitoring for large workloads

---

## Phase 2: Streaming API (Weeks 5-8)

### Week 5-6: WebSocket Infrastructure

#### 2.1 Enhanced WebSocket Manager

**Technical Specification:**
```python
# services/gateway/app/streaming_websockets.py
class StreamingConnectionManager(ConnectionManager):
    def __init__(self):
        super().__init__()
        self.stream_registry = StreamRegistry()
        self.buffer_manager = BufferManager()
    
    async def create_stream(self, agent_id: str, 
                          pin_name: str) -> StreamSession:
        stream_id = generate_stream_id()
        session = StreamSession(
            stream_id=stream_id,
            agent_id=agent_id,
            pin_name=pin_name,
            created_at=datetime.utcnow()
        )
        await self.stream_registry.register(session)
        return session
    
    async def stream_chunk(self, stream_id: str, 
                         chunk: StreamChunk) -> None:
        # Buffer management for reliability
        await self.buffer_manager.add(stream_id, chunk)
        
        # Forward to subscribers
        subscribers = await self.get_subscribers(stream_id)
        for sub in subscribers:
            await self.send_chunk(sub, chunk)
```

**Implementation Tasks:**
- [ ] Create StreamingConnectionManager class
- [ ] Implement stream session management
- [ ] Add buffering for reliability
- [ ] Create subscription system
- [ ] Implement backpressure handling

#### 2.2 WebSocket Endpoints

**API Specification:**
```python
# services/gateway/app/router_streaming.py
@router.websocket("/ws/streams/{stream_id}")
async def stream_endpoint(websocket: WebSocket, stream_id: str):
    await manager.connect(websocket, stream_id)
    try:
        while True:
            data = await websocket.receive_json()
            await process_stream_message(stream_id, data)
    except WebSocketDisconnect:
        await manager.disconnect(websocket, stream_id)

@router.post("/api/v1/streams/init")
async def init_stream(request: StreamInitRequest):
    session = await manager.create_stream(
        agent_id=request.agent_id,
        pin_name=request.pin_name
    )
    return {
        "stream_id": session.stream_id,
        "ws_url": f"/ws/streams/{session.stream_id}"
    }
```

**Implementation Tasks:**
- [ ] Create streaming router module
- [ ] Implement WebSocket endpoints
- [ ] Add authentication/authorization
- [ ] Create stream lifecycle management
- [ ] Implement error handling

### Week 7-8: SSE Support & Agent Integration

#### 2.3 Server-Sent Events Implementation

**Technical Specification:**
```python
# services/gateway/app/sse_streaming.py
@router.get("/api/v1/streams/{stream_id}/sse")
async def sse_stream(stream_id: str):
    async def event_generator():
        async with manager.subscribe(stream_id) as subscription:
            yield f"event: stream_start\ndata: {json.dumps({'stream_id': stream_id})}\n\n"
            
            async for chunk in subscription:
                yield f"event: stream_data\ndata: {json.dumps(chunk.to_dict())}\n\n"
            
            yield f"event: stream_end\ndata: {json.dumps({'stream_id': stream_id})}\n\n"
    
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive"
        }
    )
```

**Implementation Tasks:**
- [ ] Implement SSE endpoints
- [ ] Create event formatting system
- [ ] Add connection management
- [ ] Implement heartbeat mechanism
- [ ] Create client reconnection logic

#### 2.4 Agent SDK Streaming Support

**SDK Extensions:**
```python
# sdk/python/mentatlab/streaming.py
class StreamingAgent(BaseAgent):
    async def stream_output(self, pin_name: str, 
                          data_iterator: AsyncIterator[Any]):
        stream_id = await self.init_stream(pin_name)
        
        try:
            async for chunk in data_iterator:
                await self.send_chunk(stream_id, chunk)
        finally:
            await self.end_stream(stream_id)
```

**Implementation Tasks:**
- [ ] Extend Python SDK with streaming support
- [ ] Update Rust SDK for streaming
- [ ] Add Node.js streaming utilities
- [ ] Create streaming examples
- [ ] Update SDK documentation

---

## Phase 3: Example Agents (Weeks 9-12)

### Week 9-10: Image Processing Agents

#### 3.1 Image Classifier Agent

**Implementation Plan:**
```yaml
# agents/image-classifier/manifest.yaml
id: mentatlab.image-classifier
version: 0.1.0
image: harbor.lan/agents/image-classifier:0.1.0
runtime: python3.11
description: "Classify images using Vision Transformer models"
inputs:
  - name: image
    type: image
    metadata:
      mimeType: "image/jpeg,image/png"
      maxSize: "10MB"
  - name: model
    type: string
    enum: ["vit-base", "resnet50", "efficientnet"]
outputs:
  - name: classification
    type: json
  - name: confidence
    type: number
  - name: features
    type: binary  # For downstream processing
resources:
  profiles: ["image_processing"]
```

**Development Tasks:**
- [ ] Create base image processing agent template
- [ ] Integrate Vision Transformer models
- [ ] Implement efficient image preprocessing
- [ ] Add batch processing support
- [ ] Create comprehensive tests

#### 3.2 YOLO Object Detection Agent

**Implementation Tasks:**
- [ ] Integrate YOLOv8 model
- [ ] Add bounding box output format
- [ ] Implement confidence thresholding
- [ ] Support multiple image formats
- [ ] Create visualization utilities

### Week 11-12: Audio & Video Agents

#### 3.3 Audio Transcription Agent (Whisper)

**Implementation Plan:**
```python
# agents/audio-transcriber/src/main.py
class AudioTranscriber(StreamingAgent):
    def __init__(self):
        self.model = whisper.load_model("base")
    
    async def process(self, inputs: dict) -> dict:
        audio_ref = inputs["audio"]
        audio_data = await self.download_media(audio_ref)
        
        # Stream transcription segments
        async for segment in self.transcribe_streaming(audio_data):
            await self.stream_output("transcript", segment)
        
        return {"status": "completed"}
```

**Development Tasks:**
- [ ] Integrate OpenAI Whisper
- [ ] Implement streaming transcription
- [ ] Add language detection
- [ ] Support multiple audio formats
- [ ] Create subtitle generation

#### 3.4 Video Analysis Agent

**Implementation Tasks:**
- [ ] Create frame extraction pipeline
- [ ] Implement scene detection
- [ ] Add activity recognition
- [ ] Support streaming analysis
- [ ] Create video summarization

---

## Phase 4: Testing & Optimization (Weeks 13-16)

### Week 13-14: Performance Testing

#### 4.1 Load Testing Framework

**Test Scenarios:**
```python
# tests/performance/multimodal_load_test.py
class MultimodalLoadTest:
    scenarios = {
        "image_processing": {
            "concurrent_users": 100,
            "file_size": "5MB",
            "duration": "10m",
            "target_latency": 500  # ms
        },
        "video_streaming": {
            "concurrent_streams": 50,
            "bitrate": "1080p",
            "duration": "30m",
            "target_latency": 100  # ms
        },
        "mixed_workload": {
            "image_agents": 50,
            "audio_agents": 30,
            "video_agents": 20,
            "duration": "1h"
        }
    }
```

**Testing Tasks:**
- [ ] Create load testing framework
- [ ] Implement performance benchmarks
- [ ] Test resource scaling
- [ ] Measure streaming latency
- [ ] Identify bottlenecks

#### 4.2 Memory Management

**Optimization Tasks:**
- [ ] Implement streaming file processing
- [ ] Add memory pooling for buffers
- [ ] Create garbage collection tuning
- [ ] Optimize container memory limits
- [ ] Implement OOM prevention

### Week 15-16: Integration & Documentation

#### 4.3 Integration Testing

**Test Suite:**
```yaml
# tests/integration/multimodal_e2e.yaml
tests:
  - name: "Image to Text Pipeline"
    flow:
      - upload_image: "test_image.jpg"
      - classify_image: "vit-base"
      - generate_description: "gpt-4"
      - validate_output: "json_schema"
  
  - name: "Video Analysis Pipeline"
    flow:
      - upload_video: "test_video.mp4"
      - extract_frames: "1fps"
      - analyze_scenes: "streaming"
      - aggregate_results: "summary"
```

**Integration Tasks:**
- [ ] Create end-to-end test flows
- [ ] Test backward compatibility
- [ ] Validate cross-agent communication
- [ ] Test failure scenarios
- [ ] Measure system resilience

#### 4.4 Documentation & Training

**Documentation Tasks:**
- [ ] Update API documentation
- [ ] Create multimodal agent guide
- [ ] Write streaming best practices
- [ ] Create troubleshooting guide
- [ ] Develop training materials

---

## Resource Requirements

### Team Allocation

| Role | Phase 1 | Phase 2 | Phase 3 | Phase 4 |
|------|---------|---------|---------|---------|
| Platform Engineers | 4 | 3 | 2 | 2 |
| Frontend Engineers | 1 | 2 | 1 | 1 |
| ML Engineers | 0 | 0 | 3 | 1 |
| DevOps Engineers | 2 | 1 | 1 | 2 |
| QA Engineers | 1 | 1 | 2 | 3 |

### Infrastructure Requirements

```yaml
development:
  kubernetes:
    nodes: 10
    gpu_nodes: 3
    storage: "10TB"
  s3_storage:
    capacity: "50TB"
    bandwidth: "10Gbps"
  
production:
  kubernetes:
    nodes: 20
    gpu_nodes: 6
    storage: "20TB"
  s3_storage:
    capacity: "100TB"
    bandwidth: "40Gbps"
  cdn:
    locations: ["us-east", "us-west", "eu-central"]
```

### Performance Targets

| Metric | Target | Measurement |
|--------|--------|-------------|
| Stream Initiation Latency | < 100ms | p99 |
| Streaming Data Latency | < 50ms | p95 |
| Image Processing Time | < 500ms | p90 |
| Video Processing FPS | > 30fps | average |
| Storage Upload Speed | > 100MB/s | sustained |
| Concurrent Streams | > 1000 | peak |
| System Availability | 99.9% | monthly |

---

## Integration Strategy

### Sprint 5 Foundation Integration

#### 1. K8s Scheduling Integration
```python
# Extend existing K8s scheduler
class MultimodalScheduler(K8sScheduler):
    def schedule_agent(self, manifest: dict, inputs: dict):
        # Leverage Sprint 5 K8s CRDs
        if self.is_multimodal(manifest):
            resources = self.calculate_multimodal_resources(inputs)
            job = self.create_multimodal_job(manifest, resources)
        else:
            job = super().schedule_agent(manifest, inputs)
        
        return self.submit_job(job)
```

#### 2. SDK v1.0 Extension
```python
# Maintain backward compatibility
from mentatlab.sdk import Agent  # Sprint 5 SDK

class MultimodalAgent(Agent):
    # All v1.0 functionality preserved
    # New multimodal methods added
    async def process_media(self, media_ref: dict) -> Any:
        # New functionality
        pass
```

#### 3. Manifest Validation Enhancement
```python
# Extend Sprint 5 validation
validator = ManifestValidator(ValidationMode.STRICT)
validator.add_multimodal_rules()
```

### Migration Path

1. **Phase 1**: Feature flags for multimodal types
2. **Phase 2**: Opt-in streaming for compatible agents  
3. **Phase 3**: Gradual agent migration
4. **Phase 4**: Full platform capability

---

## Risk Mitigation

### Technical Risks

| Risk | Impact | Mitigation | Contingency |
|------|--------|------------|-------------|
| S3 Storage Latency | High | CDN integration, caching | Direct file transfer fallback |
| Streaming Scalability | High | Horizontal scaling, buffering | Batch processing mode |
| GPU Resource Constraints | Medium | Dynamic allocation, queuing | CPU-only models |
| Memory Overflow | High | Streaming processing, limits | Automatic job restart |
| Network Bandwidth | Medium | Compression, optimization | Rate limiting |

### Rollback Plan

```yaml
rollback_stages:
  - name: "Disable Multimodal Features"
    steps:
      - Set ENABLE_MULTIMODAL=false
      - Route to text-only endpoints
      - Maintain service availability
  
  - name: "Revert Schema Changes"
    steps:
      - Deploy previous schema version
      - Run migration scripts
      - Validate existing agents
  
  - name: "Full Rollback"
    steps:
      - Revert to Sprint 5 baseline
      - Restore previous deployments
      - Communicate with users
```

---

## Success Criteria

### Technical Success Metrics

1. **Functional Requirements**
   - [ ] All multimodal pin types operational
   - [ ] Streaming latency < 100ms (p99)
   - [ ] Support for 1GB video files
   - [ ] 99.9% streaming uptime

2. **Performance Requirements**
   - [ ] 1000+ concurrent streams
   - [ ] < 2% CPU overhead for streaming
   - [ ] < 500ms image processing (p90)
   - [ ] 30+ fps video processing

3. **Integration Requirements**
   - [ ] 100% backward compatibility
   - [ ] All Sprint 5 features preserved
   - [ ] Seamless SDK migration
   - [ ] No breaking API changes

### Business Success Metrics

1. **Adoption Metrics**
   - 50+ multimodal agents created
   - 100+ developers using streaming APIs
   - 10k+ multimodal flows executed/day
   - 90% developer satisfaction

2. **Operational Metrics**
   - < 5% increase in infrastructure cost
   - < 10% increase in support tickets
   - 99.9% platform availability
   - < 24hr issue resolution

### Testing Strategy

```yaml
test_pyramid:
  unit_tests:
    coverage: "> 90%"
    focus: 
      - Pin validation
      - Reference generation
      - Stream management
  
  integration_tests:
    coverage: "> 80%"
    focus:
      - End-to-end flows
      - Agent communication
      - Storage integration
  
  performance_tests:
    scenarios:
      - Load testing
      - Stress testing
      - Endurance testing
  
  acceptance_tests:
    - User workflows
    - API compatibility
    - Migration scenarios
```

---

## Communication Plan

### Stakeholder Updates

1. **Weekly Progress Reports**
   - Development velocity
   - Risk assessment
   - Blocker resolution
   - Next week priorities

2. **Bi-weekly Demos**
   - Feature demonstrations
   - Performance metrics
   - User feedback incorporation

3. **Monthly Executive Reviews**
   - Milestone progress
   - Budget utilization
   - Strategic alignment

### Developer Communication

1. **Beta Preview Program**
   - Early access for key partners
   - Feedback collection
   - Use case validation

2. **Documentation Releases**
   - API preview docs
   - Migration guides
   - Example implementations

3. **Community Engagement**
   - Blog posts on progress
   - Technical deep-dives
   - Open source contributions

---

## Appendix A: Technical Dependencies

```yaml
dependencies:
  storage:
    - minio: "RELEASE.2025-01-01"
    - boto3: "1.26.0"
  
  streaming:
    - websockets: "11.0"
    - sse-starlette: "1.6.0"
  
  ml_models:
    - transformers: "4.35.0"
    - whisper: "20230314"
    - ultralytics: "8.0.0"
  
  infrastructure:
    - kubernetes: "1.28+"
    - redis: "7.0+"
    - nginx: "1.25+"
```

---

## Appendix B: API Changes

### New Endpoints

```yaml
streaming:
  POST /api/v1/streams/init:
    description: Initialize streaming session
    returns: {stream_id, ws_url}
  
  GET /api/v1/streams/{stream_id}/sse:
    description: SSE streaming endpoint
    produces: text/event-stream
  
  WS /ws/streams/{stream_id}:
    description: WebSocket streaming
    protocol: JSON messages

storage:
  POST /api/v1/storage/upload:
    description: Upload multimodal file
    returns: {ref, metadata}
  
  GET /api/v1/storage/{ref}:
    description: Download file by reference
    returns: Binary data
```

---

**Document Version:** 1.0  
**Created:** August 2, 2025  
**Review Schedule:** Weekly during implementation  
**Approval:** Required from Platform, Security, and Product leads