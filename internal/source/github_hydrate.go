package source

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"mecha.im/internal/event"
)

const maxDiffSize = 500 * 1024 // 500KB

var githubAPIBase = "https://api.github.com"

func init() {
	if v := os.Getenv("GITHUB_API_URL"); v != "" {
		githubAPIBase = strings.TrimRight(v, "/")
	}
}

// Hydrate enriches an event with data from the GitHub API.
// Uses SHA-pinned endpoints to avoid TOCTOU with mutable PR state.
func (g *GitHubSource) Hydrate(ctx context.Context, ev *event.Event) error {
	number := attrInt(ev.Attrs, "number")
	if g.token == "" || number == 0 {
		return nil
	}
	if strings.HasPrefix(ev.Type, "pull_request") {
		return g.hydratePR(ctx, ev)
	}
	return nil
}

func (g *GitHubSource) hydratePR(ctx context.Context, ev *event.Event) error {
	client := &http.Client{Timeout: 30 * time.Second}
	owner, _ := ev.Attrs["repo_owner"].(string)
	repo, _ := ev.Attrs["repo_name"].(string)
	number := attrInt(ev.Attrs, "number")

	// SHA-pinned compare (immutable)
	headSHA, _ := ev.Attrs["head_sha"].(string)
	baseSHA, _ := ev.Attrs["base_sha"].(string)
	var diffURL string
	if headSHA != "" && baseSHA != "" {
		diffURL = fmt.Sprintf("%s/repos/%s/%s/compare/%s...%s",
			githubAPIBase, owner, repo, baseSHA, headSHA)
	} else {
		diffURL = fmt.Sprintf("%s/repos/%s/%s/pulls/%d",
			githubAPIBase, owner, repo, number)
	}
	diff, err := g.githubGet(ctx, client, diffURL, "application/vnd.github.diff")
	if err != nil {
		ev.Attrs["diff"] = ""
		ev.Attrs["diff_error"] = err.Error()
	} else {
		if len(diff) > maxDiffSize {
			diff = diff[:maxDiffSize] + "\n... (truncated)"
		}
		ev.Attrs["diff"] = diff
	}

	// Fetch file list with pagination (up to 10 pages = 1000 files)
	var allFiles []string
	filesURL := fmt.Sprintf("%s/repos/%s/%s/pulls/%d/files?per_page=100",
		githubAPIBase, owner, repo, number)
	for page := 0; page < 10 && filesURL != ""; page++ {
		body, nextURL, err := g.githubGetPaginated(ctx, client, filesURL)
		if err != nil {
			break
		}
		allFiles = append(allFiles, extractFileList(body)...)
		filesURL = nextURL
	}
	if len(allFiles) > 0 {
		ev.Attrs["file_list"] = strings.Join(allFiles, "\n")
	} else {
		ev.Attrs["file_list"] = ""
	}

	return nil
}

func (g *GitHubSource) githubGet(ctx context.Context, client *http.Client, url, accept string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+g.token)
	req.Header.Set("Accept", accept)

	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("github api: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxDiffSize+1024))
	if err != nil {
		return "", err
	}
	if resp.StatusCode != 200 {
		return "", fmt.Errorf("github api %d: %s", resp.StatusCode, string(body[:min(len(body), 200)]))
	}
	return string(body), nil
}

// githubGetPaginated fetches a URL and returns the body + next page URL (from Link header).
func (g *GitHubSource) githubGetPaginated(ctx context.Context, client *http.Client, url string) (string, string, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return "", "", err
	}
	req.Header.Set("Authorization", "Bearer "+g.token)
	req.Header.Set("Accept", "application/vnd.github+json")

	resp, err := client.Do(req)
	if err != nil {
		return "", "", fmt.Errorf("github api: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxDiffSize+1024))
	if err != nil {
		return "", "", err
	}
	if resp.StatusCode != 200 {
		return "", "", fmt.Errorf("github api %d: %s", resp.StatusCode, string(body[:min(len(body), 200)]))
	}
	return string(body), parseNextLink(resp.Header.Get("Link")), nil
}

func parseNextLink(link string) string {
	for _, part := range strings.Split(link, ",") {
		part = strings.TrimSpace(part)
		if strings.Contains(part, `rel="next"`) {
			start := strings.Index(part, "<")
			end := strings.Index(part, ">")
			if start >= 0 && end > start {
				return part[start+1 : end]
			}
		}
	}
	return ""
}

func extractFileList(body string) []string {
	var files []struct{ Filename string }
	if err := json.Unmarshal([]byte(body), &files); err != nil {
		return nil
	}
	names := make([]string, 0, len(files))
	for _, f := range files {
		names = append(names, f.Filename)
	}
	return names
}

// attrInt extracts an integer from Attrs (handles float64 from JSON).
func attrInt(attrs event.Attrs, key string) int {
	return intVal(attrs[key])
}
