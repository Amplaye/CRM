"use client";

import { UserPlus, Shield, Trash2, X, QrCode, User, Hourglass, Info } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import type { Dictionary } from "@/lib/i18n/dictionaries/en";
import { useTenant } from "@/lib/contexts/TenantContext";
import { createClient } from "@/lib/supabase/client";
import { useCallback, useEffect, useMemo, useState } from "react";

type DbRole = "owner" | "manager" | "host";

type Member = {
  id: string;
  user_id: string;
  role: DbRole;
  email: string;
  name: string;
  created_at?: string;
};

// An invite that's been created but not yet scanned — it lives only in
// qr_login_tokens (no tenant_members row until first scan), so without this the
// owner has no way to see who's been invited but hasn't logged in.
type PendingInvite = {
  id: string;
  token: string;
  pending_name: string | null;
  pending_role: string | null;
  expires_at: string;
};

// UI roles: Admin (DB owner — the account creator, unique), Responsabile
// (DB manager — takes orders and charges with the cassa, plus everything
// Staff can do) and Staff (DB host — camerieri). Only the owner manages the team.
type TFn = (k: keyof Dictionary) => string;
const roleToUiLabel = (r: DbRole, t: TFn): string => {
  if (r === "owner") return t("team_role_admin") || "Admin";
  if (r === "manager") return t("team_role_responsabile") || "Responsabile";
  return t("team_role_staff") || "Staff";
};

