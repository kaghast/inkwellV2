/**
 * Google Drive v3 REST API Client for Inkwell Note Backups
 */

export interface DriveBackupFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  createdTime?: string;
  modifiedTime?: string;
  webViewLink?: string;
  webContentLink?: string;
  notesCount?: number;
}

const INKWELL_BACKUP_FOLDER = "Inkwell Notes Backups";

/**
 * Searches for existing 'Inkwell Notes Backups' folder or creates one
 */
export async function findOrCreateBackupFolder(accessToken: string): Promise<string> {
  const query = encodeURIComponent(
    `name = '${INKWELL_BACKUP_FOLDER}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`
  );

  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name)`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (!searchRes.ok) {
    const err = await searchRes.text();
    throw new Error(`Google Drive klasör araması başarısız (${searchRes.status}): ${err}`);
  }

  const searchData = await searchRes.json();
  if (searchData.files && searchData.files.length > 0) {
    return searchData.files[0].id;
  }

  // Create folder
  const createRes = await fetch("https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: INKWELL_BACKUP_FOLDER,
      mimeType: "application/vnd.google-apps.folder",
      description: "Inkwell Günlük ve Not Defteri Otomatik & Manuel Yedekleri",
    }),
  });

  if (!createRes.ok) {
    const err = await createRes.text();
    throw new Error(`Google Drive klasörü oluşturulamadı (${createRes.status}): ${err}`);
  }

  const folder = await createRes.json();
  return folder.id;
}

/**
 * Uploads structured JSON backup to user's Google Drive inside 'Inkwell Notes Backups' folder
 */
export async function uploadBackupToDrive(
  accessToken: string,
  backupData: any,
  customFileName?: string
): Promise<DriveBackupFile> {
  const folderId = await findOrCreateBackupFolder(accessToken);

  const now = new Date();
  const dateStr = now.toISOString().replace(/[:.]/g, "-").slice(0, 16);
  const fileName =
    customFileName ||
    `Inkwell_Backup_${dateStr}.json`;

  const fileMetadata = {
    name: fileName,
    parents: [folderId],
    description: `Inkwell Not Yedekleme Paketi — ${now.toLocaleDateString("tr-TR")} ${now.toLocaleTimeString("tr-TR")} (${backupData.data?.notes?.length || 0} not)`,
    properties: {
      app: "Inkwell",
      version: "1.0",
      notesCount: String(backupData.data?.notes?.length || 0),
      tagsCount: String(backupData.data?.tags?.length || 0),
    },
  };

  const fileContent = JSON.stringify(backupData, null, 2);
  const boundary = "-------314159265358979323846";
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;

  const multipartRequestBody =
    delimiter +
    "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
    JSON.stringify(fileMetadata) +
    delimiter +
    "Content-Type: application/json\r\n\r\n" +
    fileContent +
    closeDelimiter;

  const uploadRes = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,size,createdTime,modifiedTime,webViewLink",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body: multipartRequestBody,
    }
  );

  if (!uploadRes.ok) {
    const err = await uploadRes.text();
    throw new Error(`Yedek Google Drive'a yüklenemedi (${uploadRes.status}): ${err}`);
  }

  const uploaded = await uploadRes.json();
  return {
    id: uploaded.id,
    name: uploaded.name,
    mimeType: uploaded.mimeType,
    size: uploaded.size,
    createdTime: uploaded.createdTime,
    modifiedTime: uploaded.modifiedTime,
    webViewLink: uploaded.webViewLink,
    notesCount: backupData.data?.notes?.length || 0,
  };
}

/**
 * Uploads markdown summary export file to Google Drive
 */
