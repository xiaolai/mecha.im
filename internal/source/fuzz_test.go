package source

import (
	"net/http"
	"testing"
)

func FuzzGitHubParse(f *testing.F) {
	f.Add([]byte(`{"action":"opened","pull_request":{"number":1}}`))
	f.Add([]byte(`{}`))
	f.Add([]byte(`not json`))
	f.Add([]byte(``))

	src := NewGitHubSource("", "")
	f.Fuzz(func(t *testing.T, body []byte) {
		h := http.Header{}
		h.Set("X-GitHub-Event", "push")
		h.Set("X-GitHub-Delivery", "fuzz-123")
		src.Parse(h, body) //nolint:errcheck // fuzz: we only care about panics
	})
}

func FuzzSlackParse(f *testing.F) {
	f.Add([]byte(`{"type":"event_callback","event":{"type":"message","text":"hi"},"event_id":"Ev01"}`))
	f.Add([]byte(`{"type":"url_verification","challenge":"abc"}`))
	f.Add([]byte(`{}`))
	f.Add([]byte(`not json`))

	src := NewSlackSource("")
	f.Fuzz(func(t *testing.T, body []byte) {
		h := http.Header{}
		src.Parse(h, body) //nolint:errcheck
	})
}

func FuzzTelegramParse(f *testing.F) {
	f.Add([]byte(`{"update_id":123,"message":{"message_id":1,"chat":{"id":456},"text":"hello"}}`))
	f.Add([]byte(`{"update_id":123}`))
	f.Add([]byte(`{}`))
	f.Add([]byte(`not json`))

	src := NewTelegramSource("")
	f.Fuzz(func(t *testing.T, body []byte) {
		h := http.Header{}
		src.Parse(h, body) //nolint:errcheck
	})
}

func FuzzGitLabParse(f *testing.F) {
	f.Add([]byte(`{"object_kind":"merge_request","object_attributes":{"action":"open"}}`))
	f.Add([]byte(`{}`))
	f.Add([]byte(`not json`))

	src := NewGitLabSource("")
	f.Fuzz(func(t *testing.T, body []byte) {
		h := http.Header{}
		h.Set("X-Gitlab-Event", "Push Hook")
		src.Parse(h, body) //nolint:errcheck
	})
}
