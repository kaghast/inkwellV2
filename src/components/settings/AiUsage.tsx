import React, { useEffect, useState } from "react";
import { BarChart3 } from "lucide-react";
import { aiApi, type AiUsageData } from "@/lib/workspaceApi";

const TASK_LABELS: Record<string, string> = {
  capture: "Yakalama çıkarımı",
  embedding: "Anlamsal dizin",
  ask: "Ask Inkwell",
  review: "Aylık değerlendirme",
  connections: "Beklenmedik bağlantılar",
  file_text: "Dosya metni (OCR)",
  generate: "Diğer",
};

const ACTION_LABELS: Record<string, string> = {
  summarize: "Özetle",
  rewrite: "Yeniden yaz",
  translate: "Çevir",
  explain: "Açıkla",
  extract_tasks: "Görevleri çıkar",
  generate_tags: "Etiket öner",
  outline: "Taslak",
  meeting_notes: "Toplantı notu",
  project_summary: "Proje özeti",
  research_questions: "Araştırma soruları",
  research_insights: "İçgörüler",
  find_connections: "Bağlantılar",
  contradictions: "Çelişkiler",
  compare: "Karşılaştır",
};

export function taskLabel(task: string) {
  if (task.startsWith("action:")) return `Eylem: ${ACTION_LABELS[task.slice(7)] || task.slice(7)}`;
  return TASK_LABELS[task] || task;
}

const fmt = (n: number) => n.toLocaleString("tr-TR");

/** Settings > Yapay Zeka: model calls and tokens of the last 30 days, from ai_runs. */
export default function AiUsage() {
  const [data, setData] = useState<AiUsageData | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    aiApi
      .usage(30)
      .then(setData)
      .catch(() => setError(true));
  }, []);

  if (error) return null;
  const max = Math.max(1, ...(data?.by_day || []).map((d) => d.calls));

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3" data-testid="ai-usage">
      <div className="flex items-center gap-2">
        <BarChart3 className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-semibold">Kullanım · son 30 gün</h3>
      </div>
      {!data ? (
        <p className="text-xs text-muted-foreground">Yükleniyor…</p>
      ) : data.calls === 0 ? (
        <p className="text-xs text-muted-foreground">Bu dönemde yapay zeka çağrısı yapılmadı.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Çağrı" value={fmt(data.calls)} />
            <Stat label="Başarısız" value={fmt(data.failed)} />
            <Stat label="Girdi token" value={fmt(data.input_tokens)} />
            <Stat label="Çıktı token" value={fmt(data.output_tokens)} />
          </div>

          {data.by_day.length > 1 && (
            <div className="flex h-10 items-end gap-px" aria-label="Günlük çağrı sayısı">
              {data.by_day.map((d) => (
                <div
                  key={d.day}
                  className="flex-1 rounded-t-sm bg-primary/60"
                  style={{ height: `${Math.max(6, (d.calls / max) * 100)}%` }}
                  title={`${d.day}: ${d.calls} çağrı, ${fmt(d.tokens)} token`}
                />
              ))}
            </div>
          )}

          <table className="w-full text-xs" data-testid="ai-usage-tasks">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-1 font-medium">İş</th>
                <th className="py-1 text-right font-medium">Çağrı</th>
                <th className="py-1 text-right font-medium">Token (girdi / çıktı)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {data.by_task.map((t) => (
                <tr key={t.task}>
                  <td className="py-1">{taskLabel(t.task)}</td>
                  <td className="py-1 text-right tabular-nums">
                    {fmt(t.calls)}
                    {t.failed > 0 && <span className="text-destructive"> ({t.failed} hata)</span>}
                  </td>
                  <td className="py-1 text-right tabular-nums text-muted-foreground">
                    {fmt(t.input_tokens)} / {fmt(t.output_tokens)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[11px] text-muted-foreground">
            Modeller: {data.by_model.map((m) => `${m.model || m.provider} (${m.calls})`).join(", ")}. Token sayılarını sağlayıcı bildirir; anlamsal dizin çağrıları
            için token bildirilmez. Ücretlendirme sağlayıcının kendi panelinde görünür.
          </p>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-muted/50 px-2.5 py-1.5">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold tabular-nums">{value}</div>
    </div>
  );
}
