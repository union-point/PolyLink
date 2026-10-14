// One switch for every migrated page. Mock mode never contacts the backend.
export const config = Object.freeze({
  dataMode: 'mock',
  apiBaseUrl: 'http://localhost:3004',
  axiosUrl: 'https://cdn.jsdelivr.net/npm/axios@1.13.2/dist/axios.min.js',
  mockDatabase: 'polylink-demo-v1',
  mockSchemaVersion: 1,
});
