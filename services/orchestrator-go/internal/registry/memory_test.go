package registry

import (
	"context"
	"testing"
)

func TestMemoryRegistry_Create(t *testing.T) {
	reg := NewMemoryRegistry()
	defer reg.Close()
	ctx := context.Background()

	t.Run("creates new agent", func(t *testing.T) {
		req := &CreateAgentRequest{
			ID:           "test.agent",
			Name:         "Test Agent",
			Version:      "1.0.0",
			Image:        "test/agent:v1",
			Capabilities: []string{"test", "demo"},
			Description:  "A test agent",
		}

		agent, err := reg.Create(ctx, req)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		if agent.ID != req.ID {
			t.Errorf("expected ID %q, got %q", req.ID, agent.ID)
		}
		if agent.Name != req.Name {
			t.Errorf("expected Name %q, got %q", req.Name, agent.Name)
		}
		if agent.CreatedAt.IsZero() {
			t.Error("CreatedAt should be set")
		}
		if agent.UpdatedAt.IsZero() {
			t.Error("UpdatedAt should be set")
		}
	})

	t.Run("returns error for duplicate ID", func(t *testing.T) {
		req := &CreateAgentRequest{
			ID:      "duplicate.agent",
			Name:    "Duplicate Agent",
			Version: "1.0.0",
		}

		_, err := reg.Create(ctx, req)
		if err != nil {
			t.Fatalf("First create failed: %v", err)
		}

		_, err = reg.Create(ctx, req)
		if err != ErrAgentExists {
			t.Errorf("expected ErrAgentExists, got %v", err)
		}
	})

	t.Run("validates required fields", func(t *testing.T) {
		tests := []struct {
			name string
			req  *CreateAgentRequest
		}{
			{"missing ID", &CreateAgentRequest{Name: "Test", Version: "1.0"}},
			{"missing Name", &CreateAgentRequest{ID: "test", Version: "1.0"}},
			{"missing Version", &CreateAgentRequest{ID: "test", Name: "Test"}},
		}

		for _, tt := range tests {
			t.Run(tt.name, func(t *testing.T) {
				_, err := reg.Create(ctx, tt.req)
				if err == nil {
					t.Error("expected validation error")
				}
			})
		}
	})
}

func TestMemoryRegistry_Get(t *testing.T) {
	reg := NewMemoryRegistry()
	defer reg.Close()
	ctx := context.Background()

	// Create a test agent
	req := &CreateAgentRequest{
		ID:      "get.test.agent",
		Name:    "Get Test Agent",
		Version: "1.0.0",
	}
	created, _ := reg.Create(ctx, req)

	t.Run("gets existing agent", func(t *testing.T) {
		agent, err := reg.Get(ctx, "get.test.agent")
		if err != nil {
			t.Fatalf("Get failed: %v", err)
		}

		if agent.ID != created.ID {
			t.Errorf("expected ID %q, got %q", created.ID, agent.ID)
		}
	})

	t.Run("returns error for non-existent agent", func(t *testing.T) {
		_, err := reg.Get(ctx, "non.existent")
		if err != ErrAgentNotFound {
			t.Errorf("expected ErrAgentNotFound, got %v", err)
		}
	})
}

func TestMemoryRegistry_Update(t *testing.T) {
	reg := NewMemoryRegistry()
	defer reg.Close()
	ctx := context.Background()

	// Create a test agent
	req := &CreateAgentRequest{
		ID:          "update.test.agent",
		Name:        "Update Test Agent",
		Version:     "1.0.0",
		Description: "Original description",
	}
	reg.Create(ctx, req)

	t.Run("updates existing agent", func(t *testing.T) {
		newName := "Updated Name"
		newVersion := "2.0.0"
		updateReq := &UpdateAgentRequest{
			Name:    &newName,
			Version: &newVersion,
		}

		agent, err := reg.Update(ctx, "update.test.agent", updateReq)
		if err != nil {
			t.Fatalf("Update failed: %v", err)
		}

		if agent.Name != newName {
			t.Errorf("expected Name %q, got %q", newName, agent.Name)
		}
		if agent.Version != newVersion {
			t.Errorf("expected Version %q, got %q", newVersion, agent.Version)
		}
	})

	t.Run("preserves unmodified fields", func(t *testing.T) {
		agent, _ := reg.Get(ctx, "update.test.agent")
		if agent.Description != "Original description" {
			t.Error("Description should be preserved")
		}
	})

	t.Run("returns error for non-existent agent", func(t *testing.T) {
		_, err := reg.Update(ctx, "non.existent", &UpdateAgentRequest{})
		if err != ErrAgentNotFound {
			t.Errorf("expected ErrAgentNotFound, got %v", err)
		}
	})
}

func TestMemoryRegistry_Delete(t *testing.T) {
	reg := NewMemoryRegistry()
	defer reg.Close()
	ctx := context.Background()

	// Create a test agent
	req := &CreateAgentRequest{
		ID:      "delete.test.agent",
		Name:    "Delete Test Agent",
		Version: "1.0.0",
	}
	reg.Create(ctx, req)

	t.Run("deletes existing agent", func(t *testing.T) {
		err := reg.Delete(ctx, "delete.test.agent")
		if err != nil {
			t.Fatalf("Delete failed: %v", err)
		}

		exists, _ := reg.Exists(ctx, "delete.test.agent")
		if exists {
			t.Error("agent should be deleted")
		}
	})

	t.Run("returns error for non-existent agent", func(t *testing.T) {
		err := reg.Delete(ctx, "non.existent")
		if err != ErrAgentNotFound {
			t.Errorf("expected ErrAgentNotFound, got %v", err)
		}
	})
}

