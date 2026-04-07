"use client";

import { useTenant } from "@/lib/contexts/TenantContext";
import { useEffect, useState } from "react";
import { Users, Send, Trash2, ChevronDown } from "lucide-react";

interface ClientNote {
  id: string;
  tenant_id: string;
  content: string;
  author: string;
  created_at: string;
  tenants?: { name: string };
}

export default function ClientsPage() {
  const { globalRole } = useTenant();
  const [tenants, setTenants] = useState<any[]>([]);
  const [selectedTenant, setSelectedTenant] = useState<string>("all");
  const [notes, setNotes] = useState<ClientNote[]>([]);
  const [newNote, setNewNote] = useState("");
  const [noteTenant, setNoteTenant] = useState<string>("");
  const [loading, setLoading] = useState(true);

  // Load tenants
  useEffect(() => {
    fetch("/api/admin/overview")
      .then(r => r.json())
      .then(d => {
        const ts = d.tenants || [];
        setTenants(ts);
        if (ts.length > 0) setNoteTenant(ts[0].id);
      })
      .catch(() => {});
  }, []);

  // Load notes
  const fetchNotes = async () => {
    setLoading(true);
    const url = selectedTenant === "all"
      ? "/api/admin/client-notes"
      : `/api/admin/client-notes?tenant_id=${selectedTenant}`;
    try {
      const res = await fetch(url);
      const data = await res.json();
      setNotes(data.notes || []);
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  useEffect(() => { fetchNotes(); }, [selectedTenant]);

  const handleAddNote = async () => {
    if (!newNote.trim() || !noteTenant) return;
    await fetch("/api/admin/client-notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenant_id: noteTenant, content: newNote.trim() }),
    });
    setNewNote("");
    fetchNotes();
  };

  const handleDelete = async (id: string) => {
    await fetch("/api/admin/client-notes", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    fetchNotes();
  };

  if (globalRole !== "platform_admin") {
    return <div className="p-8 text-center text-black">Unauthorized</div>;
  }

  const cardStyle = { background: "rgba(252,246,237,0.85)", borderColor: "#c4956a" };
  const inputBorder = { borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" };

  return (
    <div className="p-4 sm:p-6 lg:p-8 w-full space-y-4 sm:space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Users className="w-5 h-5 text-[#c4956a]" />
          <h1 className="text-xl sm:text-2xl font-bold text-black">Client Notes</h1>
        </div>
        <div className="relative">
          <select value={selectedTenant} onChange={e => setSelectedTenant(e.target.value)}
            className="text-sm border-2 rounded-lg px-3 py-2 pr-8 focus:outline-none focus:ring-1 focus:ring-[#c4956a] appearance-none"
            style={{ ...inputBorder }}>
            <option value="all">All Clients</option>
            {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <ChevronDown className="w-4 h-4 text-black/40 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>
      </div>

      {/* Add note */}
      <div className="rounded-xl border-2 p-4" style={cardStyle}>
        <div className="flex gap-3">
          <div className="relative flex-shrink-0">
            <select value={noteTenant} onChange={e => setNoteTenant(e.target.value)}
              className="text-xs border-2 rounded-lg px-2 py-2.5 pr-7 focus:outline-none focus:ring-1 focus:ring-[#c4956a] appearance-none"
              style={{ ...inputBorder }}>
              {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <ChevronDown className="w-3 h-3 text-black/40 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
          <input
            type="text"
            value={newNote}
            onChange={e => setNewNote(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleAddNote()}
            placeholder="Add a note... (contract expiry, call follow-up, feature request, etc.)"
            className="flex-1 text-sm border-2 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-[#c4956a]"
            style={{ ...inputBorder }}
          />
          <button onClick={handleAddNote} disabled={!newNote.trim()}
            className="px-4 py-2 rounded-lg text-white text-sm font-medium transition-colors disabled:opacity-40"
            style={{ background: "#c4956a" }}>
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Notes list */}
      {loading ? (
        <div className="p-12 text-center text-black/50 animate-pulse">Loading...</div>
      ) : notes.length === 0 ? (
        <div className="rounded-xl border-2 p-12 text-center" style={cardStyle}>
          <p className="text-sm text-black/40">No notes yet. Add your first note above.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {notes.map(note => (
            <div key={note.id} className="rounded-xl border-2 p-4 flex items-start gap-3 group" style={cardStyle}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] font-bold text-[#c4956a] bg-[#c4956a]/10 px-2 py-0.5 rounded">
                    {note.tenants?.name || "Unknown"}
                  </span>
                  <span className="text-[10px] text-black/30">{new Date(note.created_at).toLocaleString()}</span>
                </div>
                <p className="text-sm text-black">{note.content}</p>
              </div>
              <button onClick={() => handleDelete(note.id)}
                className="p-1.5 opacity-0 group-hover:opacity-100 hover:bg-red-50 rounded-lg transition-all text-red-400 hover:text-red-600 flex-shrink-0">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
