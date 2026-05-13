"use client";

import { UserPlus, Shield, Trash2, X, QrCode, User } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import type { Dictionary } from "@/lib/i18n/dictionaries/en";
import { useTenant } from "@/lib/contexts/TenantContext";
import { createClient } from "@/lib/supabase/client";
import { useEffect, useMemo, useState } from "react";

type DbRole = "owner" | "manager" | "host";

type Member = {
  id: string;
  user_id: string;
  role: DbRole;
  email: string;
  name: string;
  created_at?: string;
};

// UI exposes only two roles: Admin (DB owner — the account creator, unique)
// and Staff (DB host). Legacy `manager` rows are displayed as Staff but cannot
// be re-assigned from the UI; only the owner can manage the team.
type TFn = (k: keyof Dictionary) => string;
const roleToUiLabel = (r: DbRole, t: TFn): string => {
  if (r === "owner") return t("team_role_admin") || "Admin";
  return t("team_role_staff") || "Staff";
};

export function StaffTab() {
  const { t } = useLanguage();
  const { activeTenant } = useTenant();
  const supabase = useMemo(() => createClient(), []);

  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [myRole, setMyRole] = useState<DbRole | null>(null);

  const [showInvite, setShowInvite] = useState(false);
  const [inviteName, setInviteName] = useState("");
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
    setLoading(true);

    const fetchMembers = async () => {
      const { data, error } = await supabase
        .from("tenant_members")
        .select("id, user_id, role, created_at, users(email, name)")
        .eq("tenant_id", activeTenant.id);
      if (error) {
        console.error(error);
        setLoading(false);
        return;
      }
      const rows: Member[] = (data || []).map((r: any) => ({
        id: r.id,
        user_id: r.user_id,
        role: r.role as DbRole,
        email: r.users?.email || "",
        name: r.users?.name || "",
        created_at: r.created_at,
      }));
      setMembers(rows);
      setLoading(false);
    };

    fetchMembers();

    const ch = supabase
      .channel(`tenant_members-${activeTenant.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tenant_members", filter: `tenant_id=eq.${activeTenant.id}` }, fetchMembers)
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
    };
  }, [activeTenant, supabase]);

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
    if (!confirm((t("team_remove_confirm") || "Rimuovere {email}?").replace("{email}", member.email || member.name))) return;
    // Optimistic remove so the UI updates instantly even if the realtime
    // broadcast lags or is filtered out.
    const prev = members;
    setMembers(curr => curr.filter(m => m.id !== member.id));
    const { error } = await supabase
      .from("tenant_members")
      .delete()
      .eq("id", member.id);
    if (error) {
      setMembers(prev);
      alert(error.message);
    }
  };

  const submitInvite = async () => {
    if (!activeTenant) return;
    setInviting(true);
    setInviteError(null);
    try {
      // Only Staff (host) can be invited from the UI. The Admin (owner) role is
      // reserved for the account creator and cannot be assigned to anyone else.
      const name = inviteName.trim();
      const res = await fetch("/api/team/add-staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, role: "host", tenantId: activeTenant.id }),
      });
      const body = await res.json();
      if (!res.ok) {
        setInviteError(body?.error || "Add staff failed");
        return;
      }
      setShowInvite(false);
      setInviteName("");
      setQrFor({ kind: "pending", name });
      setQrUrl(body.url);
      setQrError(null);
      setQrLoading(false);
    } catch (e: any) {
      setInviteError(e?.message || "Network error");
    } finally {
      setInviting(false);
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
              onClick={() => setShowInvite(true)}
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-zinc-900 hover:bg-zinc-800 transition-colors cursor-pointer"
            >
              <UserPlus className="-ml-1 mr-2 h-5 w-5" aria-hidden="true" />
              {t("staff_invite")}
            </button>
          </div>
        )}
      </div>

      <div className="border-2 rounded-xl overflow-hidden" style={{ background: 'rgba(252,246,237,0.85)', borderColor: '#c4956a', boxShadow: '0 20px 60px rgba(196,149,106,0.25), 0 8px 24px rgba(196,149,106,0.15)' }}>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y" style={{ borderColor: '#c4956a' }}>
            <thead>
              <tr>
                <th className="px-3 sm:px-6 py-3 text-left text-xs font-semibold text-black uppercase tracking-wider">{t("staff_col_name")}</th>
                <th className="px-3 sm:px-6 py-3 text-left text-xs font-semibold text-black uppercase tracking-wider">{t("staff_col_role")}</th>
                <th className="px-3 sm:px-6 py-3 text-left text-xs font-semibold text-black uppercase tracking-wider">{t("staff_col_status")}</th>
                <th className="relative px-3 sm:px-6 py-3"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y" style={{ borderColor: 'rgba(196,149,106,0.3)' }}>
              {loading && (
                <tr><td colSpan={4} className="px-6 py-8 text-center text-sm text-black">…</td></tr>
              )}
              {!loading && members.length === 0 && (
                <tr><td colSpan={4} className="px-6 py-8 text-center text-sm text-black">{t("team_empty") || "Nessun membro ancora."}</td></tr>
              )}
              {!loading && members.map(m => {
                const initials = (m.name || m.email || "?").slice(0, 2).toUpperCase();
                const isMe = m.user_id === myUserId;
                return (
                  <tr key={m.id}>
                    <td className="px-3 sm:px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="flex-shrink-0 h-10 w-10 rounded-full flex justify-center items-center text-black font-bold" style={{ background: 'rgba(196,149,106,0.2)' }}>{initials}</div>
                        <div className="ml-4">
                          <div className="text-sm font-medium text-black">{m.name || m.email}{isMe && ` (${t("team_you") || "You"})`}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 sm:px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-black flex items-center">
                        {m.role === "owner"
                          ? <Shield className="w-4 h-4 mr-1 text-terracotta-600" />
                          : <User className="w-4 h-4 mr-1 text-zinc-600" />}
                        {roleLabel(m.role)}
                      </div>
                    </td>
                    <td className="px-3 sm:px-6 py-4 whitespace-nowrap">
                      <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-emerald-100 text-emerald-800">{t("team_status_active") || "Active"}</span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      {canManage && (
                        <div className="inline-flex items-center gap-3">
                          {m.role === "host" && (
                            <button
                              onClick={() => openQrFor(m)}
                              className="text-zinc-700 hover:text-black cursor-pointer inline-flex items-center"
                              title={t("staff_qr_login") || "QR di login"}
                            >
                              <QrCode className="w-4 h-4" />
                            </button>
                          )}
                          {!isMe && m.role !== "owner" && (
                            <button
                              onClick={() => removeMember(m)}
                              className="text-red-500 hover:text-red-700 cursor-pointer inline-flex items-center"
                              title={t("team_remove") || "Rimuovi"}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

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
                <p className="text-xs text-zinc-600 mt-1">
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
                  <p className="text-xs text-black/70 text-center">
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
