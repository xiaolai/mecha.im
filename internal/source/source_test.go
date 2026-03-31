package source

import (
	"testing"
)

func TestRegistrySourceLifecycle(t *testing.T) {
	r := NewRegistry()
	if r.Len() != 0 {
		t.Errorf("Len() = %d, want 0", r.Len())
	}

	src := NewGenericSource("test", "")
	r.Register(src)

	if r.Len() != 1 {
		t.Errorf("Len() = %d, want 1", r.Len())
	}
	got, ok := r.Get("test")
	if !ok || got.Name() != "test" {
		t.Errorf("Get(test) = %v, %v", got, ok)
	}
	_, ok = r.Get("missing")
	if ok {
		t.Error("Get(missing) should return false")
	}
}

func TestRegistryNilLen(t *testing.T) {
	var r *Registry
	if r.Len() != 0 {
		t.Errorf("nil registry Len() = %d, want 0", r.Len())
	}
}

func TestRegistryTriggersCopy(t *testing.T) {
	r := NewRegistry()
	triggers := r.Triggers()
	if triggers == nil {
		t.Error("Triggers() should return non-nil map")
	}
	// Mutating the returned map should not affect the registry
	triggers["injected"] = nil
	if _, ok := r.GetTrigger("injected"); ok {
		t.Error("mutating Triggers() return value should not affect registry")
	}
}

func TestRegistryResponder(t *testing.T) {
	r := NewRegistry()
	_, ok := r.GetResponder("github")
	if ok {
		t.Error("should not find unregistered responder")
	}
}
