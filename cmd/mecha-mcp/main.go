package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type docPage struct {
	Slug  string `json:"slug"`
	Title string `json:"title"`
	Body  string `json:"-"`
}

var pages []docPage

func loadPages(dir string) error {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return fmt.Errorf("read docs dir %s: %w", dir, err)
	}
	pages = nil
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".md") {
			continue
		}
		data, err := os.ReadFile(filepath.Join(dir, e.Name()))
		if err != nil {
			continue
		}
		slug := strings.TrimSuffix(e.Name(), ".md")
		title, body := parseFrontmatter(string(data))
		if title == "" {
			title = slug
		}
		pages = append(pages, docPage{Slug: slug, Title: title, Body: body})
	}
	return nil
}

func parseFrontmatter(content string) (title, body string) {
	if !strings.HasPrefix(content, "---\n") {
		return "", content
	}
	end := strings.Index(content[4:], "\n---\n")
	if end < 0 {
		return "", content
	}
	fm := content[4 : 4+end]
	body = strings.TrimSpace(content[4+end+5:])
	for _, line := range strings.Split(fm, "\n") {
		if strings.HasPrefix(line, "title:") {
			title = strings.TrimSpace(strings.TrimPrefix(line, "title:"))
			break
		}
	}
	return title, body
}

func findPage(slug string) *docPage {
	for i := range pages {
		if pages[i].Slug == slug {
			return &pages[i]
		}
	}
	return nil
}

func searchPages(query string) []docPage {
	q := strings.ToLower(query)
	var results []docPage
	for _, p := range pages {
		if strings.Contains(strings.ToLower(p.Title), q) ||
			strings.Contains(strings.ToLower(p.Body), q) {
			results = append(results, p)
		}
	}
	return results
}

// MCP protocol types
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

func handleMCP(msg mcpRequest) mcpResponse {
	switch msg.Method {
	case "initialize":
		return mcpResponse{
			JSONRPC: "2.0",
			ID:      msg.ID,
			Result: map[string]any{
				"protocolVersion": "2024-11-05",
				"capabilities":   map[string]any{"tools": map[string]any{}},
				"serverInfo":     map[string]any{"name": "mecha-docs", "version": "0.1.0"},
			},
		}

	case "tools/list":
		return mcpResponse{
			JSONRPC: "2.0",
			ID:      msg.ID,
			Result: map[string]any{
				"tools": []map[string]any{
					{
						"name":        "list-topics",
						"description": "List all mecha documentation topics",
						"inputSchema": map[string]any{"type": "object", "properties": map[string]any{}},
					},
					{
						"name":        "get-page",
						"description": "Get a specific mecha documentation page by slug",
						"inputSchema": map[string]any{
							"type": "object",
							"properties": map[string]any{
								"slug": map[string]any{"type": "string", "description": "Page slug (e.g., 'workers', 'events', 'installation')"},
							},
							"required": []string{"slug"},
						},
					},
					{
						"name":        "search-docs",
						"description": "Search mecha documentation by keyword",
						"inputSchema": map[string]any{
							"type": "object",
							"properties": map[string]any{
								"query": map[string]any{"type": "string", "description": "Search keyword or phrase"},
							},
							"required": []string{"query"},
						},
					},
				},
			},
		}

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
		return mcpResponse{
			JSONRPC: "2.0",
			ID:      msg.ID,
			Error:   &mcpError{Code: -32601, Message: "method not found: " + msg.Method},
		}
	}
}

func handleToolCall(id any, name string, args map[string]any) mcpResponse {
	switch name {
	case "list-topics":
		var topics []map[string]string
		for _, p := range pages {
			topics = append(topics, map[string]string{"slug": p.Slug, "title": p.Title})
		}
		data, _ := json.Marshal(topics)
		return mcpResponse{
			JSONRPC: "2.0", ID: id,
			Result: map[string]any{"content": []map[string]any{{"type": "text", "text": string(data)}}},
		}

	case "get-page":
		slug, _ := args["slug"].(string)
		p := findPage(slug)
		if p == nil {
			return mcpResponse{
				JSONRPC: "2.0", ID: id,
				Result: map[string]any{
					"content": []map[string]any{{"type": "text", "text": fmt.Sprintf("page %q not found", slug)}},
					"isError": true,
				},
			}
		}
		return mcpResponse{
			JSONRPC: "2.0", ID: id,
			Result: map[string]any{"content": []map[string]any{{"type": "text", "text": p.Body}}},
		}

	case "search-docs":
		query, _ := args["query"].(string)
		results := searchPages(query)
		if len(results) == 0 {
			return mcpResponse{
				JSONRPC: "2.0", ID: id,
				Result: map[string]any{"content": []map[string]any{{"type": "text", "text": "no results for: " + query}}},
			}
		}
		var sb strings.Builder
		for _, r := range results {
			sb.WriteString(fmt.Sprintf("## %s (%s)\n\n", r.Title, r.Slug))
			body := r.Body
			if len(body) > 500 {
				body = body[:500] + "\n...(truncated, use get-page for full content)"
			}
			sb.WriteString(body)
			sb.WriteString("\n\n---\n\n")
		}
		return mcpResponse{
			JSONRPC: "2.0", ID: id,
			Result: map[string]any{"content": []map[string]any{{"type": "text", "text": sb.String()}}},
		}

	default:
		return mcpResponse{
			JSONRPC: "2.0", ID: id,
			Error: &mcpError{Code: -32602, Message: "unknown tool: " + name},
		}
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

func main() {
	docsDir := os.Getenv("DOCS_DIR")
	if docsDir == "" {
		docsDir = "website/guide"
	}
	if err := loadPages(docsDir); err != nil {
		log.Fatal(err)
	}
	log.Printf("loaded %d doc pages from %s", len(pages), docsDir)

	addr := ":8090"
	if v := os.Getenv("ADDR"); v != "" {
		addr = v
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /sse", handleSSE)
	mux.HandleFunc("POST /message", handleMessage)
	mux.HandleFunc("OPTIONS /", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("ok"))
	})

	log.Printf("mecha-mcp listening on %s", addr)
	log.Fatal(http.ListenAndServe(addr, mux))
}
