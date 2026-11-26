// В приложении есть только отпечаток. Исходный код установки передаётся отдельно.
const expected='ab1ccfa025224f37909e00c78418dd6a7893353ca12dff313b2067a843feb399';

export async function matchesCode(value) {
  const code=String(value).trim().toUpperCase().replace(/[\s-]/g,'');
  if (!/^[A-Z2-9]{12}$/.test(code)) return false;
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(code));
  const hex=Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join('');
  return hex===expected;
}
