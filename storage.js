import {fresh} from './model.js';
function open() {
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open('kolorist-local-cabinet',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('cabinet');
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
    request.onblocked=()=>reject(new Error('Закройте другие окна кабинета и повторите.'));
  });
}
export const database=open();
export async function read() {
  const db=await database;
  return new Promise((resolve,reject)=>{
    const transaction=db.transaction('cabinet','readonly');
    const request=transaction.objectStore('cabinet').get('data');
    request.onsuccess=()=>resolve(request.result||fresh());
    request.onerror=()=>reject(request.error);
  });
}
export async function change(update) {
  const db=await database;
  return new Promise((resolve,reject)=>{
    const transaction=db.transaction('cabinet','readwrite');
    const store=transaction.objectStore('cabinet');
    const request=store.get('data');
    let next, failure;
    request.onsuccess=()=>{
      try {
        next=update(request.result||fresh());
        store.put(next,'data');
      } catch(error) {failure=error;transaction.abort();}
    };
    transaction.oncomplete=()=>resolve(next);
    transaction.onabort=()=>reject(failure||new Error('Запись не сохранилась. Проверьте свободное место и повторите.'));
  });
}

// Активация хранится отдельно от записей, поэтому импорт JSON её не меняет.
export async function isActivated() {
  const db=await database;
  return new Promise((resolve,reject)=>{
    const txn=db.transaction('cabinet','readonly');
    const request=txn.objectStore('cabinet').get('activation');
    request.onsuccess=()=>resolve(request.result===true);
    request.onerror=()=>reject(request.error);
  });
}

export async function rememberActivation() {
  const db=await database;
  return new Promise((resolve,reject)=>{
    const txn=db.transaction('cabinet','readwrite');
    txn.objectStore('cabinet').put(true,'activation');
    txn.oncomplete=()=>resolve();
    txn.onabort=()=>reject(new Error('Не удалось запомнить код. Откройте приложение в обычном окне Safari.'));
  });
}
