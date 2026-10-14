// Temporary compatibility for links from the not-yet-migrated search page.
export function selectedUserId() {
  const query = new URLSearchParams(location.search).get('id');
  if (query) return query;
  const legacy = localStorage.getItem('user_id');
  if (legacy) { localStorage.removeItem('user_id'); history.replaceState(null, '', `user.html?id=${encodeURIComponent(legacy)}`); }
  return legacy;
}
