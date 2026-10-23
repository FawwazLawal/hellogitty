package dashboard

import (
	"html/template"
	"log"
	"net/http"
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
