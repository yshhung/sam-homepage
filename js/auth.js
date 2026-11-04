// Microsoft 登入（MSAL）與 Microsoft Graph 呼叫
import { CONFIG } from '../config.js';

// Files.ReadWrite：你自己 OneDrive 的首頁資料；Files.Read.All：讀和果 SharePoint 的匯出檔；
// Mail.Read：只讀需回覆的信，首頁不能改、不能刪你的信
const SCOPES = ['User.Read', 'Files.ReadWrite', 'Files.Read.All', 'Calendars.Read', 'Mail.Read'];
// 記住上次登入的帳號（只有電子郵件，沒有密碼或憑證），下次自動帶入、不用再選帳號
const HINT_KEY = 'samhome.loginHint';
let pca = null;
let account = null;
let redirecting = false;

function saveHint(acc) {
  try { if (acc?.username) localStorage.setItem(HINT_KEY, acc.username); } catch { /* 私密瀏覽 */ }
}
function loginHint() {
  try { return localStorage.getItem(HINT_KEY) || undefined; } catch { return undefined; }
}

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
  // 裝置上的登入資料不見了（例如清過網站資料），但記得帳號：先在背景試一次，不行才讓你按登入
  if (!account && loginHint()) {
    try {
      account = (await pca.ssoSilent({ scopes: SCOPES, loginHint: loginHint() })).account;
    } catch { /* 背景登入不行（iPhone 常擋），就顯示登入按鈕 */ }
  }
  if (account) { pca.setActiveAccount(account); saveHint(account); }
  return account;
}

export function getAccount() {
  return account;
}

// 用整頁跳轉而不是彈出視窗：iPhone 主畫面 App 不支援彈出視窗。
// 帶入記住的帳號、不強制選帳號：微軟那邊還記得你時，會自動跳回來、不用再輸入
export function login() {
  return pca.loginRedirect({ scopes: SCOPES, loginHint: loginHint() });
}

export function logout() {
  try { localStorage.removeItem(HINT_KEY); } catch { /* 私密瀏覽 */ }
  return pca.logoutRedirect({ account });
}

// 通行證（約 1 小時）過期時 MSAL 會自己換新；換新用的憑證微軟規定網頁版只能用 24 小時，
// 過了就要回微軟那邊重拿一次：先在背景試，不行才整頁跳轉（微軟記得你時只會閃一下就回來）
async function getToken() {
  try {
    return (await pca.acquireTokenSilent({ scopes: SCOPES, account })).accessToken;
  } catch (e) {
    if (!(e instanceof msal.InteractionRequiredAuthError)) throw e;
    try {
      const r = await pca.ssoSilent({ scopes: SCOPES, loginHint: account?.username || loginHint() });
      account = r.account;
      pca.setActiveAccount(account);
      return r.accessToken;
    } catch { /* 背景不行，改整頁跳轉 */ }
    if (!redirecting) {
      redirecting = true; // 好幾個資料同時要通行證時，只跳轉一次
      await pca.acquireTokenRedirect({ scopes: SCOPES, account, loginHint: account?.username || loginHint() });
    }
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
