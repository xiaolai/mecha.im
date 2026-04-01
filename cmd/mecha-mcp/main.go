package main

import (
	"log"
	"net/http"
	"os"
)

func main() {
	docsDir = os.Getenv("DOCS_DIR")
	if docsDir == "" {
		docsDir = "website/guide"
	}
	repoDir = os.Getenv("REPO_DIR")
	if repoDir == "" {
		repoDir = "."
	}
	rulesDir = os.Getenv("RULES_DIR")
	if rulesDir == "" {
		rulesDir = ".claude/rules"
	}
	examplesDir = os.Getenv("EXAMPLES_DIR")
	if examplesDir == "" {
		examplesDir = "workers"
	}
	webhookSecret = os.Getenv("GITHUB_MECHA_MCP_WEBHOOK_SECRET")

	reloadPages()
	log.Printf("loaded %d docs, %d rules, %d examples", len(getPages()), len(getRules()), len(getExamples()))

	if webhookSecret != "" {
		log.Printf("github webhook enabled (HMAC validated)")
	} else {
		log.Printf("warning: GITHUB_MECHA_MCP_WEBHOOK_SECRET not set, webhook endpoint disabled")
	}

	addr := ":8090"
	if v := os.Getenv("ADDR"); v != "" {
		addr = v
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /sse", handleSSE)
	mux.HandleFunc("POST /message", handleMessage)
	mux.HandleFunc("POST /webhook", handleWebhook)
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
