import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Copy, Loader2, Plus, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import api, { formatApiError } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { saasApi, ROLE_LABEL, formatLimit, type WorkspaceDetail, type WorkspaceSummary, type TeamObject } from "@/lib/saasApi";

const INVITE_ROLES = ["editor", "commenter", "viewer", "admin"];

/** Settings > Ekip: team workspaces, members, roles, invitations and shared objects. */
export default function TeamSettings() {
  const { user } = useAuth();
  const [list, setList] = useState<WorkspaceSummary[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<WorkspaceDetail | null>(null);
  const [objects, setObjects] = useState<TeamObject[]>([]);
  const [newName, setNewName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("editor");
  const [lastLink, setLastLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [noteTitle, setNoteTitle] = useState("");

  const loadList = useCallback(() => {
    saasApi
      .workspaces()
      .then((ws) => {
        setList(ws);
        setSelected((cur) => cur || ws.find((w) => w.kind === "team")?.workspace_id || null);
      })
      .catch((e) => toast.error(formatApiError(e)));
  }, []);

  const loadDetail = useCallback(() => {
    if (!selected) return setDetail(null);
    saasApi.workspace(selected).then(setDetail).catch((e) => toast.error(formatApiError(e)));
    saasApi.objects(selected).then(setObjects).catch(() => setObjects([]));
  }, [selected]);

  useEffect(loadList, [loadList]);
  useEffect(loadDetail, [loadDetail]);

  async function run(fn: () => Promise<unknown>, ok?: string) {
    setBusy(true);
    try {
      await fn();
      if (ok) toast.success(ok);
      loadDetail();
      loadList();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setBusy(false);
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setBusy(true);
    try {
      const ws = await saasApi.createWorkspace(newName.trim());
      setNewName("");
      toast.success("Ekip çalışma alanı oluşturuldu");
      setSelected(ws.workspace_id);
      loadList();
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setBusy(false);
    }
  }

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    if (!detail) return;
    setBusy(true);
    try {
      const r = await saasApi.invite(detail.workspace_id, inviteEmail.trim(), inviteRole);
      const link = `${window.location.origin}${r.path}`;
      setLastLink(link);
      setInviteEmail("");
      try {
        await navigator.clipboard.writeText(link);
        toast.success("Davet bağlantısı kopyalandı; davet ettiğin kişiyle paylaş.");
      } catch {
        toast.success("Davet oluşturuldu; bağlantıyı aşağıdan kopyala.");
      }
      loadDetail();
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setBusy(false);
    }
  }

  async function newTeamNote(e: React.FormEvent) {
    e.preventDefault();
    if (!detail || !noteTitle.trim()) return;
    const space = detail.spaces.find((s) => s.is_default) || detail.spaces[0];
    await run(async () => {
      await api.post("/notes", { title: noteTitle.trim(), content: "", space_id: space?.space_id });
      setNoteTitle("");
    }, "Ortak not oluşturuldu");
  }

  if (!list) return <div className="text-sm text-muted-foreground">Yükleniyor…</div>;
  const teams = list.filter((w) => w.kind === "team");

  return (
    <div className="space-y-6" data-testid="team-settings">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Users className="h-5 w-5 text-primary" /> Ekip
        </h2>
        <p className="text-sm text-muted-foreground">
          Ekip çalışma alanındaki notları üyeler rollerine göre görür ve düzenler. Kişisel çalışma alanın hiçbir zaman paylaşılmaz.
        </p>
      </div>

      <form onSubmit={create} className="flex flex-wrap items-end gap-2">
        <div className="flex-1 space-y-1">
          <Label htmlFor="team-name">Yeni ekip çalışma alanı</Label>
          <Input id="team-name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Örn. Ürün ekibi" maxLength={80} data-testid="team-name" />
        </div>
        <Button type="submit" size="sm" disabled={busy || newName.trim().length < 2} data-testid="team-create">
          <Plus className="mr-1 h-4 w-4" /> Oluştur
        </Button>
      </form>

      {teams.length === 0 ? (
        <p className="text-sm text-muted-foreground">Henüz bir ekip çalışma alanın yok.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {teams.map((w) => (
            <button
              key={w.workspace_id}
              type="button"
              onClick={() => setSelected(w.workspace_id)}
              className={`rounded-full border px-3 py-1 text-xs ${selected === w.workspace_id ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card"}`}
              data-testid="team-chip"
            >
              {w.name} · {ROLE_LABEL[w.role] || w.role} · {w.members} üye
            </button>
          ))}
        </div>
      )}

      {detail && detail.kind === "team" && (
        <div className="space-y-5 rounded-xl border border-border bg-card p-4" data-testid="team-detail">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-base font-semibold">{detail.name}</h3>
            <span className="text-xs text-muted-foreground">
              Paket: {detail.plan.name} · Üye sınırı: {formatLimit(detail.plan.limits.members)} ·{" "}
              <Link to={`/settings?tab=billing&workspace=${detail.workspace_id}`} className="text-primary hover:underline">
                Paketi yönet
              </Link>
            </span>
          </div>

          <section className="space-y-2">
            <h4 className="text-sm font-semibold">Üyeler</h4>
            <ul className="divide-y divide-border/60 text-sm">
              {detail.members.map((m) => (
                <li key={m.user_id} className="flex flex-wrap items-center gap-2 py-2" data-testid="team-member">
                  <span className="min-w-0 flex-1 truncate">
                    {m.name} {m.email && <span className="text-xs text-muted-foreground">· {m.email}</span>}
                  </span>
                  {detail.can_manage && m.role !== "owner" ? (
                    <select
                      className="h-7 rounded-md border border-border bg-background px-1 text-xs"
                      value={m.role}
                      onChange={(e) => run(() => saasApi.setRole(detail.workspace_id, m.user_id, e.target.value), "Rol güncellendi")}
                      aria-label={`${m.name} rolü`}
                    >
                      {INVITE_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABEL[r]}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-xs text-muted-foreground">{ROLE_LABEL[m.role] || m.role}</span>
                  )}
                  {detail.can_manage && m.role !== "owner" && (
                    <Button size="sm" variant="ghost" className="h-7 px-2" title="Çıkar" onClick={() => run(() => saasApi.removeMember(detail.workspace_id, m.user_id), "Üye çıkarıldı")}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            {detail.role !== "owner" && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const myId = (user as any)?.user_id as string | undefined;
                  if (myId && confirm("Bu çalışma alanından ayrılmak istediğine emin misin?")) {
                    run(async () => {
                      await saasApi.removeMember(detail.workspace_id, myId);
                      setSelected(null);
                    }, "Çalışma alanından ayrıldın");
                  }
                }}
              >
                Ayrıl
              </Button>
            )}
          </section>

          {detail.can_manage && (
            <section className="space-y-2">
              <h4 className="text-sm font-semibold">Davet et</h4>
              <form onSubmit={invite} className="flex flex-wrap items-end gap-2">
                <Input type="email" required value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="e-posta" className="h-8 max-w-xs" data-testid="invite-email" />
                <select className="h-8 rounded-md border border-border bg-background px-2 text-sm" value={inviteRole} onChange={(e) => setInviteRole(e.target.value)} aria-label="Rol">
                  {INVITE_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </option>
                  ))}
                </select>
                <Button type="submit" size="sm" disabled={busy} data-testid="invite-send">
                  Davet bağlantısı oluştur
                </Button>
              </form>
              <p className="text-[11px] text-muted-foreground">E-posta gönderimi yok: bağlantıyı davet ettiğin kişiye sen iletirsin. Bağlantı 7 gün geçerli ve yalnızca o e-posta adresiyle açılan hesapta çalışır.</p>
              {lastLink && (
                <div className="flex items-center gap-2 rounded-md bg-muted/60 px-2 py-1 text-xs">
                  <code className="min-w-0 flex-1 truncate" data-testid="invite-link">{lastLink}</code>
                  <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => navigator.clipboard.writeText(lastLink).then(() => toast.success("Kopyalandı"))}>
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
              {detail.invitations.length > 0 && (
                <ul className="text-xs">
                  {detail.invitations.map((i) => (
                    <li key={i.invitation_id} className="flex items-center gap-2 py-1">
                      <span className="flex-1">
                        {i.email} · {ROLE_LABEL[i.role]} · {new Date(i.expires_at).toLocaleDateString("tr-TR")} tarihine kadar
                      </span>
                      <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => run(() => saasApi.revokeInvite(detail.workspace_id, i.invitation_id), "Davet iptal edildi")}>
                        İptal
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          <section className="space-y-2">
            <h4 className="text-sm font-semibold">Ortak notlar</h4>
            {detail.can_write && (
              <form onSubmit={newTeamNote} className="flex gap-2">
                <Input value={noteTitle} onChange={(e) => setNoteTitle(e.target.value)} placeholder="Yeni ortak not başlığı" className="h-8 max-w-sm" data-testid="team-note-title" />
                <Button type="submit" size="sm" disabled={busy || !noteTitle.trim()} data-testid="team-note-create">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Ekle"}
                </Button>
              </form>
            )}
            {objects.length === 0 ? (
              <p className="text-xs text-muted-foreground">Bu çalışma alanında henüz not yok.</p>
            ) : (
              <ul className="divide-y divide-border/60 text-sm" data-testid="team-objects">
                {objects.map((o) => (
                  <li key={o.note_id} className="flex items-center gap-2 py-1.5">
                    <Link to={`/note/${o.slug || o.note_id}`} className="min-w-0 flex-1 truncate hover:underline">
                      {o.title}
                    </Link>
                    <span className="text-[11px] text-muted-foreground">
                      {o.type_name} · {o.mine ? "sen" : o.author || "üye"} · {new Date(o.updated_at).toLocaleDateString("tr-TR")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
