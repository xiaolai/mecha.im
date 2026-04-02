package main

import (
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
	"time"
)

// orchestrationTools are the task/worker/event MCP tools.
// Appended to toolDefs during init.
var orchestrationTools = []map[string]any{
	{
		"name":        "mecha-task",
		"description": "Submit a task to a mecha worker. Returns task ID immediately (async). Poll with mecha-task-status for the result.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"prompt": map[string]any{"type": "string", "description": "Task prompt for the worker"},
				"worker": map[string]any{"type": "string", "description": "Worker name (omit for round-robin)"},
			},
			"required": []string{"prompt"},
		},
	},
	{
		"name":        "mecha-task-status",
		"description": "Get the status and result of a task by ID. Returns state (pending/dispatched/completed/failed), result, error, timing.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"id": map[string]any{"type": "string", "description": "Task ID from mecha-task response"},
			},
			"required": []string{"id"},
		},
	},
	{
		"name":        "mecha-task-wait",
		"description": "Submit a task and wait for the result (synchronous). Polls until completed or failed, up to timeout.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"prompt":  map[string]any{"type": "string", "description": "Task prompt for the worker"},
				"worker":  map[string]any{"type": "string", "description": "Worker name (omit for round-robin)"},
				"timeout": map[string]any{"type": "integer", "description": "Max wait seconds (default: 300)"},
			},
			"required": []string{"prompt"},
		},
	},
	{
		"name":        "mecha-workers",
		"description": "List all registered workers with their type, state, and endpoint.",
		"inputSchema": map[string]any{"type": "object", "properties": map[string]any{}},
	},
	{
		"name":        "mecha-tasks",
		"description": "List recent tasks, optionally filtered by state.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"state": map[string]any{"type": "string", "description": "Filter by state: pending, dispatched, completed, failed"},
			},
		},
	},
	{
		"name":        "mecha-events",
		"description": "List recent events, optionally filtered by state.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"state": map[string]any{"type": "string", "description": "Filter: received, matched, dispatched, completed, failed, skipped"},
			},
		},
	},
	{
		"name":        "mecha-fire-event",
		"description": "Fire a webhook event to a registered source (github, gitlab, slack, telegram, or a generic source).",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"source": map[string]any{"type": "string", "description": "Source name (e.g., github, gitlab, slack)"},
				"body":   map[string]any{"type": "string", "description": "Raw JSON webhook payload"},
			},
			"required": []string{"source", "body"},
		},
	},
	{
		"name":        "mecha-metrics",
		"description": "Get current mecha server metrics (tasks created/completed/failed, dispatch latency, queue depth, etc.).",
		"inputSchema": map[string]any{"type": "object", "properties": map[string]any{}},
	},
}

func handleOrchestrationTool(id any, name string, args map[string]any) (mcpResponse, bool) {
	text := func(s string) mcpResponse {
		return mcpResponse{JSONRPC: "2.0", ID: id, Result: map[string]any{
			"content": []map[string]any{{"type": "text", "text": s}},
		}}
	}
	errText := func(s string) mcpResponse {
		return mcpResponse{JSONRPC: "2.0", ID: id, Result: map[string]any{
			"content": []map[string]any{{"type": "text", "text": s}}, "isError": true,
		}}
	}

	switch name {
	case "mecha-task":
		return handleMechaTask(args, text, errText), true
	case "mecha-task-status":
		return handleMechaTaskStatus(args, text, errText), true
	case "mecha-task-wait":
		return handleMechaTaskWait(args, text, errText), true
	case "mecha-workers":
		return handleMechaWorkers(text, errText), true
	case "mecha-tasks":
		return handleMechaTasks(args, text, errText), true
	case "mecha-events":
		return handleMechaEvents(args, text, errText), true
	case "mecha-fire-event":
		return handleMechaFireEvent(args, text, errText), true
	case "mecha-metrics":
		return handleMechaMetrics(text, errText), true
	default:
		return mcpResponse{}, false
	}
}

type respFn func(string) mcpResponse

func handleMechaTask(args map[string]any, text, errText respFn) mcpResponse {
	prompt, _ := args["prompt"].(string)
	if prompt == "" {
		return errText("prompt is required")
	}
	payload := map[string]string{"prompt": prompt}
	if w, ok := args["worker"].(string); ok && w != "" {
		payload["worker"] = w
	}
	body, status, err := apiPost("/task", payload)
	if err != nil {
		return errText("API error: " + err.Error())
	}
	if status >= 400 {
		return errText(fmt.Sprintf("mecha returned %d: %s", status, string(body)))
	}
	return text(string(body))
}

