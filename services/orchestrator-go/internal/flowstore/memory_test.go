package flowstore

import (
	"context"
	"encoding/json"
	"testing"
)

func TestMemoryStore_Create(t *testing.T) {
	store := NewMemoryStore()
	defer store.Close()
	ctx := context.Background()

	t.Run("creates new flow", func(t *testing.T) {
		graph := json.RawMessage(`{"nodes":[],"edges":[]}`)
		req := &CreateFlowRequest{
			Name:        "Test Flow",
			Description: "A test flow",
			Graph:       graph,
		}

		flow, err := store.Create(ctx, req)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		if flow.ID == "" {
			t.Error("expected ID to be generated")
		}
		if flow.Name != req.Name {
			t.Errorf("expected Name %q, got %q", req.Name, flow.Name)
		}
		if flow.CreatedAt.IsZero() {
			t.Error("CreatedAt should be set")
		}
		if flow.UpdatedAt.IsZero() {
			t.Error("UpdatedAt should be set")
		}
	})

	t.Run("creates flow with custom ID", func(t *testing.T) {
		graph := json.RawMessage(`{"nodes":[]}`)
		req := &CreateFlowRequest{
			ID:    "custom-flow-id",
			Name:  "Custom ID Flow",
			Graph: graph,
		}

		flow, err := store.Create(ctx, req)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		if flow.ID != "custom-flow-id" {
			t.Errorf("expected ID %q, got %q", "custom-flow-id", flow.ID)
		}
	})

	t.Run("returns error for duplicate ID", func(t *testing.T) {
		graph := json.RawMessage(`{}`)
		req := &CreateFlowRequest{
			ID:    "duplicate-flow",
			Name:  "Duplicate Flow",
			Graph: graph,
		}

		_, err := store.Create(ctx, req)
		if err != nil {
			t.Fatalf("First create failed: %v", err)
		}

		_, err = store.Create(ctx, req)
		if err != ErrFlowExists {
			t.Errorf("expected ErrFlowExists, got %v", err)
		}
	})

	t.Run("validates required fields", func(t *testing.T) {
		tests := []struct {
			name string
			req  *CreateFlowRequest
		}{
			{"missing Name", &CreateFlowRequest{Graph: json.RawMessage(`{}`)}},
			{"missing Graph", &CreateFlowRequest{Name: "Test"}},
		}

		for _, tt := range tests {
			t.Run(tt.name, func(t *testing.T) {
				_, err := store.Create(ctx, tt.req)
				if err == nil {
					t.Error("expected validation error")
				}
			})
		}
	})
}

func TestMemoryStore_Get(t *testing.T) {
	store := NewMemoryStore()
	defer store.Close()
	ctx := context.Background()

	// Create a test flow
	graph := json.RawMessage(`{"nodes":[]}`)
	req := &CreateFlowRequest{
		ID:    "get-test-flow",
		Name:  "Get Test Flow",
		Graph: graph,
	}
	created, _ := store.Create(ctx, req)

	t.Run("gets existing flow", func(t *testing.T) {
		flow, err := store.Get(ctx, "get-test-flow")
		if err != nil {
			t.Fatalf("Get failed: %v", err)
		}

		if flow.ID != created.ID {
			t.Errorf("expected ID %q, got %q", created.ID, flow.ID)
		}
	})

	t.Run("returns error for non-existent flow", func(t *testing.T) {
		_, err := store.Get(ctx, "non-existent")
		if err != ErrFlowNotFound {
			t.Errorf("expected ErrFlowNotFound, got %v", err)
		}
	})
}

func TestMemoryStore_Update(t *testing.T) {
	store := NewMemoryStore()
	defer store.Close()
	ctx := context.Background()

	// Create a test flow
	graph := json.RawMessage(`{"nodes":[]}`)
	req := &CreateFlowRequest{
		ID:          "update-test-flow",
		Name:        "Update Test Flow",
		Description: "Original description",
		Graph:       graph,
	}
	store.Create(ctx, req)

	t.Run("updates existing flow", func(t *testing.T) {
		newName := "Updated Name"
		newDesc := "Updated description"
		updateReq := &UpdateFlowRequest{
			Name:        &newName,
			Description: &newDesc,
		}

		flow, err := store.Update(ctx, "update-test-flow", updateReq)
		if err != nil {
			t.Fatalf("Update failed: %v", err)
		}

		if flow.Name != newName {
			t.Errorf("expected Name %q, got %q", newName, flow.Name)
		}
		if flow.Description != newDesc {
			t.Errorf("expected Description %q, got %q", newDesc, flow.Description)
		}
	})

	t.Run("updates graph", func(t *testing.T) {
		newGraph := json.RawMessage(`{"nodes":[{"id":"n1"}],"edges":[]}`)
		updateReq := &UpdateFlowRequest{
			Graph: newGraph,
		}

		flow, err := store.Update(ctx, "update-test-flow", updateReq)
		if err != nil {
			t.Fatalf("Update failed: %v", err)
		}

		if string(flow.Graph) != string(newGraph) {
			t.Errorf("expected Graph %s, got %s", newGraph, flow.Graph)
		}
	})

	t.Run("returns error for non-existent flow", func(t *testing.T) {
		_, err := store.Update(ctx, "non-existent", &UpdateFlowRequest{})
		if err != ErrFlowNotFound {
			t.Errorf("expected ErrFlowNotFound, got %v", err)
		}
	})
}

