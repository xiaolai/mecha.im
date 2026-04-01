package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// ---------- parseFrontmatter ----------

func TestParseFrontmatterWithYAML(t *testing.T) {
	content := `---
title: Getting Started
description: How to install mecha
---

# Getting Started

Install mecha with...`

	title, body := parseFrontmatter(content)
	if title != "Getting Started" {
		t.Errorf("title = %q, want 'Getting Started'", title)
	}
	if !strings.HasPrefix(body, "# Getting Started") {
		t.Errorf("body should start with heading, got: %q", body[:min(50, len(body))])
	}
}

func TestParseFrontmatterNoFrontmatter(t *testing.T) {
	content := "# Just a heading\n\nSome body text."
	title, body := parseFrontmatter(content)
	if title != "" {
		t.Errorf("title = %q, want empty", title)
	}
	if body != content {
		t.Errorf("body should be entire content when no frontmatter")
	}
}

func TestParseFrontmatterIncompleteFrontmatter(t *testing.T) {
	// Has opening --- but no closing ---
	content := "---\ntitle: Incomplete\nSome body text."
	title, body := parseFrontmatter(content)
	if title != "" {
		t.Errorf("title = %q, want empty for incomplete frontmatter", title)
	}
	if body != content {
		t.Errorf("body should be entire content for incomplete frontmatter")
	}
}

func TestParseFrontmatterNoTitle(t *testing.T) {
	content := `---
description: No title here
---

Body text.`
	title, body := parseFrontmatter(content)
	if title != "" {
		t.Errorf("title = %q, want empty", title)
	}
	if body != "Body text." {
		t.Errorf("body = %q, want 'Body text.'", body)
	}
}

func TestParseFrontmatterEmptyBody(t *testing.T) {
	content := `---
title: Empty Body
---
`
	title, body := parseFrontmatter(content)
	if title != "Empty Body" {
		t.Errorf("title = %q, want 'Empty Body'", title)
	}
	if body != "" {
		t.Errorf("body = %q, want empty", body)
	}
}

// ---------- findPage ----------

func TestFindPageExists(t *testing.T) {
	pp := []docPage{
		{Slug: "install", Title: "Installation", Body: "Install guide"},
		{Slug: "config", Title: "Configuration", Body: "Config guide"},
	}
	p := findPage("config", pp)
	if p == nil {
		t.Fatal("findPage should find 'config'")
	}
	if p.Title != "Configuration" {
		t.Errorf("title = %q", p.Title)
	}
}

func TestFindPageNotFound(t *testing.T) {
	pp := []docPage{
		{Slug: "install", Title: "Installation", Body: "Install guide"},
	}
	p := findPage("missing", pp)
	if p != nil {
		t.Error("findPage should return nil for missing page")
	}
}

func TestFindPageEmptySlice(t *testing.T) {
	p := findPage("anything", nil)
	if p != nil {
		t.Error("findPage should return nil for nil slice")
	}
}

// ---------- searchPages ----------

func TestSearchPagesMatchTitle(t *testing.T) {
	pp := []docPage{
		{Slug: "install", Title: "Installation Guide", Body: "Steps to install"},
		{Slug: "config", Title: "Configuration", Body: "Config options"},
		{Slug: "api", Title: "API Reference", Body: "Endpoints"},
	}
	results := searchPages("install", pp)
	if len(results) != 1 {
		t.Fatalf("got %d results, want 1", len(results))
	}
	if results[0].Slug != "install" {
		t.Errorf("slug = %q, want 'install'", results[0].Slug)
	}
}

func TestSearchPagesMatchBody(t *testing.T) {
	pp := []docPage{
		{Slug: "install", Title: "Setup", Body: "Install mecha using go install"},
		{Slug: "api", Title: "API", Body: "REST endpoints for mecha"},
	}
	results := searchPages("endpoints", pp)
	if len(results) != 1 {
		t.Fatalf("got %d results, want 1", len(results))
	}
	if results[0].Slug != "api" {
		t.Errorf("slug = %q, want 'api'", results[0].Slug)
	}
}

