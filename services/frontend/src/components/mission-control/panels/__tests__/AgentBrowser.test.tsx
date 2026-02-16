import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, test, expect, beforeEach, vi } from 'vitest';

// Hoisted mocks
const { mockAgentListResult } = vi.hoisted(() => ({
  mockAgentListResult: {
    agents: [] as any[],
    loading: false,
    error: null as string | null,
    refresh: vi.fn(),
    selectedAgent: null as any,
    selectAgent: vi.fn(),
  },
}));

// Mock useAgentList hook
vi.mock('@/hooks/useAgentList', () => ({
  useAgentList: () => mockAgentListResult,
  default: () => mockAgentListResult,
}));

import { AgentBrowser } from '../AgentBrowser';

describe('AgentBrowser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAgentListResult.agents = [];
    mockAgentListResult.loading = false;
    mockAgentListResult.error = null;
    mockAgentListResult.refresh = vi.fn();
    mockAgentListResult.selectedAgent = null;
    mockAgentListResult.selectAgent = vi.fn();
  });

  test('shows loading state', () => {
    mockAgentListResult.loading = true;
    render(<AgentBrowser />);
    expect(screen.getByText('Loading...')).toBeTruthy();
  });

  test('shows agent count when loaded', () => {
    mockAgentListResult.agents = [
      { id: 'a1', name: 'Agent 1', type: 'echo', status: 'online', capabilities: [], config: {} },
      { id: 'a2', name: 'Agent 2', type: 'llm', status: 'offline', capabilities: [], config: {} },
    ];
    render(<AgentBrowser />);
    expect(screen.getByText('2 agents')).toBeTruthy();
  });

  test('shows singular "agent" label for single agent', () => {
    mockAgentListResult.agents = [
      { id: 'a1', name: 'Agent 1', type: 'echo', status: 'online', capabilities: [], config: {} },
    ];
    render(<AgentBrowser />);
    expect(screen.getByText('1 agent')).toBeTruthy();
  });

  test('renders empty state when no agents', () => {
    mockAgentListResult.agents = [];
    render(<AgentBrowser />);
    expect(screen.getByText(/No agents registered/)).toBeTruthy();
  });

  test('shows error message when error occurs', () => {
    mockAgentListResult.error = 'Failed to load agents';
    render(<AgentBrowser />);
    expect(screen.getByText('Failed to load agents')).toBeTruthy();
  });

  test('renders agent list with names', () => {
    mockAgentListResult.agents = [
      { id: 'a1', name: 'Echo Agent', type: 'echo', status: 'online', capabilities: [], config: {} },
      { id: 'a2', name: 'LLM Agent', type: 'llm', status: 'busy', capabilities: [], config: {} },
    ];
    render(<AgentBrowser />);
    expect(screen.getByText('Echo Agent')).toBeTruthy();
    expect(screen.getByText('LLM Agent')).toBeTruthy();
  });

  test('displays agent type in the list', () => {
    mockAgentListResult.agents = [
      { id: 'a1', name: 'Test', type: 'psyche-sim', status: 'online', capabilities: [], config: {} },
    ];
    render(<AgentBrowser />);
    expect(screen.getByText('psyche-sim')).toBeTruthy();
  });

  test('shows capabilities badges (up to 3)', () => {
    mockAgentListResult.agents = [
      {
        id: 'a1',
        name: 'Agent X',
        type: 'llm',
        status: 'online',
        capabilities: ['chat', 'tool-use', 'vision', 'embedding'],
        config: {},
      },
    ];
    render(<AgentBrowser />);
    expect(screen.getByText('chat')).toBeTruthy();
    expect(screen.getByText('tool-use')).toBeTruthy();
    expect(screen.getByText('vision')).toBeTruthy();
    // Fourth capability should show as +1
    expect(screen.getByText('+1')).toBeTruthy();
  });

  test('calls selectAgent when an agent is clicked', () => {
    const agent = { id: 'a1', name: 'Click Me', type: 'echo', status: 'online', capabilities: [], config: {} };
    mockAgentListResult.agents = [agent];
    render(<AgentBrowser />);

    fireEvent.click(screen.getByText('Click Me'));
    expect(mockAgentListResult.selectAgent).toHaveBeenCalledWith(agent);
  });

  test('calls refresh when Refresh button is clicked', () => {
    render(<AgentBrowser />);
    fireEvent.click(screen.getByText('Refresh'));
    expect(mockAgentListResult.refresh).toHaveBeenCalledOnce();
  });

  test('shows detail view when agent is selected', () => {
    mockAgentListResult.selectedAgent = {
      id: 'agent-detail',
      name: 'Detailed Agent',
      type: 'psyche-sim',
      status: 'online',
      capabilities: ['reasoning', 'memory'],
      config: { temperature: 0.7 },
      metadata: { version: '1.0' },
    };
    render(<AgentBrowser />);
    // Should show the detail view with Back button
    expect(screen.getByText(/Back/)).toBeTruthy();
    expect(screen.getByText('Detailed Agent')).toBeTruthy();
  });

  test('detail view shows agent ID', () => {
    mockAgentListResult.selectedAgent = {
      id: 'agent-xyz',
      name: 'Test',
      type: 'echo',
      status: 'online',
      capabilities: [],
      config: {},
    };
    render(<AgentBrowser />);
    expect(screen.getByText('agent-xyz')).toBeTruthy();
  });

  test('detail view shows agent status', () => {
    mockAgentListResult.selectedAgent = {
      id: 'a1',
      name: 'Test',
      type: 'echo',
      status: 'busy',
      capabilities: [],
      config: {},
    };
    render(<AgentBrowser />);
    expect(screen.getByText('busy')).toBeTruthy();
  });

  test('detail view shows capabilities when present', () => {
    mockAgentListResult.selectedAgent = {
      id: 'a1',
      name: 'Test',
      type: 'echo',
      status: 'online',
      capabilities: ['chat', 'tool-use'],
      config: {},
    };
    render(<AgentBrowser />);
    expect(screen.getByText('chat')).toBeTruthy();
    expect(screen.getByText('tool-use')).toBeTruthy();
  });

  test('detail view shows config when present', () => {
    mockAgentListResult.selectedAgent = {
      id: 'a1',
      name: 'Test',
      type: 'echo',
      status: 'online',
      capabilities: [],
      config: { model: 'gpt-4' },
    };
    render(<AgentBrowser />);
    expect(screen.getByText(/"model": "gpt-4"/)).toBeTruthy();
  });

  test('Back button calls selectAgent(null) to go back to list', () => {
    mockAgentListResult.selectedAgent = {
      id: 'a1',
      name: 'Test',
      type: 'echo',
      status: 'online',
      capabilities: [],
      config: {},
    };
    render(<AgentBrowser />);
    fireEvent.click(screen.getByText(/Back/));
    expect(mockAgentListResult.selectAgent).toHaveBeenCalledWith(null);
  });

  test('uses agent id as display name when name is empty', () => {
    mockAgentListResult.agents = [
      { id: 'agent-fallback-id', name: '', type: 'echo', status: 'online', capabilities: [], config: {} },
    ];
    render(<AgentBrowser />);
    expect(screen.getByText('agent-fallback-id')).toBeTruthy();
  });
});