export function StaffTab() {
  const { t } = useLanguage();
  const { activeTenant } = useTenant();
  const supabase = useMemo(() => createClient(), []);

  const [members, setMembers] = useState<Member[]>([]);
  const [pending, setPending] = useState<PendingInvite[]>([]);
  const [showRoleHelp, setShowRoleHelp] = useState(false);
  const [loading, setLoading] = useState(true);
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [myRole, setMyRole] = useState<DbRole | null>(null);

  const [showInvite, setShowInvite] = useState(false);
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState<"host" | "manager">("host");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  // qrFor describes whose QR is open: either an existing Member (re-login)
  // or a pending staff invite (name only — Admin role is creator-only).
  type PendingTarget = { kind: "pending"; name: string };
  type ExistingTarget = { kind: "existing"; member: Member };
  type QrTarget = PendingTarget | ExistingTarget;

  const [qrFor, setQrFor] = useState<QrTarget | null>(null);
  const [qrUrl, setQrUrl] = useState<string>("");
  const [qrLoading, setQrLoading] = useState(false);
  const [qrError, setQrError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setMyUserId(user?.id || null);
    })();
  }, [supabase]);

  useEffect(() => {
    if (!activeTenant) return;
    let cancelled = false;
    // Only flip the full-table skeleton on the *first* load for a given tenant.
    // Realtime refetches must not blank out the table.
    setLoading(true);

    const fetchMembers = async (opts: { showSpinner?: boolean } = {}) => {
      // Split the membership lookup from the profile lookup. The combined
      // join previously triggered the per-row "Tenant members can read each
      // other profiles" RLS policy on public.users; doing two narrow queries
      // lets each one hit its own index and the policy evaluates once.
      const { data: tmRows, error: tmErr } = await supabase
        .from("tenant_members")
        .select("id, user_id, role, created_at")
        .eq("tenant_id", activeTenant.id);
      if (tmErr) {
        console.error(tmErr);
        if (!cancelled && opts.showSpinner) setLoading(false);
        return;
      }
      const userIds = (tmRows || []).map((r: any) => r.user_id as string);
      let usersById = new Map<string, { email: string; name: string }>();
      if (userIds.length > 0) {
        const { data: userRows, error: uErr } = await supabase
          .from("users")
          .select("id, email, name")
          .in("id", userIds);
        if (uErr) {
          console.error(uErr);
        } else {
          usersById = new Map((userRows || []).map((u: any) => [u.id, { email: u.email || "", name: u.name || "" }]));
        }
      }
      if (cancelled) return;
      const rows: Member[] = (tmRows || []).map((r: any) => {
        const u = usersById.get(r.user_id);
        return {
          id: r.id,
          user_id: r.user_id,
          role: r.role as DbRole,
          email: u?.email || "",
          name: u?.name || "",
          created_at: r.created_at,
        };
      });
      setMembers(rows);
      if (opts.showSpinner) setLoading(false);
    };

    fetchMembers({ showSpinner: true });

    const ch = supabase
      .channel(`tenant_members-${activeTenant.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tenant_members", filter: `tenant_id=eq.${activeTenant.id}` },
        () => { void fetchMembers({ showSpinner: false }); }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
    };
  }, [activeTenant, supabase]);

  // Pending invites: rows in qr_login_tokens not yet scanned (user_id null),
  // not consumed, not expired. Only owner/manager can read these (RLS).
  const fetchPending = useCallback(async () => {
    if (!activeTenant) return;
    const nowIso = new Date().toISOString();
    const { data } = await supabase
      .from("qr_login_tokens")
      .select("id, token, pending_name, pending_role, expires_at, consumed_at, user_id")
      .eq("tenant_id", activeTenant.id)
      .is("user_id", null)
      .is("consumed_at", null)
      .gt("expires_at", nowIso)
      .order("expires_at", { ascending: false });
    setPending(
      (data || [])
        .filter((r: any) => r.pending_name || r.pending_role)
        .map((r: any) => ({
          id: r.id,
          token: r.token,
          pending_name: r.pending_name,
          pending_role: r.pending_role,
          expires_at: r.expires_at,
        })),
    );
  }, [activeTenant, supabase]);

  useEffect(() => { void fetchPending(); }, [fetchPending]);

  useEffect(() => {
    if (!myUserId || members.length === 0) return;
    const me = members.find(m => m.user_id === myUserId);
    setMyRole(me ? me.role : null);
  }, [myUserId, members]);

  // Only the account creator (DB role 'owner' → UI 'Admin') can manage the team.
  const canManage = myRole === "owner";

  const removeMember = async (member: Member) => {
    if (!canManage) return;
    if (member.role === "owner") return; // Admin (owner) is not removable
    if (!activeTenant) return;
    if (!confirm((t("team_remove_confirm") || "Rimuovere {email}?").replace("{email}", member.name || member.email))) return;
    // Optimistic remove so the UI updates instantly even if the realtime
    // broadcast lags or is filtered out.
    const prev = members;
    setMembers(curr => curr.filter(m => m.id !== member.id));
    try {
      const res = await fetch("/api/team/remove-member", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberId: member.id, tenantId: activeTenant.id }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setMembers(prev);
        alert(body?.error || "Remove failed");
      }
    } catch (e: any) {
      setMembers(prev);
      alert(e?.message || "Network error");
    }
  };

  const submitInvite = async () => {
    if (!activeTenant) return;
    setInviting(true);
    setInviteError(null);
    try {
      // Staff (host) or Responsabile (manager) can be invited from the UI. The
      // Admin (owner) role is reserved for the account creator.
      const name = inviteName.trim();
      const res = await fetch("/api/team/add-staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, role: inviteRole, tenantId: activeTenant.id }),
      });
      const body = await res.json();
      if (!res.ok) {
        setInviteError(body?.error || "Add staff failed");
        return;
      }
      setShowInvite(false);
      setInviteName("");
      setInviteRole("host");
      setQrFor({ kind: "pending", name });
      setQrUrl(body.url);
      setQrError(null);
      setQrLoading(false);
      void fetchPending(); // show it in the "waiting to scan" list right away
    } catch (e: any) {
      setInviteError(e?.message || "Network error");
    } finally {
      setInviting(false);
    }
  };

  // Re-show the QR for a pending invite (the owner closed the modal, or wants to
  // show it again on the new hire's phone). The token is still valid until it
  // expires; we rebuild the same /qr-login URL from it.
  const reshowPending = (p: PendingInvite) => {
    setQrFor({ kind: "pending", name: p.pending_name || "" });
    setQrUrl(`${window.location.origin}/qr-login?t=${p.token}`);
    setQrError(null);
    setQrLoading(false);
  };

  // Cancel an outstanding invite before it's scanned (wrong name/role, or the
  // person isn't joining). Deletes the pending token via the requests-style API.
  const cancelPending = async (p: PendingInvite) => {
    if (!activeTenant) return;
    if (!confirm((t("team_pending_cancel_confirm") || "Annullare l'invito per {name}?").replace("{name}", p.pending_name || "—"))) return;
    const prev = pending;
    setPending(curr => curr.filter(x => x.id !== p.id)); // optimistic
    try {
      const res = await fetch("/api/team/cancel-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tokenId: p.id, tenantId: activeTenant.id }),
      });
      if (!res.ok) { setPending(prev); const b = await res.json().catch(() => ({})); alert(b?.error || "Failed"); }
    } catch (e: any) {
      setPending(prev);
      alert(e?.message || "Network error");
    }
  };

  // Existing-member re-issue: owner clicks the QR icon next to a member who
  // already exists (e.g. lost phone, new device) and gets a fresh 10-min QR.
  const openQrFor = async (member: Member) => {
    if (!activeTenant) return;
    setQrFor({ kind: "existing", member });
    setQrUrl("");
    setQrError(null);
    setQrLoading(true);
    try {
      const res = await fetch("/api/team/qr-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: member.user_id, tenantId: activeTenant.id }),
      });
      const body = await res.json();
      if (!res.ok) {
        setQrError(body?.error || "Failed to generate QR");
      } else {
        setQrUrl(body.url);
      }
    } catch (e: any) {
      setQrError(e?.message || "Network error");
    } finally {
      setQrLoading(false);
    }
  };

  const roleLabel = (r: DbRole) => roleToUiLabel(r, t);

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-bold text-black">{t("staff_title")}</h2>
          <p className="mt-1 text-sm text-black">{t("staff_subtitle")}</p>
        </div>
        {canManage && (
          <div className="mt-3 sm:mt-0 flex space-x-3">
            <button
              onClick={() => setShowRoleHelp(v => !v)}
              className="inline-flex items-center px-3 py-2 border-2 text-sm font-medium rounded-md text-black hover:bg-white/50 transition-colors cursor-pointer"
              style={{ borderColor: '#c4956a' }}
            >
              <Info className="-ml-0.5 mr-1.5 h-4 w-4" aria-hidden="true" />
              {t("team_roles_help")}
            </button>
            <button
              onClick={() => setShowInvite(true)}
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-zinc-900 hover:bg-zinc-800 transition-colors cursor-pointer"
            >
              <UserPlus className="-ml-1 mr-2 h-5 w-5" aria-hidden="true" />
              {t("staff_invite")}
            </button>
          </div>
        )}
      </div>

      {/* What each role can do + how the invite works — the answer to
          "what happens when I add someone". */}
      {showRoleHelp && (
        <div className="border-2 rounded-xl p-4 sm:p-5 space-y-3" style={{ borderColor: '#c4956a', background: 'rgba(252,246,237,0.7)' }}>
          <div className="flex items-start gap-2">
            <Shield className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: '#c4956a' }} />
            <p className="text-sm text-black"><span className="font-bold">{t("team_role_admin")}</span> — {t("team_help_admin")}</p>
          </div>
          <div className="flex items-start gap-2">
            <Shield className="w-4 h-4 mt-0.5 flex-shrink-0 text-blue-600" />
            <p className="text-sm text-black"><span className="font-bold">{t("team_role_responsabile")}</span> — {t("team_help_responsabile")}</p>
          </div>
          <div className="flex items-start gap-2">
            <User className="w-4 h-4 mt-0.5 flex-shrink-0 text-blue-600" />
            <p className="text-sm text-black"><span className="font-bold">{t("team_role_staff")}</span> — {t("team_help_staff")}</p>
          </div>
          <div className="flex items-start gap-2 pt-2 border-t" style={{ borderColor: 'rgba(196,149,106,0.3)' }}>
            <QrCode className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: '#c4956a' }} />
            <p className="text-sm text-black">{t("team_help_invite_flow")}</p>
          </div>
        </div>
      )}

      <div className="border-2 rounded-xl overflow-hidden" style={{ background: 'rgba(252,246,237,0.85)', borderColor: '#c4956a', boxShadow: '0 20px 60px rgba(196,149,106,0.25), 0 8px 24px rgba(196,149,106,0.15)' }}>
        {/* skeleton */}
        {loading && Array.from({ length: 3 }).map((_, i) => (
          <div key={`skel-${i}`} className="flex items-center gap-3 px-4 py-3 border-b last:border-b-0" style={{ borderColor: 'rgba(196,149,106,0.3)' }}>
            <div className="h-10 w-10 rounded-full flex-shrink-0 animate-pulse" style={{ background: 'rgba(196,149,106,0.2)' }} />
            <div className="flex-1 space-y-2">
              <div className="h-3.5 w-32 rounded animate-pulse" style={{ background: 'rgba(196,149,106,0.2)' }} />
              <div className="h-3 w-20 rounded animate-pulse" style={{ background: 'rgba(196,149,106,0.15)' }} />
            </div>
            <div className="h-3 w-12 rounded animate-pulse" style={{ background: 'rgba(196,149,106,0.15)' }} />
          </div>
        ))}

        {/* empty */}
        {!loading && members.length === 0 && (
          <div className="px-6 py-8 text-center text-sm text-black">{t("team_empty") || "Nessun membro ancora."}</div>
        )}

        {/* member rows */}
        {!loading && members.map(m => {
          const initials = (m.name || m.email || "?").slice(0, 2).toUpperCase();
          const isMe = m.user_id === myUserId;
          return (
            <div key={m.id} className="flex items-center gap-3 px-4 py-3 border-b last:border-b-0" style={{ borderColor: 'rgba(196,149,106,0.3)' }}>
              {/* avatar */}
              <div className="flex-shrink-0 h-10 w-10 rounded-full flex items-center justify-center text-black font-bold text-sm" style={{ background: 'rgba(196,149,106,0.2)' }}>{initials}</div>

              {/* name + role */}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-black truncate">
                  {m.name || m.email}{isMe && ` (${t("team_you") || "You"})`}
                </div>
                <div className="flex items-center gap-1 mt-0.5">
                  {m.role === "owner"
                    ? <Shield className="w-3 h-3 flex-shrink-0" style={{ color: '#c4956a' }} />
                    : m.role === "manager"
                    ? <Shield className="w-3 h-3 flex-shrink-0 text-blue-600" />
                    : <User className="w-3 h-3 flex-shrink-0 text-blue-600" />}
                  <span className="text-xs text-black">{roleLabel(m.role)}</span>
                  <span className="ml-2 px-1.5 py-0.5 text-xs font-semibold rounded-full bg-emerald-100 text-emerald-800">{t("team_status_active") || "Active"}</span>
                </div>
              </div>

              {/* actions */}
              {canManage && (
                <div className="flex items-center gap-3 flex-shrink-0">
                  {(m.role === "host" || m.role === "manager") && (
                    <button
                      onClick={() => openQrFor(m)}
                      className="text-black hover:text-black cursor-pointer"
                      title={t("staff_qr_login") || "QR di login"}
                    >
                      <QrCode className="w-4 h-4" />
                    </button>
                  )}
                  {!isMe && m.role !== "owner" && (
                    <button
                      onClick={() => removeMember(m)}
                      className="text-red-500 hover:text-red-700 cursor-pointer"
                      title={t("team_remove") || "Rimuovi"}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Pending invites — created but not yet scanned. Without this they're
          invisible (they live in qr_login_tokens, not tenant_members). */}
      {canManage && pending.length > 0 && (
        <div>
          <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: '#8b6540' }}>
            {t("team_pending_title")}
          </p>
          <div className="border-2 border-dashed rounded-xl overflow-hidden" style={{ borderColor: 'rgba(196,149,106,0.6)', background: 'rgba(252,246,237,0.5)' }}>
            {pending.map(p => (
              <div key={p.id} className="flex items-center gap-3 px-4 py-3 border-b last:border-b-0" style={{ borderColor: 'rgba(196,149,106,0.25)' }}>
                <div className="flex-shrink-0 h-10 w-10 rounded-full flex items-center justify-center" style={{ background: 'rgba(245,158,11,0.15)' }}>
                  <Hourglass className="w-4 h-4" style={{ color: '#92400e' }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-black truncate">{p.pending_name || "—"}</div>
                  <div className="flex items-center gap-1 mt-0.5">
                    <span className="text-xs text-black">{p.pending_role === "manager" ? roleToUiLabel("manager", t) : roleToUiLabel("host", t)}</span>
                    <span className="ml-2 px-1.5 py-0.5 text-xs font-semibold rounded-full" style={{ background: 'rgba(245,158,11,0.15)', color: '#92400e' }}>
                      {t("team_pending_badge")}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <button onClick={() => reshowPending(p)} className="text-black hover:text-black cursor-pointer" title={t("team_pending_show_qr")}>
                    <QrCode className="w-4 h-4" />
                  </button>
                  <button onClick={() => cancelPending(p)} className="text-red-500 hover:text-red-700 cursor-pointer" title={t("team_pending_cancel")}>
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {showInvite && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => !inviting && setShowInvite(false)} />
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[92vw] max-w-md border-2 rounded-xl shadow-2xl overflow-hidden" style={{ background: 'rgb(252,246,237)', borderColor: '#c4956a' }}>
            <div className="px-5 py-3 flex items-center justify-between border-b" style={{ borderColor: '#c4956a' }}>
              <h2 className="text-base font-bold text-black">{t("team_invite_title") || "Aggiungi staff"}</h2>
              <button onClick={() => !inviting && setShowInvite(false)} className="p-1.5 border-2 border-red-400 text-red-500 hover:bg-red-50 rounded-lg cursor-pointer">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="block text-sm font-medium text-black mb-1">{t("team_invite_role") || "Ruolo"}</label>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    ["host", roleToUiLabel("host", t), t("team_role_hint_staff") || ""],
                    ["manager", roleToUiLabel("manager", t), t("team_role_hint_responsabile") || ""],
                  ] as const).map(([r, label, hint]) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setInviteRole(r)}
                      className={`text-left px-3 py-2.5 rounded-lg border-2 cursor-pointer ${inviteRole === r ? "" : "opacity-70"}`}
                      style={inviteRole === r ? { borderColor: '#c4956a', background: 'rgba(196,149,106,0.15)' } : { borderColor: 'rgba(196,149,106,0.4)' }}
                    >
                      <span className="block text-sm font-bold text-black">{label}</span>
                      <span className="block text-xs text-black mt-0.5">{hint}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-black mb-1">{t("team_invite_name") || "Nome"}</label>
                <input
                  type="text"
                  value={inviteName}
                  onChange={(e) => setInviteName(e.target.value)}
                  placeholder={t("team_invite_name_placeholder") || "es. Mario"}
                  className="block w-full border-2 rounded-lg px-3 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[#c4956a]"
                  style={{ borderColor: '#c4956a', background: 'rgba(252,246,237,0.6)' }}
                  autoFocus
                />
                <p className="text-xs text-black mt-1">
                  {t("team_invite_name_hint") || "Niente email: dopo il salvataggio si genera un QR di accesso da scansionare col telefono."}
                </p>
              </div>

              {inviteError && (
                <p className="text-sm text-red-600">{inviteError}</p>
              )}
            </div>
            <div className="px-5 py-3 border-t flex justify-end gap-2" style={{ borderColor: '#c4956a' }}>
              <button
                onClick={() => setShowInvite(false)}
                disabled={inviting}
                className="px-4 py-2 text-sm font-medium border-2 rounded-lg text-black cursor-pointer disabled:opacity-50"
                style={{ borderColor: '#c4956a' }}
              >
                {t("team_cancel") || "Annulla"}
              </button>
              <button
                onClick={submitInvite}
                disabled={inviting || !inviteName.trim()}
                className="px-4 py-2 text-sm font-medium rounded-lg text-white bg-zinc-900 hover:bg-zinc-800 cursor-pointer disabled:opacity-50"
              >
                {inviting
                  ? (t("team_inviting") || "Invio…")
                  : (t("team_create_and_qr") || "Crea e mostra QR")}
              </button>
            </div>
          </div>
        </>
      )}

      {qrFor && (() => {
        const targetName = qrFor.kind === "existing" ? (qrFor.member.name || qrFor.member.email) : qrFor.name;
        return (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setQrFor(null)} />
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[92vw] max-w-md border-2 rounded-xl shadow-2xl overflow-hidden" style={{ background: 'rgb(252,246,237)', borderColor: '#c4956a' }}>
            <div className="px-5 py-3 flex items-center justify-between border-b" style={{ borderColor: '#c4956a' }}>
              <h2 className="text-base font-bold text-black">{t("staff_qr_title") || "Login con QR"}</h2>
              <button onClick={() => setQrFor(null)} className="p-1.5 border-2 border-red-400 text-red-500 hover:bg-red-50 rounded-lg cursor-pointer">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-sm text-black text-center">
                {(t("staff_qr_subtitle") || "Mostra questo QR a {name} e fa scansionare col telefono per accedere.").replace("{name}", targetName)}
              </p>
              {qrLoading && (
                <div className="flex justify-center py-12 text-sm text-black">…</div>
              )}
              {qrError && (
                <p className="text-sm text-red-600 text-center">{qrError}</p>
              )}
              {qrUrl && (
                <>
                  <div className="flex justify-center p-4 rounded-lg" style={{ background: 'white', border: '2px solid #c4956a' }}>
                    <QRCodeSVG value={qrUrl} size={260} level="M" />
                  </div>
                  <p className="text-xs text-black text-center">
                    {(t("staff_qr_expires") || "Valido per 10 minuti. Si può usare una sola volta.")}
                  </p>
                </>
              )}
            </div>
          </div>
        </>
        );
      })()}
    </div>
  );
}
