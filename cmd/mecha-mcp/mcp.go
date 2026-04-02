package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

type mcpRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      any             `json:"id,omitempty"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

type mcpResponse struct {
	JSONRPC string    `json:"jsonrpc"`
	ID      any       `json:"id,omitempty"`
	Result  any       `json:"result,omitempty"`
	Error   *mcpError `json:"error,omitempty"`
}

type mcpError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

var toolDefs = []map[string]any{
	{"name": "list-topics", "description": "List all mecha documentation topics", "inputSchema": map[string]any{"type": "object", "properties": map[string]any{}}},
	{"name": "get-page", "description": "Get a documentation page by slug", "inputSchema": map[string]any{"type": "object", "properties": map[string]any{"slug": map[string]any{"type": "string", "description": "Page slug"}}, "required": []string{"slug"}}},
	{"name": "search-docs", "description": "Search documentation by keyword", "inputSchema": map[string]any{"type": "object", "properties": map[string]any{"query": map[string]any{"type": "string", "description": "Search keyword"}}, "required": []string{"query"}}},
	{"name": "get-spec", "description": "Get a project rule/spec by name", "inputSchema": map[string]any{"type": "object", "properties": map[string]any{"name": map[string]any{"type": "string", "description": "Rule name"}}, "required": []string{"name"}}},
	{"name": "get-examples", "description": "List/get example worker YAML files", "inputSchema": map[string]any{"type": "object", "properties": map[string]any{"name": map[string]any{"type": "string", "description": "Example name (omit to list all)"}}}},
	{"name": "get-version", "description": "Get current mecha version", "inputSchema": map[string]any{"type": "object", "properties": map[string]any{}}},
}

func handleMCP(msg mcpRequest) mcpResponse {
	switch msg.Method {
	case "initialize":
		return mcpResponse{JSONRPC: "2.0", ID: msg.ID, Result: map[string]any{
			"protocolVersion": "2024-11-05",
			"capabilities":   map[string]any{"tools": map[string]any{}},
			"serverInfo":     map[string]any{"name": "mecha", "version": Version},
		}}
	case "tools/list":
		return mcpResponse{JSONRPC: "2.0", ID: msg.ID, Result: map[string]any{"tools": toolDefs}}
	case "tools/call":
		var params struct {
			Name      string         `json:"name"`
			Arguments map[string]any `json:"arguments"`
		}
		json.Unmarshal(msg.Params, &params)
		return handleToolCall(msg.ID, params.Name, params.Arguments)
	case "notifications/initialized":
		return mcpResponse{}
	default:
		return mcpResponse{JSONRPC: "2.0", ID: msg.ID, Error: &mcpError{Code: -32601, Message: "method not found: " + msg.Method}}
	}
}

func handleToolCall(id any, name string, args map[string]any) mcpResponse {
	text := func(s string) mcpResponse {
		return mcpResponse{JSONRPC: "2.0", ID: id, Result: map[string]any{"content": []map[string]any{{"type": "text", "text": s}}}}
	}
	errText := func(s string) mcpResponse {
		return mcpResponse{JSONRPC: "2.0", ID: id, Result: map[string]any{"content": []map[string]any{{"type": "text", "text": s}}, "isError": true}}
	}

	// Orchestration tools (task/worker/event)
	if resp, ok := handleOrchestrationTool(id, name, args); ok {
		return resp
	}

	// Documentation tools
	switch name {
	case "list-topics":
		pp := getPages()
		var topics []map[string]string
		for _, p := range pp {
			topics = append(topics, map[string]string{"slug": p.Slug, "title": p.Title})
		}
		data, _ := json.Marshal(topics)
		return text(string(data))

	case "get-page":
		slug, _ := args["slug"].(string)
		p := findPage(slug, getPages())
		if p == nil {
			return errText(fmt.Sprintf("page %q not found", slug))
		}
		return text(p.Body)

	case "search-docs":
		query, _ := args["query"].(string)
		results := searchPages(query, getPages())
		if len(results) == 0 {
			return text("no results for: " + query)
		}
		var sb strings.Builder
		for _, r := range results {
			sb.WriteString(fmt.Sprintf("## %s (%s)\n\n", r.Title, r.Slug))
			body := r.Body
			if len(body) > 500 {
				body = body[:500] + "\n...(truncated, use get-page for full content)"
			}
			sb.WriteString(body + "\n\n---\n\n")
		}
		return text(sb.String())

	case "get-spec":
		n, _ := args["name"].(string)
		p := findPage(n, getRules())
		if p == nil {
			var avail []string
			for _, r := range getRules() {
				avail = append(avail, r.Slug)
			}
			return errText(fmt.Sprintf("spec %q not found. Available: %v", n, avail))
		}
		return text(p.Body)

	case "get-examples":
		exs := getExamples()
		n, hasName := args["name"].(string)
		if !hasName || n == "" {
			var list []map[string]string
			for _, e := range exs {
				list = append(list, map[string]string{"name": e.Slug, "title": e.Title})
			}
			data, _ := json.Marshal(list)
			return text(string(data))
		}
		p := findPage(n, exs)
		if p == nil {
			return errText(fmt.Sprintf("example %q not found", n))
		}
		return text(p.Body)

	case "get-version":
		return text("mecha " + Version)

	default:
		return mcpResponse{JSONRPC: "2.0", ID: id, Error: &mcpError{Code: -32602, Message: "unknown tool: " + name}}
	}
}

func handleSSE(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}
	sessionID := fmt.Sprintf("s-%d", time.Now().UnixNano())
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	fmt.Fprintf(w, "event: endpoint\ndata: /message?session=%s\n\n", sessionID)
	flusher.Flush()
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-ticker.C:
			fmt.Fprintf(w, ": keepalive\n\n")
			flusher.Flush()
		}
	}
}

func handleMessage(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Content-Type", "application/json")
	var msg mcpRequest
	if err := json.NewDecoder(r.Body).Decode(&msg); err != nil {
		json.NewEncoder(w).Encode(mcpResponse{JSONRPC: "2.0", Error: &mcpError{Code: -32700, Message: "parse error"}})
		return
	}
	resp := handleMCP(msg)
	if resp.ID == nil && resp.Error == nil && resp.Result == nil {
		w.WriteHeader(http.StatusAccepted)
		return
	}
	json.NewEncoder(w).Encode(resp)
}