func TestMemoryStore_Delete(t *testing.T) {
	store := NewMemoryStore()
	defer store.Close()
	ctx := context.Background()

	// Create a test flow
	graph := json.RawMessage(`{}`)
	req := &CreateFlowRequest{
		ID:    "delete-test-flow",
		Name:  "Delete Test Flow",
		Graph: graph,
	}
	store.Create(ctx, req)

	t.Run("deletes existing flow", func(t *testing.T) {
		err := store.Delete(ctx, "delete-test-flow")
		if err != nil {
			t.Fatalf("Delete failed: %v", err)
		}

		_, err = store.Get(ctx, "delete-test-flow")
		if err != ErrFlowNotFound {
			t.Error("flow should be deleted")
		}
	})

	t.Run("returns error for non-existent flow", func(t *testing.T) {
		err := store.Delete(ctx, "non-existent")
		if err != ErrFlowNotFound {
			t.Errorf("expected ErrFlowNotFound, got %v", err)
		}
	})
}

func TestMemoryStore_List(t *testing.T) {
	store := NewMemoryStore()
	defer store.Close()
	ctx := context.Background()

	// Create test flows
	flows := []CreateFlowRequest{
		{ID: "flow1", Name: "Flow 1", Graph: json.RawMessage(`{}`), CreatedBy: "user1"},
		{ID: "flow2", Name: "Flow 2", Graph: json.RawMessage(`{}`), CreatedBy: "user2"},
		{ID: "flow3", Name: "Flow 3", Graph: json.RawMessage(`{}`), CreatedBy: "user1"},
	}
	for _, f := range flows {
		req := f
		store.Create(ctx, &req)
	}

	t.Run("lists all flows", func(t *testing.T) {
		list, err := store.List(ctx, nil)
		if err != nil {
			t.Fatalf("List failed: %v", err)
		}

		if len(list) != 3 {
			t.Errorf("expected 3 flows, got %d", len(list))
		}
	})

	t.Run("filters by creator", func(t *testing.T) {
		list, err := store.List(ctx, &ListOptions{
			CreatedBy: "user1",
		})
		if err != nil {
			t.Fatalf("List failed: %v", err)
		}

		if len(list) != 2 {
			t.Errorf("expected 2 flows by user1, got %d", len(list))
		}
	})

	t.Run("applies limit", func(t *testing.T) {
		list, err := store.List(ctx, &ListOptions{Limit: 2})
		if err != nil {
			t.Fatalf("List failed: %v", err)
		}

		if len(list) != 2 {
			t.Errorf("expected 2 flows with limit, got %d", len(list))
		}
	})

	t.Run("applies offset", func(t *testing.T) {
		allList, _ := store.List(ctx, nil)
		offsetList, _ := store.List(ctx, &ListOptions{Offset: 1})

		if len(offsetList) != len(allList)-1 {
			t.Errorf("offset list should have %d items, got %d", len(allList)-1, len(offsetList))
		}
	})
}

func TestCreateFlowRequest_Validate(t *testing.T) {
	tests := []struct {
		name    string
		req     CreateFlowRequest
		wantErr bool
	}{
		{
			name: "valid request",
			req: CreateFlowRequest{
				Name:  "Test Flow",
				Graph: json.RawMessage(`{}`),
			},
			wantErr: false,
		},
		{
			name: "missing Name",
			req: CreateFlowRequest{
				Graph: json.RawMessage(`{}`),
			},
			wantErr: true,
		},
		{
			name: "missing Graph",
			req: CreateFlowRequest{
				Name: "Test Flow",
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
