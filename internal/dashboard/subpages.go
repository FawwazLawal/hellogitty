package dashboard

import (
	"html/template"
	"log"
	"net/http"
	"strings"
)

func (h *Handler) serveReposPage(w http.ResponseWriter, r *http.Request) {
	h.serveSubPage(w, r, h.ReposTemplate, "repospage")
}

func (h *Handler) servePipelinePage(w http.ResponseWriter, r *http.Request) {
	h.serveSubPage(w, r, h.PipelineTemplate, "pipelinepage")
}

func (h *Handler) serveConversationsPage(w http.ResponseWriter, r *http.Request) {
	h.serveSubPage(w, r, h.ConversationsTemplate, "conversationspage")
}

func (h *Handler) serveYourReposPage(w http.ResponseWriter, r *http.Request) {
	h.serveSubPage(w, r, h.YourReposTemplate, "yourrepospage")
}

func (h *Handler) serveWorkPage(w http.ResponseWriter, r *http.Request) {
	h.serveSubPage(w, r, h.WorkTemplate, "workpage")
}

func (h *Handler) serveAlertYourMove(w http.ResponseWriter, r *http.Request) {
	h.serveSubPage(w, r, h.AlertYourMoveTemplate, "alert-your-move")
}

func (h *Handler) serveAlertWatchedClaimed(w http.ResponseWriter, r *http.Request) {
	h.serveSubPage(w, r, h.AlertWatchedClaimedTemplate, "alert-watched-claimed")
}

func (h *Handler) serveAlertWatchedClosed(w http.ResponseWriter, r *http.Request) {
	h.serveSubPage(w, r, h.AlertWatchedClosedTemplate, "alert-watched-closed")
}

func (h *Handler) serveAlertCheckFailed(w http.ResponseWriter, r *http.Request) {
	h.serveSubPage(w, r, h.AlertCheckFailedTemplate, "alert-check-failed")
}

func (h *Handler) serveAlertRepoHealthPage(w http.ResponseWriter, r *http.Request) {
	health := ""
	if strings.HasSuffix(r.URL.Path, "/repo-slow") {
		health = "slow"
	}
	title := "Repo dormant"
	desc := "Repositories with no recent commit activity — they may have gone quiet."
	if health == "slow" {
		title = "Repo slowing"
		desc = "Repositories whose commit frequency has dropped — they may be losing momentum."
	}

	tmpl, err := template.New("index").Funcs(funcs).Parse(h.Template)
	if err == nil && h.AlertRepoHealthTemplate != "" {
		_, err = tmpl.New("alert-repo-health").Parse(h.AlertRepoHealthTemplate)
	}
	if err != nil || h.AlertRepoHealthTemplate == "" {
		log.Printf("dashboard: alert-repo-health template: %v", err)
		http.Error(w, "alert-repo-health template error", http.StatusInternalServerError)
		return
	}
	p, err := h.build()
	if err != nil {
		log.Printf("dashboard: alert-repo-health build: %v", err)
		http.Error(w, "could not read data", http.StatusInternalServerError)
		return
	}
	p.AlertTitle = title
	p.AlertDesc = desc
	target := strings.ToUpper(health)
	if target == "" {
		target = "DORMANT"
	}
	for _, r := range p.Rows {
		if r.Health == target {
			p.HealthRepos = append(p.HealthRepos, r)
		}
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	if err := tmpl.ExecuteTemplate(w, "alert-repo-health", p); err != nil {
		log.Printf("dashboard: render alert-repo-health: %v", err)
	}
}

func (h *Handler) serveSubPage(w http.ResponseWriter, r *http.Request, tplSource, tplName string) {
	tmpl, err := template.New("index").Funcs(funcs).Parse(h.Template)
	if err == nil && tplSource != "" {
		_, err = tmpl.New(tplName).Parse(tplSource)
	}
	if err != nil || tplSource == "" {
		log.Printf("dashboard: %s template: %v", tplName, err)
		http.Error(w, tplName+" template error", http.StatusInternalServerError)
		return
	}
	p, err := h.build()
	if err != nil {
		log.Printf("dashboard: %s build: %v", tplName, err)
		http.Error(w, "could not read data", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	if err := tmpl.ExecuteTemplate(w, tplName, p); err != nil {
		log.Printf("dashboard: render %s: %v", tplName, err)
	}
}
