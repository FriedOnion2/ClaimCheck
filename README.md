# ClaimCheck

ClaimCheck compares explicit file-change claims in an AI coding assistant's final response with files supplied by the user. It is vendor-neutral: use plain-text or Markdown chat and an output folder from any AI tool. It does not call an AI API, require an account, or upload files.

## Evidence levels

- **Verified**: Git evidence relative to a selected baseline shows the claimed file was added, modified, renamed, or deleted.
- **Artifact present**: the claimed path appears in the supplied AI output files. This proves only that the file was supplied, not that it was written to a target project.
- **Missing / contradicted / unverified**: evidence is absent, conflicts with the claim, or cannot establish it.

Claim extraction is heuristic and considers explicit paths near change verbs. It does not establish semantic correctness, test success, runtime behavior, or deployment. Final chat and detached output files alone cannot prove persistence in an otherwise unprovided project; use the Git-aware CLI for that.

## Web app

Requires Node.js 20 or newer. No install step or third-party dependencies.

```sh
npm start
```

Open `http://127.0.0.1:4173`. Paste the final AI response, select the AI output folder, and run the check. Processing stays in the browser; the local server only serves static app files.

## CLI

```sh
node ./bin/claimcheck.js --chat ./final-response.md --artifacts ./ai-output
```

Compare against a project snapshot and Git baseline:

```sh
node ./bin/claimcheck.js --chat ./final-response.md --artifacts ./ai-output --project ./my-project --base HEAD --json
```

`--base` may be a commit, tag, or branch and must resolve in the project. Without `--base`, the CLI compares to `HEAD`. Untracked non-ignored files are included as additions. Exit codes: `0` no missing/contradicted claims, `1` at least one missing or contradicted claim, `2` invalid arguments or I/O/Git error.

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
