// Profile identity travels in the URL, so links survive reload and sharing.
export function selectedUserId() {
  return new URLSearchParams(location.search).get('id');
}
