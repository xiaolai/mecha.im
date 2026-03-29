---
max_pure_loc: 200
---

# Extraction Rules

## 1. Types & interfaces → types.go
Extract type definitions and interfaces into a dedicated `types.go` in the same package.

## 2. Constants & enums → constants.go
Extract `const` blocks and iota enums into `constants.go` in the same package.

## 3. Helper functions → helpers.go
Extract unexported helper functions into `helpers.go` in the same package.

## 4. Test helpers → helpers_test.go
Extract shared test fixtures and helpers into `helpers_test.go`.

## 5. SQL/schema → schema.go or queries.go
Extract SQL strings and schema DDL into dedicated files.
