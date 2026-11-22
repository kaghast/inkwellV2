import React, { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Archive, ArchiveRestore, Layers, Plus, Pencil, Check, X } from "lucide-react";
import PageShell, { Empty, Section } from "@/components/PageShell";
import TypeIcon from "@/components/TypeIcon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import api, { formatApiError } from "@/lib/api";
import { objectPath, wsApi, type Space } from "@/lib/workspaceApi";
import type { Note } from "@/types";

const COLORS = ["#6366f1", "#0ea5e9", "#22c55e", "#f59e0b", "#ef4444", "#ec4899", "#64748b"];

export default function SpacesPage() {
  const { spaceId } = useParams();
  const navigate = useNavigate();
  const { spaces, refreshSpaces, typeById } = useWorkspace();
  const [name, setName] = useState("");
  const [color, setColor] = useState(COLORS[0]);
  const [creating, setCreating] = useState(false);
  const [objects, setObjects] = useState<Note[] | null>(null);
  const [rename, setRename] = useState<string | null>(null);

  const current = spaces.find((s) => s.space_id === spaceId) || null;

  useEffect(() => {
    refreshSpaces();
  }, [refreshSpaces]);

  useEffect(() => {
    if (!spaceId) return setObjects(null);
    setObjects(null);
    api
      .get("/notes", { params: { space_id: spaceId } })
      .then((r) => setObjects(Array.isArray(r.data) ? r.data : r.data.items || []))
      .catch((e) => toast.error(formatApiError(e)));
  }, [spaceId]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      const s = await wsApi.createSpace({ name: name.trim(), color });
      setName("");
      setCreating(false);
      refreshSpaces();
      navigate(`/spaces/${s.space_id}`);
    } catch (err) {
      toast.error(formatApiError(err));
    }
  }

  async function update(s: Space, patch: Partial<Pick<Space, "name" | "archived">>) {
    try {
      await wsApi.updateSpace(s.space_id, patch);
      refreshSpaces();
      setRename(null);
    } catch (err) {
      toast.error(formatApiError(err));
    }
  }

  const active = spaces.filter((s) => !s.archived);
  const archived = spaces.filter((s) => s.archived);

  return (
    <PageShell
      title={current ? current.name : "Bölümler"}
      subtitle={current ? `${current.object_count} nesne` : "Her bölüm kendi nesnelerini tutar. Takım bölümleri ve yetkiler sonraki aşamada gelir."}
      wide
      actions={
        current ? (
          <Button size="sm" variant="outline" onClick={() => navigate("/spaces")}>Tüm bölümler</Button>
        ) : (
          <Button size="sm" onClick={() => setCreating(true)} data-testid="space-create-btn"><Plus className="w-4 h-4 mr-1" /> Yeni bölüm</Button>
        )
      }
    >
      {!current && (
        <>
          {creating && (
            <form onSubmit={create} className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3">
              <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Bölüm adı (ör. İş, Araştırma)" className="h-8 max-w-xs" aria-label="Bölüm adı" />
              <div className="flex gap-1" role="radiogroup" aria-label="Renk">
                {COLORS.map((c) => (
                  <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={c} onClick={() => setColor(c)} className={`h-5 w-5 rounded-full border-2 ${color === c ? "border-foreground" : "border-transparent"}`} style={{ background: c }} />
                ))}
              </div>
              <Button size="sm" type="submit" disabled={!name.trim()}>Oluştur</Button>
              <Button size="sm" type="button" variant="ghost" onClick={() => setCreating(false)}>Vazgeç</Button>
            </form>
          )}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {active.map((s) => (
              <div key={s.space_id} className="group rounded-lg border border-border bg-card p-4">
                <div className="flex items-center gap-2">
                  <span className="h-3 w-3 rounded-full" style={{ background: s.color || "#64748b" }} />
                  {rename === s.space_id ? (
                    <RenameField initial={s.name} onSave={(n) => update(s, { name: n })} onCancel={() => setRename(null)} />
                  ) : (
                    <Link to={`/spaces/${s.space_id}`} className="flex-1 truncate font-medium hover:underline">{s.name}</Link>
                  )}
                  {s.is_default && <span className="text-[10px] text-muted-foreground">Varsayılan</span>}
                </div>
                <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                  <span>{s.object_count} nesne</span>
                  <span className="flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                    <button type="button" className="rounded p-1 hover:bg-muted" aria-label="Yeniden adlandır" onClick={() => setRename(s.space_id)}><Pencil className="w-3.5 h-3.5" /></button>
                    {!s.is_default && (
                      <button type="button" className="rounded p-1 hover:bg-muted" aria-label="Arşivle" onClick={() => update(s, { archived: true })}><Archive className="w-3.5 h-3.5" /></button>
                    )}
                  </span>
                </div>
              </div>
            ))}
          </div>
          {archived.length > 0 && (
            <Section title="Arşiv" className="mt-5">
              <ul className="space-y-1">
                {archived.map((s) => (
                  <li key={s.space_id} className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Layers className="w-3.5 h-3.5" /> <span className="flex-1">{s.name} · {s.object_count} nesne</span>
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => update(s, { archived: false })}><ArchiveRestore className="w-3.5 h-3.5 mr-1" /> Geri al</Button>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </>
      )}

      {spaceId && !current && spaces.length > 0 && <Empty>Bölüm bulunamadı.</Empty>}

      {current && (
        <Section title="Nesneler">
          {objects === null ? (
            <Empty>Yükleniyor…</Empty>
          ) : objects.length === 0 ? (
            <Empty>Bu bölümde henüz nesne yok. Nesne sayfasındaki “Bölüm” seçicisiyle taşıyabilirsin.</Empty>
          ) : (
            <ul className="divide-y divide-border/60">
              {objects.map((n) => {
                const t = typeById(n.note_type_id);
                return (
                  <li key={n.note_id}>
                    <Link to={objectPath(n)} className="flex items-center gap-2.5 rounded-md px-1 py-2 hover:bg-muted/50">
                      <TypeIcon icon={t?.icon} color={t?.color} className="w-4 h-4" />
                      <span className="flex-1 truncate text-sm">{n.title || "Adsız"}</span>
                      <span className="text-[11px] text-muted-foreground">{t?.name}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
      )}
    </PageShell>
  );
}

function RenameField({ initial, onSave, onCancel }: { initial: string; onSave: (v: string) => void; onCancel: () => void }) {
  const [v, setV] = useState(initial);
  return (
    <form
      className="flex flex-1 items-center gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        if (v.trim()) onSave(v.trim());
      }}
    >
      <Input autoFocus value={v} onChange={(e) => setV(e.target.value)} className="h-7" aria-label="Yeni ad" onKeyDown={(e) => e.key === "Escape" && onCancel()} />
      <button type="submit" className="rounded p-1 hover:bg-muted" aria-label="Kaydet"><Check className="w-3.5 h-3.5" /></button>
      <button type="button" className="rounded p-1 hover:bg-muted" aria-label="Vazgeç" onClick={onCancel}><X className="w-3.5 h-3.5" /></button>
    </form>
  );
}