export async function uploadMarkdownSummaryToDrive(
  accessToken: string,
  notesList: any[],
  customFileName?: string
): Promise<DriveBackupFile> {
  const folderId = await findOrCreateBackupFolder(accessToken);

  const now = new Date();
  const dateStr = now.toISOString().replace(/[:.]/g, "-").slice(0, 16);
  const fileName =
    customFileName ||
    `Inkwell_Notlar_Arsivi_${dateStr}.md`;

  let mdContent = `# Inkwell Not Arşivi (${now.toLocaleDateString("tr-TR")} ${now.toLocaleTimeString("tr-TR")})\n\n`;
  mdContent += `Toplam Not Sayısı: ${notesList.length}\n\n---\n\n`;

  for (const n of notesList) {
    mdContent += `## ${n.title || "Başlıksız Not"}\n`;
    mdContent += `**Tarih:** ${n.date || "—"} | **Oluşturulma:** ${new Date(n.created_at || n.createdAt).toLocaleString("tr-TR")}\n`;
    if (n.tags && n.tags.length > 0) {
      mdContent += `**Etiketler:** ${n.tags.map((t: string) => `#${t}`).join(" ")}\n`;
    }
    if (n.people && n.people.length > 0) {
      mdContent += `**Kişiler:** ${n.people.map((p: string) => `@${p}`).join(" ")}\n`;
    }
    mdContent += `\n${n.content}\n\n---\n\n`;
  }

  const fileMetadata = {
    name: fileName,
    parents: [folderId],
    description: `Inkwell Notları Markdown formatında dışa aktarma (${notesList.length} not)`,
  };

  const boundary = "-------314159265358979323846";
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;

  const multipartRequestBody =
    delimiter +
    "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
    JSON.stringify(fileMetadata) +
    delimiter +
    "Content-Type: text/markdown; charset=UTF-8\r\n\r\n" +
    mdContent +
    closeDelimiter;

  const uploadRes = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,size,createdTime,modifiedTime,webViewLink",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body: multipartRequestBody,
    }
  );

  if (!uploadRes.ok) {
    const err = await uploadRes.text();
    throw new Error(`Markdown yedeği Google Drive'a yüklenemedi (${uploadRes.status}): ${err}`);
  }

  const uploaded = await uploadRes.json();
  return {
    id: uploaded.id,
    name: uploaded.name,
    mimeType: uploaded.mimeType,
    size: uploaded.size,
    createdTime: uploaded.createdTime,
    modifiedTime: uploaded.modifiedTime,
    webViewLink: uploaded.webViewLink,
    notesCount: notesList.length,
  };
}

/**
 * Lists all backup files in user's Google Drive
 */
export async function listDriveBackups(accessToken: string): Promise<DriveBackupFile[]> {
  try {
    const folderId = await findOrCreateBackupFolder(accessToken);
    const query = encodeURIComponent(`'${folderId}' in parents and trashed = false`);

    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name,mimeType,size,createdTime,modifiedTime,webViewLink,webContentLink,properties)&orderBy=createdTime desc`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Google Drive yedekleri listelenemedi: ${err}`);
    }

    const data = await res.json();
    return (data.files || []).map((f: any) => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      size: f.size,
      createdTime: f.createdTime,
      modifiedTime: f.modifiedTime,
      webViewLink: f.webViewLink,
      webContentLink: f.webContentLink,
      notesCount: f.properties?.notesCount ? parseInt(f.properties.notesCount, 10) : undefined,
    }));
  } catch (err) {
    console.error("List drive backups error:", err);
    throw err;
  }
}

/**
 * Downloads and parses backup JSON from Google Drive
 */
export async function downloadBackupFromDrive(accessToken: string, fileId: string): Promise<any> {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Dosya Google Drive'dan indirilemedi (${res.status}): ${err}`);
  }

  return await res.json();
}

/**
 * Deletes backup file from Google Drive
 */
export async function deleteBackupFromDrive(accessToken: string, fileId: string): Promise<void> {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok && res.status !== 204) {
    const err = await res.text();
    throw new Error(`Yedek Google Drive'dan silinemedi: ${err}`);
  }
}
