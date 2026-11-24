import React, { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { ExternalLink, Library, Loader2, Lock, Plus } from "lucide-react";
import PageShell, { Empty, Section } from "@/components/PageShell";
import MarkdownView from "@/components/MarkdownView";
import QuickLog from "@/components/journal/QuickLog";
import TypeIcon from "@/components/TypeIcon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import api, { formatApiError } from "@/lib/api";
import { taskPatchBody, type TaskState } from "@/lib/tasks";
import { JOURNAL_CHANGED, journalApi, notifyJournalChanged, objectPath, type CollectionDetail, type CollectionSummary } from "@/lib/workspaceApi";

/**
 * Collections: lists that gather around a topic (books to read, ideas, a
 * trip). Each is an object of type "Koleksiyon"; its entries are bullets in
 * the "## Liste" section, and other notes join it with a "parçası" relation.
 */
export default function CollectionsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { noteTypes } = useWorkspace();
  const [list, setList] = useState<CollectionSummary[] | null>(null);
  const [detail, setDetail] = useState<CollectionDetail | null>(null);
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);

  const loadList = useCallback(() => {
    journalApi
      .collections()
      .then(setList)
      .catch((e) => toast.error(formatApiError(e)));
  }, []);
  const loadDetail = useCallback(() => {
    if (!id) return setDetail(null);
    journalApi
      .collection(id)
      .then(setDetail)
      .catch((e) => {
        toast.error(formatApiError(e));
        setDetail(null);
      });
  }, [id]);

  useEffect(() => {
    loadList();
    loadDetail();
    const reload = () => {
      loadList();
      loadDetail();
    };
    window.addEventListener(JOURNAL_CHANGED, reload);
    return () => window.removeEventListener(JOURNAL_CHANGED, reload);
  }, [loadList, loadDetail]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setCreating(true);
    try {
      const c = await journalApi.createCollection({ title: title.trim() });
      setTitle("");
      loadList();
      navigate(`/journal/collections/${c.note_id}`);
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setCreating(false);
    }
  }

  async function toggleTask(index: number, next: boolean | TaskState) {
    if (!detail) return;
    try {
      await api.patch(`/notes/${detail.note_id}/tasks`, taskPatchBody(index, next, detail.content));
      notifyJournalChanged();
    } catch (e) {
      toast.error(formatApiError(e));
      loadDetail();
    }
  }

  async function add(text: string, kind: string) {
    if (!detail) return;
    await journalApi.log({ note_id: detail.note_id, text, kind: kind as any, section: "Liste" });
    notifyJournalChanged();
  }

  const typeName = (tid: string) => noteTypes.find((t) => t.type_id === tid);

  return (
    <PageShell title="Koleksiyonlar" subtitle="Bir konu etrafında toplanan listeler" wide>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.4fr)]">
        <div className="min-w-0 space-y-3">
          <form onSubmit={create} className="flex items-center gap-2" data-testid="collection-create">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Yeni koleksiyon, ör. Okunacak kitaplar" aria-label="Koleksiyon adı" />
            <Button type="submit" size="sm" disabled={creating || !title.trim()}>
              {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            </Button>
          </form>
          {list === null ? (
            <div className="text-sm text-muted-foreground">Yükleniyor…</div>
          ) : list.length === 0 ? (
            <Empty>Henüz koleksiyon yok. Okunacak kitaplar, fikirler ya da bir gezi planı gibi bir liste başlat.</Empty>
          ) : (
            <ul className="space-y-1.5" data-testid="collection-list">
              {list.map((c) => (
                <li key={c.note_id}>
                  <Link
                    to={`/journal/collections/${c.note_id}`}
                    className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 text-sm transition-colors ${
                      c.note_id === id ? "border-primary/40 bg-primary/5" : "border-border bg-card hover:border-primary/30"
                    }`}
                  >
                    <Library className="w-4 h-4 shrink-0 text-teal-600" />
                    <span className="min-w-0 flex-1 truncate font-medium">{c.title}</span>
                    {c.locked && <Lock className="w-3 h-3 text-muted-foreground" />}
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {c.items} öğe{c.open > 0 ? ` · ${c.open} açık` : ""}{c.linked > 0 ? ` · ${c.linked} not` : ""}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="min-w-0">
          {!id ? (
            <Empty>Soldan bir koleksiyon seç ya da yeni bir tane oluştur.</Empty>
          ) : !detail ? (
            <div className="text-sm text-muted-foreground">Yükleniyor…</div>
          ) : (
            <div className="space-y-4">
              <Section
                title={detail.title}
                action={
                  <Link to={objectPath(detail)} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                    Notu aç <ExternalLink className="w-3 h-3" />
                  </Link>
                }
              >
                {detail.locked ? (
                  <Empty>Bu koleksiyon parola kilitli.</Empty>
                ) : (
                  <>
                    <div className="prose-sm max-w-none" data-testid="collection-content">
                      <MarkdownView content={detail.content} onTaskToggle={detail.archived ? undefined : toggleTask} />
                    </div>
                    {!detail.archived && (
                      <div className="mt-3 border-t border-border/60 pt-3">
                        <QuickLog onSubmit={add} kinds={["note", "task", "event"]} placeholder="Listeye ekle…" testId="collection-log" />
                      </div>
                    )}
                  </>
                )}
              </Section>
              <Section title={`Bağlı notlar · ${detail.linked.length}`}>
                {detail.linked.length === 0 ? (
                  <Empty>
                    Bir notu bu koleksiyona bağlamak için notun “İlişkiler” bölümünden “parçası” ilişkisiyle “{detail.title}” seç.
                  </Empty>
                ) : (
                  <ul className="divide-y divide-border/60">
                    {detail.linked.map((n) => {
                      const t = typeName(n.note_type_id);
                      return (
                        <li key={n.note_id}>
                          <Link to={objectPath(n)} className="flex items-center gap-2.5 rounded-md px-1 py-2 hover:bg-muted/50">
                            <TypeIcon icon={t?.icon} color={t?.color} className="w-4 h-4" />
                            <span className="flex-1 truncate text-sm">{n.title}</span>
                            <span className="text-[11px] text-muted-foreground">{t?.name}</span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Section>
            </div>
          )}
        </div>
      </div>
    </PageShell>
  );
}
