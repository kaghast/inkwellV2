import axios, { AxiosError } from "axios";

const rawBase =
  (typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_BACKEND_URL) ||
  (typeof process !== "undefined" && process.env?.REACT_APP_BACKEND_URL) ||
  "";

// Clean base URL: remove whitespace and any trailing slashes
const cleanBase = rawBase ? String(rawBase).trim().replace(/\/+$/, "") : "";

// If cleanBase is provided and already ends with /api, use it as is; otherwise append /api
export const API = cleanBase
  ? cleanBase.endsWith("/api")
    ? cleanBase
    : `${cleanBase}/api`
  : "/api";

const api = axios.create({
  baseURL: API,
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
  },
});

api.interceptors.request.use((config) => {
  if (config.url && typeof config.url === "string") {
    // Normalize path to prevent leading double slashes like //auth/login
    config.url = config.url.replace(/^\/+/, "/");
  }
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("inkwell_token");
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

api.interceptors.response.use(
  (res) => {
    if (res.data && typeof res.data === "object" && typeof window !== "undefined") {
      const tok = res.data.token || res.data.access_token;
      if (tok && typeof tok === "string") {
        localStorage.setItem("inkwell_token", tok);
      }
    }
    return res;
  },
  (error: AxiosError) => {
    return Promise.reject(error);
  }
);

export function formatApiError(error: any): string {
  if (!error) return "Bilinmeyen bir hata oluştu";
  if (typeof error === "string") return error;
  if (error.response?.data?.detail) {
    const detail = error.response.data.detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) {
      return detail.map((d: any) => d.msg || JSON.stringify(d)).join(", ");
    }
    return JSON.stringify(detail);
  }
  if (error.response?.data?.message) return error.response.data.message;
  if (error.response?.statusText) return `${error.response.status}: ${error.response.statusText}`;
  if (error.message) {
    if (error.message === "Network Error") {
      return "Sunucuya bağlanılamadı (Ağ bağlantısını veya oturumunuzu kontrol edin)";
    }
    return error.message;
  }
  return "İstek işlenirken bir hata oluştu";
}

export default api;
