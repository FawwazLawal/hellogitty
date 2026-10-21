# Versioning

Every publish to the default branch is a release. It gets the next patch tag and a release page
with downloadable builds. Every so often the owner declares a new version (the minor or major
number), and the count starts again from there.

**Only the owner declares a new version, graduates a codename, or starts a new one.** Nobody drops
"(baby)", bumps a minor or major version, or invents a name on their own initiative. The patch
number moves on its own, one per publish.

## The number in brackets

People read a release as its version and, in brackets, how many updates it has had since that
version began. The bracket number is the tag's patch number.

```
tag        shown as                     what it is
v0.2.0     v0.2.0                       the publish that started 0.2.0
v0.2.1     v0.2.0 (1)                   the first update after it
v0.2.3     v0.2.0 (3)                   the third
v0.3.0     v0.3.0                       the owner declared 0.3.0; the count starts again
```

The tag itself stays plain semantic versioning (`v0.2.3`), because that is what Go and GitHub
read: Go ignores tags with brackets in them, and treats `v0.2.0-3` as older than `v0.2.0`. The
dashboard header, `hellogitty -version` and release page titles all show the bracket form. A
build from source between releases reads, for example, "dev build · after v0.2.0 (3)".

**Publishing a release:**
1. Update `cmd/hellogitty/release.txt` to the new tag.
2. Rename `## Unreleased` in CHANGELOG.md to the new release.
3. Commit, then tag that commit with an annotated tag ("v0.2.4 - Black Bombay (baby)").
4. Push the commit and the tag.

The release workflow (`.github/workflows/release.yml`) tests, builds for macOS, Linux and Windows,
and creates the page titled "v0.2.0 (4) - Black Bombay (baby)". For a tag on a commit older than
the workflow, run it by hand from main with that tag (Actions, release, Run workflow).

A version number is never reused or removed. Go's public mirror keeps every tag that was ever
fetched, so the same number with different code would break installs with a checksum error.

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
