const ANDROID_ORIGIN='https://appassets.androidplatform.net';
const inAPK=location.origin===ANDROID_ORIGIN && location.pathname==='/kolorist/index.html';
const installHash='ab1ccfa025224f37909e00c78418dd6a7893353ca12dff313b2067a843feb399';
let database;
let stored;
let writes=Promise.resolve();
let browserBackup;
let serial=0;
const androidPending=new Map();

const androidPort=inAPK?new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{window.removeEventListener('message',accept);reject(new Error('Связь с приложением недоступна.'));},8000);
  function accept(event) {
    if (event.data!=='kolorist-android-v2' || event.ports.length!==1) return;
    window.removeEventListener('message',accept);
    clearTimeout(timer);
    const port=event.ports[0];
    port.onmessage=event=>{
      const reply=JSON.parse(event.data);
      const waiting=androidPending.get(reply.id);
      if (!waiting) return;
      androidPending.delete(reply.id);
      if (reply.error) waiting.reject(new Error(reply.error));
      else waiting.resolve(reply.value);
    };
    resolve(port);
  }
  window.addEventListener('message',accept);
}):null;

async function androidCall(operation,fields) {
  const port=await androidPort;
  return new Promise((resolve,reject)=>{
    const id=++serial;
    androidPending.set(id,{resolve,reject});
    try {port.postMessage(JSON.stringify({id,operation,...fields}));}
    catch(error) {androidPending.delete(id);reject(error);}
  });
}

function openDatabase() {
  return database??=new Promise((resolve,reject)=>{
    const request=indexedDB.open('kolorist-local-cabinet',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('cabinet');
    request.onsuccess=()=>{request.result.onversionchange=()=>request.result.close();resolve(request.result);};
    request.onerror=()=>reject(new Error('Не удалось открыть хранилище.'));
    request.onblocked=()=>reject(new Error('Закройте другие окна кабинета и откройте его снова.'));
  });
}

async function dbAction(mode, operation) {
  const db=await openDatabase();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('cabinet',mode);
    const store=tx.objectStore('cabinet');
    let result, failure;
    const get=(key,callback)=>{
      const request=store.get(key);
      request.onsuccess=()=>{
        try {callback(request.result);}
        catch(error) {failure=error;tx.abort();}
      };
    };
    tx.oncomplete=()=>resolve(result);
    tx.onabort=()=>reject(failure||new Error('Не удалось записать данные. Проверьте свободное место.'));
    try {operation(store,get,value=>{result=value;});}
    catch(error) {failure=error;tx.abort();}
  });
}

const getDB=key=>dbAction('readonly',(_store,get,done)=>get(key,done));
const putDB=(key,value)=>dbAction('readwrite',(store)=>store.put(value,key));

const BACKUP_REMINDER_KEY='backup-reminder-at';
const BACKUP_REMINDER_INTERVAL=3*24*60*60*1000;

function backupReminderPlan(next,now,hasRecords) {
  if (!Number.isSafeInteger(next) || next<=0 || next>now+BACKUP_REMINDER_INTERVAL) {
    return {next:now+BACKUP_REMINDER_INTERVAL,show:false};
  }
  return next<=now && hasRecords
    ? {next:now+BACKUP_REMINDER_INTERVAL,show:true}
    : {next,show:false};
}

async function claimBackupReminder(hasRecords) {
  const now=Date.now();
  if (inAPK) {
    const next=await androidCall('getBackupReminder',{});
    const plan=backupReminderPlan(next,now,hasRecords);
    if (plan.next!==next) await androidCall('setBackupReminder',{next:plan.next});
    return plan.show;
  }
  return dbAction('readwrite',(store,get,done)=>get(BACKUP_REMINDER_KEY,next=>{
    const plan=backupReminderPlan(next,now,hasRecords);
    if (plan.next!==next) store.put(plan.next,BACKUP_REMINDER_KEY);
    done(plan.show);
  }));
}

function postponeBackupReminder() {
  const next=Date.now()+BACKUP_REMINDER_INTERVAL;
  return inAPK ? androidCall('setBackupReminder',{next}) : putDB(BACKUP_REMINDER_KEY,next);
}

