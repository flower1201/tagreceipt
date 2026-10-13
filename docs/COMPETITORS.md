# Competitors & differentiation

Checked 2026-10-13.

| Tool | What it solves | TagReceipt wedge |
|------|----------------|------------------|
| `gh release verify` | Cryptographic attestation for release assets | TagReceipt audits **Tag→Commit→CI→Release consistency** and emits an offline receipt; it does **not** claim attestation |
| semantic-release | Automates version bumps and publishing | Post-hoc audit, not a releaser |
| softprops/action-gh-release | Creates GitHub Releases from Actions | Creator, not auditor |

TagReceipt explicitly marks asset provenance as **NOT VERIFIED** unless a separate attestation tool is used.
