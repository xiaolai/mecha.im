package policies

import (
	"encoding/json"
	"testing"
)

func FuzzParseRules(f *testing.F) {
	f.Add([]byte(`{"comment":{"allow":true,"max_length":1000}}`))
	f.Add([]byte(`{"labels":{"allow":true,"allowed":["bug"],"blocked":["approved"]}}`))
	f.Add([]byte(`{"status":{"allow":false}}`))
	f.Add([]byte(`{"commit":{"allow":true,"max_size":50000}}`))
	f.Add([]byte(`{"metadata":{"allow":false}}`))
	f.Add([]byte(`{}`))
	f.Add([]byte(`{"comment":{"allow":"yes"}}`))
	f.Add([]byte(`not json`))

	f.Fuzz(func(t *testing.T, data []byte) {
		var raw map[string]any
		if err := json.Unmarshal(data, &raw); err != nil {
			return // skip non-JSON inputs
		}
		ParseRules(raw) //nolint:errcheck // fuzz: we only care about panics
	})
}

func FuzzResultUnmarshal(f *testing.F) {
	f.Add([]byte(`{"output":"hello"}`))
	f.Add([]byte(`{"output":"","comment":{"target":"pr:1","body":"review"}}`))
	f.Add([]byte(`{"labels":{"add":["bug"],"remove":["wontfix"]}}`))
	f.Add([]byte(`{"status":{"state":"success","description":"ok"}}`))
	f.Add([]byte(`{"commit":{"message":"fix","diff":"--- a\n+++ b"}}`))
	f.Add([]byte(`{"metadata":{"model":"test","input_tokens":100}}`))
	f.Add([]byte(`{}`))
	f.Add([]byte(`not json`))

	f.Fuzz(func(t *testing.T, data []byte) {
		var r Result
		json.Unmarshal(data, &r) //nolint:errcheck // fuzz: we only care about panics
	})
}
