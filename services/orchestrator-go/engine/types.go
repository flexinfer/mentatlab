package engine

import (
	"time"
)

type NodeType string

const (
	NodeTypeAgent NodeType = "agent"
	NodeTypeTask  NodeType = "task"
)

type Node struct {
	ID      string   `json:"id"`
	Type    NodeType `json:"type"`
	Image   string   `json:"image,omitempty"` // Docker image for K8s
	Command []string `json:"command,omitempty"`
	Inputs  []string `json:"inputs,omitempty"` // IDs of nodes this node depends on
}

type Graph struct {
	ID    string `json:"id"`
	Nodes []Node `json:"nodes"`
}

type RunStatus string

const (
	RunStatusPending   RunStatus = "pending"
	RunStatusRunning   RunStatus = "running"
	RunStatusCompleted RunStatus = "completed"
	RunStatusFailed    RunStatus = "failed"
)

type Run struct {
	ID        string    `json:"id"`
	GraphID   string    `json:"graph_id"`
	Status    RunStatus `json:"status"`
	StartTime time.Time `json:"start_time"`
	EndTime   time.Time `json:"end_time,omitempty"`
	Logs      []string  `json:"logs,omitempty"`
}
