package registry

import (
	"context"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

func TestRedisRegistry_SeedDefaultAgents(t *testing.T) {
	t.Parallel()

	mr := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	defer client.Close()

	reg := NewRedisRegistryFromClient(client)
	ctx := context.Background()

	if err := reg.SeedDefaultAgents(ctx); err != nil {
		t.Fatalf("SeedDefaultAgents failed: %v", err)
	}

	expected := []string{
		"mentatlab.echo",
		"mentatlab.psyche-sim",
		"mentatlab.ctm-cogpack",
		"loom-mcp-executor",
		"mentatlab.flexinfer-adapter",
	}
	for _, id := range expected {
		exists, err := reg.Exists(ctx, id)
		if err != nil {
			t.Fatalf("Exists(%s) failed: %v", id, err)
		}
		if !exists {
			t.Fatalf("expected %s to exist after seeding", id)
		}
	}

	echo, err := reg.Get(ctx, "mentatlab.echo")
	if err != nil {
		t.Fatalf("Get echo agent failed: %v", err)
	}
	if got, want := echo.Image, defaultEchoAgentImage; got != want {
		t.Fatalf("expected echo image %q, got %q", want, got)
	}
	if got, want := echo.Command, []string{"python", "agents/echo/main.py"}; len(got) != len(want) || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("expected echo command %v, got %v", want, got)
	}
}

func TestRedisRegistry_SeedDefaultAgentsBackfillsMissingFields(t *testing.T) {
	t.Parallel()

	mr := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	defer client.Close()

	reg := NewRedisRegistryFromClient(client)
	ctx := context.Background()

	if err := reg.SeedDefaultAgents(ctx); err != nil {
		t.Fatalf("initial seed failed: %v", err)
	}

	customCommand := []string{"python", "custom-echo.py"}
	customImage := "registry.harbor.lan/library/custom-echo:1"
	if _, err := reg.Update(ctx, "mentatlab.echo", &UpdateAgentRequest{
		Command: customCommand,
		Image:   &customImage,
	}); err != nil {
		t.Fatalf("Update failed: %v", err)
	}

	if err := reg.SeedDefaultAgents(ctx); err != nil {
		t.Fatalf("second seed failed: %v", err)
	}

	updated, err := reg.Get(ctx, "mentatlab.echo")
	if err != nil {
		t.Fatalf("Get failed: %v", err)
	}
	if got := updated.Command; len(got) != len(customCommand) || got[0] != customCommand[0] || got[1] != customCommand[1] {
		t.Fatalf("expected custom command to be preserved, got %v", got)
	}
	if got := updated.Image; got != customImage {
		t.Fatalf("expected custom image to be preserved, got %q", got)
	}

	blankImage := ""
	if _, err := reg.Update(ctx, "mentatlab.echo", &UpdateAgentRequest{
		Command: []string{},
		Image:   &blankImage,
	}); err != nil {
		t.Fatalf("blanking fields failed: %v", err)
	}

	if err := reg.SeedDefaultAgents(ctx); err != nil {
		t.Fatalf("backfill seed failed: %v", err)
	}

	backfilled, err := reg.Get(ctx, "mentatlab.echo")
	if err != nil {
		t.Fatalf("Get backfilled agent failed: %v", err)
	}
	if got, want := backfilled.Image, defaultEchoAgentImage; got != want {
		t.Fatalf("expected backfilled image %q, got %q", want, got)
	}
	if got, want := backfilled.Command, []string{"python", "agents/echo/main.py"}; len(got) != len(want) || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("expected backfilled command %v, got %v", want, got)
	}
}
