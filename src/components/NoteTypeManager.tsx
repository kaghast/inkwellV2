import React, { useState, useEffect } from "react";
import {
  Boxes,
  Plus,
  Edit2,
  Trash2,
  Lock,
  Calendar,
  CheckCircle2,
  Hash,
  Type,
  ChevronDown,
  Info,
  Check,
  X,
  AlertCircle,
  Sparkles,
  Calculator,
  ArrowRight,
  HelpCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import api, { formatApiError } from "@/lib/api";
import { toast } from "sonner";
import type {
  NoteType,
  NoteTypeField,
  NoteParameterType,
  CalculationConfig,
  CalculationOperator,
} from "@/types";
import { PARAMETER_TYPE_LABELS } from "@/components/CustomFieldsRenderer";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

const COLOR_PALETTE = [
  "#3b82f6", // Blue
  "#10b981", // Emerald
  "#8b5cf6", // Purple
  "#f59e0b", // Amber
  "#ec4899", // Pink
  "#06b6d4", // Cyan
  "#ef4444", // Rose
  "#64748b", // Slate
];

interface EditingFieldState {
  id: string;
  name: string;
  type: NoteParameterType;
  optionsStr: string; // Comma separated for dropdown
  calcConfig: CalculationConfig;
  required: boolean;
  placeholder: string;
}

const DEFAULT_CALC_CONFIG: CalculationConfig = {
  fieldAId: "",
  fieldBId: "",
  operator: "-",
  unit: "",
  decimalPlaces: 2,
};

export default function NoteTypeManager() {
  const [noteTypes, setNoteTypes] = useState<NoteType[]>([]);
  const [loading, setLoading] = useState(true);

  // Editor Modal / Panel State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTypeId, setEditingTypeId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState(COLOR_PALETTE[0]);
  const [fields, setFields] = useState<EditingFieldState[]>([]);
  const [saving, setSaving] = useState(false);

  // Fetch all note types
  const fetchNoteTypes = async () => {
    setLoading(true);
    try {
      const { data } = await api.get<NoteType[]>("/note-types");
      setNoteTypes(data);
    } catch (err: any) {
      toast.error(formatApiError(err) || "Not tipleri yüklenemedi");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNoteTypes();
  }, []);

  const openCreateModal = () => {
    setEditingTypeId(null);
    setName("");
    setDescription("");
    setColor(COLOR_PALETTE[0]);
    setFields([
      {
        id: `field_1_${Math.random().toString(36).slice(2, 6)}`,
        name: "",
        type: "text",
        optionsStr: "",
        calcConfig: { ...DEFAULT_CALC_CONFIG },
        required: false,
        placeholder: "",
      },
    ]);
    setIsModalOpen(true);
  };

  const openEditModal = (nt: NoteType) => {
    if (nt.is_default || nt.type_id === "type_plain" || nt.type_id === "type_card" || nt.type_id === "default") {
      toast.error(`Varsayılan not tipi (${nt.name}) silinemez ve değiştirilemez.`);
      return;
    }
    setEditingTypeId(nt.type_id);
    setName(nt.name);
    setDescription(nt.description || "");
    setColor(nt.color || COLOR_PALETTE[0]);
    setFields(
      (nt.fields || []).map((f) => ({
        id: f.id,
        name: f.name,
        type: f.type,
        optionsStr: (f.options || []).join(", "),
        calcConfig: f.calcConfig ? { ...f.calcConfig } : { ...DEFAULT_CALC_CONFIG },
        required: Boolean(f.required),
        placeholder: f.placeholder || "",
      }))
    );
    setIsModalOpen(true);
  };

  const addField = () => {
    setFields((prev) => [
      ...prev,
      {
        id: `field_${prev.length + 1}_${Math.random().toString(36).slice(2, 6)}`,
        name: "",
        type: "text",
        optionsStr: "",
        calcConfig: { ...DEFAULT_CALC_CONFIG },
        required: false,
        placeholder: "",
      },
    ]);
  };

  const removeField = (index: number) => {
    setFields((prev) => prev.filter((_, i) => i !== index));
  };

  const updateField = (index: number, patch: Partial<EditingFieldState>) => {
    setFields((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], ...patch };
      return copy;
    });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Not tipi adı zorunludur");
      return;
    }

    // Validate fields
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      if (!f.name.trim()) {
        toast.error(`${i + 1}. parametrenin adı boş olamaz.`);
        return;
      }

      if (f.type === "dropdown") {
        const opts = f.optionsStr
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        if (opts.length === 0) {
          toast.error(
            `"${f.name}" açılır liste parametresi için en az bir seçenek girmelisiniz (virgülle ayırarak).`
          );
          return;
        }
      }

      if (f.type === "calculation") {
        if (!f.calcConfig.fieldAId || !f.calcConfig.fieldBId) {
          toast.error(
            `"${f.name}" hesaplama parametresi için işlem yapılacak 1. ve 2. parametreleri seçmelisiniz.`
          );
          return;
        }
        if (f.calcConfig.fieldAId === f.calcConfig.fieldBId) {
          toast.error(
            `"${f.name}" hesaplama parametresinde aynı parametre hem 1. hem 2. değer olarak seçilemez.`
          );
          return;
        }
      }
    }

    const payloadFields: NoteTypeField[] = fields.map((f, idx) => ({
      id: f.id || `field_${idx + 1}`,
      name: f.name.trim(),
      type: f.type,
      options:
        f.type === "dropdown"
          ? f.optionsStr
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : undefined,
      calcConfig:
        f.type === "calculation"
          ? {
              fieldAId: f.calcConfig.fieldAId,
              fieldBId: f.calcConfig.fieldBId,
              operator: f.calcConfig.operator || "+",
              unit: f.calcConfig.unit ? f.calcConfig.unit.trim() : undefined,
              decimalPlaces: f.calcConfig.decimalPlaces ?? 2,
            }
          : undefined,
      required: f.required,
      placeholder: f.placeholder.trim() || undefined,
    }));

    setSaving(true);
    try {
      if (editingTypeId) {
        // Update
        const { data } = await api.put<NoteType>(`/note-types/${editingTypeId}`, {
          name: name.trim(),
          description: description.trim() || null,
          color,
          fields: payloadFields,
        });
        toast.success(`"${data.name}" not tipi güncellendi`);
      } else {
        // Create
        const { data } = await api.post<NoteType>("/note-types", {
          name: name.trim(),
          description: description.trim() || null,
          color,
          fields: payloadFields,
        });
        toast.success(`"${data.name}" not tipi oluşturuldu`);
      }
      setIsModalOpen(false);
      await fetchNoteTypes();
    } catch (err: any) {
      toast.error(formatApiError(err) || "Not tipi kaydedilemedi");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (typeId: string, typeName: string) => {
    try {
      await api.delete(`/note-types/${typeId}`);
      toast.success(`"${typeName}" not tipi silindi`);
      await fetchNoteTypes();
    } catch (err: any) {
      toast.error(formatApiError(err) || "Not tipi silinemedi");
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200" data-testid="note-types-tab-content">
      {/* Top Description & Action Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-serif text-2xl font-bold flex items-center gap-2">
            <Boxes className="w-5 h-5 text-primary" strokeWidth={1.5} /> Not Tipleri & Özel Parametreler
          </h2>
          <p className="text-xs text-muted-foreground mt-1 max-w-xl">
            Notlarınıza özel parametreler tanımlayın. Dört işlem veya zamansal fark hesaplama (Hesapla), açılır liste, mantıksal değer, sayı veya datetime alanları ekleyerek notlarınızı özelleştirin.
          </p>
        </div>

        <Button
          onClick={openCreateModal}
          data-testid="create-note-type-btn"
          className="shrink-0 flex items-center gap-2 cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Yeni Not Tipi Tanımla</span>
        </Button>
      </div>

      {/* Info Card */}
      <div className="flex items-start gap-3 p-3.5 rounded-lg bg-secondary/50 border border-border text-xs text-muted-foreground">
        <Info className="w-4 h-4 text-primary shrink-0 mt-0.5" />
        <div>
          <span className="font-semibold text-foreground">Varsayılan Not Tipi Koruması: </span>
          Sistemde yer alan <strong>"Düz Metin"</strong> ve <strong>"Kart"</strong> tipleri silinemez veya yapısı değiştirilemez. Oluşturduğunuz yeni not tiplerini not yazarken veya düzenlerken tek tıkla seçebilirsiniz.
        </div>
      </div>

      {/* Note Types List */}
      {loading ? (
        <div className="py-12 text-center text-xs text-muted-foreground">
          Not tipleri yükleniyor...
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {noteTypes.map((nt) => {
            const isProtected =
              nt.is_default || nt.type_id === "type_plain" || nt.type_id === "type_card" || nt.type_id === "default";
            const isPlainDefault =
              nt.is_default || nt.type_id === "type_plain" || nt.type_id === "default";
            const fieldCount = nt.fields?.length || 0;

            return (
              <div
                key={nt.type_id}
                className={`p-5 rounded-xl border transition-all ${
                  isProtected
                    ? "bg-card/70 border-border/80"
                    : "bg-card border-border hover:border-primary/40 shadow-2xs"
                }`}
                data-testid={`note-type-item-${nt.type_id}`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3.5">
                    <div
                      className="w-9 h-9 rounded-lg flex items-center justify-center text-white shrink-0 shadow-xs"
                      style={{ backgroundColor: nt.color || "#3b82f6" }}
                    >
                      <Boxes className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-serif text-lg font-bold text-foreground">
                          {nt.name}
                        </h3>
                        {isProtected && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-slate-500/10 text-slate-600 dark:text-slate-300 border border-slate-500/20">
                            <Lock className="w-3 h-3" /> Varsayılan (Korumalı)
                          </span>
                        )}
                        {!isProtected && (
                          <span className="text-[11px] font-mono text-muted-foreground bg-muted px-2 py-0.5 rounded">
                            {fieldCount} Parametre
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {nt.description ||
                          (isPlainDefault
                            ? "Standart sade metin ve Markdown notları"
                            : nt.type_id === "type_card"
                            ? "Kanban panosu kartları ve ilişkili notlar"
                            : "Açıklama belirtilmemiş")}
                      </p>
                    </div>
                  </div>

                  {/* Actions */}
                  {!isPlainDefault && (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openEditModal(nt)}
                        data-testid={`edit-note-type-${nt.type_id}`}
                        className="h-8 text-xs cursor-pointer"
                      >
                        <Edit2 className="w-3.5 h-3.5 mr-1" /> Düzenle
                      </Button>

                      {!isProtected && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 text-xs text-destructive hover:text-destructive hover:bg-destructive/10 cursor-pointer"
                              data-testid={`delete-note-type-${nt.type_id}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent className="bg-card border-border">
                            <AlertDialogHeader>
                              <AlertDialogTitle className="font-serif">
                                "{nt.name}" not tipini sil?
                              </AlertDialogTitle>
                              <AlertDialogDescription className="text-xs">
                                Bu not tipi silindiğinde, bu tipi kullanan mevcut notlarınız korunur ancak standart düz metin tipine dönüştürülür. Bu işlem geri alınamaz.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>İptal</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => handleDelete(nt.type_id, nt.name)}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                Sil
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                    </div>
                  )}
                </div>

                {/* Parameters Preview */}
                {!isPlainDefault && nt.fields && nt.fields.length > 0 && (
                  <div className="mt-4 pt-3.5 border-t border-border/60">
                    <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                      Tanımlı Parametreler:
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {nt.fields.map((f, idx) => {
                        const typeInfo = PARAMETER_TYPE_LABELS[f.type] || PARAMETER_TYPE_LABELS.text;
                        const Icon = typeInfo.icon;

                        if (f.type === "calculation" && f.calcConfig) {
                          const paramA = nt.fields.find((p) => p.id === f.calcConfig?.fieldAId);
                          const paramB = nt.fields.find((p) => p.id === f.calcConfig?.fieldBId);
                          const opLabel =
                            f.calcConfig.operator === "+"
                              ? "+"
                              : f.calcConfig.operator === "-"
                              ? "-"
                              : f.calcConfig.operator === "*"
                              ? "×"
                              : f.calcConfig.operator === "/"
                              ? "÷"
                              : f.calcConfig.operator.startsWith("time_diff")
                              ? "Zaman Farkı"
                              : f.calcConfig.operator;

                          return (
                            <div
                              key={f.id || idx}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/25"
                            >
                              <Calculator className="w-3.5 h-3.5 shrink-0 text-emerald-500" />
                              <span className="font-semibold">{f.name}</span>
                              <span className="text-[10px] font-mono opacity-80">
                                ({paramA ? paramA.name : "A"} {opLabel} {paramB ? paramB.name : "B"})
                              </span>
                            </div>
                          );
                        }

                        return (
                          <div
                            key={f.id || idx}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs bg-muted/60 border border-border"
                          >
                            <Icon className="w-3.5 h-3.5 text-primary shrink-0" />
                            <span className="font-medium text-foreground">{f.name}</span>
                            <span className="text-[10px] text-muted-foreground font-mono">
                              ({typeInfo.label.split("(")[0].trim()})
                            </span>
                            {f.required && (
                              <span className="text-[10px] text-amber-500 font-semibold" title="Zorunlu">
                                *
                              </span>
                            )}
                            {f.type === "dropdown" && f.options && f.options.length > 0 && (
                              <span
                                className="text-[10px] text-muted-foreground/80 max-w-[120px] truncate"
                                title={f.options.join(", ")}
                              >
                                [{f.options.join(", ")}]
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Note Type Modal / Form */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-xs">
          <div
            className="bg-card border border-border rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-150"
            data-testid="note-type-modal"
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-muted/30">
              <div className="flex items-center gap-2">
                <Boxes className="w-5 h-5 text-primary" />
                <h3 className="font-serif text-lg font-bold">
                  {editingTypeId ? "Not Tipini Düzenle" : "Yeni Not Tipi Oluştur"}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="text-muted-foreground hover:text-foreground p-1 rounded-md cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Name & Color */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="sm:col-span-2 space-y-1.5">
                  <label className="text-xs font-semibold text-foreground flex items-center gap-1">
                    Not Tipi Adı <span className="text-destructive">*</span>
                  </label>
                  <Input
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Örn: Görev / Süreç Takibi, Fatura & Hesap, Seyahat Planı..."
                    className="h-9 text-xs"
                    data-testid="note-type-name-input"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground">Tema Rengi</label>
                  <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                    {COLOR_PALETTE.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setColor(c)}
                        style={{ backgroundColor: c }}
                        className={`w-6 h-6 rounded-full transition-transform cursor-pointer ${
                          color === c
                            ? "scale-110 ring-2 ring-foreground ring-offset-2 ring-offset-background"
                            : "hover:scale-105 opacity-80"
                        }`}
                      />
                    ))}
                  </div>
                </div>
              </div>

              {/* Description */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground">Açıklama (Opsiyonel)</label>
                <Input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Bu not tipinin kullanım amacını kısaca açıklayın..."
                  className="h-9 text-xs"
                  data-testid="note-type-desc-input"
                />
              </div>

              {/* Dynamic Parameters List */}
              <div className="space-y-4 pt-4 border-t border-border">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-bold text-foreground uppercase tracking-wider flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-primary" /> Not Parametreleri & Veri Alanları
                    </h4>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Bu not tipi seçildiğinde doldurulacak alanları belirleyin.
                    </p>
                  </div>

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addField}
                    data-testid="add-parameter-field-btn"
                    className="h-8 text-xs flex items-center gap-1.5 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" /> Parametre Ekle
                  </Button>
                </div>

                {fields.length === 0 ? (
                  <div className="p-4 text-center rounded-lg border border-dashed border-border text-xs text-muted-foreground">
                    Henüz parametre eklenmedi. Yukarıdaki butona tıklayarak alan tanımlayabilirsiniz.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {fields.map((f, idx) => {
                      // Other candidate fields for calculation
                      const otherFields = fields.filter((_, i) => i !== idx);

                      return (
                        <div
                          key={f.id || idx}
                          className="p-3.5 rounded-lg bg-secondary/40 border border-border/80 space-y-3 relative group"
                          data-testid={`parameter-field-row-${idx}`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[11px] font-mono font-bold text-muted-foreground bg-muted px-2 py-0.5 rounded">
                              #{idx + 1} Parametre
                            </span>

                            <button
                              type="button"
                              onClick={() => removeField(idx)}
                              className="text-muted-foreground hover:text-destructive p-1 rounded transition-colors cursor-pointer"
                              title="Parametreyi Sil"
                              data-testid={`remove-field-btn-${idx}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {/* Parameter Name */}
                            <div className="space-y-1">
                              <label className="text-[11px] font-medium text-foreground">
                                Parametre Adı <span className="text-destructive">*</span>
                              </label>
                              <Input
                                required
                                value={f.name}
                                onChange={(e) => updateField(idx, { name: e.target.value })}
                                placeholder="Örn: Başlangıç Zamanı, Bitiş Zamanı, Toplam Süre..."
                                className="h-8 text-xs"
                                data-testid={`field-name-input-${idx}`}
                              />
                            </div>

                            {/* Parameter Type */}
                            <div className="space-y-1">
                              <label className="text-[11px] font-medium text-foreground">
                                Parametre Türü
                              </label>
                              <select
                                value={f.type}
                                onChange={(e) => {
                                  const newType = e.target.value as NoteParameterType;
                                  // Auto-fill calc default if selecting calculation
                                  let newCalcConfig = { ...f.calcConfig };
                                  if (newType === "calculation" && (!newCalcConfig.fieldAId || !newCalcConfig.fieldBId)) {
                                    if (otherFields.length >= 2) {
                                      newCalcConfig.fieldAId = otherFields[0].id;
                                      newCalcConfig.fieldBId = otherFields[1].id;
                                    } else if (otherFields.length === 1) {
                                      newCalcConfig.fieldAId = otherFields[0].id;
                                    }
                                  }
                                  updateField(idx, { type: newType, calcConfig: newCalcConfig });
                                }}
                                className="w-full h-8 px-2.5 rounded-md border border-border bg-background text-xs text-foreground focus:outline-hidden focus:border-primary cursor-pointer font-medium"
                                data-testid={`field-type-select-${idx}`}
                              >
                                <option value="text">📝 Metin (Kısa Yazı)</option>
                                <option value="number">🔢 Sayısal Değer</option>
                                <option value="datetime">⏰ Datetime (Tarih & Saat)</option>
                                <option value="calculation">🧮 Hesapla (Dört İşlem & Zaman Farkı)</option>
                                <option value="dropdown">🔽 Açılır Liste (Dropdown)</option>
                                <option value="boolean">☑️ Mantıksal (Boolean / Evet-Hayır)</option>
                              </select>
                            </div>
                          </div>

                          {/* Calculation Config Builder */}
                          {f.type === "calculation" && (
                            <div className="p-3 rounded-md bg-card/90 border border-emerald-500/30 space-y-2.5">
                              <div className="flex items-center justify-between">
                                <label className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                                  <Calculator className="w-3.5 h-3.5" />
                                  <span>Hesaplama Kuralı & Formülü</span>
                                </label>
                                <span className="text-[10px] text-muted-foreground">
                                  Mevcut parametreler arasından seçin
                                </span>
                              </div>

                              {otherFields.length < 2 ? (
                                <div className="p-2.5 rounded bg-amber-500/10 border border-amber-500/20 text-xs text-amber-600 dark:text-amber-400 flex items-start gap-2">
                                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                                  <div>
                                    Hesaplama yapabilmek için en az <strong>2 farklı parametre</strong> (örn: Başlangıç Tarihi ve Bitiş Tarihi, ya da Fiyat ve Adet) tanımlanmış olmalıdır.
                                  </div>
                                </div>
                              ) : (
                                <div className="space-y-2">
                                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                    {/* Parameter 1 (Field A) */}
                                    <div className="space-y-1">
                                      <span className="text-[10px] text-muted-foreground block font-medium">
                                        1. Değer (Parametre A):
                                      </span>
                                      <select
                                        value={f.calcConfig.fieldAId}
                                        onChange={(e) =>
                                          updateField(idx, {
                                            calcConfig: { ...f.calcConfig, fieldAId: e.target.value },
                                          })
                                        }
                                        className="w-full h-8 px-2 rounded border border-border bg-background text-xs text-foreground font-medium cursor-pointer"
                                      >
                                        <option value="">— Seçiniz —</option>
                                        {otherFields.map((of) => (
                                          <option key={of.id} value={of.id}>
                                            {of.name || `Parametre (${of.id})`}
                                          </option>
                                        ))}
                                      </select>
                                    </div>

                                    {/* Operator */}
                                    <div className="space-y-1">
                                      <span className="text-[10px] text-muted-foreground block font-medium">
                                        İşlem Türü:
                                      </span>
                                      <select
                                        value={f.calcConfig.operator}
                                        onChange={(e) =>
                                          updateField(idx, {
                                            calcConfig: {
                                              ...f.calcConfig,
                                              operator: e.target.value as CalculationOperator,
                                            },
                                          })
                                        }
                                        className="w-full h-8 px-2 rounded border border-border bg-background text-xs text-foreground font-medium cursor-pointer"
                                      >
                                        <optgroup label="⏰ Tarih & Zaman İşlemleri">
                                          <option value="time_diff_auto">
                                            Zaman Farkı (Otomatik - Gün/Saat/Dk)
                                          </option>
                                          <option value="time_diff_hours">
                                            Saat Cinsinden Fark (Saat)
                                          </option>
                                          <option value="time_diff_days">
                                            Gün Cinsinden Fark (Gün)
                                          </option>
                                          <option value="time_diff_minutes">
                                            Dakika Cinsinden Fark (Dakika)
                                          </option>
                                        </optgroup>
                                        <optgroup label="🔢 Sayısal Dört İşlem">
                                          <option value="+">Toplama (+)</option>
                                          <option value="-">Çıkarma (-)</option>
                                          <option value="*">Çarpma (×)</option>
                                          <option value="/">Bölme (÷)</option>
                                        </optgroup>
                                      </select>
                                    </div>

                                    {/* Parameter 2 (Field B) */}
                                    <div className="space-y-1">
                                      <span className="text-[10px] text-muted-foreground block font-medium">
                                        2. Değer (Parametre B):
                                      </span>
                                      <select
                                        value={f.calcConfig.fieldBId}
                                        onChange={(e) =>
                                          updateField(idx, {
                                            calcConfig: { ...f.calcConfig, fieldBId: e.target.value },
                                          })
                                        }
                                        className="w-full h-8 px-2 rounded border border-border bg-background text-xs text-foreground font-medium cursor-pointer"
                                      >
                                        <option value="">— Seçiniz —</option>
                                        {otherFields.map((of) => (
                                          <option key={of.id} value={of.id}>
                                            {of.name || `Parametre (${of.id})`}
                                          </option>
                                        ))}
                                      </select>
                                    </div>
                                  </div>

                                  {/* Result Unit / Suffix */}
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 border-t border-border/50">
                                    <div className="space-y-1">
                                      <span className="text-[10px] text-muted-foreground block">
                                        Sonuç Birimi / Sonek (Opsiyonel):
                                      </span>
                                      <Input
                                        value={f.calcConfig.unit || ""}
                                        onChange={(e) =>
                                          updateField(idx, {
                                            calcConfig: { ...f.calcConfig, unit: e.target.value },
                                          })
                                        }
                                        placeholder="Örn: TL, saat, gün, adet, %"
                                        className="h-7 text-xs"
                                      />
                                    </div>

                                    {/* Formula Preview Box */}
                                    <div className="flex flex-col justify-end">
                                      <div className="text-[11px] font-mono p-1.5 rounded bg-secondary/80 border border-border flex items-center gap-1.5 truncate">
                                        <span className="text-muted-foreground font-sans text-[10px]">
                                          Özet:
                                        </span>
                                        <span className="font-bold text-foreground">
                                          {otherFields.find((o) => o.id === f.calcConfig.fieldAId)?.name ||
                                            "Parametre A"}
                                        </span>
                                        <span className="text-primary font-bold">
                                          {f.calcConfig.operator === "+"
                                            ? "+"
                                            : f.calcConfig.operator === "-"
                                            ? "-"
                                            : f.calcConfig.operator === "*"
                                            ? "×"
                                            : f.calcConfig.operator === "/"
                                            ? "÷"
                                            : "→ Fark →"}
                                        </span>
                                        <span className="font-bold text-foreground">
                                          {otherFields.find((o) => o.id === f.calcConfig.fieldBId)?.name ||
                                            "Parametre B"}
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}

                          {/* Dropdown Options Input */}
                          {f.type === "dropdown" && (
                            <div className="p-2.5 rounded-md bg-card/80 border border-border/80 space-y-1.5">
                              <label className="text-[11px] font-medium text-foreground flex items-center justify-between">
                                <span>
                                  Dropdown Seçenekleri (Virgül ile ayırın) <span className="text-destructive">*</span>
                                </span>
                                <span className="text-[10px] text-muted-foreground">
                                  Örn: Düşük, Orta, Yüksek, Kritik
                                </span>
                              </label>
                              <Input
                                required
                                value={f.optionsStr}
                                onChange={(e) => updateField(idx, { optionsStr: e.target.value })}
                                placeholder="Seçenek 1, Seçenek 2, Seçenek 3..."
                                className="h-8 text-xs"
                                data-testid={`field-options-input-${idx}`}
                              />
                              {/* Preview Chips */}
                              {f.optionsStr.trim() && (
                                <div className="flex flex-wrap gap-1 pt-1">
                                  {f.optionsStr
                                    .split(",")
                                    .map((s) => s.trim())
                                    .filter(Boolean)
                                    .map((opt, i) => (
                                      <span
                                        key={i}
                                        className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium"
                                      >
                                        {opt}
                                      </span>
                                    ))}
                                </div>
                              )}
                            </div>
                          )}

                          {/* Optional Placeholder & Required Flag */}
                          {f.type !== "calculation" && (
                            <div className="flex items-center justify-between pt-1 text-xs">
                              <label className="flex items-center gap-1.5 cursor-pointer text-muted-foreground hover:text-foreground">
                                <input
                                  type="checkbox"
                                  checked={f.required}
                                  onChange={(e) => updateField(idx, { required: e.target.checked })}
                                  className="h-3.5 w-3.5 rounded border-border text-primary cursor-pointer"
                                />
                                <span className="text-[11px]">Zorunlu alan</span>
                              </label>

                              {f.type === "text" || f.type === "number" ? (
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[11px] text-muted-foreground">İpucu Metni:</span>
                                  <input
                                    type="text"
                                    value={f.placeholder}
                                    onChange={(e) => updateField(idx, { placeholder: e.target.value })}
                                    placeholder="Örn: 0.00 veya Açıklama..."
                                    className="h-6 px-2 text-[11px] bg-background border border-border rounded max-w-[140px]"
                                  />
                                </div>
                              ) : null}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Modal Footer */}
              <div className="flex items-center justify-end gap-2 pt-4 border-t border-border">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setIsModalOpen(false)}
                  disabled={saving}
                >
                  İptal
                </Button>
                <Button
                  type="submit"
                  disabled={saving}
                  data-testid="save-note-type-submit-btn"
                  className="cursor-pointer"
                >
                  {saving
                    ? "Kaydediliyor..."
                    : editingTypeId
                    ? "Değişiklikleri Kaydet"
                    : "Not Tipini Oluştur"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
