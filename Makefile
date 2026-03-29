VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
LDFLAGS := -s -w -X mecha.im/internal/cli.Version=$(VERSION)

build:
	go build -ldflags "$(LDFLAGS)" -o mecha ./cmd/mecha

test:
	go test -race ./...

vet:
	go vet ./...

ci: vet test build

clean:
	rm -f mecha

.PHONY: build test vet ci clean
