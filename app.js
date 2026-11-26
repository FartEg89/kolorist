import {units,uid,money,unitPrice,today,showDate,blankVisit,calculate,report,newest,discount,price,priceFromPackage,priceWithMarkup,fixed,date,backup,restore,requireThat} from './model.js';
import {read,change,isActivated,rememberActivation} from './storage.js';
import {matchesCode} from './activation.js';

const $=id=>document.getElementById(id);
const root=$('content');
const dialog=$('dialog');
const body=$('dialog-body');
let state,draft,tab='visit',toastTimer;
let pendingDraft=Promise.resolve();
let savingVisit=false;
let reportMode='day',reportDate=today();
let visitLists=new Set();
const clone=value=>JSON.parse(JSON.stringify(value));

function el(tag,text,style) {
  const node=document.createElement(tag);
  if (text!==undefined) node.textContent=text;
  if (style) node.className=style;
  return node;
}
function box(tag,style,...children) {
  const node=el(tag,undefined,style);
  node.append(...children);
  return node;
}
const panel=(...items)=>box('div','panel stack',...items);
const actions=(...items)=>box('div','actions',...items);
const dim=text=>el('p',text,'muted');
function notify(text) {
  const toast=$('toast');
  toast.textContent=text;
  toast.hidden=false;
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>{toast.hidden=true;},5000);
}
function run(control,action) {
  if (control.disabled) return;
  control.disabled=true;
  return Promise.resolve().then(action).catch(error=>notify(error.message||'Не удалось выполнить действие.')).finally(()=>{control.disabled=false;});
}
function b(text,action,style) {
  const node=el('button',text,style);
  node.type='button';
  node.onclick=()=>run(node,action);
  return node;
}
function input(name,value,options={}) {
  const node=el(options.rows?'textarea':'input');
  node.name=name;
  Object.assign(node,options);
  node.value=value??'';
  return node;
}
function choose(name,value,options) {
  const node=el('select');
  node.name=name;
  for (const [key,text] of options) {
    const option=el('option',text);
    option.value=key;
    node.append(option);
  }
  node.value=value;
  return node;
}
function label(text,field) { return box('label','',document.createTextNode(text),field); }
function form(handler,buttonText,...fields) {
  const go=el('button',buttonText,'primary');
  go.type='submit';
  const node=box('form','stack',...fields,go);
  node.onsubmit=event=>{
    event.preventDefault();
    run(go,()=>handler(Object.fromEntries(new FormData(node)),node));
  };
  return node;
}
function details(title,contents,opened=false) {
  const node=box('details','',el('summary',title),contents);
  node.open=opened;
  return node;
}
function show(title,...items) {
  $('dialog-title').textContent=title;
  body.replaceChildren(...items);
  if (!dialog.open) dialog.showModal();
}
function confirm(title,text,accept,labelText='Подтвердить') {
  show(title,box('div','stack',dim(text),actions(b('Отмена',()=>dialog.close()),b(labelText,accept,'danger'))));
}
function jump(next) {
  if (savingVisit) return;
  tab=next;
  render();
  window.scrollTo(0,0);
}
async function write(update) { state=await change(update); }
function remember() {
  const snapshot=clone(draft);
  pendingDraft=pendingDraft.catch(()=>{}).then(()=>write(data=>({...data,draft:snapshot})));
  pendingDraft.catch(()=>notify('Черновик не записался. Проверьте свободное место.'));
}
function setDraft(next) {
  draft=next;
  visitLists=new Set();
  remember();
  jump('visit');
}
const discountFields = row => box('div','duo',
  label('Размер',input('amount',row.amount,{inputMode:'decimal',placeholder:'0'})),
  label('Единица',choose('type',row.type,[['%','%'],['₽','₽']])),
  label('Применить к',choose('target',row.target,[['работа','Работе'],['весь_чек','Всему чеку']])));
