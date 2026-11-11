import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

export default function UserManagement({ onClose, onSessionChange }) {
  const { t } = useTranslation();
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let current = true;
    setLoading(true);
    Promise.all(['/api/users', '/api/roles'].map(async (url) => {
      const response = await fetch(url);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      return result;
    })).then(([userList, roleList]) => {
      if (current) { setUsers(userList); setRoles(roleList); setError(''); }
    }).catch((failure) => { if (current) setError(failure.message); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [revision]);

  async function save(event, user) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const body = user ? { role: values.get('role'), active: values.has('active') }
      : { username: values.get('username'), password: values.get('password'), role: values.get('role') };
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch(user ? `/api/users/${user.id}` : '/api/users', {
        method: user ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Gallery-Request': '1' },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error((await response.json()).error);
      if (!user) form.reset();
      setMessage(t('userSaved'));
      setRevision((value) => value + 1);
      await onSessionChange();
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }

  return (
    <section className="user-management" aria-labelledby="users-heading">
      <div className="upload-panel__heading">
        <h2 id="users-heading">{t('manageUsers')}</h2>
        <button type="button" className="upload-panel__close" onClick={onClose} aria-label={t('closeUsers')} title={t('closeUsers')}>×</button>
      </div>
      <form className="user-create-form" onSubmit={(event) => save(event)}>
        <label className="upload-field"><span>{t('username')}</span><input name="username" autoComplete="off" pattern="[a-zA-Z0-9_.\-]{3,64}" minLength={3} maxLength={64} required /></label>
        <label className="upload-field"><span>{t('password')}</span><input name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required /></label>
        <label className="upload-field"><span>{t('role')}</span><select name="role" defaultValue="viewer" required>{roles.map((role) => <option key={role.name} value={role.name}>{t(`roles.${role.name}`)}</option>)}</select></label>
        <button className="auth-panel__button" type="submit" disabled={busy || loading}>{t('createUser')}</button>
      </form>
      {error && <p className="auth-panel__status--error" role="alert">{t(`authErrors.${error}`, { defaultValue: error })}</p>}
      {message && <p role="status">{message}</p>}
      {loading ? <p role="status">{t('loadingUsers')}</p> : (
        <div className="user-list">
          {users.map((user) => (
            <form key={`${user.id}-${revision}`} className="user-row" onSubmit={(event) => save(event, user)} aria-label={user.username}>
              <strong>{user.username}</strong>
              <label className="upload-field"><span>{t('role')}</span><select name="role" defaultValue={user.role}>{roles.map((role) => <option key={role.name} value={role.name}>{t(`roles.${role.name}`)}</option>)}</select></label>
              <label className="user-active"><input name="active" type="checkbox" defaultChecked={user.active} />{t('accountActive')}</label>
              <button type="submit" className="auth-panel__button" disabled={busy}>{t('saveChanges')}</button>
            </form>
          ))}
          <button type="button" className="auth-panel__button" disabled={busy} onClick={() => setRevision((value) => value + 1)}>{t('retry')}</button>
        </div>
      )}
    </section>
  );
}