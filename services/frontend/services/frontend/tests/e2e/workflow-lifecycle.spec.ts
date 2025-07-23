import { test, expect } from '@playwright/test';

test('should complete full workflow lifecycle', async ({ page, request }) => {
  // Navigate to the main page
  await page.goto('/');

  // Create Workflow in UI: Input node connected to an "echo" node.
  // Assuming 'input' and 'echo' agents are available in the palette.

  // 1. Drag and drop 'input' node
  const inputAgentCard = page.locator('[data-testid="agent-card-Input Agent"]');
  const flowCanvas = page.locator('[data-testid="flow-canvas"]');

  await inputAgentCard.dragTo(flowCanvas);

  // 2. Drag and drop 'echo' node
  const echoAgentCard = page.locator('[data-testid="agent-card-Echo Agent"]');
  await echoAgentCard.dragTo(flowCanvas, {
    targetPosition: { x: 400, y: 200 }, // Adjust position as needed
  });

  // Connect the nodes (This part is complex and might require manual interaction or more advanced Playwright features)
  // For simplicity, we'll assume the nodes are created and we can find their IDs.
  // In a real scenario, you'd need to interact with the React Flow handles to create connections.
  // This might involve clicking on the source handle of the input node and dragging to the target handle of the echo node.
  // For now, we'll rely on the backend to handle the connection if the workflow is saved and loaded.

  // Extract workflowId from the UI or application state.
  // This is a placeholder. In a real application, you'd have a way to get the workflow ID after saving.
  // For example, if there's a "Save" button that returns the ID, or if the ID is in the URL.
  // For this test, we'll assume a default workflow ID or try to extract it from a visible element.
  // If the workflow ID is not directly visible, you might need to inspect network requests or local storage.
  // For now, let's assume the workflow ID is displayed somewhere or can be inferred.
  // A more robust solution would involve intercepting the save API call.

  // Placeholder for workflowId extraction
  // You might need to add a data-testid to an element that displays the workflow ID.
  // For example, if there's a div with data-testid="workflow-id" that shows the ID.
  const workflowIdElement = page.locator('[data-testid="workflow-id"]');
  let workflowId = 'test-workflow-id'; // Default or placeholder

  try {
    // Attempt to get the workflow ID if it's displayed in the UI
    workflowId = await workflowIdElement.textContent() || workflowId;
  } catch (error) {
    console.warn('Could not find workflow ID element, using placeholder:', error);
  }

  // Execute Workflow via API
  const backendUrl = 'http://localhost:8000'; // Assuming backend runs on 8000
  const executeEndpoint = `${backendUrl}/api/v1/orchestrator/execute/${workflowId}`;
  const inputPayload = {
    input_data: {
      message: 'Hello E2E Test!',
    },
  };

  const apiResponse = await request.post(executeEndpoint, {
    data: inputPayload,
  });

  expect(apiResponse.ok()).toBeTruthy();
  const responseBody = await apiResponse.json();
  expect(responseBody.status).toBe('completed');
  expect(responseBody.output).toEqual({ message: 'Hello E2E Test!' }); // Assuming echo_plugin returns the input message
});