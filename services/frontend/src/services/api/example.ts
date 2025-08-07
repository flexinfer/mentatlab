/**
 * Example usage of the new API service layer
 */

import { apiService } from './apiService';

// Example 1: Basic usage with the default API service instance
async function exampleBasicUsage() {
  // Connect WebSocket for streaming
  await apiService.connectWebSocket();
  
  // Use Flow service
  const flows = await apiService.flows.listFlows({ limit: 10 });
  console.log('Available flows:', flows);
  
  // Execute a flow with streaming updates
  const execution = await apiService.flows.executeFlow({
    flowId: 'my-flow-id',
    inputs: { message: 'Hello' }
  });
  
  // Subscribe to execution updates
  const unsubscribe = apiService.flows.subscribeToExecution(
    execution.executionId,
    (update) => {
      console.log('Flow update:', update);
    }
  );
  
  // Clean up when done
  unsubscribe?.();
}

// Example 2: Agent communication
async function exampleAgentUsage() {
  // List available agents
  const agents = await apiService.agents.listAgents({ status: 'online' });
  
  // Send task to an agent
  const task = await apiService.agents.sendTask(agents[0].id, {
    agentId: agents[0].id,
    type: 'process',
    input: { data: 'some data' }
  });
  
  // Subscribe to agent messages
  const unsubscribe = apiService.agents.subscribeToAgentMessages(
    agents[0].id,
    (message) => {
      console.log('Agent message:', message);
    }
  );
  
  return { task, unsubscribe };
}

// Example 3: Media upload with progress tracking
async function exampleMediaUpload(file: File) {
  // Upload file with progress tracking
  const mediaFile = await apiService.media.uploadFile(file, {
    onProgress: (progress) => {
      console.log(`Upload progress: ${progress.percentage}%`);
    },
    metadata: {
      description: 'User uploaded file',
      tags: ['example', 'demo']
    }
  });
  
  // Process the uploaded media (e.g., resize an image)
  if (mediaFile.type === 'image') {
    const processed = await apiService.media.processMedia(mediaFile.id, {
      resize: { width: 800, height: 600 },
      format: 'webp',
      quality: 85
    });
    
    console.log('Processed media:', processed);
  }
  
  return mediaFile;
}

// Example 4: Real-time streaming with multimodal data
async function exampleMultimodalStreaming() {
  // Ensure WebSocket is connected
  if (!apiService.wsClient || apiService.wsClient.getStatus() !== 'connected') {
    await apiService.connectWebSocket();
  }
  
  // Subscribe to WebSocket status changes
  const statusUnsubscribe = apiService.wsClient!.onStatus((status) => {
    console.log('WebSocket status:', status);
  });
  
  // Subscribe to streaming messages
  const messageUnsubscribe = apiService.wsClient!.onMessage((message) => {
    console.log('Stream message:', message);
    
    // Handle different message types
    switch (message.type) {
      case 'audio':
        // Handle audio stream
        break;
      case 'video':
        // Handle video stream
        break;
      case 'data':
        // Handle data stream
        break;
    }
  });
  
  // Send a message via WebSocket
  apiService.wsClient!.send({
    type: 'start-stream',
    data: { mediaType: 'audio', quality: 'high' }
  });
  
  return { statusUnsubscribe, messageUnsubscribe };
}

// Example 5: Error handling and retry
async function exampleErrorHandling() {
  try {
    // This will automatically retry on network errors
    const flow = await apiService.flows.getFlow('some-flow-id');
    return flow;
  } catch (error) {
    // HTTP errors are automatically transformed to user-friendly messages
    if (error instanceof Error) {
      console.error('Failed to get flow:', error.message);
    } else {
      console.error('Failed to get flow:', error);
    }
    
    // You can also check the original error
    if ((error as any).status === 404) {
      console.log('Flow not found');
    }
  }
}

// Example 6: Custom configuration
async function exampleCustomConfig() {
  // Update API configuration at runtime
  apiService.updateConfig({
    apiKey: 'new-api-key',
    baseUrl: 'https://api.production.com'
  });
  
  // Check API health
  const isHealthy = await apiService.healthCheck();
  console.log('API is healthy:', isHealthy);
}

// Export examples for testing
export {
  exampleBasicUsage,
  exampleAgentUsage,
  exampleMediaUpload,
  exampleMultimodalStreaming,
  exampleErrorHandling,
  exampleCustomConfig
};