function personLabel() { return draft.name||'Без клиента'; }
function setPerson(person) {
  const benefit=person?.benefit?discount(person):discount({});
  Object.assign(draft,{...benefit,client:person?.id||'',name:person?.name||''});
  remember();
  dialog.close();
  render();
}
function chooseClient() {
  const search=input('search','',{type:'search',placeholder:'Имя или телефон'});
  const results=box('div','stack');
  function list() {
    const q=search.value.trim().toLocaleLowerCase('ru');
    const matching=state.clients.filter(row=>row.name.toLocaleLowerCase('ru').includes(q)||row.phone.includes(q));
    results.replaceChildren(...matching.slice(0,30).map(row=>b(row.name,()=>setPerson(row))));
    if (!matching.length) results.append(dim(q?'Никого не нашли.':'Здесь появятся ваши клиенты.'));
    if (matching.length>30) results.append(dim('Уточните поиск, чтобы найти нужного клиента.'));
  }
  search.oninput=list;
  list();
  show('Кто пришёл?',box('div','stack',label('Найти клиента',search),
    actions(b('Без клиента',()=>setPerson(null)),b('Новый клиент',()=>clientForm(null,true),'primary')),results));
}
function materialList(output) {
  const result=box('div','stack');
  const active=new Map(state.materials.filter(row=>row.active).map(row=>[row.id,row]));
  for (const snap of draft.original) {
    active.set(snap.id,draft.refresh?(state.materials.find(row=>row.id===snap.id)||snap):snap);
  }
  for (const [unit,name] of Object.entries(units)) {
    const rows=[...active.values()].filter(row=>row.unit===unit);
    if (!rows.length) continue;
    const count=()=>rows.filter(row=>Number(String(draft.qty[row.id]??'').replace(',','.'))>0).length;
    const items=box('div','stack');
    let group;
    for (const row of rows) {
      const field=input('qty',Object.hasOwn(draft.qty,row.id)?draft.qty[row.id]:'',{inputMode:'decimal',placeholder:'0'});
      field.setAttribute('aria-label',row.name+', количество');
      const update=()=>{
        if (field.value.trim()) draft.qty[row.id]=field.value;
        else delete draft.qty[row.id];
        group.firstChild.textContent=name+(count()?' · '+count():'');
        remember();
        output();
      };
      field.oninput=update;
      const step=sign=>{
        field.value=Math.min(100000,Math.max(0,fixed(field.value,'Количество',100000,3)/1000+sign*(unit==='г'?5:1)));
        update();
      };
      const minus=b('−',()=>step(-1)),plus=b('+',()=>step(1));
      minus.setAttribute('aria-label','Уменьшить количество: '+row.name);
      plus.setAttribute('aria-label','Увеличить количество: '+row.name);
      items.append(box('div','item',box('div','',el('strong',row.name),dim(unitPrice(row.retail)+' за 1 '+unit)),box('div','qty',minus,field,plus)));
    }
    group=details(name+(count()?' · '+count():''),items,visitLists.has(unit)||count()>0);
    group.ontoggle=()=>group.open?visitLists.add(unit):visitLists.delete(unit);
    result.append(group);
  }
  for (const id of Object.keys(draft.qty).filter(id=>!active.has(id))) result.append(b('Убрать недоступный расходник',()=>{
    delete draft.qty[id];
    remember();
    render();
  }));
  if (!result.children.length) result.append(dim('Расходники можно добавить во вкладке «Ещё».'));
  return result;
}
function editVisit(row) {
  dialog.close();
  const open=()=>setDraft({...blankVisit(),id:row.id,editing:row.created,baseRevision:row.revision??1,date:row.date,
    client:row.client,name:row.name,work:row.work/100,note:row.note,recipe:row.recipe,
    type:row.type,target:row.target,amount:row.amount,original:row.items,qty:Object.fromEntries(row.items.map(x=>[x.id,x.qty]))});
  if ((!draft.editing || draft.id!==row.id) && hasDraft()) confirm('Открыть визит?','Текущий черновик будет заменён.',()=>{dialog.close();open();},'Открыть');
  else open();
}
function hasDraft() {
  return Boolean(draft.editing||draft.client||draft.work||draft.recipe||draft.note||draft.amount||Object.keys(draft.qty).length);
}
function historyToDraft(row,person,withMaterials) {
  const open=()=>{
    const next={...blankVisit(),client:person.id,name:person.name,recipe:row.recipe,...(person.benefit?discount(person):{})};
    if (withMaterials) {
      next.work=row.work/100;
      next.qty=Object.fromEntries(row.items.filter(x=>state.materials.some(m=>m.id===x.id&&m.active)).map(x=>[x.id,x.qty]));
    }
    dialog.close();
    setDraft(next);
  };
  const emptyForClient=!draft.editing && draft.client===person.id && !draft.work && !draft.recipe && !draft.note && !Object.keys(draft.qty).length &&
    (!draft.amount || (person.benefit && Number(draft.amount)===person.amount && draft.type===person.type && draft.target===person.target));
  if (hasDraft() && !emptyForClient) confirm('Заполнить новый визит?','Текущий черновик будет заменён.',open,'Заполнить');
  else open();
}
function visitPage() {
  const title=el('h1',draft.editing?'Редактирование визита':'Новый визит');
  const header=box('div','head',title);
  if (draft.editing) header.append(b('Отменить правку',()=>confirm('Закрыть правку?','Изменения черновика будут удалены.',()=>{
    dialog.close();setDraft(blankVisit());
  },'Закрыть')));
  const selected=state.clients.find(x=>x.id===draft.client);
  const previous=selected&&state.visits.filter(x=>x.client===selected.id).sort(newest)[0];
  const person=panel(box('div','row',el('strong',personLabel()),b(draft.client?'Изменить':'Выбрать клиента',chooseClient)));
  if (previous && !draft.editing) person.append(b('Повторить прошлый визит',()=>historyToDraft(previous,selected,true)));
  const work=input('work',draft.work,{inputMode:'decimal',placeholder:'0'});
  const day=input('date',draft.date,{type:'date',required:true});
  const recipe=input('recipe',draft.recipe,{rows:3,maxLength:5000,placeholder:'Например, 7.1 + оксид 3%'});
  const note=input('note',draft.note,{rows:2,maxLength:3000});
  const amount=el('strong','0 ₽','amount'),fund=el('span'),net=el('span'),saving=el('p','','muted');
  const error=el('p','','danger');
  error.hidden=true;
  const update=()=>{
    try {
      const bill=calculate(draft,state.materials);
      amount.textContent=money(bill.total);
      fund.textContent='На закупку '+money(bill.fund);
      net.textContent='Чистыми '+money(bill.net);
      net.classList.toggle('danger',bill.net<0);
      saving.textContent=bill.saving?'Скидка '+money(bill.saving):'';
      saving.hidden=!bill.saving;
      error.hidden=true;
    } catch(e) {
      error.textContent=e.message;
      error.hidden=false;
      amount.textContent='—';
      fund.textContent='';
      net.textContent='';
      saving.hidden=true;
    }
  };
  const amounts=box('aside','bill',box('div','summary',el('strong','Итог чека'),amount),box('div','row',fund,net),saving,error);
  const recipes=details('Формула окрашивания и заметка',box('div','stack',label('Формула',recipe),label('Заметка',note)),Boolean(draft.recipe||draft.note));
  const discounts=details('Скидка',discountFields(draft),Boolean(draft.amount));
  const materials=box('div','stack',el('h2','Расходники'),materialList(update));
  if (draft.editing && draft.original.length) materials.append(b(draft.refresh?'Вернуть цены визита':'Обновить цены в этом визите',()=>{
    const apply=()=>{draft.refresh=!draft.refresh;remember();dialog.close();render();};
    if (draft.refresh) apply();
    else confirm('Обновить цены?','Будут использованы текущие цены справочника.',apply,'Обновить');
  }));
  const visitForm=form(async ()=>{
    const savingDraft=clone(draft);
    savingVisit=true;
    visitForm.inert=true;
    let saved;
    try {
      await pendingDraft.catch(()=>{});
      await write(data=>{
        const current=data.visits.find(v=>v.id===savingDraft.id);
        if (savingDraft.editing) {
          requireThat(current && current.created===savingDraft.editing &&
            (current.revision??1)===(savingDraft.baseRevision??1),'Визит изменился. Откройте его заново из итогов.');
        } else requireThat(!current,'Этот визит уже сохранён.');
        const math=calculate(savingDraft,data.materials);
        saved={...math,id:savingDraft.id,date:date(savingDraft.date),client:savingDraft.client,name:savingDraft.name,
          recipe:savingDraft.recipe.trim(),note:savingDraft.note.trim(),created:current?.created||new Date().toISOString(),
          revision:current?(current.revision??1)+1:1};
        return {...data,draft:null,visits:data.visits.filter(v=>v.id!==saved.id).concat(saved)};
      });
    } finally {
      savingVisit=false;
      visitForm.inert=false;
    }
    draft=blankVisit();
    visitLists=new Set();
    jump(savingDraft.editing?'report':'visit');
    notify('Визит сохранён · '+money(saved.total));
  },draft.editing?'Сохранить изменения':'Сохранить визит',person,panel(label('Стоимость работы, ₽',work),label('Дата',day)),materials,recipes,discounts,amounts);
  amounts.append(visitForm.lastChild);
  visitForm.oninput=event=>{
    if (['work','date','recipe','note','amount','target','type'].includes(event.target.name)) {
      draft[event.target.name]=event.target.value;
      remember();
      update();
    }
  };
  update();
  return box('section','',header,visitForm);
}
function clientForm(existing=null,pick=false) {
  const row=existing||{id:uid(),name:'',phone:'',note:'',benefit:false,...discount({})};
  const benefit=input('benefit','yes',{type:'checkbox',checked:row.benefit});
  const discountBox=discountFields(row);
  discountBox.hidden=!benefit.checked;
  benefit.onchange=()=>{discountBox.hidden=!benefit.checked;};
  show(existing?'Изменить карточку':'Новый клиент',form(async fields=>{
    requireThat(fields.name.trim(),'Укажите имя клиента.');
    const record={id:row.id,name:fields.name.trim(),phone:fields.phone.trim(),note:fields.note.trim(),benefit:benefit.checked,...discount(fields)};
    await write(data=>({...data,clients:data.clients.filter(x=>x.id!==record.id).concat(record)}));
    if (pick) setPerson(record);
    else {
      dialog.close();
      render();
    }
    notify('Клиент сохранён');
  },'Сохранить клиента',label('Имя',input('name',row.name,{maxLength:120,required:true})),
  label('Телефон',input('phone',row.phone,{type:'tel',maxLength:60})),label('Заметка',input('note',row.note,{rows:2,maxLength:2000})),
  label('Индивидуальная скидка',benefit),discountBox));
}
function clientCard(row) {
  const history=state.visits.filter(x=>x.client===row.id).sort(newest);
  const description=box('div','stack',el('p',row.phone||'Телефон не указан'));
  if (row.note) description.append(el('p',row.note,'prewrap'));
  if (row.benefit) description.append(dim('Скидка '+row.amount+' '+row.type+(row.target==='работа'?' на работу':' на весь чек')));
  description.append(actions(b('Изменить',()=>clientForm(row)),b('Удалить',()=>confirm('Удалить клиента?',
    'Сохранённые визиты и формулы останутся в итогах.',async ()=>{
      await write(data=>({...data,clients:data.clients.filter(x=>x.id!==row.id)}));
      if (draft.client===row.id && !draft.editing) setPerson(null);
      dialog.close();
      render();
      notify('Клиент удалён');
    },'Удалить'),'danger')));
  const host=box('div','stack');
  if (!history.length) host.append(dim('Визитов пока нет.'));
  appendPages(host,history,visit=>box('article','record',el('strong',showDate(visit.date)+' · '+money(visit.total)),
    el('p',visit.recipe||'Формула не записана.','prewrap'),actions(
      b('Открыть визит',()=>editVisit(visit)),...(visit.recipe?[b('Копировать формулу',()=>historyToDraft(visit,row,false))]:[]))));
  show(row.name,box('div','stack',description,el('h3','История визитов'),host));
}
function appendPages(host,records,renderRow) {
  let offset=0;
  function page() {
    host.append(...records.slice(offset,offset+30).map(renderRow));
    offset+=30;
    if (offset<records.length) host.append(b('Показать ещё',()=>{
      host.lastElementChild.remove();
      page();
    }));
  }
  page();
}
function clientsPage() {
  const search=input('search','',{type:'search',placeholder:'Имя или телефон'});
  const results=box('div','stack');
  function showMatches() {
    const q=search.value.trim().toLocaleLowerCase('ru');
    const rows=state.clients.filter(x=>x.name.toLocaleLowerCase('ru').includes(q)||x.phone.includes(q)).sort((a,b)=>a.name.localeCompare(b.name,'ru'));
    results.replaceChildren();
    if (!rows.length) results.append(panel(dim(q?'Никого не нашли.':'Добавьте первого клиента, чтобы хранить его формулы и историю.')));
    appendPages(results,rows,row=>box('article','record',box('div','row',box('div','',el('strong',row.name),dim(row.phone||'Телефон не указан')),
      b('Карточка',()=>clientCard(row)))));
  }
  search.oninput=showMatches;
  showMatches();
  return box('section','',box('div','head',el('h1','Клиенты'),b('Добавить',()=>clientForm(),'primary')),label('Поиск',search),results);
}
function visitCard(row) {
  const controls=actions(b('Изменить',()=>editVisit(row)),b('Удалить',()=>confirm('Удалить визит?',
    'Визит за '+showDate(row.date)+' исчезнет из истории и итогов.',async ()=>{
      await pendingDraft.catch(()=>{});
      await write(data=>({...data,visits:data.visits.filter(x=>x.id!==row.id),draft:data.draft?.id===row.id?null:data.draft}));
      if (draft.id===row.id) draft=blankVisit();
      dialog.close();
      render();
      notify('Визит удалён');
    },'Удалить'),'danger'));
  show(row.name||'Визит без клиента',box('div','stack',dim(showDate(row.date)),panel(
    box('div','row',el('strong','Чек'),el('strong',money(row.total))),dim('На закупку '+money(row.fund)+' · чистыми '+money(row.net))),
    ...(row.recipe?[el('p',row.recipe,'prewrap')]:[]),...(row.note?[el('p',row.note,'prewrap')]:[]),controls));
}
function reportPage() {
  const mode=choose('period',reportMode,[['day','День'],['month','Месяц']]);
  const picker=input('period-date',reportMode==='day'?reportDate:reportDate.slice(0,7),{type:reportMode==='day'?'date':'month',placeholder:'ГГГГ-ММ'});
  mode.onchange=()=>{reportMode=mode.value;render();};
  picker.onchange=()=>{
    try {
      reportDate=date(reportMode==='day'?picker.value:picker.value+'-01');
      render();
    } catch(error) {notify(error.message);}
  };
  const result=report(state,reportMode==='day'?reportDate:reportDate.slice(0,7));
  const metric=(title,value,negative=false)=>box('div','panel',dim(title),el('b',value,negative?'danger':''));
  const metrics=box('div','metrics',metric('Касса',money(result.total)),metric('Чистыми',money(result.net)),
    metric('Начислено на закупку',money(result.fund)),metric('Потрачено на закупку',money(result.expenses)),
    metric('Фонд за период',money(result.balance)+(result.balance<0?' · перерасход':''),result.balance<0),
    metric('Фонд за всё время',money(result.all)+(result.all<0?' · перерасход':''),result.all<0));
  const history=box('div','stack');
  if (!result.visits.length) history.append(panel(dim('За этот период визитов пока нет.')));
  appendPages(history,result.visits,row=>box('article','record',box('div','row',box('div','',el('strong',row.name||'Без клиента'),
    dim(showDate(row.date)+' · '+money(row.total))),b('Открыть',()=>visitCard(row)))));
  return box('section','',el('h1','Итоги'),box('div','panel duo',label('Период',mode),label(reportMode==='day'?'Дата':'Месяц',picker)),
    metrics,dim('Визитов: '+result.visits.length+' · средний чек '+money(result.average)),el('h2','Визиты периода'),history);
}
function purchaseForm() {
  show('Новая закупка',form(async fields=>{
    const row={id:uid(),date:date(fields.date),supplier:fields.supplier.trim(),note:fields.note.trim(),
      total:fixed(fields.total,'Сумма',10000000)};
    requireThat(row.total>0,'Укажите сумму больше нуля.');
    await write(data=>({...data,purchases:data.purchases.concat(row)}));
    dialog.close();
    render();
    notify('Закупка сохранена');
  },'Сохранить закупку',
    label('Сумма, ₽',input('total','',{inputMode:'decimal',required:true})),label('Дата',input('date',today(),{type:'date',required:true})),
    label('Поставщик',input('supplier','',{maxLength:120})),label('Описание',input('note','',{rows:2,maxLength:1000}))));
}
function purchasesPage() {
  const list=box('div','stack');
  const purchases=state.purchases.slice().sort(newest);
  if (!purchases.length) list.append(panel(dim('Закупок пока нет.')));
  appendPages(list,purchases,row=>box('article','record',box('div','row',el('strong',row.supplier||'Закупка'),el('strong',money(row.total))),
    dim(showDate(row.date)),...(row.note?[el('p',row.note,'prewrap')]:[]),
    b('Удалить закупку',()=>confirm('Удалить закупку?',money(row.total)+' за '+showDate(row.date),async ()=>{
      await write(data=>({...data,purchases:data.purchases.filter(x=>x.id!==row.id)}));
      dialog.close();
      render();
      notify('Закупка удалена');
    },'Удалить'),'danger')));
  return box('section','',box('div','head',el('h1','Закупки'),b('Добавить',purchaseForm,'primary')),list);
}
function materialForm(existing) {
  const row=existing||{id:uid(),name:'',unit:'г',cost:'',retail:'',active:true};
  const cost=input('cost',row.cost,{inputMode:'decimal'});
  const retail=input('retail',row.retail,{inputMode:'decimal'});
  const capacity=input('pack-size','',{inputMode:'decimal'});
  const packaging=input('pack-price','',{inputMode:'decimal'});
  const percent=input('markup','',{inputMode:'decimal',placeholder:'0'});
  const unit=choose('unit',row.unit,[['г','Граммы'],['доза','Дозы'],['шт','Штуки']]);
  unit.disabled=Boolean(existing);
  const calc=details('Рассчитать цену из упаковки',box('div','stack',
    label('Цена упаковки, ₽',packaging),label('Сколько граммов, доз или штук',capacity),
    b('Подставить цену закупки',()=>{cost.value=priceFromPackage(packaging.value,capacity.value);}),
    label('Наценка, %',percent),b('Подставить цену клиенту',()=>{retail.value=priceWithMarkup(cost.value,percent.value);})));
  const save=form(async fields=>{
    requireThat(fields.name.trim(),'Укажите название расходника.');
    const record={...row,name:fields.name.trim(),unit:unit.value,cost:price(fields.cost,'Цена закупки'),
      retail:price(fields.retail,'Цена клиенту')};
    await write(data=>({...data,materials:existing?data.materials.map(m=>m.id===row.id?record:m):data.materials.concat(record),revised:true}));
    dialog.close();
    render();
    notify('Расходник сохранён');
  },'Сохранить цены',label('Название',input('name',row.name,{required:true,maxLength:120})),label('Единица измерения',unit),
  label('Закупка за единицу, ₽',cost),label('Клиенту за единицу, ₽',retail),calc);
  const toggle=async ()=>{
    await write(data=>({...data,materials:data.materials.map(m=>m.id===row.id?{...m,active:!m.active}:m)}));
    dialog.close();
    render();
    notify(row.active?'Расходник в архиве':'Расходник возвращён');
  };
  show(existing?'Цены расходника':'Новый расходник',box('div','stack',save,...(existing?[b(
    row.active?'Архивировать':'Вернуть из архива',
    ()=>row.active?confirm('Архивировать расходник?','Цены в прежних визитах сохранятся.',toggle,'Архивировать'):toggle(),row.active?'danger':'')]:[])));
}
function materialsPage() {
  const head=box('div','head',el('h1','Расходники'),b('Добавить',()=>materialForm(),'primary'));
  const list=box('div','stack');
  const sorted=state.materials.slice().sort((a,b)=>Number(b.active)-Number(a.active));
  appendPages(list,sorted,row=>box('article','record',box('div','row',box('div','',
    el('strong',row.name+(row.active?'':' · архив')),dim(unitPrice(row.cost)+' закупка · '+unitPrice(row.retail)+' клиенту за 1 '+row.unit)),
  b('Изменить',()=>materialForm(row)))));
  return box('section','',head,dim('Начальные цены примерные. Проверьте каждый расходник перед первой записью.'),list);
}
function saveFile() {
  const file=new File([backup(state)],'kolorist-'+today()+'.json',{type:'application/json'});
  if (navigator.canShare?.({files:[file]})) {
    return navigator.share({files:[file]}).then(()=>notify('Копия передана в меню сохранения.')).catch(error=>{
      if (error.name!=='AbortError') downloadBackup(file);
    });
  }
  downloadBackup(file);
}
function downloadBackup(file) {
  const url=URL.createObjectURL(file);
  const link=el('a');
  link.href=url;
  link.download=file.name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
  notify('Резервная копия подготовлена.');
}
function backupsPage() {
  const pick=input('backup','',{type:'file',accept:'.json,application/json'});
  pick.onchange=async ()=>{
    const file=pick.files[0];
    if (!file) return;
    pick.value='';
    try {
      requireThat(file.size<=25000000,'Выберите JSON-копию размером до 25 МБ.');
      let parsed;
      try {parsed=JSON.parse(await file.text());}
      catch {throw new Error('Не удалось прочитать JSON. Выберите файл резервной копии.');}
      const imported=restore(parsed);
      confirm('Восстановить записи?',
        'Файл заменит местные записи. В копии визитов: '+imported.visits.length+', клиентов: '+imported.clients.length+'.',async ()=>{
          await pendingDraft.catch(()=>{});
          await write(()=>imported);
          draft=blankVisit();
          dialog.close();
          render();
          notify('Записи восстановлены.');
        },'Восстановить');
    } catch(error) {notify(error.message);}
  };
  return box('section','',el('h1','Резервная копия'),panel(
    dim('Сохраните JSON в приложении «Файлы». По этой копии можно восстановить клиентов, визиты, закупки и цены на другом телефоне.'),
    b('Сохранить копию в Файлы',saveFile,'primary'),label('Восстановить из файла',pick)),
    panel(el('h2','Переезд из Google Таблицы'),dim('Если там уже есть записи, скачайте JSON в настройках прежнего кабинета и выберите его здесь.')));
}
function morePage() {
  return box('section','',el('h1','Ещё'),panel(
    b('Закупки',()=>jump('purchases')),b('Расходники и цены',()=>jump('materials')),
    b('Резервная копия',()=>jump('backup'))),
    panel(el('h2','Работа на iPhone'),dim('Откройте ссылку в Safari, нажмите «Поделиться → На экран Домой». Затем откройте иконку с интернетом один раз.'),
      dim('Записи остаются в памяти этого устройства. Часовой пояс — Якутск.')));
}
const views={visit:visitPage,clients:clientsPage,report:reportPage,more:morePage,purchases:purchasesPage,materials:materialsPage,backup:backupsPage};
function render() {
  const back=Object.hasOwn(views,tab)&&!['visit','clients','report','more'].includes(tab);
  root.replaceChildren(...(back?[box('div','head',b('К разделу «Ещё»',()=>jump('more')))]:[]),views[tab]());
  for (const button of $('tabs').querySelectorAll('button')) {
    if (button.dataset.tab===(back?'more':tab)) button.setAttribute('aria-current','page');
    else button.removeAttribute('aria-current');
  }
}
function offlineStatus(text) { $('offline').textContent=text; }
async function activateOffline() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const registration=await navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'});
    await navigator.serviceWorker.ready;
    registration.update().catch(()=>{});
    offlineStatus('Готово к работе офлайн');
    if (window.matchMedia('(display-mode: standalone)').matches) navigator.storage?.persist?.().catch(()=>{});
  } catch {
    offlineStatus('Записи на устройстве');
  }
}
$('close').onclick=()=>dialog.close();
for (const button of $('tabs').querySelectorAll('button')) button.onclick=()=>jump(button.dataset.tab);
async function openCabinet() {
  state=await read();
  draft=state.draft||blankVisit();
  render();
  $('tabs').hidden=false;
  root.setAttribute('aria-busy','false');
}

