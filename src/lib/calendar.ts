/**
 * Google Calendar v3 REST API Client for Inkwell Note & Agenda Integration
 */

export interface CalendarEventAttendee {
  email?: string;
  displayName?: string;
  responseStatus?: string;
  self?: boolean;
}

export interface CalendarEvent {
  id: string;
  summary: string;
  description?: string;
  location?: string;
  start: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  end: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  attendees?: CalendarEventAttendee[];
  hangoutLink?: string;
  htmlLink?: string;
  status?: string;
}

/**
 * Fetches events from Google Calendar for the given date (YYYY-MM-DD)
 */
export async function fetchCalendarEventsForDate(
  accessToken: string,
  isoDate: string
): Promise<CalendarEvent[]> {
  try {
    // Determine start and end of the day in local ISO representation
    const startOfDay = new Date(`${isoDate}T00:00:00`);
    const endOfDay = new Date(`${isoDate}T23:59:59.999`);

    const timeMin = startOfDay.toISOString();
    const timeMax = endOfDay.toISOString();

    const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
    url.searchParams.set("timeMin", timeMin);
    url.searchParams.set("timeMax", timeMax);
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("orderBy", "startTime");
    url.searchParams.set("maxResults", "50");

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error("Google oturum süreniz dolmuş olabilir. Lütfen yeniden bağlanın.");
      }
      const errText = await response.text();
      throw new Error(`Google Takvim etkinlikleri alınamadı (${response.status}): ${errText}`);
    }

    const data = await response.json();
    return (data.items || []).map((item: any) => ({
      id: item.id,
      summary: item.summary || "İsimsiz Etkinlik",
      description: item.description,
      location: item.location,
      start: item.start || {},
      end: item.end || {},
      attendees: item.attendees,
      hangoutLink: item.hangoutLink,
      htmlLink: item.htmlLink,
      status: item.status,
    }));
  } catch (error: any) {
    console.error("fetchCalendarEventsForDate error:", error);
    throw error;
  }
}

/**
 * Formats time range for a Google Calendar event (e.g. "14:30 - 15:30" or "Tüm Gün")
 */
export function formatEventTimeRange(event: CalendarEvent): string {
  if (event.start.dateTime && event.end.dateTime) {
    const s = new Date(event.start.dateTime);
    const e = new Date(event.end.dateTime);
    const sStr = s.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
    const eStr = e.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
    return `${sStr} - ${eStr}`;
  }
  return "Tüm Gün";
}

/**
 * Transforms a Google Calendar event into a structured Markdown note draft
 */
export function convertEventToNoteDraft(
  event: CalendarEvent,
  isoDate: string
): { title: string; content: string; date: string; locationName?: string } {
  const timeRange = formatEventTimeRange(event);
  const title = event.summary || "Takvim Etkinliği";

  let md = ``;

  // Time & Details section
  md += `**📅 Zaman:** ${isoDate} (${timeRange})\n`;

  if (event.location) {
    md += `**📍 Konum:** ${event.location}\n`;
  }

  if (event.hangoutLink) {
    md += `**📹 Görüşme:** [Google Meet Bağlantısı](${event.hangoutLink})\n`;
  }

  // Attendees formatted with @ mentions so Inkwell auto-links them to People
  if (event.attendees && event.attendees.length > 0) {
    const attendeeHandles = event.attendees
      .map((att) => {
        if (att.displayName) {
          // Clean name for tag handle: remove spaces or sanitize
          const cleanName = att.displayName.trim().replace(/\s+/g, "_");
          return `@${cleanName}`;
        }
        if (att.email) {
          const userPart = att.email.split("@")[0].replace(/\./g, "_");
          return `@${userPart}`;
        }
        return null;
      })
      .filter(Boolean);

    if (attendeeHandles.length > 0) {
      md += `**👥 Katılımcılar:** ${attendeeHandles.join(" ")}\n`;
    }
  }

  md += `\n---\n\n`;

  // Event Description / Agenda
  if (event.description && event.description.trim()) {
    md += `### 📝 Etkinlik Açıklaması & Gündem\n`;
    md += `${event.description.trim()}\n\n`;
  }

  // Pre-filled Meeting Notes & Tasks Section
  md += `### 📌 Toplantı & Görev Notları\n`;
  md += `- [ ] Toplantı çıktılarını ve aksiyonları belirle\n`;
  md += `- \n\n`;

  return {
    title,
    content: md,
    date: isoDate,
    locationName: event.location,
  };
}