func TestSearchPagesCaseInsensitive(t *testing.T) {
	pp := []docPage{
		{Slug: "guide", Title: "GETTING STARTED", Body: "Welcome"},
	}
	results := searchPages("getting started", pp)
	if len(results) != 1 {
		t.Fatalf("got %d results, want 1", len(results))
	}
}

func TestSearchPagesNoMatch(t *testing.T) {
	pp := []docPage{
		{Slug: "install", Title: "Installation", Body: "Steps"},
	}
	results := searchPages("kubernetes", pp)
	if len(results) != 0 {
		t.Errorf("got %d results, want 0", len(results))
	}
}

func TestSearchPagesMultipleMatches(t *testing.T) {
	pp := []docPage{
		{Slug: "a", Title: "Worker Config", Body: "How to configure workers"},
		{Slug: "b", Title: "Docker Workers", Body: "Docker-based worker setup"},
		{Slug: "c", Title: "API", Body: "No mention of w-o-r-k-e-r here"},
	}
	results := searchPages("worker", pp)
	if len(results) != 2 {
		t.Fatalf("got %d results, want 2", len(results))
	}
}

// ---------- readDir ----------

func TestReadDirWithMDFiles(t *testing.T) {
	dir := t.TempDir()

	// Create markdown files with frontmatter
	content1 := `---
title: Page One
---

Content of page one.`
	os.WriteFile(filepath.Join(dir, "page-one.md"), []byte(content1), 0o644)

	content2 := "# Page Two\n\nNo frontmatter."
	os.WriteFile(filepath.Join(dir, "page-two.md"), []byte(content2), 0o644)

	// Non-markdown file should be skipped
	os.WriteFile(filepath.Join(dir, "readme.txt"), []byte("skip me"), 0o644)

	// Directory should be skipped
	os.MkdirAll(filepath.Join(dir, "subdir"), 0o755)

	result, err := readDir(dir)
	if err != nil {
		t.Fatalf("readDir: %v", err)
	}
	if len(result) != 2 {
		t.Fatalf("got %d pages, want 2", len(result))
	}

	// Find the page with frontmatter
	var found bool
	for _, p := range result {
		if p.Slug == "page-one" {
			found = true
			if p.Title != "Page One" {
				t.Errorf("title = %q, want 'Page One'", p.Title)
			}
		}
		if p.Slug == "page-two" {
			if p.Title != "page-two" {
				t.Errorf("title = %q, want 'page-two' (slug as fallback)", p.Title)
			}
		}
	}
	if !found {
		t.Error("page-one not found in results")
	}
}

func TestReadDirWithYMLFiles(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "worker.yml"), []byte("name: test\nendpoint: http://x\n"), 0o644)

	result, err := readDir(dir)
	if err != nil {
		t.Fatalf("readDir: %v", err)
	}
	if len(result) != 1 {
		t.Fatalf("got %d pages, want 1", len(result))
	}
	if result[0].Slug != "worker" {
		t.Errorf("slug = %q, want 'worker'", result[0].Slug)
	}
}

func TestReadDirNonexistent(t *testing.T) {
	_, err := readDir("/nonexistent/path/xyz")
	if err == nil {
		t.Fatal("expected error for nonexistent dir")
	}
}

func TestReadDirEmpty(t *testing.T) {
	dir := t.TempDir()
	result, err := readDir(dir)
	if err != nil {
		t.Fatalf("readDir: %v", err)
	}
	if len(result) != 0 {
		t.Errorf("got %d pages, want 0", len(result))
	}
}

// ---------- touchesDocs ----------

func TestTouchesDocsWebsitePath(t *testing.T) {
	payload := `{"commits":[{"added":["website/guide/install.md"],"modified":[],"removed":[]}]}`
	if !touchesDocs([]byte(payload)) {
		t.Error("should detect website/ path change")
	}
}

func TestTouchesDocsRulesPath(t *testing.T) {
	payload := `{"commits":[{"added":[],"modified":[".claude/rules/security.md"],"removed":[]}]}`
	if !touchesDocs([]byte(payload)) {
		t.Error("should detect .claude/rules/ path change")
	}
}

func TestTouchesDocsWorkersPath(t *testing.T) {
	payload := `{"commits":[{"added":[],"modified":[],"removed":["workers/reviewer.yml"]}]}`
	if !touchesDocs([]byte(payload)) {
		t.Error("should detect workers/ path change")
	}
}

