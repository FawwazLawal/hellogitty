# Versioning

Changes land on the default branch continuously. Every so often the owner declares a build a
milestone, and that milestone gets a semantic version tag and a codename.

**Only the owner declares a milestone, graduates a codename, or starts a new one.** Nobody drops
"(baby)", bumps a major version, or invents a name on their own initiative.

## Tags and codenames

- **The tag** is pure semantic versioning, `vMAJOR.MINOR.PATCH` with an optional prerelease such
  as `-beta.1`. It is what Go tools resolve, so
  `go install github.com/FawwazLawal/hellogitty/cmd/hellogitty@v0.1.0` installs that milestone.
- **The codename** is a coat colour and a cat breed, such as Black Bombay. It sits beside the
  number and never replaces it.
- **"(baby)"** is a human label for a codename that has not grown up yet. It appears in release
  titles, in `hellogitty -version`, in the dashboard header and in the changelog. It is never
  part of a tag.

```
tag              v0.1.0
release title    v0.1.0 - Black Bombay (baby)
-version         hellogitty v0.1.0 - Black Bombay (baby)
```

## The codename cycle

A codename owns one major version line. It is born a baby, matures through releases, and grows
up when the owner says so. Growing up and reaching `.0` of its major version are the same event:
the release that drops "(baby)" is `vN.0.0`. Soon after, the owner opens the next codename as a
new baby.

```
Black Bombay (baby)   v0.1.0, v0.2.0, ... v0.9.x       first codename, baby phase
Black Bombay          v1.0.0                            grows up, drops (baby)
Black Bombay          v1.1.0, v1.2.0, ...               same era, still maturing
Calico Blue (baby)    v2.0.0-beta.1, -beta.2, ...       next era begins
Calico Blue           v2.0.0                            grows up
Calico Blue           v2.1.0, ...
```

### Only the first codename gets 0.x

Black Bombay's baby phase is the only one that uses the `0.x` line. `0.x` exists once in a
project's life and semantic versions never go backwards, so every later codename's baby phase
uses prerelease tags of its own major: `v2.0.0-beta.1`, `v2.0.0-beta.2`, and so on. Never a
return to `0.x`. If you are opening a new codename and reach for `v0.1.0`, that number is spent.

### Why this suits Go

`go install ...@latest` skips prereleases. Once Black Bombay grows up, anyone installing with
`@latest` gets the newest stable build and never lands on the next codename's baby by accident.
Trying a baby takes an explicit version, such as `@v2.0.0-beta.1`.

### The cost at each new major: `/vN` in the module path

From major version 2 on, Go requires the major version in the module path. Black Bombay pays
nothing, because Go does not use `/v1`. Opening Calico Blue (major 2) means changing `go.mod` to
`module github.com/FawwazLawal/hellogitty/v2` and rewriting every internal import to the `/v2`
path, and the install line becomes `.../hellogitty/v2/cmd/hellogitty@latest`. Every later
codename repeats this for its own major. Expect an afternoon of import rewriting, and do it in the
same change that opens the new major.

## In the code

`cmd/hellogitty/version.go` holds a table mapping each major version to its codename. The baby
label follows from the version: every `0.x` release, and the prereleases of a later major's
`X.0.0`. A build from a milestone tag reports itself by name; any other build reports itself as a
dev build. Release builds can stamp the version explicitly:

```bash
go build -ldflags "-X main.version=v0.1.0" ./cmd/hellogitty
```

Every milestone is listed in [CHANGELOG.md](CHANGELOG.md).
