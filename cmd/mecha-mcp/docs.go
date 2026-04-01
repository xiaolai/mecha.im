package main

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

type docPage struct {
	Slug  string `json:"slug"`
	Title string `json:"title"`
	Body  string `json:"-"`
}

var (
	docsDir     string
	rulesDir    string
	examplesDir string
	mu          sync.RWMutex
	pages       []docPage
	rules       []docPage
	examples    []docPage
)

func reloadPages() {
	loaded, err := readDir(docsDir)
	if err != nil {
		log.Printf("reload docs: %v", err)
		return
	}
	rls, _ := readDir(rulesDir)
	exs, _ := readDir(examplesDir)
	mu.Lock()
	pages = loaded
	rules = rls
	examples = exs
	mu.Unlock()
}

func getPages() []docPage {
	mu.RLock()
	defer mu.RUnlock()
	return pages
}

func getRules() []docPage {
	mu.RLock()
	defer mu.RUnlock()
	return rules
}

func getExamples() []docPage {
	mu.RLock()
	defer mu.RUnlock()
	return examples
}

func readDir(dir string) ([]docPage, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("read docs dir %s: %w", dir, err)
	}
	var result []docPage
	for _, e := range entries {
		if e.IsDir() || (!strings.HasSuffix(e.Name(), ".md") && !strings.HasSuffix(e.Name(), ".yml")) {
			continue
		}
		data, err := os.ReadFile(filepath.Join(dir, e.Name()))
		if err != nil {
			log.Printf("warning: skipping unreadable doc %s: %v", e.Name(), err)
			continue
		}
		ext := filepath.Ext(e.Name())
		slug := strings.TrimSuffix(e.Name(), ext)
		title, body := parseFrontmatter(string(data))
		if title == "" {
			title = slug
		}
		result = append(result, docPage{Slug: slug, Title: title, Body: body})
	}
	return result, nil
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

func findPage(slug string, pp []docPage) *docPage {
	for i := range pp {
		if pp[i].Slug == slug {
			return &pp[i]
		}
	}
	return nil
}

func searchPages(query string, pp []docPage) []docPage {
	q := strings.ToLower(query)
	var results []docPage
	for _, p := range pp {
		if strings.Contains(strings.ToLower(p.Title), q) ||
			strings.Contains(strings.ToLower(p.Body), q) {
			results = append(results, p)
		}
	}
	return results
}
