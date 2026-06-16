# Backlog — club-draw

진행 중이 아닌 작업 큐. 스프린트 시작 시 `tasks.md`로 이동(스키마는 진행 중에만 존재).

## Features

## Bugs

## Tech debt

- [constraint] `encodeBackup` output stability — no snapshot/deterministic-seed assertion. `JSON.stringify` key order is V8-deterministic in practice but not spec-guaranteed; a small fixed-input snapshot test would cement the contract (source: PR #11 review P3) — test/backup.test.ts

## Ideas
