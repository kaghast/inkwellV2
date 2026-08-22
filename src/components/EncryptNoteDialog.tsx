import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Lock, Unlock, Key, AlertTriangle, Eye, EyeOff, ShieldCheck } from "lucide-react";
import { hashPassword, verifyPassword } from "@/lib/crypto";
import { toast } from "sonner";
import api from "@/lib/api";
import type { Note } from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  note: Note;
  onSuccess: (updatedNote: Note) => void;
}

export default function EncryptNoteDialog({
  open,
  onOpenChange,
  note,
  onSuccess,
}: Props) {
  const isEncrypted = Boolean(note.is_encrypted);

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<"encrypt" | "remove" | "change">(
    isEncrypted ? "remove" : "encrypt"
  );

  const handleEncrypt = async () => {
    if (!password.trim()) {
      toast.error("Lütfen bir parola girin");
      return;
    }
    if (password !== confirmPassword) {
      toast.error("Parolalar birbiriyle eşleşmiyor");
      return;
    }

    setSaving(true);
    try {
      const hash = await hashPassword(password.trim());
      const res = await api.put<Note>(`/notes/${note.note_id}`, {
        is_encrypted: true,
        password_hash: hash,
        change_summary: "Not parola ile şifrelendi",
      });

      toast.success("Not başarıyla şifrelendi");
      onSuccess(res.data);
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Not şifrelenirken hata oluştu");
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveEncryption = async () => {
    if (!currentPassword.trim()) {
      toast.error("Şifreyi kaldırmak için geçerli parolayı girin");
      return;
    }

    setSaving(true);
    try {
      const isValid = await verifyPassword(currentPassword.trim(), note.password_hash || "");
      if (!isValid) {
        toast.error("Girdiğiniz parola hatalı");
        setSaving(false);
        return;
      }

      const res = await api.put<Note>(`/notes/${note.note_id}`, {
        is_encrypted: false,
        password_hash: null,
        change_summary: "Not şifresi kaldırıldı",
      });

      toast.success("Notun şifre koruması kaldırıldı");
      onSuccess(res.data);
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Şifre kaldırılırken hata oluştu");
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    if (!currentPassword.trim()) {
      toast.error("Geçerli parolayı girin");
      return;
    }
    if (!password.trim()) {
      toast.error("Yeni parolayı girin");
      return;
    }
    if (password !== confirmPassword) {
      toast.error("Yeni parolalar eşleşmiyor");
      return;
    }

    setSaving(true);
    try {
      const isValid = await verifyPassword(currentPassword.trim(), note.password_hash || "");
      if (!isValid) {
        toast.error("Geçerli parola hatalı");
        setSaving(false);
        return;
      }

      const newHash = await hashPassword(password.trim());
      const res = await api.put<Note>(`/notes/${note.note_id}`, {
        is_encrypted: true,
        password_hash: newHash,
        change_summary: "Not parolası değiştirildi",
      });

      toast.success("Not parolası başarıyla güncellendi");
      onSuccess(res.data);
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Parola güncellenirken hata oluştu");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md bg-card border-border rounded-lg" data-testid="encrypt-note-dialog">
        <DialogHeader>
          <DialogTitle className="font-serif text-lg flex items-center gap-2">
            {isEncrypted ? (
              <>
                <Key className="w-5 h-5 text-amber-500" />
                <span>Not Şifresi Yönetimi</span>
              </>
            ) : (
              <>
                <Lock className="w-5 h-5 text-primary" />
                <span>Notu Şifrele</span>
              </>
            )}
          </DialogTitle>
        </DialogHeader>

        {isEncrypted && (
          <div className="flex rounded-lg bg-muted/60 p-1 border border-border/60 text-xs mb-2">
            <button
              type="button"
              onClick={() => setMode("remove")}
              className={`flex-1 py-1.5 rounded-md font-medium transition-colors cursor-pointer ${
                mode === "remove"
                  ? "bg-card text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Şifreyi Kaldır
            </button>
            <button
              type="button"
              onClick={() => setMode("change")}
              className={`flex-1 py-1.5 rounded-md font-medium transition-colors cursor-pointer ${
                mode === "change"
                  ? "bg-card text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Şifreyi Değiştir
            </button>
          </div>
        )}

        <div className="space-y-3.5 py-1">
          {(!isEncrypted || mode === "encrypt") && (
            <>
              <div className="p-3 rounded-lg border border-amber-500/30 bg-amber-500/10 flex items-start gap-2.5 text-xs text-amber-800 dark:text-amber-300">
                <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                <span>
                  Not içeriği şifrelendiğinde, doğru parola girilmeden içerik görüntülenemez.
                  Arama motoru ve takvim filtrelerinde not bulunabilir ancak içeriği gizli kalır.
                </span>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">Yeni Parola</label>
                <div className="relative">
                  <Input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Güçlü bir parola belirleyin"
                    className="text-xs pr-8"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">Parolayı Tekrar Girin</label>
                <Input
                  type={showPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Parolanızı doğrulayın"
                  className="text-xs"
                />
              </div>
            </>
          )}

          {isEncrypted && mode === "remove" && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Şifre korumasını kaldırmak için lütfen mevcut not parolasını girin:
              </p>
              <Input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Mevcut parola"
                className="text-xs"
                autoFocus
              />
            </div>
          )}

          {isEncrypted && mode === "change" && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">Mevcut Parola</label>
                <Input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Mevcut parola"
                  className="text-xs"
                  autoFocus
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">Yeni Parola</label>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Yeni parola"
                  className="text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">Yeni Parola Tekrar</label>
                <Input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Yeni parolayı onaylayın"
                  className="text-xs"
                />
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="flex items-center justify-between gap-2 pt-2 border-t border-border/60">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            İptal
          </Button>

          {(!isEncrypted || mode === "encrypt") && (
            <Button
              type="button"
              size="sm"
              onClick={handleEncrypt}
              disabled={!password.trim() || saving}
              className="gap-1.5 cursor-pointer bg-primary text-primary-foreground"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>{saving ? "Şifreleniyor..." : "Notu Şifrele"}</span>
            </Button>
          )}

          {isEncrypted && mode === "remove" && (
            <Button
              type="button"
              size="sm"
              onClick={handleRemoveEncryption}
              disabled={!currentPassword.trim() || saving}
              className="gap-1.5 cursor-pointer bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              <Unlock className="w-3.5 h-3.5" />
              <span>{saving ? "Kaldırılıyor..." : "Şifreyi Kaldır"}</span>
            </Button>
          )}

          {isEncrypted && mode === "change" && (
            <Button
              type="button"
              size="sm"
              onClick={handleChangePassword}
              disabled={!currentPassword.trim() || !password.trim() || saving}
              className="gap-1.5 cursor-pointer"
            >
              <Key className="w-3.5 h-3.5" />
              <span>{saving ? "Kaydediliyor..." : "Parolayı Değiştir"}</span>
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
