package main

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
				"source":     map[string]any{"type": "string", "description": "Source name (e.g., github, gitlab, slack)"},
				"body":       map[string]any{"type": "string", "description": "Raw JSON webhook payload"},
				"event_type": map[string]any{"type": "string", "description": "Event type header (X-Event-Type) for generic sources"},
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
