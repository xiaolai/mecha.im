VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
LDFLAGS := -s -w -X mecha.im/internal/cli.Version=$(VERSION)

build:
	go build -ldflags "$(LDFLAGS)" -o mecha ./cmd/mecha

test:
	go test -race ./...

vet:
	go vet ./...

ci: vet test build

mcp:
	go build -ldflags "-s -w" -o mecha-mcp ./cmd/mecha-mcp

clean:
	rm -f mecha mecha-mcp

image-base:
	docker build -t mecha-worker-base -f docker/base/Dockerfile docker/

image-claude: image-base
	docker build -t mecha-worker-claude docker/claude/

image-codex: image-base
	docker build -t mecha-worker-codex docker/codex/

image-gemini: image-base
	docker build -t mecha-worker-gemini docker/gemini/

images: image-claude image-codex image-gemini

.PHONY: build mcp test vet ci clean image-base image-claude image-codex image-gemini images
