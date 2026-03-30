package writeback

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
)

var apiBase = "https://api.github.com"

func init() {
	if v := os.Getenv("GITHUB_API_URL"); v != "" {
		apiBase = strings.TrimRight(v, "/")
	}
}

// OverrideAPIBase replaces the GitHub API base URL and returns a restore function.
// Intended for cross-package testing.
func OverrideAPIBase(url string) func() {
	old := apiBase
	apiBase = strings.TrimRight(url, "/")
	return func() { apiBase = old }
}

func (c *Client) postComment(ctx context.Context, owner, repo string, number int, body string) error {
	u := fmt.Sprintf("%s/repos/%s/%s/issues/%d/comments",
		apiBase, url.PathEscape(owner), url.PathEscape(repo), number)
	payload, _ := json.Marshal(map[string]string{"body": body})
	return c.githubPost(ctx, u, payload)
}

func (c *Client) setStatus(ctx context.Context, owner, repo, sha, state, desc string) error {
	u := fmt.Sprintf("%s/repos/%s/%s/statuses/%s",
		apiBase, url.PathEscape(owner), url.PathEscape(repo), url.PathEscape(sha))
	payload, _ := json.Marshal(map[string]string{
		"state":       state,
		"description": desc,
		"context":     "mecha",
	})
	return c.githubPost(ctx, u, payload)
}

func (c *Client) addLabel(ctx context.Context, owner, repo string, number int, label string) error {
	u := fmt.Sprintf("%s/repos/%s/%s/issues/%d/labels",
		apiBase, url.PathEscape(owner), url.PathEscape(repo), number)
	payload, _ := json.Marshal(map[string][]string{"labels": {label}})
	return c.githubPost(ctx, u, payload)
}

func (c *Client) removeLabel(ctx context.Context, owner, repo string, number int, label string) error {
	url := fmt.Sprintf("%s/repos/%s/%s/issues/%d/labels/%s", apiBase,
		url.PathEscape(owner), url.PathEscape(repo), number, url.PathEscape(label))
	req, err := http.NewRequestWithContext(ctx, "DELETE", url, nil)
	if err != nil {
		return fmt.Errorf("create delete request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Accept", "application/vnd.github+json")
	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("github delete: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("github %d: %s", resp.StatusCode, string(body))
	}
	return nil
}

func (c *Client) githubPost(ctx context.Context, url string, payload []byte) error {
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("create post request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("github post: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("github %d: %s", resp.StatusCode, string(body))
	}
	return nil
}
