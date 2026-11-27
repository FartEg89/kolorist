const TZ = 'Asia/Yakutsk';
const units = {'г':'Граммы','доза':'Дозы','шт':'Штуки'};
const seed = [
  ['Краситель','г',5,8],['Порошок','г',3,5],['Оксид','г',.3,.6],
  ['Шампунь','доза',6,10],['Бальзам','доза',5,9],['Маска','доза',15,25],['Спрей','доза',8,14],['Лак','доза',6,10],
  ['Перчатки','шт',6,10],['Пеньюар','шт',12,20],['Полотенца','шт',10,15],['Фольга','шт',8,12]
];
function uid() {
  const bytes=crypto.getRandomValues(new Uint8Array(16));
  bytes[6]=(bytes[6]&15)|64;
  bytes[8]=(bytes[8]&63)|128;
  const hex=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
  return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-');
}
const rubles = new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2});
const quantityFormat = new Intl.NumberFormat('ru-RU',{maximumFractionDigits:3});
const prices = new Intl.NumberFormat('ru-RU',{maximumFractionDigits:6});
const ruDate = new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'});
let cabinetZone = TZ;
function defaultPreferences() {
  return {zone:TZ,name:'Кабинет колориста',theme:'system',step_g:5,step_dose:1,step_piece:1,
    defaultAmount:0,defaultType:'%',defaultTarget:'работа',expandMaterials:false,expandRecipe:false};
}
const stepKeys={'г':'step_g','доза':'step_dose','шт':'step_piece'};
function preferencesFrom(raw={}) {
  const p={...defaultPreferences(),...raw};
  const result=defaultPreferences();
  result.name=text(p.name,60,true);
  try { new Intl.DateTimeFormat('ru',{timeZone:p.zone}); }
  catch { throw new Error('Укажите корректный часовой пояс.'); }
  requireThat(typeof p.zone==='string' && p.zone.length<=60,'Укажите корректный часовой пояс.');
  result.zone=p.zone;
  requireThat(['system','light','dark'].includes(p.theme),'В копии неверная тема.');
  result.theme=p.theme;
  for (const key of Object.values(stepKeys)) {
    result[key]=fixed(p[key],'Шаг',10000,3)/1000;
    requireThat(result[key]>0,'Шаг должен быть больше нуля.');
  }
  const rule=discount({amount:p.defaultAmount,type:p.defaultType,target:p.defaultTarget});
  return Object.assign(result,{defaultAmount:rule.amount,defaultType:rule.type,defaultTarget:rule.target,
    expandMaterials:p.expandMaterials===true,expandRecipe:p.expandRecipe===true});
}
const money = value => rubles.format(value/100) + ' ₽';
const unitPrice = value => prices.format(value) + ' ₽';
const showDate = value => ruDate.format(new Date(value+'T00:00:00Z'));
function today(moment = new Date()) {
  const parts=new Intl.DateTimeFormat('en-GB',{year:'numeric',month:'2-digit',day:'2-digit',timeZone:cabinetZone});
  const d=Object.fromEntries(parts.formatToParts(moment).map(x=>[x.type,x.value]));
  return d.year+'-'+d.month+'-'+d.day;
}
const fresh = () => ({version:1, clients:[], visits:[], purchases:[], draft:null,
  materials:seed.map(([name,unit,cost,retail],i)=>({id:'m'+i,name,unit,cost,retail,active:true,order:i+1})),preferences:defaultPreferences(),revised:false});
