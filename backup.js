const MAX_BACKUP = 24_000_000;
const BACKUP_HEADER = 32;
const BACKUP_MAGIC = [75,76,66,49]; // KLB1, совместимо с APK 1.2.2 и новее.
const BACKUP_INVALID = 'Пароль не подошёл или файл повреждён.';
function protectedBackup(bytes) {
  return BACKUP_MAGIC.every((value,index)=>bytes[index]===value);
}
async function archiveKey(password,salt,operation) {
  const buffer=new TextEncoder().encode(password);
  try {
    const material=await crypto.subtle.importKey('raw',buffer,'PBKDF2',false,['deriveKey']);
    return await crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:600000,hash:'SHA-256'},
      material,{name:'AES-GCM',length:256},false,[operation]);
  } finally {buffer.fill(0);}
}
async function sealBackup(json,password) {
  requireThat(password.trim() && password.length>=8 && password.length<=128,'Введите пароль от 8 до 128 символов.');
  const plaintext=new TextEncoder().encode(json);
  try {
    requireThat(plaintext.length<=MAX_BACKUP,'Копия превышает 24 МБ.');
    const header=crypto.getRandomValues(new Uint8Array(BACKUP_HEADER));
    header.set(BACKUP_MAGIC);
    const key=await archiveKey(password,header.subarray(4,20),'encrypt');
    const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv:header.subarray(20),additionalData:header,tagLength:128},key,plaintext);
    return new Blob([header,encrypted],{type:'application/octet-stream'});
  } finally {plaintext.fill(0);}
}
async function unsealBackup(bytes,password) {
  requireThat(bytes.length<=MAX_BACKUP+BACKUP_HEADER+16,'Копия превышает 24 МБ.');
  if (!protectedBackup(bytes)) {
    requireThat(bytes.length<=MAX_BACKUP,'Копия превышает 24 МБ.');
    return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  }
  requireThat(password && password.length<=128 && bytes.length>=BACKUP_HEADER+16,BACKUP_INVALID);
  const header=bytes.subarray(0,BACKUP_HEADER);
  const key=await archiveKey(password,header.subarray(4,20),'decrypt');
  let plaintext;
  try {
    plaintext=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:header.subarray(20),additionalData:header,tagLength:128},key,bytes.subarray(BACKUP_HEADER)));
    return new TextDecoder('utf-8',{fatal:true}).decode(plaintext);
  } catch {throw new Error(BACKUP_INVALID);}
  finally {plaintext?.fill(0);}
}