func TestMemoryRegistry_List(t *testing.T) {
	reg := NewMemoryRegistry()
	defer reg.Close()
	ctx := context.Background()

	// Create test agents
	agents := []CreateAgentRequest{
		{ID: "list.agent1", Name: "Agent 1", Version: "1.0.0", Capabilities: []string{"cap1", "cap2"}},
		{ID: "list.agent2", Name: "Agent 2", Version: "1.0.0", Capabilities: []string{"cap2", "cap3"}},
		{ID: "list.agent3", Name: "Agent 3", Version: "1.0.0", Capabilities: []string{"cap1"}},
	}
	for _, a := range agents {
		req := a
		reg.Create(ctx, &req)
	}

	t.Run("lists all agents", func(t *testing.T) {
		list, err := reg.List(ctx, nil)
		if err != nil {
			t.Fatalf("List failed: %v", err)
		}

		if len(list) < 3 {
			t.Errorf("expected at least 3 agents, got %d", len(list))
		}
	})

	t.Run("filters by capabilities", func(t *testing.T) {
		list, err := reg.List(ctx, &ListOptions{
			Capabilities: []string{"cap1"},
		})
		if err != nil {
			t.Fatalf("List failed: %v", err)
		}

		// Should match agent1 and agent3
		count := 0
		for _, a := range list {
			if a.ID == "list.agent1" || a.ID == "list.agent3" {
				count++
			}
		}
		if count < 2 {
			t.Errorf("expected 2 agents with cap1, got %d", count)
		}
	})

	t.Run("applies limit", func(t *testing.T) {
		list, err := reg.List(ctx, &ListOptions{Limit: 2})
		if err != nil {
			t.Fatalf("List failed: %v", err)
		}

		if len(list) > 2 {
			t.Errorf("expected at most 2 agents, got %d", len(list))
		}
	})

	t.Run("applies offset", func(t *testing.T) {
		allList, _ := reg.List(ctx, nil)
		offsetList, _ := reg.List(ctx, &ListOptions{Offset: 1})

		if len(offsetList) != len(allList)-1 {
			t.Errorf("offset list should have %d items, got %d", len(allList)-1, len(offsetList))
		}
	})
}

func TestMemoryRegistry_Exists(t *testing.T) {
	reg := NewMemoryRegistry()
	defer reg.Close()
	ctx := context.Background()

	req := &CreateAgentRequest{
		ID:      "exists.test.agent",
		Name:    "Exists Test Agent",
		Version: "1.0.0",
	}
	reg.Create(ctx, req)

	t.Run("returns true for existing agent", func(t *testing.T) {
		exists, err := reg.Exists(ctx, "exists.test.agent")
		if err != nil {
			t.Fatalf("Exists failed: %v", err)
		}
		if !exists {
			t.Error("expected agent to exist")
		}
	})

	t.Run("returns false for non-existent agent", func(t *testing.T) {
		exists, err := reg.Exists(ctx, "non.existent")
		if err != nil {
			t.Fatalf("Exists failed: %v", err)
		}
		if exists {
			t.Error("expected agent to not exist")
		}
	})
}

func TestMemoryRegistry_DefaultAgents(t *testing.T) {
	// Use NewMemoryRegistryWithDefaults for pre-loaded agents
	reg := NewMemoryRegistryWithDefaults()
	defer reg.Close()
	ctx := context.Background()

	// Registry should have default agents pre-loaded
	list, err := reg.List(ctx, nil)
	if err != nil {
		t.Fatalf("List failed: %v", err)
	}

	if len(list) == 0 {
		t.Error("expected default agents to be pre-loaded")
	}

	// Check for specific default agent
	echo, err := reg.Get(ctx, "mentatlab.echo")
	if err != nil {
		t.Errorf("expected mentatlab.echo to be pre-loaded: %v", err)
	} else if echo.Name != "Echo Agent" {
		t.Errorf("expected Echo Agent, got %q", echo.Name)
	}

	// Verify all expected defaults
	expectedIDs := []string{"mentatlab.echo", "mentatlab.psyche-sim", "mentatlab.ctm-cogpack"}
	for _, id := range expectedIDs {
		exists, err := reg.Exists(ctx, id)
		if err != nil {
			t.Errorf("Exists(%s) failed: %v", id, err)
		}
		if !exists {
			t.Errorf("expected %s to exist", id)
		}
	}
}

func TestCreateAgentRequest_Validate(t *testing.T) {
	tests := []struct {
		name    string
		req     CreateAgentRequest
		wantErr bool
	}{
		{
			name: "valid request",
			req: CreateAgentRequest{
				ID:      "test.agent",
				Name:    "Test Agent",
				Version: "1.0.0",
			},
			wantErr: false,
		},
		{
			name: "missing ID",
			req: CreateAgentRequest{
				Name:    "Test Agent",
				Version: "1.0.0",
			},
			wantErr: true,
		},
		{
			name: "missing Name",
			req: CreateAgentRequest{
				ID:      "test.agent",
				Version: "1.0.0",
			},
			wantErr: true,
		},
		{
			name: "missing Version",
			req: CreateAgentRequest{
				ID:   "test.agent",
				Name: "Test Agent",
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.req.Validate()
			if (err != nil) != tt.wantErr {
				t.Errorf("Validate() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}