func TestTouchesDocsNonDocPath(t *testing.T) {
	payload := `{"commits":[{"added":["internal/cli/serve.go"],"modified":["Makefile"],"removed":[]}]}`
	if touchesDocs([]byte(payload)) {
		t.Error("should not detect non-doc paths")
	}
}

func TestTouchesDocsEmptyCommits(t *testing.T) {
	payload := `{"commits":[]}`
	if touchesDocs([]byte(payload)) {
		t.Error("should return false for empty commits")
	}
}

func TestTouchesDocsInvalidJSON(t *testing.T) {
	// Invalid JSON defaults to true (conservative: assume docs changed)
	if !touchesDocs([]byte("{invalid json")) {
		t.Error("should return true for unparseable JSON")
	}
}

func TestTouchesDocsMultipleCommits(t *testing.T) {
	payload := `{"commits":[
		{"added":["src/main.go"],"modified":[],"removed":[]},
		{"added":["website/index.md"],"modified":[],"removed":[]}
	]}`
	if !touchesDocs([]byte(payload)) {
		t.Error("should detect docs change in second commit")
	}
}

func TestTouchesDocsModifiedField(t *testing.T) {
	payload := `{"commits":[{"added":[],"modified":["website/config.md"],"removed":[]}]}`
	if !touchesDocs([]byte(payload)) {
		t.Error("should detect modified website/ path")
	}
}

// ---------- validateHMAC ----------

func TestValidateHMACValid(t *testing.T) {
	secret := "test-secret-key"
	body := []byte(`{"action":"push"}`)

	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	sig := "sha256=" + hex.EncodeToString(mac.Sum(nil))

	if !validateHMAC(secret, body, sig) {
		t.Error("valid HMAC should pass")
	}
}

func TestValidateHMACInvalid(t *testing.T) {
	secret := "test-secret-key"
	body := []byte(`{"action":"push"}`)

	if validateHMAC(secret, body, "sha256=0000000000000000000000000000000000000000000000000000000000000000") {
		t.Error("invalid HMAC should fail")
	}
}

func TestValidateHMACNoPrefix(t *testing.T) {
	if validateHMAC("secret", []byte("body"), "invalid-no-sha256-prefix") {
		t.Error("missing sha256= prefix should fail")
	}
}

func TestValidateHMACEmptySig(t *testing.T) {
	if validateHMAC("secret", []byte("body"), "") {
		t.Error("empty signature should fail")
	}
}

func TestValidateHMACDifferentBody(t *testing.T) {
	secret := "my-secret"
	body1 := []byte("original body")
	body2 := []byte("tampered body")

	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body1)
	sig := "sha256=" + hex.EncodeToString(mac.Sum(nil))

	// Signature computed for body1 should not validate for body2
	if validateHMAC(secret, body2, sig) {
		t.Error("HMAC for different body should fail")
	}
}

// ---------- handleMCP ----------

func TestHandleMCPInitialize(t *testing.T) {
	resp := handleMCP(mcpRequest{JSONRPC: "2.0", ID: 1, Method: "initialize"})
	if resp.ID != 1 {
		t.Errorf("id = %v, want 1", resp.ID)
	}
	if resp.Error != nil {
		t.Errorf("unexpected error: %v", resp.Error)
	}
	result, ok := resp.Result.(map[string]any)
	if !ok {
		t.Fatalf("result not a map")
	}
	if result["protocolVersion"] != "2024-11-05" {
		t.Errorf("protocolVersion = %v", result["protocolVersion"])
	}
}

func TestHandleMCPToolsList(t *testing.T) {
	resp := handleMCP(mcpRequest{JSONRPC: "2.0", ID: 2, Method: "tools/list"})
	if resp.Error != nil {
		t.Errorf("unexpected error: %v", resp.Error)
	}
	result, ok := resp.Result.(map[string]any)
	if !ok {
		t.Fatalf("result not a map")
	}
	tools, ok := result["tools"].([]map[string]any)
	if !ok {
		t.Fatalf("tools not a slice of maps")
	}
	if len(tools) != 6 {
		t.Errorf("got %d tools, want 6", len(tools))
	}
}

