// Phase 3a client: billing, team workspaces, invitations, platform admin.
import api from "@/lib/api";

export interface PlanLimits {
  objects?: number;
  storage_mb?: number;
  members?: number;
  ai_calls_month?: number;
}

export interface Plan {
  plan_key: string;
  name: string;
  description: string;
  price_monthly: string;
  price_yearly: string;
  currency: string;
  limits: PlanLimits;
  features: string[];
  is_active: boolean;
  is_default: boolean;
  sort_order: number;
}

export interface Usage {
  objects: number;
  storage_mb: number;
  storage_bytes: number;
  members: number;
  pending_invitations: number;
  ai_calls_month: number;
}

export interface Subscription {
  plan_key: string;
  period: string;
  current_period_end: string | null;
  source: string;
  active: boolean;
}

export interface Payment {
  payment_id: string;
  workspace_id: string;
  user_id: string | null;
  email?: string | null;
  plan_key: string;
  period: string;
  amount: string;
  currency: string;
  status: "pending" | "paid" | "failed" | "review";
  error: string | null;
  period_end: string | null;
  created_at: string;
  paid_at: string | null;
}

export interface BillingProfile {
  full_name: string;
  phone: string;
  address: string;
  city: string;
  country: string;
  zip_code: string | null;
  identity_number_hint: string | null;
}

export interface BillingOverview {
  workspace: { workspace_id: string; name: string; kind: string; role: string };
  plan: Plan;
  subscription: Subscription | null;
  usage: Usage;
  plans: Plan[];
  payments: Payment[];
  profile: BillingProfile | null;
  payment: { configured: boolean; provider: string; sandbox: boolean | null };
  can_manage: boolean;
}

export interface WorkspaceSummary {
  workspace_id: string;
  name: string;
  kind: "personal" | "team";
  role: string;
  is_owner: boolean;
  members: number;
  plan: { plan_key: string; name: string; limits: PlanLimits };
}

export interface WorkspaceDetail {
  workspace_id: string;
  name: string;
  kind: string;
  role: string;
  can_manage: boolean;
  can_write: boolean;
  plan: Plan;
  subscription: Subscription | null;
  members: Array<{ user_id: string; name: string; email: string | null; picture: string | null; role: string; joined_at: string }>;
  invitations: Array<{ invitation_id: string; email: string; role: string; expires_at: string }>;
  spaces: Array<{ space_id: string; name: string; color: string | null; is_default: boolean; archived: boolean }>;
}

export interface TeamObject {
  note_id: string;
  slug: string | null;
  title: string;
  type_name: string;
  space_id: string | null;
  updated_at: string;
  author: string | null;
  mine: boolean;
}

export const ROLE_LABEL: Record<string, string> = {
  owner: "Sahip",
  admin: "Yönetici",
  editor: "Editör",
  commenter: "Yorumcu",
  viewer: "İzleyici",
};

export const LIMIT_LABEL: Record<keyof PlanLimits, string> = {
  objects: "Nesne",
  storage_mb: "Depolama (MB)",
  members: "Üye",
  ai_calls_month: "Yapay zeka çağrısı / ay",
};

export const PAYMENT_STATUS: Record<string, string> = { pending: "Bekliyor", paid: "Ödendi", failed: "Başarısız", review: "İncelemede" };

export const formatLimit = (n: number | undefined) => (n === undefined || n === null || n < 0 ? "Sınırsız" : n.toLocaleString("tr-TR"));
export const formatMoney = (amount: string, currency = "TRY") => {
  const n = Number(amount);
  return Number.isFinite(n) ? n.toLocaleString("tr-TR", { style: "currency", currency, maximumFractionDigits: 2 }) : amount;
};

export const saasApi = {
  billing: (workspaceId?: string) => api.get<BillingOverview>("/billing", { params: workspaceId ? { workspace_id: workspaceId } : {} }).then((r) => r.data),
  saveProfile: (p: Partial<BillingProfile> & { identity_number?: string }) => api.put<BillingProfile>("/billing/profile", p).then((r) => r.data),
  checkout: (b: { workspace_id?: string; plan_key: string; period: "month" | "year" }) =>
    api.post<{ payment_id: string; token: string; payment_page_url: string | null }>("/billing/checkout", b).then((r) => r.data),

  workspaces: () => api.get<WorkspaceSummary[]>("/workspaces").then((r) => r.data),
  createWorkspace: (name: string) => api.post<WorkspaceSummary>("/workspaces", { name }).then((r) => r.data),
  workspace: (id: string) => api.get<WorkspaceDetail>(`/workspaces/${id}`).then((r) => r.data),
  renameWorkspace: (id: string, name: string) => api.put(`/workspaces/${id}`, { name }).then((r) => r.data),
  objects: (id: string, spaceId?: string) => api.get<TeamObject[]>(`/workspaces/${id}/objects`, { params: spaceId ? { space_id: spaceId } : {} }).then((r) => r.data),
  setRole: (id: string, userId: string, role: string) => api.patch(`/workspaces/${id}/members/${userId}`, { role }).then((r) => r.data),
  removeMember: (id: string, userId: string) => api.delete(`/workspaces/${id}/members/${userId}`).then((r) => r.data),
  invite: (id: string, email: string, role: string) =>
    api.post<{ invitation_id: string; email: string; role: string; expires_at: string; path: string }>(`/workspaces/${id}/invitations`, { email, role }).then((r) => r.data),
  revokeInvite: (id: string, invId: string) => api.delete(`/workspaces/${id}/invitations/${invId}`).then((r) => r.data),
  invitation: (token: string) =>
    api
      .get<{ workspace_name: string; role: string; invited_by: string | null; email: string; email_matches: boolean; already_member: boolean; expires_at: string }>(`/invitations/${token}`)
      .then((r) => r.data),
  acceptInvitation: (token: string) => api.post<{ workspace_id: string; role: string }>(`/invitations/${token}/accept`).then((r) => r.data),

  adminMe: () => api.get<{ is_admin: boolean }>("/admin/me").then((r) => r.data),
  adminStats: () => api.get<any>("/admin/stats").then((r) => r.data),
  adminUsers: (q = "", offset = 0) => api.get<{ total: number; users: any[] }>("/admin/users", { params: { q, offset, limit: 50 } }).then((r) => r.data),
  adminSetDisabled: (userId: string, disabled: boolean) => api.patch(`/admin/users/${userId}`, { disabled }).then((r) => r.data),
  adminWorkspaces: () => api.get<any[]>("/admin/workspaces").then((r) => r.data),
  adminSetSubscription: (workspaceId: string, b: { plan_key: string; period_end: string | null; note?: string }) =>
    api.put(`/admin/workspaces/${workspaceId}/subscription`, b).then((r) => r.data),
  adminClearSubscription: (workspaceId: string) => api.delete(`/admin/workspaces/${workspaceId}/subscription`).then((r) => r.data),
  adminPlans: () => api.get<Plan[]>("/admin/plans").then((r) => r.data),
  adminCreatePlan: (p: Partial<Plan>) => api.post<Plan>("/admin/plans", p).then((r) => r.data),
  adminUpdatePlan: (key: string, p: Partial<Plan>) => api.put<Plan>(`/admin/plans/${key}`, p).then((r) => r.data),
  adminPayments: () => api.get<Payment[]>("/admin/payments").then((r) => r.data),
  adminAudit: (action?: string) => api.get<any[]>("/admin/audit", { params: action ? { action } : {} }).then((r) => r.data),
};
