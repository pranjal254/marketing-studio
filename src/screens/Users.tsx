import { Fragment, useState, type FormEvent } from "react";
import { DotsThree, UserPlus } from "@phosphor-icons/react";
import { openTasksFor, useStore } from "../store";
import { roleTypes } from "../data";
import { DEFAULT_PASSWORD } from "../access";
import { Avatar, Chip, Menu } from "../ui";
import type { Person, Role } from "../types";

export default function UsersScreen() {
  const { state, viewer, authed, actions } = useStore();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("Viewer");
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editRole, setEditRole] = useState<Role>("Viewer");
  const [editError, setEditError] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) { setError("Enter the person's full name."); return; }
    if (!email.includes("@")) { setError("Enter a valid work email."); return; }
    actions.addUser(name.trim(), email.trim(), role);
    setName(""); setEmail(""); setRole("Viewer"); setError(""); setAdding(false);
  }

  function startEdit(person: Person) {
    setAdding(false);
    setEditingId(person.id);
    setEditName(person.name);
    setEditEmail(person.email);
    setEditRole(person.role);
    setEditError("");
  }

  function submitEdit(event: FormEvent) {
    event.preventDefault();
    if (!editingId) return;
    const trimmedName = editName.trim();
    const trimmedEmail = editEmail.trim();
    if (!trimmedName) { setEditError("Enter the person's full name."); return; }
    if (!trimmedEmail.includes("@")) { setEditError("Enter a valid work email."); return; }
    const taken = state.people.some((p) => p.id !== editingId && p.email.toLowerCase() === trimmedEmail.toLowerCase());
    if (taken) { setEditError("Another member already signs in with that email."); return; }
    actions.updateUser(editingId, { name: trimmedName, email: trimmedEmail, role: editRole });
    setEditingId(null);
    setEditError("");
  }

  return (
    <div className="screen-content users-screen">
      <section className="simple-page-header"><div><h1>Users &amp; roles</h1><p>Everyone with access to the workspace, mapped to the human gates they own, with their live open-task count.</p></div><button className="primary-button" onClick={() => { setAdding(!adding); setError(""); setEditingId(null); }}><UserPlus size={16} /> Add user</button></section>
      {adding && (
        <form className="add-user-card" onSubmit={submit} noValidate>
          <div className="field"><label htmlFor="new-user-name">Full name</label><input id="new-user-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Maya Iyer" /></div>
          <div className="field"><label htmlFor="new-user-email">Work email</label><input id="new-user-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@levelshift.com" /></div>
          <div className="field"><label htmlFor="new-user-role">Role</label><select id="new-user-role" value={role} onChange={(e) => setRole(e.target.value as Role)}>{roleTypes.map((r) => <option key={r.name}>{r.name}</option>)}</select></div>
          <div className="add-user-actions"><button type="submit" className="primary-button">Send invite</button><button type="button" className="secondary-button" onClick={() => setAdding(false)}>Cancel</button></div>
          <p className="add-user-note">They sign in with this email and the shared default password (<code>{DEFAULT_PASSWORD}</code>); their role decides which pages the studio shows them.</p>
          {error && <p className="form-error" role="alert">{error}</p>}
        </form>
      )}
      <div className="users-layout">
        <section className="users-table" aria-label="Workspace members">
          <div className="users-table-head"><span>{state.people.length} members</span><span>Sign-in: work email + the AiCoE default password · SSO replaces this in production</span></div>
          {state.people.map((u) => {
            const open = openTasksFor(state, u.id).length;
            const isSelf = u.id === authed?.id;
            return (
              <Fragment key={u.id}>
                <div className="user-row">
                  <Avatar initials={u.initials} />
                  <div className="user-id"><strong>{u.name}{u.id === viewer.id ? " (you)" : ""}</strong><small>{u.email}</small></div>
                  <span><Chip tone="blue">{u.role}</Chip></span>
                  <span className="user-gate">{roleTypes.find((r) => r.name === u.role)?.gate}</span>
                  <span><Chip tone={u.status === "Active" ? "green" : "amber"}>{u.status}</Chip></span>
                  <span className="user-active">{open > 0 ? `${open} open task${open > 1 ? "s" : ""}` : u.lastActive}</span>
                  <Menu label={<span className="icon-button" aria-hidden="true"><DotsThree size={18} weight="bold" /></span>}>
                    <button onClick={() => startEdit(u)}>Edit details</button>
                    <button onClick={() => actions.setViewAs(u.id)} disabled={u.status !== "Active"}>View workspace as {u.name.split(" ")[0]}</button>
                    <button onClick={() => actions.removeUser(u.id)} disabled={u.id === viewer.id}>Remove from workspace</button>
                  </Menu>
                </div>
                {editingId === u.id && (
                  <form className="add-user-card edit-user-card" onSubmit={submitEdit} noValidate>
                    <div className="field"><label htmlFor="edit-user-name">Full name</label><input id="edit-user-name" value={editName} onChange={(e) => setEditName(e.target.value)} /></div>
                    <div className="field"><label htmlFor="edit-user-email">Work email</label><input id="edit-user-email" type="email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} /></div>
                    <div className="field"><label htmlFor="edit-user-role">Role</label><select id="edit-user-role" value={editRole} onChange={(e) => setEditRole(e.target.value as Role)} disabled={isSelf}>{roleTypes.map((r) => <option key={r.name}>{r.name}</option>)}</select></div>
                    <div className="add-user-actions"><button type="submit" className="primary-button">Save changes</button><button type="button" className="secondary-button" onClick={() => setEditingId(null)}>Cancel</button></div>
                    {isSelf && <p className="add-user-note">You can't change your own role — it keeps you from locking yourself out of this page.</p>}
                    {editError && <p className="form-error" role="alert">{editError}</p>}
                  </form>
                )}
              </Fragment>
            );
          })}
        </section>
        <aside className="roles-panel">
          <h2>Roles map to human gates</h2>
          <p className="roles-copy">Every role corresponds to a decision point in the nine-step campaign journey. Agents route work to these gates and never approve on a person's behalf.</p>
          {roleTypes.map((r) => <div className="role-item" key={r.name}><strong>{r.name}</strong><p>{r.description}</p></div>)}
        </aside>
      </div>
    </div>
  );
}
