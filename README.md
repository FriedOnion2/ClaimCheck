# ClaimCheck

ClaimCheck compares explicit file-change claims in an AI coding assistant's final response with files supplied by the user. It is vendor-neutral: use plain-text or Markdown chat and an output folder from any AI tool. It does not call an AI API, require an account, or upload files.

## Evidence levels

- **Persisted exact**: SHA-256 of the same-path AI output file matches the current target-project file. This confirms byte-for-byte equality at scan time.
- **Git verified**: Git evidence relative to a selected baseline shows the claimed file was added, modified, renamed, or deleted.
- **Content differs**: the target project contains the claimed path but its current bytes do not match the supplied AI output.
- **Artifact present**: the claimed path appears in the supplied AI output files. This proves only that the file was supplied, not that it was written to a target project.
- **Present but unproven / missing / contradicted / unverified**: evidence is incomplete, absent, conflicts with the claim, or cannot establish it.

Claim extraction is heuristic and considers explicit paths near change verbs. For current-snapshot verification, also select the actual target project folder in the web app, or pass `--project` in the CLI. Hash equality confirms the project contains identical bytes at scan time, but cannot alone prove that this AI wrote them in this session. To establish change attribution, use a pre-change Git baseline. It does not establish semantic correctness, test success, runtime behavior, or deployment.

## Web app

Requires Node.js 20 or newer. No install step or third-party dependencies.

```sh
npm start
```

Open `http://127.0.0.1:4173`. Paste the final AI response, select the AI output folder, and optionally select the actual target project folder for SHA-256 snapshot comparison. Processing stays in the browser; files are read locally and never uploaded.

## CLI

```sh
node ./bin/claimcheck.js --chat ./final-response.md --artifacts ./ai-output
```

Compare against a project snapshot and Git baseline:

```sh
node ./bin/claimcheck.js --chat ./final-response.md --artifacts ./ai-output --project ./my-project --base HEAD --json
```

`--project` computes SHA-256 fingerprints for claimed paths to compare current project files against same-path AI outputs. Files larger than 50 MiB are not hashed. `--base` is optional; when supplied, it must resolve to a commit and enables Git change/deletion evidence relative to that commit. Untracked non-ignored files are included as additions. Exit codes: `0` no missing, contradicted, or content-mismatch claims, `1` at least one such claim, `2` invalid arguments or I/O/Git error.

## Development

```sh
npm test
npm run check
```

## Security and privacy

The web server binds to loopback. The browser app makes no network requests with user content. Avoid exposing the local server to an untrusted network. CLI paths are read-only; ClaimCheck never modifies the project or Git state. See [SECURITY.md](SECURITY.md).

## Design references

The Git-aware mode relies on Git name-status diff output to establish changed paths. Related mature tools include [Git diff](https://git-scm.com/docs/git-diff) and [reviewdog](https://github.com/reviewdog/reviewdog), which integrates review findings with diff context.

## License

MIT. See [LICENSE](LICENSE).