function requireThat(condition,message) { if (!condition) throw new Error(message); }
function fixed(value,label,max,digits=2) {
  const raw=String(value ?? '').trim().replace(',','.');
  if (!raw) return 0;
  requireThat(raw.length<=48 && /^\+?(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw),label+' — введите число без минуса.');
  requireThat(Number(raw)<=max,label+' — слишком большое значение.');
  const [whole,fraction='']=raw.replace(/^\+/,'').split('.');
  const decimals=fraction.padEnd(digits+1,'0');
  return Number(whole)*10**digits+Number(decimals.slice(0,digits))+(decimals[digits]>='5'?1:0);
}
const price = (value,label) => fixed(value,label,1000000,6)/1000000;
const roundRatio=(numerator,denominator)=>Number((numerator+denominator/2n)/denominator);
function priceFromPackage(packaging,capacity) {
  const pack=fixed(packaging,'Цена упаковки',10000000);
  const count=fixed(capacity,'Количество в упаковке',10000000,3);
  requireThat(count>0,'Количество в упаковке должно быть больше нуля.');
  const micros=roundRatio(BigInt(pack)*10000000n,BigInt(count));
  requireThat(micros<=1000000000000,'Цена единицы превышает 1 млн ₽.');
  return micros/1000000;
}
function priceWithMarkup(cost,markup) {
  const base=fixed(cost,'Цена закупки',1000000,6);
  const percent=fixed(markup,'Наценка',10000);
  const micros=roundRatio(BigInt(base)*BigInt(10000+percent),10000n);
  requireThat(micros<=1000000000000,'Цена единицы превышает 1 млн ₽.');
  return micros/1000000;
}
function date(value) {
  requireThat(typeof value==='string' && /^\d{4}-\d\d-\d\d$/.test(value) && value>='1900-01-01' && value<='2199-12-31','Выберите дату.');
  const parsed=new Date(value+'T00:00:00Z');
  requireThat(Number.isFinite(+parsed) && parsed.toISOString().slice(0,10)===value,'Такой даты нет.');
  return value;
}
const blankVisit = () => ({id:uid(),date:today(),client:'',name:'',work:'',recipe:'',note:'',
  amount:'',type:'%',target:'работа',qty:{},original:[],refresh:false});
