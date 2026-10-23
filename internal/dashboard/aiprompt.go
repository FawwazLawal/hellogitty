package dashboard

import "strings"

// aiPrompt is a prompt to paste into an AI coding assistant, so it can keep HelloGitty in step with
// your projects for you: tracking repositories, watching issues, feeding a pipeline command. It
// names this install's own files, so the assistant doesn't have to guess.
func aiPrompt(about []AboutItem) string {
	get := func(k string) string {
		for _, a := range about {
			if a.Key == k {
				return a.Value
			}
		}
		return ""
	}
	dir, addr := get("Config folder"), get("Dashboard address")
	if addr == "" {
		addr = "http://localhost:7340"
	}
	var b strings.Builder
	b.WriteString("I use HelloGitty, a dashboard that runs on my computer and tracks my GitHub work: my pull requests and issues, repositories I follow, and issues I watch. Help me keep it up to date automatically as I work, so I don't have to do it by hand.\n\n")
	b.WriteString("How HelloGitty is set up here:\n")
	if dir != "" {
		b.WriteString("- Its folder: " + dir + ". Its settings are in hellogitty.json in that folder.\n")
	}
	b.WriteString("- The dashboard and its guide: " + addr + " and " + addr + "/help.\n")
	if s := get("Snapshot file"); s != "" {
		b.WriteString("- " + s + ": every tracked repository's numbers as JSON, rewritten after each check. Read it; don't write it.\n")
	}
	if s := get("Inbox file"); s != "" && s != "not set" {
		b.WriteString("- " + s + ": events about my pull requests and watched issues as JSON (comments, reviews, closes, claims). Read it; don't write it.\n")
	}
	b.WriteString("\nWhat you can change, from that folder:\n")
	b.WriteString("- hellogitty track owner/name, and hellogitty untrack owner/name: start or stop following a repository.\n")
	b.WriteString("- hellogitty watch owner/name 123, hellogitty unwatch owner/name 123, and hellogitty watch to list: watch an issue for someone else claiming it or it closing.\n")
	b.WriteString("- hellogitty.json: \"repos\" (repositories to follow), \"maintain\" (repositories or organisations I maintain), \"repos_file\" (a JSON file of more repositories, re-read on every check), and \"pipeline_command\" (a program that prints each repository's stage as JSON; the README's \"Pipeline stages\" section has the format).\n")
	b.WriteString("\nRules:\n")
	b.WriteString("- Never write a GitHub token into any file. HelloGitty reads it from the GITHUB_TOKEN environment variable.\n")
	b.WriteString("- Don't edit HelloGitty's database or its code. Use the commands above; edit hellogitty.json only for settings the commands don't cover.\n")
	b.WriteString("- HelloGitty only reads GitHub. Don't post, comment or change anything on GitHub for it.\n")
	b.WriteString("- Keep each change small and tell me what you changed and why.\n")
	b.WriteString("\nFirst read the guide and my hellogitty.json. Then propose how to do this, and wait for my yes: [say what you want, for example \"watch every issue I comment on\", \"follow every repository I open a pull request in\", or \"turn my project's task list into a pipeline_command\"].")
	return b.String()
}
