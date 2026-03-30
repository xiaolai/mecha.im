package writeback

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
)

var apiBase = "https://api.github.com"

func init() {
	if v := os.Getenv("GITHUB_API_URL"); v != "" {
		apiBase = strings.TrimRight(v, "/")
	}
}

func (c *Client) postComment(ctx context.Context, owner, repo string, number int, body string) error {
	url := fmt.Sprintf("%s/repos/%s/%s/issues/%d/comments", apiBase, owner, repo, number)
	payload, _ := json.Marshal(map[string]string{"body": body})
	return c.githubPost(ctx, url, payload)
}

func (c *Client) setStatus(ctx context.Context, owner, repo, sha, state, desc string) error {
	url := fmt.Sprintf("%s/repos/%s/%s/statuses/%s", apiBase, owner, repo, sha)
	payload, _ := json.Marshal(map[string]string{
		"state":       state,
		"description": desc,
		"context":     "mecha",
	})
	return c.githubPost(ctx, url, payload)
}

func (c *Client) addLabel(ctx context.Context, owner, repo string, number int, label string) error {
	url := fmt.Sprintf("%s/repos/%s/%s/issues/%d/labels", apiBase, owner, repo, number)
	payload, _ := json.Marshal(map[string][]string{"labels": {label}})
	return c.githubPost(ctx, url, payload)
}

func (c *Client) removeLabel(ctx context.Context, owner, repo string, number int, label string) error {
	url := fmt.Sprintf("%s/repos/%s/%s/issues/%d/labels/%s", apiBase, owner, repo, number, label)
	req, err := http.NewRequestWithContext(ctx, "DELETE", url, nil)
	if err != nil {
		return err
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
		return err
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
