import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, ExternalLink, KeyRound, Loader2, Sparkles, Trash2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import api, { formatApiError } from "@/lib/api";
import AiUsage from "./AiUsage";

interface AiSettingsData {
  provider: string;
  has_key: boolean;
  key_hint: string | null;
  model: string | null;
  default_model: string;
  enabled: boolean;
  last_check_at: string | null;
  last_check_ok: boolean | null;
  last_error: string | null;
  providers: Array<{ id: string; name: string; key_url: string; default_model: string; semantic: boolean }>;
}

/**
 * Settings > Yapay Zeka: the user's own AI provider key. The key is sent once,
 * stored encrypted on the server and never shown again (only its last 4 chars).
 * A new key is checked with a real call before it is turned on.
 */
export default function AiSettings() {
  const [data, setData] = useState<AiSettingsData | null>(null);
  const [key, setKey] = useState("");
  const [model, setModel] = useState("");
  const [providerId, setProviderId] = useState("gemini");
  const [busy, setBusy] = useState<"save" | "test" | "toggle" | "delete" | null>(null);

  const apply = (d: AiSettingsData) => {
    setData(d);
    setModel(d.model || "");
    setProviderId(d.provider);
  };

  useEffect(() => {
    api.get<AiSettingsData>("/ai/settings").then((r) => apply(r.data)).catch((e) => toast.error(formatApiError(e)));
  }, []);

  async function save(body: Record<string, unknown>, kind: "save" | "toggle") {
    setBusy(kind);
    try {
      const { data: r } = await api.put<{ settings: AiSettingsData; test_error: string | null }>("/ai/settings", body);
      apply(r.settings);
      setKey("");
      if (r.test_error) toast.error(`Anahtar doğrulanamadı: ${r.test_error}`);
      else if (r.settings.enabled) toast.success("Yapay zeka etkin");
      else toast.success("Kaydedildi");
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setBusy(null);
    }
  }

  async function test() {
    setBusy("test");
    try {
      const { data: r } = await api.post<{ ok: boolean; error?: string; enabled_now?: boolean; settings: AiSettingsData }>("/ai/settings/test");
      apply(r.settings);
      if (!r.ok) toast.error(r.error || "Bağlantı başarısız");
      else if (r.enabled_now) toast.success("Bağlantı çalışıyor, yapay zeka etkinleştirildi");
      else if (!r.settings.enabled) toast.success("Bağlantı çalışıyor. Yapay zeka şu an kapalı; kullanmak için etkinleştir.");
      else toast.success("Bağlantı çalışıyor");
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!window.confirm("Kayıtlı API anahtarı silinsin mi? Yakalamalar kural tabanlı işlenmeye döner.")) return;
    setBusy("delete");
    try {
      const { data: r } = await api.delete<AiSettingsData>("/ai/settings");
      apply(r);
      toast.success("Anahtar silindi");
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setBusy(null);
    }
  }

  if (!data) return <div className="text-sm text-muted-foreground">Yükleniyor…</div>;
  const provider = data.providers.find((p) => p.id === providerId) || data.providers[0];
  const switching = providerId !== data.provider && data.has_key;

  return (
    <div className="space-y-5 max-w-2xl" data-testid="ai-settings">
      <div>
        <h2 className="font-serif text-xl font-bold flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-primary" /> Yapay Zeka
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Yakalamaları işlemek, Ask Inkwell ve yapay zeka eylemleri için kendi API anahtarını kullan. Anahtar sunucuda şifreli saklanır ve bir daha
          gösterilmez. Anahtar yoksa yakalamalar kural tabanlı işlenir.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-card p-4 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <select
              value={providerId}
              onChange={(e) => {
                setProviderId(e.target.value);
                setModel(e.target.value === data.provider ? data.model || "" : "");
              }}
              className="h-8 rounded-md border border-input bg-background px-2 text-sm font-semibold"
              aria-label="Yapay zeka sağlayıcısı"
              data-testid="ai-provider-select"
            >
              {data.providers.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <div className="mt-1 text-xs text-muted-foreground">
              {switching
                ? "Sağlayıcıyı değiştirmek için bu sağlayıcının anahtarını gir."
                : data.has_key
                  ? <>Kayıtlı anahtar: ••••{data.key_hint}</>
                  : "Henüz anahtar girilmedi"}
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <span className={data.enabled ? "text-emerald-600 dark:text-emerald-400 font-medium" : "text-muted-foreground"}>{data.enabled ? "Etkin" : "Kapalı"}</span>
            <input
              type="checkbox"
              role="switch"
              aria-label="Yapay zekayı etkinleştir"
              className="h-4 w-8 cursor-pointer accent-[hsl(var(--primary))]"
              checked={data.enabled}
              disabled={!data.has_key || busy !== null}
              onChange={(e) => save({ enabled: e.target.checked }, "toggle")}
              data-testid="ai-enabled-toggle"
            />
          </label>
        </div>

        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            save({ provider: provider.id, api_key: key || undefined, model }, "save");
          }}
        >
          <div className="space-y-1">
            <label htmlFor="ai-key" className="text-xs font-medium">{data.has_key ? "Yeni API anahtarı (değiştirmek için)" : "API anahtarı"}</label>
            <div className="relative">
              <KeyRound className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
              <Input
                id="ai-key"
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder={provider.id === "anthropic" ? "sk-ant-…" : provider.id === "openai" ? "sk-…" : "AIza…"}
                className="pl-8 font-mono"
                data-testid="ai-key-input"
              />
            </div>
            <a href={provider.key_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
              {provider.id === "anthropic"
                ? "Anthropic Console'dan anahtar al"
                : provider.id === "openai"
                  ? "OpenAI Platform'dan anahtar al"
                  : "Google AI Studio'dan ücretsiz anahtar al"} <ExternalLink className="w-3 h-3" />
            </a>
          </div>
          <div className="space-y-1">
            <label htmlFor="ai-model" className="text-xs font-medium">Model (isteğe bağlı)</label>
            <Input id="ai-model" value={model} onChange={(e) => setModel(e.target.value)} placeholder={provider.default_model} className="font-mono" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={busy !== null || (!key.trim() && (switching || model === (data.model || "")))} data-testid="ai-save">
              {busy === "save" && <Loader2 className="w-4 h-4 mr-1 animate-spin" />} {key.trim() ? "Kaydet ve doğrula" : "Kaydet"}
            </Button>
            {data.has_key && (
              <Button type="button" size="sm" variant="outline" onClick={test} disabled={busy !== null} data-testid="ai-test">
                {busy === "test" && <Loader2 className="w-4 h-4 mr-1 animate-spin" />} Bağlantıyı test et
              </Button>
            )}
            {data.has_key && (
              <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={remove} disabled={busy !== null}>
                <Trash2 className="w-4 h-4 mr-1" /> Anahtarı sil
              </Button>
            )}
          </div>
        </form>

        {data.has_key && !data.enabled && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200" data-testid="ai-disabled-notice">
            <span className="flex-1 min-w-0">
              Anahtar kayıtlı ama yapay zeka kapalı. Kapalıyken yakalamalar kural tabanlı işlenir, Ask Inkwell yalnızca ilgili notları listeler.
            </span>
            <Button size="sm" className="h-7 text-xs" onClick={() => save({ enabled: true }, "toggle")} disabled={busy !== null} data-testid="ai-enable-btn">
              {busy === "toggle" && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />} Etkinleştir
            </Button>
          </div>
        )}

        {data.last_check_at && (
          <div className={`flex items-start gap-2 rounded-md px-3 py-2 text-xs ${data.last_check_ok ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-destructive/10 text-destructive"}`}>
            {data.last_check_ok ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <XCircle className="w-4 h-4 shrink-0" />}
            <span>
              {data.last_check_ok ? "Son test başarılı" : `Son test başarısız: ${data.last_error}`} ·{" "}
              {new Date(data.last_check_at).toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" })}
            </span>
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Not içerikleri yalnızca sen yakaladığında, Ask Inkwell'e sorduğunda ya da bir yapay zeka eylemi çalıştırdığında seçtiğin sağlayıcıya gönderilir; parola kilitli
        notlar hiç gönderilmez. Claude'un embedding servisi olmadığı için anlamsal arama Gemini ve OpenAI ile çalışır; Claude ile tam metin ve ilişki araması kullanılır.
        Görsel ve PDF'lerdeki metin (OCR) de bu sağlayıcıyla okunur; ses dosyaları Gemini ya da OpenAI ile yazıya dökülür (Claude ses dökümü yapmaz). Word, PowerPoint ve
        Excel dosyaları sunucuda, yapay zekasız okunur.
      </p>

      <AiUsage />
    </div>
  );
}