function discount(fields) {
  const type=fields.type==='₽'?'₽':'%',target=fields.target==='весь_чек'?'весь_чек':'работа';
  const amount=fixed(fields.amount,'Скидка',10000000);
  return {type,target,amount:(type==='%'?Math.min(amount,10000):amount)/100};
}
function calculate(draft, materials) {
  const work=fixed(draft.work,'Стоимость работы',10000000);
  const discountRules=discount(draft);
  const items=[];
  const catalog=new Map(materials.map(row=>[row.id,row]));
  const originals=new Map(draft.original.map(row=>[row.id,row]));
  let fund=0,retail=0;
  for (const [id,raw] of Object.entries(draft.qty)) {
    const qty=fixed(raw,'Количество',100000,3);
    if (!qty) continue;
    const snap=originals.get(id);
    const current=catalog.get(id);
    const row=snap && (!draft.refresh || !current)?snap:current;
    requireThat(row && (row.active || snap),'Уберите недоступный расходник.');
    const sum=value=>roundRatio(BigInt(qty)*BigInt(fixed(value,'Цена',1000000,6)),10000000n);
    const costSum=sum(row.cost),retailSum=sum(row.retail);
    fund+=costSum; retail+=retailSum;
    items.push({id,name:row.name,unit:row.unit,qty:qty/1000,cost:row.cost,retail:row.retail,...(row.description?{description:row.description}:{})});
  }
  requireThat(items.length<=100 && work+retail<=1000000000 && fund<=1000000000,'Сумма визита или число позиций превышает предел.');
  const base=discountRules.target==='весь_чек'?work+retail:work;
  const amount=Math.round(discountRules.amount*100);
  const saving=Math.min(base,discountRules.type==='%'?Math.floor((base*amount+5000)/10000):amount);
  const total=work+retail-saving;
  return {work,items,fund,retail,saving,total,net:total-fund,...discountRules};
}
const newest = (a,b) => b.date.localeCompare(a.date) || (b.created || '').localeCompare(a.created || '');
function report(state,prefix) {
  const visits=state.visits.filter(row=>row.date.startsWith(prefix)).sort(newest);
  const sum=(rows,key)=>rows.reduce((amount,row)=>amount+row[key],0);
  const total=sum(visits,'total'),fund=sum(visits,'fund');
  const expenses=sum(state.purchases.filter(row=>row.date.startsWith(prefix)),'total');
  return {visits,total,fund,expenses,net:sum(visits,'net'),balance:fund-expenses,
    all:sum(state.visits,'fund')-sum(state.purchases,'total'),average:visits.length?Math.round(total/visits.length):0};
}
function text(value,max,required=false) {
  requireThat(typeof value==='string' && value.length<=max && (!required || value.trim()),'В файле есть неверное текстовое поле.');
  return value;
}
function array(value) { requireThat(Array.isArray(value),'В файле отсутствуют записи.');return value; }
function cents(value) {
  requireThat(Number.isSafeInteger(value) && value>=0 && value<=1000000000,'В файле есть неверная сумма.');
  return value;
}
function unique(rows) {
  requireThat(new Set(rows.map(x=>x.id)).size===rows.length,'В файле найдены дубли записей.');
  return rows;
}
function validateRevision(value=1) {
  requireThat(Number.isSafeInteger(value) && value>=1 && value<10000000,'В файле есть неверная версия визита.');
  return value;
}
function validateFlag(value) {
  requireThat(typeof value==='boolean','В файле есть неверная отметка.');
  return value;
}
function validateId(value) {
  requireThat(typeof value==='string' && /^[a-z0-9-]{1,70}$/.test(value),'В файле есть неверный ключ записи.');
  return value;
}
function material(row) {
  requireThat(row && Object.hasOwn(units,row.unit) && typeof row.cost==='number' && typeof row.retail==='number' &&
    price(row.cost,'Цена')===row.cost && price(row.retail,'Цена')===row.retail,'В файле неверные цены или единицы расходника.');
  return {id:validateId(row.id),name:text(row.name,120,true),unit:row.unit,cost:row.cost,retail:row.retail,
    ...(row.description===undefined?{}:{description:text(row.description,160)})};
}
function fromGoogle(data) {
  const oldItems=new Map();
  for (const row of array(data.items)) {
    const list=oldItems.get(row.visit)||[];
    list.push({...row,id:row.material});
    oldItems.set(row.visit,list);
  }
  return {version:1,revised:true,materials:array(data.materials).map(x=>({...x,active:x.active===1})),
    clients:array(data.clients).filter(x=>x.deleted===0).map(x=>({...x,benefit:x.benefit===1})),visits:array(data.visits).filter(x=>!x.deleted).map(x=>({...x,
      items:oldItems.get(x.id)||[],work:Math.round(x.work*100),fund:Math.round(x.fund*100),retail:Math.round(x.retail*100),
      saving:Math.round(x.discount*100),total:Math.round(x.total*100),net:Math.round(x.net*100)})),
    purchases:array(data.purchases).filter(x=>!x.deleted).map(x=>({...x,total:Math.round(x.total*100)}))};
}
function restore(backup) {
  requireThat(backup?.version===1 && backup.data && ['kolorist-local','parik-backup'].includes(backup.format),'Выберите JSON-копию из кабинета колориста.');
  const data=backup.format==='parik-backup'?fromGoogle(backup.data):backup.data;
  requireThat(data.version===1,'Эта версия копии не поддерживается.');
  const materials=unique(array(data.materials).map(row=>({...material(row),active:validateFlag(row.active),favorite:row.favorite===true,
    order:Number.isSafeInteger(row.order)?row.order:0,...(row.step===undefined?{}:{step:fixed(row.step,'Шаг',10000,3)/1000})})));
  const clients=unique(array(data.clients).map(row=>({id:validateId(row.id),name:text(row.name,120,true),
    phone:text(row.phone,60),note:text(row.note,2000),benefit:validateFlag(row.benefit),...discount(row)})));
  const purchases=unique(array(data.purchases).map(row=>({id:validateId(row.id),date:date(row.date),
    supplier:text(row.supplier,120),note:text(row.note,1000),total:cents(row.total)})));
  const visits=unique(array(data.visits).map(row=>{
    const items=unique(array(row.items).map(item=>{
      requireThat(typeof item.qty==='number' && item.qty>0 && fixed(item.qty,'Количество',100000,3)/1000===item.qty,'В файле неверное количество.');
      return {...material(item),qty:item.qty};
    }));
    const work=cents(row.work);
    const bill=calculate({...discount(row),work:work/100,qty:Object.fromEntries(items.map(x=>[x.id,x.qty])),original:items},[]);
    for (const key of ['fund','retail','saving','total','net']) requireThat(row[key]===bill[key],'Суммы визита в копии не совпадают.');
    return {...bill,id:validateId(row.id),date:date(row.date),client:row.client?validateId(row.client):'',name:text(row.name,120),
      recipe:text(row.recipe,5000),note:text(row.note,3000),created:text(row.created,40),revision:validateRevision(row.revision)};
  }));
  return {version:1,materials,clients,visits,purchases,draft:null,preferences:preferencesFrom(data.preferences),revised:Boolean(data.revised)};
}
function backup(state) {
  const {draft,draftEpoch,...data}=state;
  return JSON.stringify({format:'kolorist-local',version:1,data});
}
