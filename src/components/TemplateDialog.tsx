import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { formatApiError } from "@/lib/api";
import { objectPath, wsApi } from "@/lib/workspaceApi";

const META: Record<string, { title: string; description: string }> = {
  meeting: { title: "Toplantı şablonu", description: "Toplantı nesnesi oluşturur; katılımcılar Kişi nesnesi olarak bağlanır (varsa mevcut kişiler kullanılır)." },
  project: { title: "Proje şablonu", description: "Proje nesnesi ve her görev için projeye bağlı bir kart oluşturur." },
  research: { title: "Araştırma şablonu", description: "Araştırma projesi, soru listesi ve projeye bağlı makale nesneleri oluşturur." },
  daily: { title: "Günlük not", description: "Seçilen gün için günlük notu açar; yoksa oluşturur." },
};

const lines = (s: string) => s.split(/\n|,/).map((x) => x.trim()).filter(Boolean);

export default function TemplateDialog() {
  const navigate = useNavigate();
  const { templateKey, openTemplate, templates } = useWorkspace();
  const [title, setTitle] = useState("");
  const [people, setPeople] = useState("");
  const [project, setProject] = useState("");
  const [list, setList] = useState("");
  const [papers, setPapers] = useState("");
  const [goal, setGoal] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (templateKey) {
      setTitle("");
      setPeople("");
      setProject("");
      setList("");
      setPapers("");
      setGoal("");
    }
  }, [templateKey]);

  if (!templateKey) return null;
  const own = templates.find((t) => t.id === templateKey);
  const meta = META[templateKey] || {
    title: own?.name || "Şablon",
    description: own?.description || "Bu şablondan yeni bir nesne oluşturur. Başlığı boş bırakırsan şablondaki başlık kullanılır.",
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const body: Record<string, unknown> = { title: title.trim() || undefined };
      if (templateKey === "meeting") Object.assign(body, { people: lines(people), project: project.trim() || undefined });
      if (templateKey === "project") Object.assign(body, { tasks: lines(list), goal: goal.trim() || undefined });
      if (templateKey === "research") Object.assign(body, { questions: lines(list), papers: lines(papers) });
      const r = await wsApi.applyTemplate(templateKey!, body);
      toast.success(`${r.created.length} nesne oluşturuldu, ${r.relations} ilişki kuruldu`);
      openTemplate(null);
      navigate(objectPath({ slug: r.slug, note_id: r.primary_id }));
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setBusy(false);
    }
  }

  const label = "text-xs font-medium text-foreground";
  return (
    <Dialog open={!!templateKey} onOpenChange={(o) => !o && openTemplate(null)}>
      <DialogContent className="max-w-md" data-testid="template-dialog">
        <DialogHeader>
          <DialogTitle className="font-serif">{meta.title}</DialogTitle>
          <DialogDescription>{meta.description}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          {templateKey !== "daily" && (
            <div className="space-y-1">
              <label className={label} htmlFor="tpl-title">Başlık</label>
              <Input id="tpl-title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus placeholder={templateKey === "research" ? "Araştırma konusu" : "Başlık"} />
            </div>
          )}
          {templateKey === "meeting" && (
            <>
              <div className="space-y-1">
                <label className={label} htmlFor="tpl-people">Katılımcılar</label>
                <Input id="tpl-people" value={people} onChange={(e) => setPeople(e.target.value)} placeholder="Ayşe Yılmaz, Mehmet" />
              </div>
              <div className="space-y-1">
                <label className={label} htmlFor="tpl-project">Bağlı proje (isteğe bağlı)</label>
                <Input id="tpl-project" value={project} onChange={(e) => setProject(e.target.value)} placeholder="Proje adı" />
              </div>
            </>
          )}
          {templateKey === "project" && (
            <div className="space-y-1">
              <label className={label} htmlFor="tpl-goal">Hedef</label>
              <Input id="tpl-goal" value={goal} onChange={(e) => setGoal(e.target.value)} />
            </div>
          )}
          {(templateKey === "project" || templateKey === "research") && (
            <div className="space-y-1">
              <label className={label} htmlFor="tpl-list">{templateKey === "project" ? "Görevler (her satıra bir)" : "Araştırma soruları (her satıra bir)"}</label>
              <Textarea id="tpl-list" rows={4} value={list} onChange={(e) => setList(e.target.value)} />
            </div>
          )}
          {templateKey === "research" && (
            <div className="space-y-1">
              <label className={label} htmlFor="tpl-papers">Makaleler (her satıra bir başlık)</label>
              <Textarea id="tpl-papers" rows={3} value={papers} onChange={(e) => setPapers(e.target.value)} />
            </div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => openTemplate(null)}>Vazgeç</Button>
            <Button type="submit" disabled={busy} data-testid="template-submit">
              {busy && <Loader2 className="w-4 h-4 mr-1 animate-spin" />} Oluştur
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
