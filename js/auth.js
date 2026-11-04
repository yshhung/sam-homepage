// Microsoft 登入（MSAL）與 Microsoft Graph 呼叫
import { CONFIG } from '../config.js';

// Files.ReadWrite：你自己 OneDrive 的首頁資料；Files.Read.All：讀和果 SharePoint 的匯出檔；
// Mail.Read：只讀需回覆的信，首頁不能改、不能刪你的信
const SCOPES = ['User.Read', 'Files.ReadWrite', 'Files.Read.All', 'Calendars.Read', 'Mail.Read'];
let pca = null;
let account = null;

export function isConfigured() {
  return Boolean(CONFIG.clientId) && Boolean(window.msal);
}

export async function initAuth() {
  if (!isConfigured()) return null;
  pca = new msal.PublicClientApplication({
    auth: {
      clientId: CONFIG.clientId,
      authority: `https://login.microsoftonline.com/${CONFIG.tenantId}`,
      redirectUri: location.origin + location.pathname.replace(/[^/]*$/, ''),
    },
    // localStorage：iPhone 加到主畫面後重開也不用重新登入
    cache: { cacheLocation: 'localStorage' },
  });
  await pca.initialize();
  const res = await pca.handleRedirectPromise();
  account = res?.account || pca.getAllAccounts()[0] || null;
  if (account) pca.setActiveAccount(account);
  return account;
}

export function getAccount() {
  return account;
}

// 用整頁跳轉而不是彈出視窗：iPhone 主畫面 App 不支援彈出視窗
export function login() {
  return pca.loginRedirect({ scopes: SCOPES, prompt: 'select_account' });
}

export function logout() {
  return pca.logoutRedirect({ account });
}

async function getToken() {
  try {
    return (await pca.acquireTokenSilent({ scopes: SCOPES, account })).accessToken;
  } catch (e) {
    if (e instanceof msal.InteractionRequiredAuthError) await pca.acquireTokenRedirect({ scopes: SCOPES, account });
    throw e;
  }
}

export class GraphError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export async function graph(path, { method = 'GET', body, headers = {}, raw = false } = {}) {
  const token = await getToken();
  const isJson = body !== undefined && !(body instanceof ArrayBuffer) && !(body instanceof Blob);
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(isJson ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: isJson ? JSON.stringify(body) : body,
  });
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).error?.message || msg; } catch { /* 沒有內容 */ }
    throw new GraphError(res.status, msg);
  }
  if (raw || res.status === 204) return res;
  const type = res.headers.get('content-type') || '';
  return type.includes('json') ? res.json() : res;
}