function readPickedFile() {
  return new Promise((resolve,reject)=>{
    const input=document.createElement('input');
    input.type='file';
    input.accept='.kolorist,.json,application/json,application/octet-stream';
    input.hidden=true;
    document.body.append(input);
    input.addEventListener('cancel',()=>{input.remove();resolve(null);},{once:true});
    input.addEventListener('change',async ()=>{
      const file=input.files[0];
      input.remove();
      try {
        if (!file) {resolve(null);return;}
        requireThat(file.size<=MAX_BACKUP+BACKUP_HEADER+16,'Копия превышает 24 МБ.');
        const bytes=new Uint8Array(await file.arrayBuffer());
        if (protectedBackup(bytes)) {
          browserBackup=bytes;
          resolve({protected:true});
        } else resolve({protected:false,json:await unsealBackup(bytes,null)});
      } catch(error) {reject(error);}
    },{once:true});
    input.click();
  });
}

async function native(operation,fields={}) {
  if (inAPK) return androidCall(operation,fields);
  switch (operation) {
    case 'isActivated':return (await getDB('activation'))===true;
    case 'activate': {
      const code=String(fields.code).toUpperCase().replace(/[\s-]/g,'');
      if (!/^[A-Z0-9]{12}$/.test(code)) return false;
      const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(code));
      const hash=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
      if (hash!==installHash) return false;
      await putDB('activation',true);
      return true;
    }
    case 'tourDone':return (await getDB('tutorial-v2'))===true;
    case 'finishTour':await putDB('tutorial-v2',true);return true;
    case 'exportBackup': {
      const contents=await sealBackup(fields.json,fields.password);
      return new File([contents],'kolorist-'+fields.date+'.kolorist',{type:contents.type});
    }
    case 'openBackup':browserBackup=null;return readPickedFile();
    case 'unlockBackup':
      requireThat(browserBackup,'Выберите защищённую копию снова.');
      return unsealBackup(browserBackup,fields.password);
    default:throw new Error('Действие недоступно.');
  }
}

function normalizeState(raw) {
  const value=raw||fresh();
  return {...value,preferences:preferencesFrom(value.preferences)};
}

async function read() {
  if (inAPK) stored=normalizeState(await androidCall('read',{}));
  else stored=normalizeState(await dbAction('readonly',(_store,get,done)=>get('data',data=>
    get('draft-v2',entry=>{
      if (data && entry?.epoch===(data.draftEpoch||'')) done({...data,draft:entry.draft});
      else if (!data && entry?.epoch==='') done({...fresh(),draft:entry.draft});
      else done(data);
    }))));
  return stored;
}

// Черновик пишется отдельно, чтобы набор текста не переписывал историю.
function saveDraft(draft) {
  return queue(async ()=>{
    const entry={epoch:stored.draftEpoch||'',draft};
    if (inAPK) return androidCall('writeDraft',{json:JSON.stringify(entry)});
    return dbAction('readwrite',(store,get)=>get('data',current=>{
      requireThat((current?.draftEpoch||'')===entry.epoch,'Черновик изменился в другом окне. Откройте кабинет заново.');
      store.put(entry,'draft-v2');
    }));
  });
}

function queue(action) {
  const result=writes.then(action);
  writes=result.catch(()=>{});
  return result;
}

function change(update, clearDraft=false) {
  return queue(async ()=>{
    const prepare=current=>{
      const result=update(normalizeState(current));
      return {...result,
        draftEpoch:clearDraft?uid():result.draftEpoch||'',
        draft:clearDraft?null:result.draft};
    };
    if (inAPK) {
      const next=prepare(stored);
      // Состояние черновика ведёт отдельный файл. Старое поле сохраняется до
      // первой успешной записи или завершения визита.
      await androidCall('write',{json:JSON.stringify(next)});
      stored=next;
    } else {
      stored=await dbAction('readwrite',(store,get,done)=>get('data',current=>{
        const next=prepare(current);
        store.put(next,'data');
        if (clearDraft) store.delete('draft-v2');
        done(next);
      }));
    }
    return stored;
  });
}