function showActivation() {
  const code=input('code','',{type:'password',required:true,maxLength:28,autocapitalize:'characters',
    autocomplete:'off',spellcheck:false,placeholder:'XXXX-XXXX-XXXX'});
  const message=el('p','','danger');
  message.setAttribute('role','status');
  const unlock=form(async fields=>{
    message.textContent='';
    try {
      if (!await matchesCode(fields.code)) {
        message.textContent='Код не подошёл. Проверьте символы и попробуйте снова.';
        code.focus();
        return;
      }
      await rememberActivation();
      await openCabinet();
    } catch(error) {
      message.textContent=error.message||'Не удалось открыть кабинет.';
    }
  },'Открыть кабинет',label('Код установки',code),message);
  code.oninput=()=>{message.textContent='';};
  const help=details('Как добавить на iPhone',box('div','stack',
    dim('Откройте ссылку в Safari. Нажмите «Поделиться → На экран Домой → Добавить».'),
    dim('Откройте новую иконку и введите код уже там.')));
  root.replaceChildren(box('section','activation',el('h1','Открыть кабинет'),
    dim('Введите код, который вам передали. На этом устройстве его нужно ввести один раз.'),
    panel(unlock),help));
  root.setAttribute('aria-busy','false');
}

try {
  if (await isActivated()) await openCabinet();
  else showActivation();
  activateOffline();
} catch {
  root.replaceChildren(panel(el('h1','Память недоступна'),dim('Откройте кабинет в обычном окне Safari и попробуйте снова.')));
  root.setAttribute('aria-busy','false');
}
