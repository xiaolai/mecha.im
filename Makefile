VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
LDFLAGS := -s -w -X mecha.im/internal/cli.Version=$(VERSION)

build:
	go build -ldflags "$(LDFLAGS)" -o mecha ./cmd/mecha

test:
	go test -race ./...

vet:
	go vet ./...

bun-test:
	cd docker/runtime && bun test

ci: vet test bun-test build

# Coverage profile generation — -coverpkg=./... instruments ALL packages,
# including those without test files, so zero-coverage packages are visible.
cover:
	go test -race -coverprofile=coverage.out -covermode=atomic -coverpkg=./... $$(go list ./... | grep -v test/integration)
	go tool cover -func=coverage.out | tail -1

# HTML coverage report
cover-html: cover
	go tool cover -html=coverage.out -o coverage.html

# Coverage gate — fails if total coverage drops below threshold
cover-check: cover
	@total=$$(go tool cover -func=coverage.out | tail -1 | awk '{print $$3}' | tr -d '%'); \
	threshold=80; \
	echo "Total coverage: $${total}% (threshold: $${threshold}%)"; \
	if [ "$$(echo "$${total} < $${threshold}" | bc -l)" = "1" ]; then \
		echo "FAIL: coverage $${total}% below $${threshold}% threshold"; \
		exit 1; \
	fi

mcp:
	go build -ldflags "-s -w -X main.Version=$(VERSION)" -o mecha-mcp ./cmd/mecha-mcp

clean:
	rm -f mecha mecha-mcp coverage.out coverage.html

image-base:
	docker build -t mecha-worker-base -f docker/base/Dockerfile docker/

image: image-base
	docker build -t mecha-worker docker/claude/

.PHONY: build mcp test vet bun-test ci clean image-base image cover cover-html cover-check
