# ClaimCheck

ClaimCheck compares the user's original request with an AI coding assistant's final response and the files it supplied. It creates a requirement checklist from lines and sentences, identifies which items have textual clues in the final response, checks explicit file-change claims against supplied files and an optional project snapshot, and generates a copy-ready prompt asking the AI to inspect and fix the real project. It works with any AI vendor and does not call an AI API or upload user content.

## Evidence levels

- **Persisted exact**: SHA-256 of the same-path AI output file matches the current target-project file. This confirms byte-for-byte equality at scan time.
- **Git verified**: Git evidence relative to a selected baseline shows the claimed file was added, modified, renamed, or deleted.
- **Content differs**: the target project contains the claimed path but its current bytes do not match the supplied AI output.
- **Artifact present**: the claimed path appears in the supplied AI output files. This proves only that the file was supplied, not that it was written to a target project.
- **Present but unproven / missing / contradicted / unverified**: evidence is incomplete, absent, conflicts with the claim, or cannot establish it.

Requirement splitting and text matching are heuristic. “Mentioned” means only that words overlap with the final response; it is not a completion verdict. The app cannot autonomously prove semantic behavior, test success, or execution identity. It highlights missing textual references and file-evidence issues so the user can pass the generated repair prompt back to the AI, which should inspect the real project and run appropriate checks. For persistence evidence, select the actual target project folder. Hash equality confirms identical bytes at scan time, not who wrote them; a pre-change Git baseline can show changes but not authorship.

## Web app

Requires Node.js 20 or newer. No install step or third-party dependencies.

```sh
npm start
```

Open `http://127.0.0.1:4173`. Paste the original user request and AI's final response, select the AI output folder, and preferably select the actual target project folder for SHA-256 snapshot comparison. Review the requirements and file evidence, then copy the generated repair prompt back into the AI conversation. Processing stays in the browser; files are read locally and never uploaded.

## CLI

```sh
node ./bin/claimcheck.js --request ./user-request.md --chat ./final-response.md --artifacts ./ai-output
```

Compare against a project snapshot and Git baseline:

```sh
node ./bin/claimcheck.js --request ./user-request.md --chat ./final-response.md --artifacts ./ai-output --project ./my-project --base HEAD --json
```

`--request` is required and is included in the JSON report's copy-ready `repairPrompt`. `--project` computes SHA-256 fingerprints for claimed paths to compare current project files against same-path AI outputs. Files larger than 50 MiB are not hashed. `--base` is optional; when supplied, it must resolve to a commit and enables Git change/deletion evidence relative to that commit. Untracked non-ignored files are included as additions. Exit codes: `0` no missing, contradicted, or content-mismatch file claims, `1` at least one such claim, `2` invalid arguments or I/O/Git error.

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