func TestHandleMCPNotificationsInitialized(t *testing.T) {
	resp := handleMCP(mcpRequest{JSONRPC: "2.0", Method: "notifications/initialized"})
	// Should return empty response (no ID, no error, no result)
	if resp.ID != nil || resp.Error != nil || resp.Result != nil {
		t.Errorf("notifications/initialized should return empty response")
	}
}

func TestHandleMCPUnknownMethod(t *testing.T) {
	resp := handleMCP(mcpRequest{JSONRPC: "2.0", ID: 3, Method: "unknown/method"})
	if resp.Error == nil {
		t.Fatal("expected error for unknown method")
	}
	if resp.Error.Code != -32601 {
		t.Errorf("error code = %d, want -32601", resp.Error.Code)
	}
}

// ---------- handleToolCall ----------

func TestHandleToolCallGetVersion(t *testing.T) {
	saved := Version
	Version = "v1.0.0-test"
	defer func() { Version = saved }()

	resp := handleToolCall(1, "get-version", nil)
	if resp.Error != nil {
		t.Fatalf("unexpected error: %v", resp.Error)
	}
	result, ok := resp.Result.(map[string]any)
	if !ok {
		t.Fatalf("result not a map")
	}
	content, ok := result["content"].([]map[string]any)
	if !ok || len(content) == 0 {
		t.Fatalf("content not a slice or empty")
	}
	text, _ := content[0]["text"].(string)
	if text != "mecha v1.0.0-test" {
		t.Errorf("text = %q", text)
	}
}

func TestHandleToolCallUnknown(t *testing.T) {
	resp := handleToolCall(1, "nonexistent-tool", nil)
	if resp.Error == nil {
		t.Fatal("expected error for unknown tool")
	}
	if resp.Error.Code != -32602 {
		t.Errorf("error code = %d, want -32602", resp.Error.Code)
	}
}

func TestHandleToolCallListTopics(t *testing.T) {
	// Set up test pages
	mu.Lock()
	pages = []docPage{
		{Slug: "install", Title: "Installation"},
		{Slug: "config", Title: "Configuration"},
	}
	mu.Unlock()
	defer func() {
		mu.Lock()
		pages = nil
		mu.Unlock()
	}()

	resp := handleToolCall(1, "list-topics", nil)
	if resp.Error != nil {
		t.Fatalf("unexpected error: %v", resp.Error)
	}
	result, _ := resp.Result.(map[string]any)
	content, _ := result["content"].([]map[string]any)
	text, _ := content[0]["text"].(string)

	var topics []map[string]string
	json.Unmarshal([]byte(text), &topics)
	if len(topics) != 2 {
		t.Errorf("got %d topics, want 2", len(topics))
	}
}

func TestHandleToolCallGetPage(t *testing.T) {
	mu.Lock()
	pages = []docPage{
		{Slug: "install", Title: "Installation", Body: "Install content here"},
	}
	mu.Unlock()
	defer func() {
		mu.Lock()
		pages = nil
		mu.Unlock()
	}()

	resp := handleToolCall(1, "get-page", map[string]any{"slug": "install"})
	if resp.Error != nil {
		t.Fatalf("unexpected error: %v", resp.Error)
	}
	result, _ := resp.Result.(map[string]any)
	content, _ := result["content"].([]map[string]any)
	text, _ := content[0]["text"].(string)
	if text != "Install content here" {
		t.Errorf("text = %q", text)
	}
}

func TestHandleToolCallGetPageNotFound(t *testing.T) {
	mu.Lock()
	pages = nil
	mu.Unlock()

	resp := handleToolCall(1, "get-page", map[string]any{"slug": "missing"})
	result, _ := resp.Result.(map[string]any)
	isError, _ := result["isError"].(bool)
	if !isError {
		t.Error("should return isError for missing page")
	}
}

func TestHandleToolCallSearchDocs(t *testing.T) {
	mu.Lock()
	pages = []docPage{
		{Slug: "install", Title: "Installation", Body: "How to install mecha"},
		{Slug: "api", Title: "API", Body: "REST endpoints"},
	}
	mu.Unlock()
	defer func() {
		mu.Lock()
		pages = nil
		mu.Unlock()
	}()

	resp := handleToolCall(1, "search-docs", map[string]any{"query": "install"})
	result, _ := resp.Result.(map[string]any)
	content, _ := result["content"].([]map[string]any)
	text, _ := content[0]["text"].(string)
	if !strings.Contains(text, "Installation") {
		t.Errorf("search should find install page, got: %q", text)
	}
}

