import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import PageShell from "@/components/PageShell";
import { Button } from "@/components/ui/button";
import { formatApiError } from "@/lib/api";
import { saasApi, ROLE_LABEL } from "@/lib/saasApi";

/** /invite/:token — join a team workspace with a one-time link. */
export default function InvitePage() {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const [info, setInfo] = useState<Awaited<ReturnType<typeof saasApi.invitation>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    saasApi
      .invitation(token)
      .then(setInfo)
      .catch((e) => setError(formatApiError(e)));
  }, [token]);

  async function accept() {
    setBusy(true);
    try {
      await saasApi.acceptInvitation(token);
      toast.success("Çalışma alanına katıldın");
      navigate("/settings?tab=team");
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageShell title="Davet" subtitle="Ekip çalışma alanına katıl">
      <div className="max-w-md space-y-4 rounded-xl border border-border bg-card p-5" data-testid="invite-page">
        {error && <p className="text-sm text-destructive">{error}</p>}
        {!error && !info && <p className="text-sm text-muted-foreground">Yükleniyor…</p>}
        {info && (
          <>
            <p className="text-sm">
              {info.invited_by ? <b>{info.invited_by}</b> : "Bir üye"} seni <b>{info.workspace_name}</b> çalışma alanına <b>{ROLE_LABEL[info.role] || info.role}</b> olarak davet etti.
            </p>
            {info.already_member ? (
              <p className="text-sm text-muted-foreground">Zaten bu çalışma alanının üyesisin.</p>
            ) : !info.email_matches ? (
              <p className="text-sm text-destructive">Bu davet {info.email} adresine gönderildi. Katılmak için o adresle giriş yap.</p>
            ) : (
              <Button onClick={accept} disabled={busy} data-testid="invite-accept">
                Katıl
              </Button>
            )}
            <p className="text-[11px] text-muted-foreground">Bağlantı {new Date(info.expires_at).toLocaleDateString("tr-TR")} tarihine kadar geçerli.</p>
          </>
        )}
      </div>
    </PageShell>
  );
}
