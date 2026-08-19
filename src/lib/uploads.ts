import api from "@/lib/api";

export interface UploadResult {
  url: string;
  file_id?: string;
  name?: string;
  size?: number;
}

export async function uploadImage(file: File): Promise<UploadResult> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("image", file);

  try {
    const { data } = await api.post<any>("/upload", formData, {
      headers: {
        "Content-Type": "multipart/form-data",
      },
    });

    const url = data?.url || (data?.file_id ? `/api/files/${data.file_id}` : "");
    if (!url) {
      throw new Error("Sunucudan geçerli bir görsel bağlantısı alınamadı");
    }

    return {
      url,
      file_id: data?.file_id,
      name: file.name,
      size: file.size,
    };
  } catch (err) {
    // If multipart fails, try base64 JSON upload as fallback
    try {
      const base64 = await fileToBase64(file);
      const { data } = await api.post<any>("/upload", {
        dataBase64: base64,
        filename: file.name,
        contentType: file.type || "image/png",
      });
      const url = data?.url || (data?.file_id ? `/api/files/${data.file_id}` : "");
      if (url) {
        return {
          url,
          file_id: data?.file_id,
          name: file.name,
          size: file.size,
        };
      }
    } catch {
      // ignore
    }
    throw err;
  }
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = (e) => reject(e);
    reader.readAsDataURL(file);
  });
}

