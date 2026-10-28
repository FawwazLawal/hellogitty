# Contributing to HelloGitty

## Prerequisites

- **Go 1.26.9+** (see `go.mod`)
- **Git**
- A GitHub personal access token (or `gh auth login`)

## Getting started

```bash
git clone https://github.com/FawwazLawal/hellogitty.git
cd hellogitty

# Create your config — list the repos you want to monitor
cp hellogitty.example.json hellogitty.json
# Edit hellogitty.json: add your repos, adjust interval if needed

# Build and run
go build -o hellogitty ./cmd/hellogitty
./start.sh
```

`start.sh` handles the GitHub token, builds from source, starts the server, and opens the dashboard at `localhost:7340`.

## Development workflow

1. Branch from `dev`:
   ```bash
   git checkout dev && git pull
   git checkout -b your-branch-name
   ```
2. Make your changes.
3. Run tests and vet:
   ```bash
   go test ./...
   go vet ./...
   ```
4. Open a pull request targeting **`dev`**. Keep PRs focused — one issue or feature per PR.

The `main` branch is for releases only. All work targets `dev`.

## Code style

- **Go**: standard formatting (`gofmt`). Run it before committing.
- **Web templates**: `html/template` in the `web/` directory.
- **CSS**: custom properties for theming — define colors and spacing as variables, not hard-coded values.

## What NOT to submit

- `local/`, `notes/`, or anything in `.gitignore`
- Generated files (`*.db`, `*.log`, `snapshot.json`)
- Secrets, tokens, or your personal `hellogitty.json`

## Reporting issues

Open an issue on the GitHub repository. Include what you expected, what happened, and steps to reproduce.

## License

This project is licensed under the Business Source License 1.1. See [LICENSE](LICENSE) for details.
