# Security Policy

## Scope

This repository contains reverse-engineering notes, sanitized evidence, and a
synthetic macOS test harness. It does not distribute the inspected proprietary
applications or native service binaries.

## Reporting

Do not open a public issue containing:

- credentials, tokens, private prompts, screenshots, or application content;
- an unpatched vulnerability with practical exploitation details;
- instructions for bypassing TCC, code signing, Authorization Services, user
  approval, or other platform security controls.

Report suspected vulnerabilities to the affected vendor through its official
security channel. Repository-specific problems that do not expose sensitive
details can be filed as ordinary GitHub issues.

## Research Boundary

The included production-action harness is restricted to the synthetic
`com.openai.codex.cualab` application. Contributions must preserve the
fail-closed target validation and must not expand the harness to arbitrary
applications.