func handleMechaTaskStatus(args map[string]any, text, errText respFn) mcpResponse {
	id, _ := args["id"].(string)
	if id == "" {
		return errText("id is required")
	}
	body, status, err := apiGet("/task/" + url.PathEscape(id))
	if err != nil {
		return errText("API error: " + err.Error())
	}
	if status >= 400 {
		return errText(fmt.Sprintf("mecha returned %d: %s", status, string(body)))
	}
	return text(string(body))
}

func handleMechaTaskWait(args map[string]any, text, errText respFn) mcpResponse {
	prompt, _ := args["prompt"].(string)
	if prompt == "" {
		return errText("prompt is required")
	}
	timeout := 300
	if t, ok := args["timeout"].(float64); ok && t > 0 {
		timeout = int(t)
	}

	// Submit task
	payload := map[string]string{"prompt": prompt}
	if w, ok := args["worker"].(string); ok && w != "" {
		payload["worker"] = w
	}
	body, status, err := apiPost("/task", payload)
	if err != nil {
		return errText("submit error: " + err.Error())
	}
	if status >= 400 {
		return errText(fmt.Sprintf("submit failed %d: %s", status, string(body)))
	}

	var task struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(body, &task); err != nil {
		return errText("parse task response: " + err.Error())
	}

	// Poll for completion
	lastState := "pending"
	deadline := time.Now().Add(time.Duration(timeout) * time.Second)
	for time.Now().Before(deadline) {
		time.Sleep(2 * time.Second)
		body, status, err = apiGet("/task/" + url.PathEscape(task.ID))
		if err != nil {
			continue
		}
		if status >= 400 {
			continue
		}
		var result struct {
			State string `json:"state"`
		}
		json.Unmarshal(body, &result)
		if result.State != "" {
			lastState = result.State
		}
		if result.State == "completed" || result.State == "failed" {
			return text(string(body))
		}
	}
	return errText(fmt.Sprintf("timeout after %ds — task %s still %s", timeout, task.ID, lastState))
}

func handleMechaWorkers(text, errText respFn) mcpResponse {
	body, status, err := apiGet("/workers")
	if err != nil {
		return errText("API error: " + err.Error())
	}
	if status >= 400 {
		return errText(fmt.Sprintf("mecha returned %d: %s", status, string(body)))
	}
	return text(string(body))
}

func handleMechaTasks(args map[string]any, text, errText respFn) mcpResponse {
	path := "/tasks"
	if state, ok := args["state"].(string); ok && state != "" {
		path += "?state=" + url.QueryEscape(state)
	}
	body, status, err := apiGet(path)
	if err != nil {
		return errText("API error: " + err.Error())
	}
	if status >= 400 {
		return errText(fmt.Sprintf("mecha returned %d: %s", status, string(body)))
	}
	return text(string(body))
}

func handleMechaEvents(args map[string]any, text, errText respFn) mcpResponse {
	path := "/events"
	if state, ok := args["state"].(string); ok && state != "" {
		path += "?state=" + url.QueryEscape(state)
	}
	body, status, err := apiGet(path)
	if err != nil {
		return errText("API error: " + err.Error())
	}
	if status >= 400 {
		return errText(fmt.Sprintf("mecha returned %d: %s", status, string(body)))
	}
	return text(string(body))
}

func handleMechaFireEvent(args map[string]any, text, errText respFn) mcpResponse {
	source, _ := args["source"].(string)
	rawBody, _ := args["body"].(string)
	if source == "" || rawBody == "" {
		return errText("source and body are required")
	}
	// Webhook expects raw body, not JSON-wrapped
	body, status, err := apiPostRaw("/webhook/"+source, rawBody, args)
	if err != nil {
		return errText("API error: " + err.Error())
	}
	if status >= 400 {
		return errText(fmt.Sprintf("mecha returned %d: %s", status, string(body)))
	}
	return text(string(body))
}

func handleMechaMetrics(text, errText respFn) mcpResponse {
	body, status, err := apiGet("/metrics")
	if err != nil {
		return errText("API error: " + err.Error())
	}
	if status >= 400 {
		return errText(fmt.Sprintf("mecha returned %d: %s", status, string(body)))
	}
	// Parse Prometheus text into readable summary
	return text(formatMetrics(string(body)))
}

func formatMetrics(raw string) string {
	var sb strings.Builder
	sb.WriteString("# Mecha Metrics\n\n")
	for _, line := range strings.Split(raw, "\n") {
		if strings.HasPrefix(line, "#") || line == "" {
			continue
		}
		parts := strings.Fields(line)
		if len(parts) == 2 {
			name := strings.TrimPrefix(parts[0], "mecha_")
			sb.WriteString(fmt.Sprintf("- **%s**: %s\n", name, parts[1]))
		}
	}
	return sb.String()
}
