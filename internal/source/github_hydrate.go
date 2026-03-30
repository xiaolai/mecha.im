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
	if g.token == "" || ev.Number == 0 {
		return nil
	}
	if strings.HasPrefix(ev.Type, "pull_request") {
		return g.hydratePR(ctx, ev)
	}
	return nil
}

func (g *GitHubSource) hydratePR(ctx context.Context, ev *event.Event) error {
	client := &http.Client{Timeout: 30 * time.Second}

	// Prefer SHA-pinned compare (immutable) over mutable PR endpoint
	headSHA, _ := ev.Payload["head_sha"].(string)
	baseBranch, _ := ev.Payload["base_branch"].(string)
	var diffURL string
	if headSHA != "" && baseBranch != "" {
		diffURL = fmt.Sprintf("%s/repos/%s/%s/compare/%s...%s",
			githubAPIBase, ev.RepoOwner, ev.RepoName, baseBranch, headSHA)
	} else {
		diffURL = fmt.Sprintf("%s/repos/%s/%s/pulls/%d",
			githubAPIBase, ev.RepoOwner, ev.RepoName, ev.Number)
	}
	diff, err := g.githubGet(ctx, client, diffURL, "application/vnd.github.diff")
	if err != nil {
		ev.Payload["diff"] = ""
		ev.Payload["diff_error"] = err.Error()
	} else {
		if len(diff) > maxDiffSize {
			diff = diff[:maxDiffSize] + "\n... (truncated)"
		}
		ev.Payload["diff"] = diff
	}

	// Fetch file list with pagination
	filesURL := fmt.Sprintf("%s/repos/%s/%s/pulls/%d/files?per_page=100",
		githubAPIBase, ev.RepoOwner, ev.RepoName, ev.Number)
	filesBody, err := g.githubGet(ctx, client, filesURL, "application/vnd.github+json")
	if err != nil {
		ev.Payload["file_list"] = ""
	} else {
		ev.Payload["file_list"] = extractFileNames(filesBody)
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

func extractFileNames(body string) string {
	var files []struct{ Filename string }
	if err := json.Unmarshal([]byte(body), &files); err != nil {
		return ""
	}
	var names []string
	for _, f := range files {
		names = append(names, f.Filename)
	}
	return strings.Join(names, "\n")
}