func TestHandleToolCallSearchDocsNoResults(t *testing.T) {
	mu.Lock()
	pages = []docPage{
		{Slug: "api", Title: "API", Body: "endpoints"},
	}
	mu.Unlock()
	defer func() {
		mu.Lock()
		pages = nil
		mu.Unlock()
	}()

	resp := handleToolCall(1, "search-docs", map[string]any{"query": "kubernetes"})
	result, _ := resp.Result.(map[string]any)
	content, _ := result["content"].([]map[string]any)
	text, _ := content[0]["text"].(string)
	if !strings.Contains(text, "no results") {
		t.Errorf("should say no results, got: %q", text)
	}
}

func TestHandleToolCallGetSpec(t *testing.T) {
	mu.Lock()
	rules = []docPage{
		{Slug: "security", Title: "Security Rules", Body: "Security content"},
	}
	mu.Unlock()
	defer func() {
		mu.Lock()
		rules = nil
		mu.Unlock()
	}()

	resp := handleToolCall(1, "get-spec", map[string]any{"name": "security"})
	result, _ := resp.Result.(map[string]any)
	content, _ := result["content"].([]map[string]any)
	text, _ := content[0]["text"].(string)
	if text != "Security content" {
		t.Errorf("text = %q", text)
	}
}

func TestHandleToolCallGetSpecNotFound(t *testing.T) {
	mu.Lock()
	rules = []docPage{
		{Slug: "security", Title: "Security", Body: "content"},
	}
	mu.Unlock()
	defer func() {
		mu.Lock()
		rules = nil
		mu.Unlock()
	}()

	resp := handleToolCall(1, "get-spec", map[string]any{"name": "missing"})
	result, _ := resp.Result.(map[string]any)
	isError, _ := result["isError"].(bool)
	if !isError {
		t.Error("should return isError for missing spec")
	}
	content, _ := result["content"].([]map[string]any)
	text, _ := content[0]["text"].(string)
	if !strings.Contains(text, "security") {
		t.Error("error should list available specs")
	}
}

func TestHandleToolCallGetExamplesList(t *testing.T) {
	mu.Lock()
	examples = []docPage{
		{Slug: "reviewer", Title: "PR Reviewer"},
		{Slug: "coder", Title: "Code Writer"},
	}
	mu.Unlock()
	defer func() {
		mu.Lock()
		examples = nil
		mu.Unlock()
	}()

	resp := handleToolCall(1, "get-examples", nil)
	result, _ := resp.Result.(map[string]any)
	content, _ := result["content"].([]map[string]any)
	text, _ := content[0]["text"].(string)

	var list []map[string]string
	json.Unmarshal([]byte(text), &list)
	if len(list) != 2 {
		t.Errorf("got %d examples, want 2", len(list))
	}
}

func TestHandleToolCallGetExamplesEmptyName(t *testing.T) {
	mu.Lock()
	examples = []docPage{
		{Slug: "reviewer", Title: "PR Reviewer"},
	}
	mu.Unlock()
	defer func() {
		mu.Lock()
		examples = nil
		mu.Unlock()
	}()

	// Empty name should list all
	resp := handleToolCall(1, "get-examples", map[string]any{"name": ""})
	result, _ := resp.Result.(map[string]any)
	content, _ := result["content"].([]map[string]any)
	text, _ := content[0]["text"].(string)

	var list []map[string]string
	json.Unmarshal([]byte(text), &list)
	if len(list) != 1 {
		t.Errorf("got %d examples, want 1", len(list))
	}
}

func TestHandleToolCallGetExamplesByName(t *testing.T) {
	mu.Lock()
	examples = []docPage{
		{Slug: "reviewer", Title: "PR Reviewer", Body: "Reviewer YAML content"},
	}
	mu.Unlock()
	defer func() {
		mu.Lock()
		examples = nil
		mu.Unlock()
	}()

	resp := handleToolCall(1, "get-examples", map[string]any{"name": "reviewer"})
	result, _ := resp.Result.(map[string]any)
	content, _ := result["content"].([]map[string]any)
	text, _ := content[0]["text"].(string)
	if text != "Reviewer YAML content" {
		t.Errorf("text = %q", text)
	}
}

func TestHandleToolCallGetExamplesNotFound(t *testing.T) {
	mu.Lock()
	examples = nil
	mu.Unlock()

	resp := handleToolCall(1, "get-examples", map[string]any{"name": "missing"})
	result, _ := resp.Result.(map[string]any)
	isError, _ := result["isError"].(bool)
	if !isError {
		t.Error("should return isError for missing example")
	}
}

func TestHandleToolCallSearchDocsLongBody(t *testing.T) {
	// Test truncation of long bodies in search results
	longBody := strings.Repeat("x", 1000)
	mu.Lock()
	pages = []docPage{
		{Slug: "long", Title: "Long Page", Body: longBody},
	}
	mu.Unlock()
	defer func() {
		mu.Lock()
		pages = nil
		mu.Unlock()
	}()

	resp := handleToolCall(1, "search-docs", map[string]any{"query": "xxx"})
	result, _ := resp.Result.(map[string]any)
	content, _ := result["content"].([]map[string]any)
	text, _ := content[0]["text"].(string)
	if !strings.Contains(text, "truncated") {
		t.Error("long body should be truncated in search results")
	}
}

// ---------- handleMCP tools/call ----------

func TestHandleMCPToolsCall(t *testing.T) {
	saved := Version
	Version = "v0.1.0"
	defer func() { Version = saved }()

	params, _ := json.Marshal(map[string]any{
		"name":      "get-version",
		"arguments": map[string]any{},
	})
	resp := handleMCP(mcpRequest{
		JSONRPC: "2.0",
		ID:      42,
		Method:  "tools/call",
		Params:  params,
	})
	if resp.Error != nil {
		t.Fatalf("unexpected error: %v", resp.Error)
	}
	result, _ := resp.Result.(map[string]any)
	content, _ := result["content"].([]map[string]any)
	text, _ := content[0]["text"].(string)
	if text != "mecha v0.1.0" {
		t.Errorf("text = %q", text)
	}
}

// ---------- reloadPages / getPages / getRules / getExamples ----------

func TestReloadPagesAndGetters(t *testing.T) {
	dir := t.TempDir()
	guidDir := filepath.Join(dir, "guide")
	rulesTestDir := filepath.Join(dir, "rules")
	exDir := filepath.Join(dir, "examples")
	os.MkdirAll(guidDir, 0o755)
	os.MkdirAll(rulesTestDir, 0o755)
	os.MkdirAll(exDir, 0o755)

	os.WriteFile(filepath.Join(guidDir, "start.md"), []byte("---\ntitle: Start\n---\nHello"), 0o644)
	os.WriteFile(filepath.Join(rulesTestDir, "sec.md"), []byte("# Security"), 0o644)
	os.WriteFile(filepath.Join(exDir, "demo.yml"), []byte("name: demo"), 0o644)

	// Save and restore globals
	oldDocs, oldRules, oldExamples := docsDir, rulesDir, examplesDir
	defer func() {
		docsDir, rulesDir, examplesDir = oldDocs, oldRules, oldExamples
	}()
	docsDir = guidDir
	rulesDir = rulesTestDir
	examplesDir = exDir

	reloadPages()

	pp := getPages()
	if len(pp) != 1 {
		t.Errorf("got %d pages, want 1", len(pp))
	}
	if len(pp) > 0 && pp[0].Title != "Start" {
		t.Errorf("title = %q, want 'Start'", pp[0].Title)
	}

	rr := getRules()
	if len(rr) != 1 {
		t.Errorf("got %d rules, want 1", len(rr))
	}

	ee := getExamples()
	if len(ee) != 1 {
		t.Errorf("got %d examples, want 1", len(ee))
	}
}

func TestReloadPagesNonexistentDir(t *testing.T) {
	oldDocs := docsDir
	defer func() { docsDir = oldDocs }()
	docsDir = "/nonexistent/dir"

	// Should not panic, just log
	reloadPages()
}
