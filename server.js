const express=require('express'),crypto=require('crypto'),fs=require('fs'),http=require('http');
const Database=require('better-sqlite3'),multer=require('multer'),{Telegraf,Markup}=require('telegraf'),{Server}=require('socket.io');
const {OAuth2Client}=require('google-auth-library');
const {BOT_TOKEN,WEBAPP_URL,ADMIN_IDS='',ADMIN_EMAILS='',GOOGLE_CLIENT_ID,SECRET='change-me',DEV,PORT=3000,TRANSLATE_URL,TRANSLATE_KEY,TRANSLATE_TARGET='uz',ANTHROPIC_API_KEY,GEMINI_API_KEY,GEMINI_MODEL='gemini-3.8-flash',FOX_MODEL='claude-haiku-5-5',GOOGLE_TRANSLATE_KEY,BOT_USERNAME='Tillar_lugat_bot'}=process.env;
let THINK=process.env.GEMINI_THINKING||'low';const FALLBACKS=(process.env.GEMINI_FALLBACK_MODEL||'gemini-3.6-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite').split(',').map(x=>x.trim()).filter(Boolean),GEMINI_FALLBACK=FALLBACKS[0],BUSY=/quota|429|exceed|demand|overload|unavailable|timeout|aborted|fetch failed|not found|no longer available|404|rate/i;
const FASTM=(process.env.GEMINI_FAST_MODEL||'gemini-3.5-flash-lite').split(',').map(x=>x.trim()).filter(Boolean),down={};
const markDown=(m,e)=>{const t=String(e&&(e.message||e));down[m]=Date.now()+(/404|not found|no longer/i.test(t)?864e5:/quota|exceed|429/i.test(t)?90000:60000)};
const chainFor=(first,fast)=>{const all=[...new Set([...(fast?FASTM:[]),first,...FALLBACKS])].filter(Boolean),ok=all.filter(m=>!(down[m]>Date.now()));return ok.length?ok:[first]};
const friendlyErr=m=>{m=String(m||'');return /quota|exceed|429|rate/i.test(m)?"Gemini kunlik limiti tugadi (bepul tarif). Birozdan keyin urinib ko'ring yoki Google AI Studio'da billing ulang.":/demand|overload|unavailable|503/i.test(m)?"Gemini hozir band. Birozdan keyin urinib ko'ring.":/timeout|aborted|fetch failed/i.test(m)?"Gemini javob bermadi. Qayta urinib ko'ring.":m.slice(0,160)};const USE_GEMINI=!!GEMINI_API_KEY,AI_KEY=GEMINI_API_KEY||ANTHROPIC_API_KEY;
const addM=(ts,n)=>{const d=new Date(ts);d.setMonth(d.getMonth()+n);return d.getTime()};const DAY=864e5,PERMS=['dicts','import','tasks','payments','trials','users','plans','methods','admins'];
process.on('uncaughtException',e=>console.error('uncaught',e));process.on('unhandledRejection',e=>console.error('unhandled',e));
const MAXW_G=+process.env.MAX_WORDS||2000000;
const DATA=process.env.DATA_DIR||'.';fs.mkdirSync(DATA+'/uploads',{recursive:true});fs.mkdirSync(DATA+'/audio',{recursive:true});
const db=new Database(DATA+'/data.db');
db.exec(`create table if not exists users(id integer primary key,name text,email text unique,is_admin int default 0,perms text default '',paid_until int default 0,trial text default 'none',created int);
create table if not exists dicts(id integer primary key autoincrement,name text,levels int default 1,sec int default 30,free int default 0);
create table if not exists words(id integer primary key autoincrement,dict_id int,level int,pos text,section int,ko text,uz text);
create table if not exists learned(user_id int,word_id int,primary key(user_id,word_id));
create table if not exists access(user_id int,dict_id int,primary key(user_id,dict_id));
create table if not exists tasks(id integer primary key autoincrement,dict_id int,level int,title text);
create table if not exists plans(id integer primary key autoincrement,months int,price int);
create table if not exists methods(id integer primary key autoincrement,name text,number text,holder text,on_ int default 1);
create table if not exists scores(user_id int,name text,week int,pts int default 0,primary key(user_id,week));
create table if not exists pays(id integer primary key autoincrement,user_id int,plan_id int,method_id int,file text,status text default 'pending',ts int);`);
for(const m0 of ["alter table dicts add column lvl text default ''","alter table words add column form text default ''","alter table words add column audio_uz text default ''","alter table words add column lvl text default ''",'alter table words add column audio text','alter table access add column until int default 0','alter table plans add column dict_id int default 0',"alter table tasks add column pos text default ''",'alter table tasks add column section int default 0','alter table plans add column monthly int default 0','alter table pays add column months int default 0','alter table dicts add column deleted int default 0','alter table dicts add column del_ts int default 0',"alter table dicts add column lang text default 'en'",'create index if not exists words_dict_ko on words(dict_id,ko)'])try{db.exec(m0)}catch{}
db.exec(`create table if not exists lvnames(dict_id int,level int,name text,primary key(dict_id,level));
create table if not exists poss(key text primary key,name text,ko text default '',ord int default 0);`);
if(!db.prepare('select 1 from poss').get()){const ip=db.prepare('insert into poss(key,name,ko,ord) values(?,?,?,?)');[['ot','Ot',''],['fel',"Fe'l (harakat)",''],['sifat','Sifat (holat)',''],['ravish','Ravish',''],['olmosh','Olmosh',''],['son','Son',''],['yordamchi',"Ko'makchi / yordamchi",'']].forEach((p,i)=>ip.run(p[0],p[1],p[2],i))}
if(!one0('select 1 from methods'))for(const n of['Click','Payme','Karta'])db.prepare('insert into methods(name,number,holder) values(?,?,?)').run(n,'','');
function one0(s){return db.prepare(s).get()}
let possC=0,possL=[];const getPoss=()=>{if(Date.now()>possC){possL=db.prepare('select * from poss order by ord,rowid').all();possC=Date.now()+3000}return possL};
const DEFLV=["Boshlang'ich","O'rta","Yuqori"];
// ===== TILLAR RO'YXATI — yangi til qo'shish uchun bitta qator yetarli =====
// n=o'zbekcha nomi, nat=o'z nomi, f=bayroq, sc=yozuv turi (Unicode Script), g=Google/MyMemory kodi, sr=ovoz tanish kodi, ev=Edge ovozi
const LANGS={
 en:{n:'Ingliz',nat:'English',f:'🇬🇧',sc:'Latin',g:'en',sr:'en-US',ev:'en-US-JennyNeural'},
 ko:{n:'Koreys',nat:'한국어',f:'🇰🇷',sc:'Hangul',g:'ko',sr:'ko-KR',ev:'ko-KR-SunHiNeural'},
 ru:{n:'Rus',nat:'Русский',f:'🇷🇺',sc:'Cyrillic',g:'ru',sr:'ru-RU',ev:'ru-RU-SvetlanaNeural'},
 ja:{n:'Yapon',nat:'日本語',f:'🇯🇵',sc:'Japanese',g:'ja',sr:'ja-JP',ev:'ja-JP-NanamiNeural'},
 zh:{n:'Xitoy',nat:'中文',f:'🇨🇳',sc:'Han',g:'zh-CN',sr:'zh-CN',ev:'zh-CN-XiaoxiaoNeural'},
 ar:{n:'Arab',nat:'العربية',f:'🇸🇦',sc:'Arabic',g:'ar',sr:'ar-SA',ev:'ar-SA-ZariyahNeural'},
 tr:{n:'Turk',nat:'Türkçe',f:'🇹🇷',sc:'Latin',g:'tr',sr:'tr-TR',ev:'tr-TR-EmelNeural'},
 de:{n:'Nemis',nat:'Deutsch',f:'🇩🇪',sc:'Latin',g:'de',sr:'de-DE',ev:'de-DE-KatjaNeural'},
 fr:{n:'Fransuz',nat:'Français',f:'🇫🇷',sc:'Latin',g:'fr',sr:'fr-FR',ev:'fr-FR-DeniseNeural'},
 es:{n:'Ispan',nat:'Español',f:'🇪🇸',sc:'Latin',g:'es',sr:'es-ES',ev:'es-ES-ElviraNeural'},
 it:{n:'Italyan',nat:'Italiano',f:'🇮🇹',sc:'Latin',g:'it',sr:'it-IT',ev:'it-IT-ElsaNeural'},
 pt:{n:'Portugal',nat:'Português',f:'🇵🇹',sc:'Latin',g:'pt',sr:'pt-PT',ev:'pt-BR-FranciscaNeural'},
 hi:{n:'Hind',nat:'हिन्दी',f:'🇮🇳',sc:'Devanagari',g:'hi',sr:'hi-IN',ev:'hi-IN-SwaraNeural'}
};
for(const L of Object.values(LANGS)){L.cls=L.sc==='Japanese'?'\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Han}':'\\p{Script='+L.sc+'}';L.re=new RegExp('['+L.cls+']','u')}
const NONLAT=/[\p{Script=Hangul}\p{Script=Cyrillic}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Arabic}\p{Script=Devanagari}\p{Script=Thai}\p{Script=Greek}\p{Script=Hebrew}]/u,LATRE=/\p{Script=Latin}/u,KANA=/[\p{Script=Hiragana}\p{Script=Katakana}]/u;
const lg=c=>LANGS[c]||LANGS.en;
const parseLangs=s=>[...new Set((Array.isArray(s)?s:String(s||'').split(',')).map(x=>String(x).trim()).filter(x=>LANGS[x]))];
const isLat=c=>lg(c).sc==='Latin';
const scGroup=c=>{const s=lg(c).sc;return s==='Japanese'||s==='Han'?'CJ':s};
const ambiguous=ls=>{const g={};for(const c of ls){const k=scGroup(c);g[k]=(g[k]||0)+1}return Object.values(g).some(n=>n>1)}; // bir yozuvni bir necha til ishlatsa (masalan ingliz+nemis) — faqat AI ajrata oladi
const srcHas=(x,ls)=>ls.some(c=>lg(c).re.test(x));
const srcAny=(x,ls)=>{const nl=ls.filter(c=>!isLat(c));return !!((nl.length&&srcHas(x,nl))||(ls.some(isLat)&&LATRE.test(x)))};
const okWord=(x,c)=>isLat(c)?(LATRE.test(x)&&!NONLAT.test(x)):lg(c).re.test(x);
const guessLang=(x,ls)=>{if(ls.length===1)return ls[0];if(KANA.test(x)&&ls.includes('ja'))return 'ja';return ls.find(c=>okWord(x,c))||ls[0]};
const legacyEnc=ls=>{const c=(ls||[]).find(x=>!isLat(x));return ({ko:'euc-kr',ru:'windows-1251',ja:'shift_jis',zh:'gbk',ar:'windows-1256'})[c]||'windows-1252'};

const lvList=d=>{const m={};db.prepare('select level,name from lvnames where dict_id=?').all(d.id).forEach(r=>m[r.level]=r.name);return Array.from({length:d.levels||1},(_,i)=>({level:i+1,name:m[i+1]||DEFLV[i]||(i+1)+'-daraja'}))};
const q=(s,...a)=>db.prepare(s).all(...a),one=(s,...a)=>db.prepare(s).get(...a),run=(s,...a)=>db.prepare(s).run(...a);
const ownerIds=ADMIN_IDS.split(',').filter(Boolean).map(Number),ownerMail=ADMIN_EMAILS.toLowerCase().split(',').filter(Boolean);
const sign=id=>{const e=Date.now()+30*DAY,b=id+'.'+e;return b+'.'+crypto.createHmac('sha256',SECRET).update(b).digest('hex')};
const unsign=t=>{const [id,e,s]=String(t||'').split('.');return s&&+e>Date.now()&&crypto.createHmac('sha256',SECRET).update(id+'.'+e).digest('hex')===s?+id:null};
const fin=id=>{let u=one('select * from users where id=?',id);if(u&&(ownerIds.includes(u.id)||ownerMail.includes((u.email||'').toLowerCase()))&&u.is_admin!=2){run('update users set is_admin=2 where id=?',id);u=one('select * from users where id=?',id)}return u};
function auth({init,dev,token}){
  if(token){const id=unsign(token);return id?fin(id):null}
  let u;
  if(DEV&&dev)u={id:+dev,first_name:'Dev'+dev};
  else{try{const p=new URLSearchParams(init),h=p.get('hash');p.delete('hash');
    const s=[...p].map(([k,v])=>k+'='+v).sort().join('\n');
    const key=crypto.createHmac('sha256','WebAppData').update(BOT_TOKEN).digest();
    if(crypto.createHmac('sha256',key).update(s).digest('hex')!==h)return null;u=JSON.parse(p.get('user'))}catch{return null}}
  run('insert or ignore into users(id,name,created) values(?,?,?)',u.id,u.first_name,Date.now());return fin(u.id)}
const active=u=>u.is_admin||u.paid_until>Date.now();
const LVL=v=>['b','o','y','all'].includes(String(v||''))?String(v):''; // b=boshlang'ich, o=o'rta, y=yuqori, all=hammasi
const PAID_ONLY=process.env.PAID_ONLY!=='0'; // 1 = hamma narsa (lug'at kitoblari va so'zlar) faqat obunachilarga; o'chirish: PAID_ONLY=0
const can=(u,d)=>active(u)||(!PAID_ONLY&&d.free)||!!one('select 1 from access where user_id=? and dict_id=? and (until=0 or until>?)',u.id,d.id,Date.now());
const has=(u,p)=>u.is_admin==2||(u.is_admin==1&&u.perms.split(',').includes(p));
const wk=()=>Math.floor(Date.now()/(7*DAY));
const addScore=(id,name,p)=>{if(p>0)run('insert into scores(user_id,name,week,pts) values(?,?,?,?) on conflict(user_id,week) do update set pts=pts+excluded.pts',id,name,wk(),p)};
const app=express();app.use(express.json());app.get('/',(r,s)=>s.sendFile(__dirname+'/index.html'));app.use('/shots',express.static(DATA+'/uploads'));app.use('/audio',express.static(DATA+'/audio'));
const up=multer({dest:DATA+'/uploads/',limits:{fileSize:25*1024*1024}}),upBig=multer({dest:DATA+'/uploads/',limits:{fileSize:2*1024*1024*1024}}),gc=GOOGLE_CLIENT_ID&&new OAuth2Client(GOOGLE_CLIENT_ID);
app.get('/config',(r,s)=>s.json({google:GOOGLE_CLIENT_ID||null,dev:!!DEV,bot:BOT_USERNAME,fox:!!AI_KEY,voice:USE_GEMINI,langs:Object.entries(LANGS).map(([c,L])=>({c,n:L.n,nat:L.nat,f:L.f,sr:L.sr,g:L.g}))}));
app.post('/auth/google',async(r,s)=>{try{const t=await gc.verifyIdToken({idToken:r.body.credential,audience:GOOGLE_CLIENT_ID}),p=t.getPayload();
  if(!p.email_verified)return s.status(401).json({e:'email'});const em=p.email.toLowerCase();
  let u=one('select * from users where email=?',em);
  if(!u){const i=run('insert into users(name,email,created) values(?,?,?)',p.name||em,em,Date.now());u=one('select * from users where id=?',i.lastInsertRowid)}
  else run('update users set name=? where id=?',p.name||u.name,u.id);
  s.json({token:sign(u.id)})}catch{s.status(401).json({e:'google'})}});
app.use('/api',(req,res,next)=>{const u=auth({init:req.get('x-init'),dev:req.get('x-dev'),token:(req.get('authorization')||'').slice(7)});if(!u)return res.status(401).json({e:'auth'});req.u=u;next()});
const adm=p=>(r,s,n)=>has(r.u,p)?n():s.status(403).json({e:'perm'});
app.get('/api/me',(r,s)=>s.json({id:r.u.id,name:r.u.name,email:r.u.email,is_admin:r.u.is_admin,perms:r.u.perms,paid_until:r.u.paid_until,trial:r.u.trial,active:active(r.u),PERMS}));
app.get('/api/stats',(r,s)=>s.json({learned:one('select count(*) n from learned where user_id=?',r.u.id).n,rank:(one('select pts from scores where user_id=? and week=?',r.u.id,wk())||{}).pts||0}));
app.post('/api/score',(r,s)=>{addScore(r.u.id,r.u.name,Math.min(+r.body.points||0,500));s.json({ok:1})});
app.get('/api/rating',(r,s)=>s.json(q('select name,pts from scores where week=? order by pts desc limit 20',wk())));
app.get('/api/plans',(r,s)=>s.json(q('select p.*,d.name dname from plans p left join dicts d on d.id=p.dict_id where coalesce(d.deleted,0)=0 order by p.dict_id,p.months')));
app.get('/api/methods',(r,s)=>s.json(q('select * from methods where on_=1')));
app.get('/api/dicts',(r,s)=>s.json(q('select * from dicts where deleted=0').map(d=>({...d,free:PAID_ONLY?0:d.free,ok:can(r.u,d)}))));
app.get('/api/tree/:id',(r,s)=>{const d=one('select * from dicts where id=?',r.params.id);
  if(!d||d.deleted||!can(r.u,d))return s.status(402).json({e:'pay'});
  s.json({d,levels:lvList(d),rows:q('select level,pos,section,count(*) n from words where dict_id=? group by 1,2,3',d.id)})});
app.get('/api/poss',(r,s)=>s.json(getPoss()));
app.get('/api/words',(r,s)=>{const {dict,level,pos,section,mode}=r.query;
  const d=one('select * from dicts where id=?',dict);if(!d||d.deleted||!can(r.u,d))return s.status(402).json({e:'pay'});
  let sql='select w.*,d.lang lang,(l.word_id is not null) learned from words w join dicts d on d.id=w.dict_id left join learned l on l.word_id=w.id and l.user_id=? where w.dict_id=?';
  const a=[r.u.id,dict];
  for(const [k,v] of [['level',level],['pos',pos],['section',section]])if(v){sql+=` and w.${k}=?`;a.push(v)}
  if(mode==='learned')sql+=' and l.word_id is not null';if(mode==='new')sql+=' and l.word_id is null';
  s.json(q(sql+' order by w.id',...a))});
app.post('/api/learned',(r,s)=>{r.body.on?run('insert or ignore into learned values(?,?)',r.u.id,r.body.id):run('delete from learned where user_id=? and word_id=?',r.u.id,r.body.id);s.json({ok:1})});
const GRAM={
 particle:[{q:"저___ 학생이에요.",h:"Men talabaman.",o:["는","를","가","에서"],a:"는"},{q:"책___ 읽어요.",h:"Kitob o'qiyman.",o:["를","을","이","는"],a:"을"},{q:"친구___ 와요.",h:"Do'st keladi.",o:["이","가","을","은"],a:"가"},{q:"학교___ 가요.",h:"Maktabga boraman.",o:["에","에서","를","도"],a:"에"},{q:"집___ 공부해요.",h:"Uyda o'qiyman.",o:["에","에서","를","가"],a:"에서"},{q:"물___ 마셔요.",h:"Suv ichaman.",o:["를","을","가","는"],a:"을"},{q:"커피___ 좋아해요.",h:"Kofeni yoqtiraman.",o:["을","를","이","은"],a:"를"},{q:"선생님___ 책이에요.",h:"O'qituvchining kitobi.",o:["의","에","를","도"],a:"의"}],
 verb:[{q:"어제 학교에 ___.",h:"Kecha maktabga bordim.",o:["가요","갔어요","갈 거예요","가고"],a:"갔어요"},{q:"지금 밥을 ___.",h:"Hozir ovqat yeyapman.",o:["먹었어요","먹어요","먹을 거예요","먹고"],a:"먹어요"},{q:"내일 친구를 ___.",h:"Ertaga do'stni uchrataman.",o:["만나요","만났어요","만날 거예요","만나고"],a:"만날 거예요"},{q:"어제 영화를 ___.",h:"Kecha kino ko'rdim.",o:["봐요","봤어요","볼 거예요","보고"],a:"봤어요"},{q:"매일 한국어를 ___.",h:"Har kuni koreys tilini o'rganaman.",o:["공부했어요","공부해요","공부할 거예요","공부하고"],a:"공부해요"},{q:"지난주에 친구가 ___.",h:"O'tgan hafta do'stim keldi.",o:["와요","왔어요","올 거예요","오고"],a:"왔어요"},{q:"다음 주에 여행을 ___.",h:"Kelasi hafta sayohatga boraman.",o:["가요","갔어요","갈 거예요","가고"],a:"갈 거예요"},{q:"지금 비가 ___.",h:"Hozir yomg'ir yog'yapti.",o:["왔어요","와요","올 거예요","오고"],a:"와요"}],
 noun:[{q:"학생 + ___ = talabalar",h:"Ko'plik qo'shimchasi",o:["들","의","도","에"],a:"들"},{q:"친구___ 선생님",h:"Do'stning o'qituvchisi",o:["의","를","도","에서"],a:"의"},{q:"나___ 좋아해요.",h:"Men ham yoqtiraman.",o:["도","들","의","에서"],a:"도"},{q:"물___ 마셔요.",h:"Faqat suv ichaman.",o:["만","들","의","에서"],a:"만"},{q:"9시___ 5시까지 일해요.",h:"9 dan 5 gacha ishlayman.",o:["부터","의","도","에서"],a:"부터"},{q:"친구___ 같이 가요.",h:"Do'st bilan birga boraman.",o:["하고","의","도","에서"],a:"하고"},{q:"버스___ 가요.",h:"Avtobusda boraman.",o:["로","으로","에서","를"],a:"로"},{q:"한국___ 왔어요.",h:"Koreyadan keldim.",o:["에서","에","를","도"],a:"에서"}]};
const SENT=[{ko:"저는 매일 한국어를 공부해요",uz:"Men har kuni koreys tilini o'rganaman"},{ko:"오늘 날씨가 정말 좋아요",uz:"Bugun ob-havo juda yaxshi"},{ko:"친구와 같이 학교에 가요",uz:"Do'stim bilan birga maktabga boraman"},{ko:"어제 우리는 영화를 봤어요",uz:"Kecha biz kino ko'rdik"},{ko:"내일 시장에서 과일을 살 거예요",uz:"Ertaga bozorda meva sotib olaman"},{ko:"저는 커피를 아주 좋아해요",uz:"Men kofeni juda yaxshi ko'raman"},{ko:"우리 집은 서울에 있어요",uz:"Uyimiz Seulda"},{ko:"주말에 가족과 여행을 갔어요",uz:"Dam olish kuni oila bilan sayohatga bordim"}];
app.get('/api/grammar',(r,s)=>{const t=r.query.type,n=Math.min(+r.query.n||8,12);
  if(t==='sent')return s.json(shuffle(SENT).slice(0,n));const a=GRAM[t];if(!a)return s.status(400).json({e:'bad'});
  s.json(shuffle(a).slice(0,n).map(g=>({q:g.q,h:g.h,o:shuffle(g.o),a:g.a})))});
const foxUse={},FOXSYS="Sen Kori — do'stona va bilimdon tulki yordamchisan 🦊. Foydalanuvchiga tillarni o'rganishda yordam berasan (ingliz, koreys, rus, yapon, xitoy, arab, turk, nemis, fransuz, ispan, italyan, portugal, hind va boshqalar). O'zbek tilida (lotin yozuvida) javob ber. Foydalanuvchi har qanday savol bersa (tillar, ta'lim, dasturlash, kundalik hayot va h.k.) to'liq, aniq va foydali javob ber: oddiy savolga qisqa, murakkabiga batafsilroq. Chet tildagi so'z va gaplarni o'z yozuvida yoz (masalan 안녕하세요, привет, こんにちは, hello) va kerak bo'lsa o'qilishini lotinda qavs ichida ko'rsat. Foydalanuvchi qaysi tilni o'rganayotganini bilsang, misollarni shu tilda ber. Mashq so'ralsa, bitta savol ber va javobni kut. Tibbiy, huquqiy yoki xavfli mavzularda ehtiyotkor bo'l.";
function fallbackFox(ms){
  const last=String(ms[ms.length-1].content).trim(),prev=ms.length>1?String(ms[ms.length-2].content):'';
  const qm=prev.match(/^🧠 «(.+?)» nima degani\?/);
  if(qm){const w=one('select * from words where ko=? limit 1',qm[1]);if(w){const first=w.uz.split(/[,;]/)[0].trim().toLowerCase(),ok=last.toLowerCase().includes(first);
    return {lite:1,reply:(ok?'Ajoyib! 🎉 ':'Deyarli! ')+'«'+w.ko+'» — '+w.uz+".\n\nYana mashq qilamizmi? «Meni sina» deb yozing."}}}
  if(/sina/i.test(last)){const w=one('select * from words order by random() limit 1');if(w)return {lite:1,reply:'🧠 «'+w.ko+'» nima degani?'}}
  let rows=[];const hang=last.match(/[^\s\d\p{P}\p{Script=Latin}]+/gu);
  if(hang)for(const h of hang.slice(0,3))rows.push(...q('select ko,uz from words where ko like ? limit 3','%'+h+'%'));
  if(!rows.length){const t=last.replace(/[^\p{L}' ]/gu,'').trim().toLowerCase();if(t.length>=2){rows=q('select ko,uz from words where lower(uz) like ? limit 5','%'+t+'%');if(!rows.length)rows=q('select ko,uz from words where lower(ko)=? limit 5',t)}}
  if(rows.length)return {lite:1,reply:rows.slice(0,5).map(w=>'📖 '+w.ko+' — '+w.uz).join('\n')};
  return {lite:1,reply:"Men hozircha lug'atdagi so'zlarni topib bera olaman 🦊 Chet tilida yoki o'zbekcha so'z yozing (masalan: school yoki maktab) yoki «Meni sina» deb yozing."}}
async function askFox(messages,words){
  if(!AI_KEY)return messages.length?fallbackFox(messages):{e:'bad'};
  const ms=messages.slice(-8).map(m=>({role:m.role==='assistant'?'assistant':'user',content:String(m.content).slice(0,1500)}));
  while(ms.length&&ms[0].role==='assistant')ms.shift();if(!ms.length)return {e:'bad'};
  const sys=FOXSYS+(words&&words.length?"\nHozir foydalanuvchi shu so'zlarni mashq qilmoqda: "+words.slice(0,20).map(w=>w.ko+' = '+w.uz).join('; ')+". Shu so'zlardan foydalanib qisqa savol-javob yoki dialog qil.":'');
  try{return {reply:await callClaude(ms,sys,800)}}catch(e){return {e:'api',msg:friendlyErr(e.message||e)}}}
const LIM={chat:[15,150],voice:[5,150]};// [bepul, obunachi] kuniga
const foxLimit=(u,t='chat')=>u.is_admin?1e9:LIM[t][active(u)?1:0];
const foxKey=(u,t)=>u.id+':'+t+':'+Math.floor(Date.now()/DAY);
const foxLeft=(u,t)=>u.is_admin?null:Math.max(0,foxLimit(u,t)-(foxUse[foxKey(u,t)]||0));
const TTSM=process.env.GEMINI_TTS_MODEL||'gemini-3.8-flash-lite-tts',VOICE=process.env.GEMINI_VOICE||'Kore';
function wavWrap(pcm,rate){rate=rate||24000;const h=Buffer.alloc(44);h.write('RIFF',0);h.writeUInt32LE(36+pcm.length,4);h.write('WAVEfmt ',8);h.writeUInt32LE(16,16);h.writeUInt16LE(1,20);h.writeUInt16LE(1,22);h.writeUInt32LE(rate,24);h.writeUInt32LE(rate*2,28);h.writeUInt16LE(2,32);h.writeUInt16LE(16,34);h.write('data',36);h.writeUInt32LE(pcm.length,40);return Buffer.concat([h,pcm])}
async function geminiTTS(text,mdl){
  const r=await fetch('https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(mdl||TTSM)+':generateContent',{method:'POST',signal:AbortSignal.timeout(20000),headers:{'content-type':'application/json','x-goog-api-key':GEMINI_API_KEY},body:JSON.stringify({contents:[{parts:[{text}]}],generationConfig:{responseModalities:['AUDIO'],speechConfig:{voiceConfig:{prebuiltVoiceConfig:{voiceName:VOICE}}}}})});
  const j=await r.json();if(!r.ok)throw new Error((j.error&&j.error.message)||('HTTP '+r.status));
  const p=((j.candidates||[])[0]?.content?.parts||[]).find(x=>x.inlineData&&x.inlineData.data);if(!p)throw new Error('audio yoq');
  let b=Buffer.from(p.inlineData.data,'base64');
  if(b.slice(0,4).toString()!=='RIFF'){const m=String(p.inlineData.mimeType||'').match(/rate=(\d+)/);b=wavWrap(b,m?+m[1]:24000)}
  return b.toString('base64')}
const ttsDown={};
async function geminiTTSany(text){let le;const ms=[...new Set([TTSM,'gemini-3.8-flash-tts','gemini-3.8-flash-lite-tts','gemini-2.5-flash-preview-tts','gemini-2.5-pro-preview-tts',...(process.env.GEMINI_TTS_EXTRA||'').split(',').map(x=>x.trim()).filter(Boolean)])];
  const live=ms.filter(m=>!(ttsDown[m]>Date.now()));
  for(const m of (live.length?live:ms)){try{return await geminiTTS(text,m)}catch(e){le=e;const t=String(e.message);
    if(/404|not found|no longer|unsupported|invalid/i.test(t)){ttsDown[m]=Date.now()+864e5;continue}
    if(/quota|exceed|429|rate|demand|overload|503|unavailable/i.test(t)){ttsDown[m]=Date.now()+(/demand|overload|503|unavailable/i.test(t)?30000:10*60000);continue}
    throw e}}
  throw le}
let gemTtsOff=0;
async function wordAudio(ko,lang){if(USE_GEMINI&&Date.now()>gemTtsOff){try{return {b:Buffer.from(await geminiTTSany(ko),'base64'),ext:'wav'}}catch(e){if(/quota|exceed|429|demand|404|not found/i.test(String(e.message)))gemTtsOff=Date.now()+30*60000}}
  const r=await fetch('https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl='+lg(lang||'ko').g+'&q='+encodeURIComponent(ko),{headers:{'user-agent':'Mozilla/5.0'},signal:AbortSignal.timeout(10000)});if(!r.ok)throw new Error('tts '+r.status);const b=Buffer.from(await r.arrayBuffer());if(b.length<500)throw new Error('tts bosh');return {b,ext:'mp3'}}
const PENDING="⏳ tarjima kutilmoqda";let trBusy=0;
async function trFill(){if(trBusy)return;trBusy=1;try{const rows=q("select w.id,w.ko,coalesce(d.lang,'en') lang from words w left join dicts d on d.id=w.dict_id where w.uz=? limit 80",PENDING);if(!rows.length)return;
  const by={};rows.forEach(x=>(by[x.lang]=by[x.lang]||[]).push(x));
  for(const [lang,rs] of Object.entries(by)){let o={};if(AI_KEY){try{o=await claudeTranslate(rs.map(x=>({ko:x.ko})),lang)}catch{}}
    let tc=0;for(const w of rs){let uz=o[w.ko]&&o[w.ko].uz;if(!uz&&tc<12&&(!AI_KEY||!Object.keys(o).length)){tc++;uz=await tr(w.ko,lang)}if(uz)run('update words set uz=? where id=? and uz=?',uz,w.id,PENDING)}}}catch{}finally{trBusy=0}}
setInterval(trFill,20000).unref();setTimeout(trFill,20000).unref();
setInterval(()=>{if(ttsQ.length<10){ttsEnqueue(q("select id from words where audio is null or audio='' limit 40").map(x=>x.id).filter(id=>(ttsTry[id]||0)<8))}},120000).unref();
const ttsQ=[],ttsTry={},ttsSet=new Set();let ttsRun=0,ttsPause=0;
function ttsEnqueue(ids){for(const id of ids)if(!ttsSet.has(id)){ttsSet.add(id);ttsQ.push(id)}ttsPump()}
async function ttsPump(){
  if(ttsRun>=6||Date.now()<ttsPause)return;const id=ttsQ.shift();if(!id)return;ttsSet.delete(id);ttsRun++;
  try{const w=one('select w.ko,w.audio,d.lang from words w left join dicts d on d.id=w.dict_id where w.id=?',id);if(w&&w.ko&&!w.audio){const a=await wordAudio(w.ko,w.lang);const name='w'+id+'_'+Date.now()+'.'+a.ext;fs.writeFileSync(DATA+'/audio/'+name,a.b);run("update words set audio=? where id=? and (audio is null or audio='')",name,id)}}
  catch(e){ttsTry[id]=(ttsTry[id]||0)+1;if(ttsTry[id]<8){if(!ttsSet.has(id)){ttsSet.add(id);ttsQ.push(id)}const d=/quota|429|demand|503|exceed/i.test(String(e.message))?20000:5000;ttsPause=Date.now()+d;setTimeout(ttsPump,d+100)}}
  finally{ttsRun--;setTimeout(ttsPump,250)}
  ttsPump()}
app.post('/api/admin/autovoice',adm('import'),(r,s)=>{const d=+r.body.dict_id;const ids=(d?q('select id from words where dict_id=? and (audio is null or audio=\'\')',d):q("select id from words where audio is null or audio=''")).map(x=>x.id);ttsEnqueue(ids);s.json({ok:1,n:ids.length})});
const ttsBusy=new Map();
app.post('/api/word-voice/:id',async(r,s)=>{const w=one('select w.id,w.ko,w.audio,d.lang from words w left join dicts d on d.id=w.dict_id where w.id=?',r.params.id);if(!w)return s.json({e:'yoq'});if(w.audio)return s.json({audio:w.audio});
  try{let p=ttsBusy.get(w.id);if(!p){p=(async()=>{const a=await wordAudio(w.ko,w.lang);const name='w'+w.id+'_'+Date.now()+'.'+a.ext;fs.writeFileSync(DATA+'/audio/'+name,a.b);run("update words set audio=? where id=? and (audio is null or audio='')",name,w.id);return one('select audio from words where id=?',w.id).audio})();ttsBusy.set(w.id,p);p.finally(()=>ttsBusy.delete(w.id)).catch(()=>{})}
    s.json({audio:await p})}catch(e){s.json({e:'tts'})}});
async function wordAudioUz(text){text=String(text).replace(/⏳.*$/,'').trim().slice(0,120);if(!text)throw new Error('bosh');
  if(USE_GEMINI&&Date.now()>gemTtsOff){try{return {b:Buffer.from(await geminiTTSany(text),'base64'),ext:'wav'}}catch(e){if(/quota|exceed|429|demand|404|not found/i.test(String(e.message)))gemTtsOff=Date.now()+30*60000}}
  const r=await fetch('https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=uz&q='+encodeURIComponent(text),{headers:{'user-agent':'Mozilla/5.0'},signal:AbortSignal.timeout(10000)});if(!r.ok)throw new Error('tts '+r.status);const b=Buffer.from(await r.arrayBuffer());if(b.length<500)throw new Error('tts bosh');return {b,ext:'mp3'}}
const uzBusy=new Map();
app.post('/api/word-voice-uz/:id',async(r,s)=>{const w=one('select id,uz,audio_uz from words where id=?',r.params.id);if(!w||!w.uz||w.uz===PENDING)return s.json({e:'yoq'});if(w.audio_uz)return s.json({audio:w.audio_uz});
  try{let p=uzBusy.get(w.id);if(!p){p=(async()=>{const a=await wordAudioUz(w.uz);const name='u'+w.id+'_'+Date.now()+'.'+a.ext;fs.writeFileSync(DATA+'/audio/'+name,a.b);run("update words set audio_uz=? where id=? and (audio_uz is null or audio_uz='')",name,w.id);return one('select audio_uz from words where id=?',w.id).audio_uz})();uzBusy.set(w.id,p);p.finally(()=>uzBusy.delete(w.id)).catch(()=>{})}
    s.json({audio:await p})}catch(e){s.json({e:'tts'})}});
// Microsoft Edge ovozi (bepul, kalitsiz, o'zbekcha va koreyscha neyron ovozlar) — "ws" paketi socket.io bilan birga o'rnatilgan
let WSM=null;try{WSM=require('ws')}catch{}
const EDGE_TOKEN='6A5AA1D4EAFF4E9FB37E23D68491D6F4',EDGE_VER=process.env.EDGE_TTS_VER||'143.0.3650.75',EDGE_VOICE=Object.fromEntries([...Object.entries(LANGS).map(([c,L])=>[c,process.env['EDGE_VOICE_'+c.toUpperCase()]||L.ev]),['uz',process.env.EDGE_VOICE_UZ||'uz-UZ-MadinaNeural']]);
const edgeGec=()=>{let t=Math.floor(Date.now()/1000)+11644473600;t-=t%300;return crypto.createHash('sha256').update(String(BigInt(t)*10000000n)+EDGE_TOKEN,'ascii').digest('hex').toUpperCase()};
const xmlEsc=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
function edgeTts(text,voice,ver){ver=ver||EDGE_VER;return new Promise((res,rej)=>{
  if(!WSM)return rej(new Error('ws moduli yoq'));
  const id=crypto.randomBytes(16).toString('hex'),ts=new Date().toUTCString().replace('GMT','GMT+0000 (Coordinated Universal Time)');let ws,tm,done=0;const bufs=[];
  const fin=e=>{if(done)return;done=1;clearTimeout(tm);try{ws.close()}catch{}if(e)rej(e);else if(bufs.length)res(Buffer.concat(bufs));else rej(new Error('edge bosh javob'))};
  try{ws=new WSM('wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken='+EDGE_TOKEN+'&Sec-MS-GEC='+edgeGec()+'&Sec-MS-GEC-Version=1-'+ver+'&ConnectionId='+id,{headers:{'Pragma':'no-cache','Cache-Control':'no-cache','Origin':'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold','User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/'+ver.split('.')[0]+'.0.0.0 Safari/537.36 Edg/'+ver.split('.')[0]+'.0.0.0','Accept-Language':'en-US,en;q=0.9','Cookie':'muid='+crypto.randomBytes(16).toString('hex').toUpperCase()+';'}})}catch(e){return rej(e)}
  tm=setTimeout(()=>fin(new Error('edge vaqt tugadi')),7000);
  ws.on('open',()=>{try{
    ws.send('X-Timestamp:'+ts+'\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n');
    ws.send('X-RequestId:'+id+'\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:'+ts+'Z\r\nPath:ssml\r\n\r\n'+"<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'><voice name='"+voice+"'><prosody pitch='+0Hz' rate='+0%' volume='+0%'>"+xmlEsc(text)+"</prosody></voice></speak>")}catch(e){fin(e)}});
  ws.on('message',(d,bin)=>{try{if(bin){const b=Buffer.from(d),hl=b.readUInt16BE(0);if(/Path:audio/.test(b.subarray(2,2+hl).toString()))bufs.push(b.subarray(2+hl))}else if(/Path:turn\.end/.test(String(d)))fin()}catch(e){fin(e)}});
  ws.on('unexpected-response',(rq,rs)=>fin(new Error('edge HTTP '+rs.statusCode)));
  ws.on('error',e=>fin(e));ws.on('close',()=>fin())})}
const scLang=ch=>/\p{Script=Hangul}/u.test(ch)?'ko':KANA.test(ch)?'ja':/\p{Script=Han}/u.test(ch)?'han':/\p{Script=Cyrillic}/u.test(ch)?'ru':/\p{Script=Arabic}/u.test(ch)?'ar':/\p{Script=Devanagari}/u.test(ch)?'hi':/\p{L}/u.test(ch)?'uz':null;
// matnni yozuv turiga qarab bo'laklarga ajratadi: har bir bo'lak o'z tilidagi ovoz bilan o'qiladi (lotin yozuvi = o'zbekcha)
function foxSegments(t){t=t.replace(/\p{Extended_Pictographic}/gu,' ').replace(/\uFE0F/g,'');const cs=[...t].map(ch=>[ch,scLang(ch)]);
  for(let i=0;i<cs.length;i++){if(cs[i][1]!=='han')continue;let j=i;while(j<cs.length&&cs[j][1]==='han')j++;const ja=(i>0&&cs[i-1][1]==='ja')||(j<cs.length&&cs[j][1]==='ja');for(let k=i;k<j;k++)cs[k][1]=ja?'ja':'zh';i=j-1}
  const runs=[];let cur=null;
  for(const [ch,l] of cs){if(!l){if(cur)cur.t+=ch;continue}if(cur&&cur.l===l)cur.t+=ch;else{cur={l,t:ch};runs.push(cur)}}
  return runs.map(r=>[r.t.replace(/\s+/g,' ').trim(),r.l]).filter(([x])=>x&&/[\p{L}\p{N}]/u.test(x))}
function ttsSegs(t){const segs=[];for(const [x,lang] of foxSegments(t)){for(let i=0;i<x.length;i+=400)segs.push([x.slice(i,i+400).trim(),lang])}return segs.slice(0,10)}
let edgeVerOk=null;
async function foxEdgeTts(t){const segs=ttsSegs(t);if(!segs.length)throw new Error('matn yoq');
  const vers=[...new Set([edgeVerOk,EDGE_VER,'143.0.3650.75','130.0.2849.68','140.0.3485.14','120.0.2210.91'].filter(Boolean))];let le;
  for(const v of vers){try{const b=Buffer.concat(await Promise.all(segs.map(([x,l])=>edgeTts(x,EDGE_VOICE[l],v))));edgeVerOk=v;return b}catch(e){le=e;if(!/403|401|ws moduli/.test(String(e.message)))throw e}}throw le}
// Gemini ovozi bo'lmasa/limit tugasa: Google ovozi (koreyscha va o'zbekcha qismlar alohida o'qiladi)
async function gTts(text,lang){let le;for(const u of ['https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=','https://translate.googleapis.com/translate_tts?ie=UTF-8&client=gtx&tl=']){try{const r=await fetch(u+lang+'&q='+encodeURIComponent(text),{headers:{'user-agent':'Mozilla/5.0'},signal:AbortSignal.timeout(6000)});if(!r.ok)throw new Error('tts '+r.status);const b=Buffer.from(await r.arrayBuffer());if(b.length<300)throw new Error('tts bosh');return b}catch(e){le=e}}throw le}
async function foxGoogleTts(t){const segs=[];
  for(const [x,l] of foxSegments(t)){const tl=l==='uz'?'tr':lg(l).g;for(let i=0;i<x.length;i+=170){let e=Math.min(x.length,i+170);if(e<x.length){const sp=x.lastIndexOf(' ',e);if(sp>i+60)e=sp}segs.push([x.slice(i,e).trim(),tl]);i=e-170}}
  if(!segs.length)throw new Error('matn yoq');const bufs=[];for(const [x,l] of segs.slice(0,14))bufs.push(await gTts(x,l));return Buffer.concat(bufs)}
app.post('/api/fox-tts',async(r,s)=>{const k=foxKey(r.u,'tts'),cap=r.u.is_admin?1e9:active(r.u)?400:60,errs=[];
  const t=String(r.body.text||'').replace(/[*_#`]/g,'').trim().slice(0,600);if(!t)return s.json({e:'tts'});
  fs.mkdirSync(DATA+'/audio/cache',{recursive:true});const ck=crypto.createHash('sha1').update(t).digest('hex'),cf=DATA+'/audio/cache/'+ck;
  try{if(fs.existsSync(cf+'.wav'))return s.json({a:fs.readFileSync(cf+'.wav').toString('base64')})}catch{}
  if(USE_GEMINI&&(foxUse[k]||0)<cap){foxUse[k]=(foxUse[k]||0)+1;try{const a=await geminiTTSany(t);try{fs.writeFileSync(cf+'.wav',Buffer.from(a,'base64'))}catch{}return s.json({a})}catch(e){foxUse[k]--;errs.push('gemini: '+friendlyErr(e.message||e).slice(0,80));console.error('fox-tts xato:',String(e.message||e).slice(0,300))}}
  try{s.json({a:(await foxGoogleTts(t)).toString('base64'),mime:'audio/mpeg'})}catch(e){errs.push('google: '+String(e.message||e).slice(0,60));console.error('fox-tts google xato:',errs.join(' | '));s.json({e:'tts',msg:errs.join(' | ')})}});
app.post('/api/fox',async(r,s)=>{const k=foxKey(r.u,'chat');if((foxUse[k]||0)>=foxLimit(r.u,'chat'))return s.json({e:'limit',left:0});foxUse[k]=(foxUse[k]||0)+1;
  const ms=(r.body.messages||[]).filter(m=>m&&m.content);const o=await askFox(ms,Array.isArray(r.body.words)?r.body.words:[]);if(o.e==='api')foxUse[k]--;o.left=foxLeft(r.u,'chat');s.json(o)});
const VOICESYS="\nFoydalanuvchi ovozli xabar yubordi (o'zbek tilida yoki o'rganilayotgan chet tilida). Avval u nima deganini aniq yozib ol, keyin unga javob ber. FAQAT JSON qaytar: {\"heard\":\"foydalanuvchi aytgan gap (o'z tilida)\",\"reply\":\"javobing\"}. Javob ovoz bilan o'qiladi: 1-3 qisqa gap yoz, *, #, emoji ishlatma, chet tildagi so'zning lotincha o'qilishini qavs ichida yozma. Agar hech narsa eshitilmasa yoki faqat shovqin bo'lsa, heard ni bo'sh qoldir.";
app.post('/api/fox-voice',up.single('audio'),async(r,s)=>{
  let buf=null;try{if(r.file){buf=fs.readFileSync(r.file.path);fs.unlinkSync(r.file.path)}}catch{}
  if(!buf||!USE_GEMINI)return s.json({e:'bad'});
  const k=foxKey(r.u,'voice');if((foxUse[k]||0)>=foxLimit(r.u,'voice'))return s.json({e:'limit',left:0});foxUse[k]=(foxUse[k]||0)+1;
  let ms=[],ws=[];try{ms=JSON.parse(r.body.messages||'[]');ws=JSON.parse(r.body.words||'[]')}catch{}
  const sys=FOXSYS+(ws.length?"\nHozir foydalanuvchi shu so'zlarni mashq qilmoqda: "+ws.slice(0,20).map(w=>w.ko+' = '+w.uz).join('; ')+".":'')+VOICESYS;
  try{const t=await geminiVoice(ms,sys,buf);let o={};try{o=JSON.parse(t)}catch{try{o=JSON.parse(t.match(/\{[\s\S]*\}/)[0])}catch{}}
    const heard=String(o.heard||'').trim(),reply=String(o.reply||'').trim();
    if(!heard||!reply){foxUse[k]--;return s.json({e:'nohear'})}
    s.json({heard,reply,left:foxLeft(r.u,'voice')})}catch(e){foxUse[k]--;s.json({e:'api',msg:friendlyErr(e.message||e)})}});
app.get('/api/tasks',(r,s)=>s.json(q('select t.*,d.name dname from tasks t join dicts d on d.id=t.dict_id where d.deleted=0')));
// bepul sinov (1 oy) so'rovi
app.post('/api/trial',(r,s)=>{if(r.u.trial!=='none')return s.json({trial:r.u.trial});run("update users set trial='pending' where id=?",r.u.id);s.json({trial:'pending'})});
// to'lov
app.post('/api/pay',up.single('shot'),(r,s)=>{const b=r.body,pl=one('select * from plans where id=?',b.plan_id);if(!r.file||!pl||!one('select 1 from methods where id=?',b.method_id))return s.status(400).json({e:'bad'});
  const m=pl.monthly?Math.max(1,Math.min(36,+b.months||1)):pl.months;
  run('insert into pays(user_id,plan_id,method_id,file,ts,months) values(?,?,?,?,?,?)',r.u.id,pl.id,b.method_id,r.file.filename,Date.now(),m);s.json({ok:1})});
app.get('/api/mypay',(r,s)=>s.json(q('select id,status,ts from pays where user_id=? order by id desc limit 5',r.u.id)));
// admin
// ---- darajalar (nomi bilan) va so'z turkumlarini boshqarish
function relevel(id,from,to){db.prepare('update words set level=? where dict_id=? and level=?').run(to,id,from)}
app.post('/api/admin/level',adm('dicts'),(r,s)=>{const b=r.body,id=+b.dict_id,d=one('select * from dicts where id=?',id);if(!d)return s.status(400).json({e:'bad'});
  const name=String(b.name||'').trim();
  db.transaction(()=>{
    if(b.add){const n=d.levels+1;run('update dicts set levels=? where id=?',n,id);if(name)run('insert or replace into lvnames values(?,?,?)',id,n,name)}
    else if(b.del){const L=+b.del;if(d.levels<=1||L<1||L>d.levels)throw new Error('bad');
      const mv=Math.min(Math.max(+b.move_to||(L>1?L-1:2),1),d.levels);
      if(mv!==L)relevel(id,L,mv);
      for(let k=L+1;k<=d.levels;k++){run('update words set level=? where dict_id=? and level=?',k-1,id,k)}
      const nm=db.prepare('select level,name from lvnames where dict_id=?').all(id);run('delete from lvnames where dict_id=?',id);
      for(const x of nm){if(x.level===L)continue;run('insert into lvnames values(?,?,?)',id,x.level>L?x.level-1:x.level,x.name)}
      run('update dicts set levels=? where id=?',d.levels-1,id);
      run('delete from tasks where dict_id=? and level=?',id,L);run('update tasks set level=level-1 where dict_id=? and level>?',id,L)}
    else if(+b.level){const L=+b.level;if(L<1||L>d.levels)throw new Error('bad');if(name)run('insert or replace into lvnames values(?,?,?)',id,L,name);else run('delete from lvnames where dict_id=? and level=?',id,L)}
  })();
  if(b.del)resection(id);s.json({ok:1,levels:lvList(one('select * from dicts where id=?',id))})});
app.post('/api/admin/words-level',adm('dicts'),(r,s)=>{const b=r.body,id=+b.dict_id,d=one('select * from dicts where id=?',id),to=+b.to_level;if(!d||!(to>=1&&to<=d.levels))return s.status(400).json({e:'bad'});
  let n=0;
  if(Array.isArray(b.ids)&&b.ids.length){const u=db.prepare('update words set level=? where id=? and dict_id=?');db.transaction(()=>{for(const w of b.ids)n+=u.run(to,+w,id).changes})()}
  else{let sql='update words set level=? where dict_id=?';const a=[to,id];for(const k of ['level','pos','section'])if(b['from_'+k]){sql+=` and ${k}=?`;a.push(b['from_'+k])}n=run(sql,...a).changes}
  resection(id);s.json({ok:1,n})});
app.post('/api/admin/pos',adm('dicts'),(r,s)=>{const b=r.body,name=String(b.name||'').trim(),ko=String(b.ko||'').trim();
  if(b.del){const k=String(b.del);if(one('select 1 from words where pos=? limit 1',k))return s.status(400).json({e:"Bu turkumda so'zlar bor. Avval so'zlarni boshqa turkumga o'tkazing."});run('delete from poss where key=?',k)}
  else if(b.key){if(!name)return s.status(400).json({e:'bad'});run('update poss set name=?,ko=? where key=?',name,ko,String(b.key))}
  else{if(!name)return s.status(400).json({e:'bad'});let k=name.toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'')||'t'+Date.now();if(/^\d/.test(k))k='k'+k;while(one('select 1 from poss where key=?',k))k+='_';
    run('insert into poss(key,name,ko,ord) values(?,?,?,?)',k,name,ko,(one('select coalesce(max(ord),0)+1 n from poss').n))}
  possC=0;s.json({ok:1,poss:getPoss()})});
app.post('/api/admin/tts-test',adm('admins'),async(r,s)=>{if(!USE_GEMINI)return s.json({ok:false,error:"GEMINI_API_KEY yo'q — ovozli javob brauzer ovozi bilan ishlaydi."});
  try{const a=await geminiTTSany("Hello! 안녕하세요. Salom!");s.json({ok:true,a,model:TTSM})}catch(e){s.json({ok:false,error:friendlyErr(e.message||e)})}});
app.post('/api/admin/dict',adm('dicts'),(r,s)=>{run('insert into dicts(name,levels,sec,lvl,lang) values(?,?,?,?,?)',r.body.name,Math.max(1,+r.body.levels||1),+r.body.sec||30,LVL(r.body.lvl),LANGS[r.body.lang]?r.body.lang:'en');s.json({ok:1})});
app.post('/api/admin/dict/:id',adm('dicts'),(r,s)=>{const b=r.body;
  if('free'in b)run('update dicts set free=? where id=?',b.free?1:0,r.params.id);
  if(b.levels)run('update dicts set levels=? where id=?',+b.levels,r.params.id);
  if(b.name)run('update dicts set name=? where id=?',b.name,r.params.id);
  if('lvl'in b)run('update dicts set lvl=? where id=?',LVL(b.lvl),r.params.id);
  if(b.lang&&LANGS[b.lang]){const o=one('select lang from dicts where id=?',r.params.id);if(o&&o.lang!==b.lang){run('update dicts set lang=? where id=?',b.lang,r.params.id);run("update words set audio='' where dict_id=?",r.params.id)}}
  if(b.sec){run('update dicts set sec=? where id=?',+b.sec,r.params.id);resection(+r.params.id)}
  if(b.del)run('update dicts set deleted=1,del_ts=? where id=?',Date.now(),r.params.id);
  if(b.restore)run('update dicts set deleted=0,del_ts=0 where id=?',r.params.id);
  if(b.purge){const id=+r.params.id;db.transaction(()=>{
    for(const w of q('select id,audio from words where dict_id=?',id)){if(w.audio)try{fs.unlinkSync(DATA+'/audio/'+w.audio)}catch{}}
    run('delete from learned where word_id in (select id from words where dict_id=?)',id);
    run('delete from words where dict_id=?',id);run('delete from tasks where dict_id=?',id);run('delete from lvnames where dict_id=?',id);
    run('delete from access where dict_id=?',id);run('delete from plans where dict_id=?',id);run('delete from dicts where id=?',id)})()}
  s.json({ok:1})});
app.get('/api/admin/dicts-trash',adm('dicts'),(r,s)=>s.json(q('select d.id,d.name,d.del_ts,(select count(*) from words w where w.dict_id=d.id) n from dicts d where d.deleted=1 order by d.del_ts desc')));
let FOXM=USE_GEMINI?GEMINI_MODEL:FOX_MODEL;
async function callGemini(messages,system,max,model,n=0){let le;for(const m of (n>=2?[model]:chainFor(model,max<=1000))){try{return await callGemini0(messages,system,max,m,2)}catch(e){le=e;if(!BUSY.test(String(e&&(e.message||e.name))))throw e;markDown(m,e)}}throw le}
async function callGemini0(messages,system,max,model,n=0){
  const body={systemInstruction:{parts:[{text:system||''}]},contents:messages.map(m=>({role:m.role==='assistant'?'model':'user',parts:[{text:String(m.content)}]})),generationConfig:{maxOutputTokens:max}};
  if(/gemini-3/i.test(model)){const fast=max<=1000;body.generationConfig.thinkingConfig={thinkingLevel:fast?THINK:'low'};body.generationConfig.maxOutputTokens=max+(fast?400:1500)}
  else if(/gemini-2\.5-flash/i.test(model))body.generationConfig.thinkingConfig={thinkingBudget:0};
  const r=await fetch('https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(model)+':generateContent',{method:'POST',signal:AbortSignal.timeout(max<=1000?15000:90000),headers:{'content-type':'application/json','x-goog-api-key':GEMINI_API_KEY},body:JSON.stringify(body)});
  const j=await r.json().catch(()=>({}));
  if(!r.ok){if(/thinking level/i.test((j.error&&j.error.message)||'')&&THINK!=='low'){THINK='low';return callGemini(messages,system,max,model)}const em0=(j.error&&j.error.message)||'';if(n===0&&r.status===503){await new Promise(z=>setTimeout(z,1500));return callGemini0(messages,system,max,model,1)}if(r.status===404&&n<2&&model!=='gemini-3.8-flash'){const t=await callGemini(messages,system,max,'gemini-3.8-flash');FOXM='gemini-3.8-flash';return t}throw new Error((j.error&&j.error.message)||'api '+r.status)}
  const c=j.candidates&&j.candidates[0];
  if(!c||!c.content){throw new Error((j.promptFeedback&&j.promptFeedback.blockReason)?'Gemini javobni blokladi: '+j.promptFeedback.blockReason:'Gemini bo\'sh javob qaytardi')}
  return (c.content.parts||[]).map(x=>x.text||'').join('').trim()}
async function callAnthropic(messages,system,max,model){
  const r=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',signal:AbortSignal.timeout(90000),headers:{'content-type':'application/json','x-api-key':ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},body:JSON.stringify({model,max_tokens:max,system,messages})});
  const j=await r.json();
  if(!r.ok){if(r.status===404&&model!=='claude-sonnet-4-6'){const t=await callAnthropic(messages,system,max,'claude-sonnet-4-6');FOXM='claude-sonnet-4-6';return t}throw new Error((j.error&&j.error.message)||'api '+r.status)}
  return (j.content||[]).map(c=>c.text||'').join('').trim()}
async function callClaude(messages,system,max=500,model=FOXM){
  if(!AI_KEY)return null;
  return USE_GEMINI?callGemini(messages,system,max,model):callAnthropic(messages,system,max,model)}
const wp=ls=>{ls=ls&&ls.length?ls:['en'];const names=ls.map(c=>lg(c).n+" ("+c+": "+lg(c).nat+")").join(', ');
 return ("Bu fayldan FAQAT quyidagi tillardagi so'z va iboralarni lug'at yozuvi sifatida ajratib ol: "+names+". Boshqa tillardagi so'zlarni (shu jumladan o'zbekcha tarjimalarni va fayldagi izohlarni) lug'at so'zi sifatida OLMA. Faylda bir necha til aralash bo'lishi mumkin — har bir so'zning tilini aniqla va yozuvga \"lang\" maydonida til kodini yoz (faqat: "+ls.join('|')+"). Birortasini ham tashlab ketma, matnni boshidan oxirigacha to'liq o'qi. Faylda so'zlar ro'yxat, jadval yoki gap-matn shaklida bo'lishi mumkin: gap ichidagi har bir ma'noli so'zni (ot, fe'l, sifat, ravish, son, olmosh, iboralar) alohida yozuv qilib ol. So'zni lug'at (asosiy) shaklida yoz — bu \"w\": otlarni qo'shimcha va yuklamalarsiz (koreyscha 은/는/이/가/을/를 kabilarsiz), fe'l va sifatlarni lug'at shaklida (koreyscha -다, ingliz tilida infinitiv, nemis/fransuz/ispan/italyan/portugal tillarida infinitiv, arab tilida asosiy shakl). So'z matnda qanday ko'rinishda uchragan bo'lsa, aynan shuni \"form\" maydoniga yoz; ikkalasi bir xil bo'lsa form ni bo'sh qoldir. Faqat sof grammatik yuklama va tugatmalarning o'zini olma. Tarjima faylning o'zida bo'lsa (so'z yonida, keyingi qatorda, jadval ustunida, qavs ichida; qaysi tilda yozilgan bo'lmasin) shuni to'g'ri o'zbek tiliga (lotin yozuvi) o'tkazib ol; fayl ichida tarjima bo'lmasa, so'zning matndagi ma'nosiga qarab o'zing aniq va qisqa (1-3 ta ekvivalent, vergul bilan) o'zbekcha tarjima qil. Tarjimada ruscha yoki inglizcha so'z ishlatma. FAQAT fayldagi so'zlarni ol: fayl ichida yo'q so'zni o'zingdan qo'shma, sinonim yoki misol keltirma. Har bir yozuvda uz bo'sh bo'lmasin. Takrorlama. FAQAT JSON massiv qaytar: [{\"w\":\"...\",\"form\":\"...\",\"uz\":\"...\",\"lang\":\""+ls.join('|')+"\",\"pos\":\"ot|fel|sifat|ravish|boshqa\"}]").replace("ot|fel|sifat|ravish|boshqa",posKeys())};
function parseWords(t,ls){ls=ls&&ls.length?ls:['en'];const out=[],add=o=>{if(!o)return;const w=String(o.w||o.ko||'').trim(),uz=String(o.uz||'').trim();if(!w||!uz)return;
  let c=String(o.lang||'').trim().toLowerCase();if(!ls.includes(c)||!okWord(w,c)){c=KANA.test(w)&&ls.includes('ja')?'ja':ls.find(x=>okWord(w,x));if(!c)return}
  out.push({ko:w,uz,pos:normPos(o.pos),form:String(o.form||'').trim().slice(0,60),lang:c})};
  t=String(t||'');
  try{JSON.parse(t.match(/\[[\s\S]*\]/)[0]).forEach(add);return out}catch{}
  for(const m of t.match(/\{[^{}]*\}/g)||[])try{add(JSON.parse(m))}catch{}return out}
function gcfg(model,max,fast){const c={maxOutputTokens:max};if(/gemini-3/i.test(model)){c.thinkingConfig={thinkingLevel:fast?THINK:'low'};c.maxOutputTokens=max+(fast?400:1500)}else if(/gemini-2\.5-flash/i.test(model))c.thinkingConfig={thinkingBudget:0};return c}
async function geminiRaw(contents,system,cfg,n=0,mdl){const base=mdl||FOXM;let le;for(const m of (n>=2?[base]:chainFor(base,(cfg.maxOutputTokens||0)<=1500))){const c2=Object.assign({},cfg);if(m!==base)c2.thinkingConfig=/gemini-3/i.test(m)?{thinkingLevel:'low'}:{thinkingBudget:0};
  try{return await geminiRaw0(contents,system,c2,2,m)}catch(e){le=e;if(!BUSY.test(String(e&&(e.message||e.name))))throw e;markDown(m,e)}}throw le}
async function geminiRaw0(contents,system,cfg,n=0,mdl){
  const body={contents,generationConfig:cfg};if(system)body.systemInstruction={parts:[{text:system}]};
  const r=await fetch('https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(mdl||FOXM)+':generateContent',{method:'POST',signal:AbortSignal.timeout(cfg.maxOutputTokens<=1500?30000:300000),headers:{'content-type':'application/json','x-goog-api-key':GEMINI_API_KEY},body:JSON.stringify(body)});
  const j=await r.json().catch(()=>({}));
  if(!r.ok){const em=(j.error&&j.error.message)||'api '+r.status;if(/thinking level/i.test(em)&&cfg.thinkingConfig&&cfg.thinkingConfig.thinkingLevel!=='low'){THINK='low';cfg.thinkingConfig.thinkingLevel='low';return geminiRaw(contents,system,cfg)}if(n===0&&r.status===503){await new Promise(z=>setTimeout(z,1500));return geminiRaw0(contents,system,cfg,1,mdl)}throw new Error(em)}
  const c=j.candidates&&j.candidates[0];const t=c&&c.content?(c.content.parts||[]).map(x=>x.text||'').join('').trim():'';
  if(!t)throw new Error("Gemini bo'sh javob qaytardi");return t}
const geminiFile=(src,mime,prompt,max)=>geminiRaw([{role:'user',parts:[src&&src.uri?{fileData:{mimeType:src.mimeType||mime,fileUri:src.uri}}:{inlineData:{mimeType:mime,data:typeof src==='string'?src:src.toString('base64')}},{text:prompt}]}],'',gcfg(FOXM,max));
async function geminiVoice(hist,system,audio){
  const cs=[];for(const m of (hist||[]).slice(-10)){const role=m.role==='assistant'?'model':'user',text=String(m.content||'').slice(0,1500);if(!text)continue;
    if(cs.length&&cs[cs.length-1].role===role)cs[cs.length-1].parts[0].text+='\n'+text;else cs.push({role,parts:[{text}]})}
  while(cs.length&&cs[0].role==='model')cs.shift();
  const au={inlineData:{mimeType:'audio/wav',data:audio.toString('base64')}};
  if(cs.length&&cs[cs.length-1].role==='user')cs[cs.length-1].parts.push(au);else cs.push({role:'user',parts:[au]});
  const cfg=gcfg(FOXM,700,1);cfg.responseMimeType='application/json';
  return geminiRaw(cs,system,cfg)}
async function aiWords(items,txt,vis,defPos,auto,job){
  const LGS=(job&&job.langs)||['ko'],NLs=LGS.filter(c=>!isLat(c)),hasLat=LGS.some(isLat),lineHas=l=>(NLs.length&&srcHas(l,NLs))||(hasLat&&LATRE.test(l)),kL=txt.split(/\n/).filter(lineHas).length,good=items.filter(i=>i.uz).length;
  if(job)job.expected=kL;
  if(!AI_KEY||(!vis&&!hasLat&&!ambiguous(LGS)&&(kL===0||good>=kL*.95))){if(!AI_KEY&&vis&&vis.partial&&job)job.warn.push((vis.pageList||[]).length+" ta sahifada matn topilmadi (skan/rasm bo'lishi mumkin): sahifalar "+(vis.pageList||[]).slice(0,30).join(', ')+". Ularni o'qish uchun GEMINI_API_KEY kerak.");return (vis&&!vis.partial)?null:items}
  let got=[],failed=0;
  try{
    if(vis){if(!USE_GEMINI){if(job)job.aiErr="GEMINI_API_KEY topilmadi";return vis.partial?items:null}if(!vis.buf){try{if(job)job.stage="Fayl AI'ga yuklanmoqda ("+Math.round(vis.size/1e6)+" MB)...";vis.ref=await geminiUpload(vis.path,vis.mime,'book');
        if(vis.mime==='application/pdf'&&!vis.pages){vis.pages=parseInt(await geminiFile(vis.ref,vis.mime,"Bu PDF faylda nechta sahifa bor? Faqat bitta butun son yoz.",50))||0;if(job)job.pages=vis.pages}}
        catch(e){if(job)job.aiErr=friendlyErr(e&&e.message||e);return vis.partial?items:null}}
      if(job)job.stage="AI fayldan so'zlarni qidiryapti...";
      const rgs=[];
      if(vis.pageList&&vis.pageList.length){for(let i=0;i<vis.pageList.length;i+=8)rgs.push(vis.pageList.slice(i,i+8))}
      else if(vis.mime==='application/pdf'&&vis.pages>8){for(let p=1;p<=vis.pages;p+=8){const g=[];for(let k=p;k<p+8&&k<=vis.pages;k++)g.push(k);rgs.push(g)}}else rgs.push(null);
      let ri=0,dn=0,lastE='';const wv=async()=>{while(ri<rgs.length){const rg=rgs[ri++],pr=wp(LGS)+(rg?"\n\nFAQAT PDFning quyidagi sahifalaridagi so'zlarni ol (sahifa raqamlari): "+rg.join(', ')+". Har bir sahifani to'liq o'qi, hech bir so'zni tashlab ketma.":"");let okc=0;
        for(let a=0;a<3&&!okc;a++){try{const w=parseWords(await geminiFile(vis.ref||vis.b64||(vis.b64=vis.buf.toString('base64')),vis.mime,pr,30000),LGS);got.push(...w);okc=1}catch(e){lastE=friendlyErr(e&&e.message||e);await new Promise(z=>setTimeout(z,2000))}}
        if(!okc){failed++;if(job)job.failedPages.push(...(rg||[]))}
        dn++;if(job)job.stage="AI fayldan so'zlarni qidiryapti ("+dn+"/"+rgs.length+")..."}};
      await Promise.all(Array.from({length:Math.min(4,rgs.length)},wv));if(!got.length&&job)job.aiErr=lastE||"AI fayldan so'z topa olmadi"}
    else{const cs=[];for(let i=0;i<txt.length&&i<20000000;i+=8000){let e=Math.min(txt.length,i+8000);const nl=txt.indexOf('\n',e);if(nl>0&&nl-e<400)e=nl;cs.push(txt.slice(i,e));i=e-8000}
      if(txt.length>20000000&&job)job.warn.push("Fayl juda katta: faqat dastlabki 20 000 000 belgi qayta ishlandi.");
      let ci=0,dn=0;const bad=[];
      const w=async()=>{while(ci<cs.length){const c=cs[ci++];if(lineHas(c)){let okc=0;for(let a=0;a<2&&!okc;a++){try{got.push(...parseWords(await callClaude([{role:'user',content:wp(LGS)+"\n\n"+c}],"Sen ko'p tilli lug'at tuzuvchisan.",12000),LGS));okc=1}catch(e){if(job)job.aiErr=friendlyErr(e&&e.message||e);await new Promise(z=>setTimeout(z,1500))}}if(!okc){failed++;bad.push(c)}}dn++;if(job)job.stage="AI fayldan so'zlarni qidiryapti ("+dn+"/"+cs.length+")..."}};
      await Promise.all(Array.from({length:Math.min(8,cs.length)},w));if(failed&&job)job.warn.push(failed+" ta matn bo'lagi AI tomonidan o'qilmadi; ular oddiy usulda ajratildi (tarjimasi/turi to'liq bo'lmasligi mumkin).");
      // qamrov tekshiruvi: matndagi so'zlar olingan so'zlar bilan qoplanganmi; qoplanmagan qatorlar AI'ga qayta beriladi
      if(got.length&&txt.length<8e6&&LGS.length===1&&LGS[0]==='ko'){try{
        const stems=new Set(),vst=new Set();for(const g of got.concat(items.filter(i=>i.uz))){stems.add(g.ko);if(/다$/.test(g.ko)&&g.ko.length>1){stems.add(g.ko.slice(0,-1));vst.add(g.ko.slice(0,-1))}}
        const cov=t=>{for(let n=t.length;n>=1;n--){const p=t.slice(0,n);if((n>=2||n===t.length)?stems.has(p):vst.has(p))return true}return false};
        const seenT=new Set(),unc=[];let tot=0,miss=0;
        for(const l of txt.split(/\r?\n/)){if(!/[가-힣]/.test(l))continue;let lm=false;for(const t of (l.match(/[가-힣]{2,}/g)||[])){if(seenT.has(t))continue;seenT.add(t);tot++;if(!cov(t)){miss++;lm=true}}if(lm)unc.push(l)}
        if(job)job.cover=tot?Math.round((tot-miss)/tot*100):100;
        if(tot>20&&miss>tot*.12&&unc.length){
          const gcs=[];let cur2='';for(const l of unc){if(cur2.length+l.length>4500){gcs.push(cur2);cur2=''}cur2+=l+'\n'}if(cur2)gcs.push(cur2);const lim=gcs.slice(0,40);
          let gi=0,gd=0;const before=got.length;
          const gw=async()=>{while(gi<lim.length){const c=lim[gi++];for(let a=0;a<2;a++){try{got.push(...parseWords(await callClaude([{role:'user',content:wp(LGS)+"\n\nDiqqat: bu qatorlardagi so'zlar oldingi o'qishda tushib qolgan. Har bir ma'noli so'zni to'liq ajratib ol.\n\n"+c}],"Sen ko'p tilli lug'at tuzuvchisan.",12000),LGS));break}catch(e){await new Promise(z=>setTimeout(z,1500))}}gd++;if(job)job.stage="Yetishmagan so'zlar qidirilmoqda ("+gd+"/"+lim.length+")..."}};
          await Promise.all(Array.from({length:Math.min(6,lim.length)},gw));
          if(job)job.warn.push("Birinchi o'qishda ~"+Math.round(miss/tot*100)+"% so'z tushib qolgan edi; qayta o'qib "+(got.length-before)+" ta qo'shimcha so'z topildi."+(gcs.length>lim.length?" Fayl katta bo'lgani uchun qayta o'qish qisman bajarildi.":""))}
      }catch{}}
    }
  }catch(e){if(job)job.aiErr=friendlyErr(e&&e.message||e)}
  if(failed&&job&&vis)job.warn.push(failed+" ta sahifa guruhi o'qilmadi: "+[...new Set(job.failedPages)].sort((a,b)=>a-b).join(', ')+" sahifalar.");
  if(!vis&&got.length&&txt&&txt.length*got.length<4e9){const T=txt.replace(/\s+/g,'').toLowerCase();const ok=g=>{const k=String(g.ko).replace(/\s+/g,'').toLowerCase();if(g.form&&T.includes(String(g.form).replace(/\s+/g,'').toLowerCase()))return true;if(T.includes(k))return true;if(g.lang!=='ko'&&k.length>=4&&T.includes(k.slice(0,k.length-2)))return true;return g.lang==='ko'&&/다$/.test(k)&&k.length>1&&T.includes(k[0])};
    const keep=got.filter(ok),drop=got.length-keep.length;got.length=0;for(const x of keep)got.push(x);if(drop&&job)job.warn.push("Faylda uchramagan "+drop+" ta so'z (AI o'zidan qo'shgan) olib tashlandi.")}
  if(!got.length)return (vis&&!vis.partial)?null:items;
  const seen=new Set(),out=[];
  for(const g of got){const kk=(g.lang||'')+'|'+g.ko;if(!seen.has(kk)){seen.add(kk);out.push({ko:g.ko,uz:g.uz,lang:g.lang,pos:(auto&&g.pos)||defPos,px:!!(auto&&g.pos),form:g.form&&g.form!==g.ko?g.form:''})}}
  if(!hasLat)for(const it of items){const kk=(it.lang||'')+'|'+it.ko;if(!seen.has(kk)){seen.add(kk);out.push(it)}}
  return out}
async function tr(t,lang){const SLF=lg(lang||'ko').g,SL=SLF.split('-')[0];
  const tryit=async f=>{try{const v=await f();return v&&v!==t?v:''}catch{return ''}},sg=()=>AbortSignal.timeout(7000);
  let r='';
  if(TRANSLATE_URL)r=await tryit(async()=>{const x=await fetch(TRANSLATE_URL,{method:'POST',signal:sg(),headers:{'content-type':'application/json'},body:JSON.stringify({q:t,source:SL,target:TRANSLATE_TARGET,api_key:TRANSLATE_KEY||undefined})});return (await x.json()).translatedText});
  if(!r&&GOOGLE_TRANSLATE_KEY)r=await tryit(async()=>{const x=await fetch('https://translation.googleapis.com/language/translate/v2?key='+GOOGLE_TRANSLATE_KEY,{method:'POST',signal:sg(),headers:{'content-type':'application/json'},body:JSON.stringify({q:t,source:SL,target:TRANSLATE_TARGET,format:'text'})});return (await x.json()).data.translations[0].translatedText});
  if(!r)r=await tryit(async()=>{const x=await fetch('https://api.mymemory.translated.net/get?q='+encodeURIComponent(t)+'&langpair='+SLF+'|'+TRANSLATE_TARGET,{signal:sg()});const j=await x.json();const v=j.responseData&&j.responseData.translatedText;return v&&!/MYMEMORY WARNING|QUERY LENGTH/i.test(v)?v:''});
  return r}
async function claudeTranslate(part,lang){const LN=lg(lang||'en').n;
  const txt=await callClaude([{role:'user',content:"Quyidagi "+LN+" tilidagi so'zlarni o'zbek tiliga (lotin yozuvi) tarjima qil va so'z turini aniqla (ot, fel=harakat 동사, sifat=holat 형용사, ravish, olmosh, son, yordamchi yoki boshqa; sifat va fe'lni aralashtirma). Har bir so'zning eng keng tarqalgan ma'nosini 1-3 ta qisqa o'zbekcha ekvivalent bilan ber (vergul bilan). Fe'llarni bosh shaklda (-moq) yoz. Ruscha yoki inglizcha so'z ishlatma. Ba'zi so'zlar oldida ← belgisidan keyin ular uchragan gap (kontekst) berilgan: ma'noni shu kontekstga qarab tanla; ko ni aynan berilganidek (← gacha bo'lgan qismini) o'zgartirmay qaytar. Ma'nosiga ishonching komil bo'lmasa, uz ni bo'sh qoldir, taxmin qilma. FAQAT JSON massiv qaytar: [{\"ko\":\"...\",\"uz\":\"...\",\"pos\":\""+posKeys()+"\"}]\n\n"+part.map(x=>x.ko+(x.ctx?'  ← '+x.ctx:'')).join('\n')}],"Sen tajribali "+LN+"-o'zbek lug'at tuzuvchisan. Tarjimalar aniq, qisqa va to'g'ri o'zbek tilida bo'lsin.",6000);
  const out={};try{JSON.parse(txt.match(/\[[\s\S]*\]/)[0]).forEach(o=>{if(o&&o.ko)out[o.ko]={uz:String(o.uz||'').trim(),pos:normPos(o.pos)}})}catch{}
  return out}
const POSMAP=[[/^(ot|otlar|noun|nouns|명사|isim)$/i,'ot'],[/^(fe['’‘`]?l|fe['’‘`]?llar|verb|verbs|동사)$/i,'fel'],[/^(sifat|sifatlar|adjective|adjectives|형용사)$/i,'sifat'],[/^(ravish|ravishlar|adverb|adverbs|부사)$/i,'ravish']];
POSMAP.push([/^(olmosh|olmoshlar|pronoun|pronouns|대명사)$/i,'olmosh'],[/^(son|sonlar|numeral|numerals|number|수사)$/i,'son'],[/^(ko['’‘`]?makchi|yordamchi|particle|particles|조사)$/i,'yordamchi']);
const normPos=x=>{x=String(x||'').trim().replace(/[()\[\]{}.:]/g,'');if(!x)return '';const ps=getPoss(),has0=k=>ps.some(p=>p.key===k);
  for(const [re,p] of POSMAP)if(re.test(x)&&has0(p))return p;
  const l=x.toLowerCase();for(const p of ps)if(l===p.key||l===String(p.name).toLowerCase()||(p.ko&&x===p.ko))return p.key;return ''};
const posKeys=()=>getPoss().map(p=>p.key).join('|')+'|boshqa';
function mkParser(defPos,auto,isTab,ls){
  ls=ls&&ls.length?ls:['ko'];const NL=ls.filter(c=>!isLat(c)),latOnly=!NL.length;
  const KC=latOnly?"\\p{Script=Latin}":NL.map(c=>lg(c).cls).join(''),K='['+KC+']',KR=new RegExp(K,'u');
  const items=[],seen=new Set();let cur='',carry=null;
  const hasK=x=>!latOnly&&KR.test(x),lat=x=>/\p{L}/u.test(x)&&!hasK(x);
  const mk=(re,fl)=>new RegExp(re,fl||'u');
  const R1=mk('^('+K+"[^\\-–—:=,;\\t|]*?)\\s*[\\-–—:=]\\s*(.+)$"),R2=mk('^('+K+"[^,;\\t|]*?)\\s*[,;\\t|]\\s*(.+)$"),
   RV=latOnly?null:mk("^([\\p{L}'’‘ʻʼ][^"+KC+"]*?)\\s*[\\-–—:=\\t,;|]\\s*("+K+".*)$"),
   RP=mk('^('+K+'['+KC+"\\s~'’-]*?)\\s*[(（]\\s*([^"+(latOnly?'':KC)+"()（）]+?)\\s*[)）]\\s*$"),
   RS=latOnly?null:mk('^('+K+'['+KC+"~\\s]*?)\\s+([\\p{L}'’‘ʻʼ].*)$"),
   RW=mk(K+(latOnly?"[\\p{Script=Latin}'’-]{1,30}":'{1,20}'),'gu'),RK=new RegExp(K,'gu');
  const add=(ko,uz)=>{ko=ko.trim();uz=uz.trim();let p=cur,px=!!cur;
    const tg=uz.match(/\s*[(\[]\s*([^)\]]+?)\s*[)\]]\s*$/);if(tg&&normPos(tg[1])){p=normPos(tg[1]);px=true;uz=uz.slice(0,tg.index).trim()}
    uz=uz.replace(/^["“”«»]+|["“”«»]+$/g,'').trim();
    const ps=uz.split(/\s*[,;|\t]\s*/);if(ps.length>1&&normPos(ps[ps.length-1])){p=normPos(ps.pop());px=true;uz=ps.join(', ')}
    if(ko&&uz&&!seen.has(ko)){const lc=guessLang(ko,ls);if(!okWord(ko,lc))return;seen.add(ko);items.push({ko,uz,pos:p||defPos,px,lang:lc})}};
  const csvSplit=(l,c)=>{const o=[];let b='',q=0;for(let i=0;i<l.length;i++){const ch=l[i];if(ch==='"'){if(q&&l[i+1]==='"'){b+='"';i++}else q=!q}else if(!q&&(ch==='\t'||ch===';'||ch==='|'||(c&&ch===','))){o.push(b);b=''}else b+=ch}o.push(b);return o.map(x=>x.trim())};
  const feed=(raw,final)=>{const fresh=raw.map(l=>l.replace(/^\s*(\d+[.)]?|[•*·])\s+/,'').trim()).filter(Boolean);
    const lines=carry!==null?[carry,...fresh]:fresh;carry=null;const lim=final?lines.length:lines.length-1;let i=0;
  for(i=0;i<lim;i++){const line=lines[i];
    if(latOnly&&NONLAT.test(line))continue;// lotin tillari tanlangan: boshqa yozuvdagi qatorlar boshqa tilga tegishli
    const hd=normPos(line.replace(/^[^\p{L}'’‘`]+|[^\p{L}'’‘`]+$/gu,''));if(hd&&line.length<30){cur=hd;continue}
    if(/[\t;|]/.test(line)||(isTab&&line.includes(','))){const cells=csvSplit(line,isTab),ki=latOnly?cells.findIndex(c=>c&&okWord(c,ls[0])):cells.findIndex(c=>hasK(c));
      if(cells.length>=2&&ki>=0){const rest=cells.filter((c,j)=>j!==ki&&c&&!hasK(c)&&/\p{L}/u.test(c)&&!normPos(c)),ps=cells.map(c=>normPos(c)).find(Boolean);
        if(rest.length){const keep=cur;if(ps)cur=ps;add(cells[ki],rest[0]);cur=keep;continue}}}
    let m=line.match(R1)||line.match(R2);
    if(m&&!hasK(m[2])){add(m[1],m[2]);continue}
    const rv=RV&&line.match(RV);if(rv&&!hasK(rv[1])){add(rv[2],rv[1]);continue}
    const pr=line.match(RP);if(pr&&!normPos(pr[2])){add(pr[1],pr[2]);continue}
    const sp=RS&&line.match(RS);if(sp&&!hasK(sp[2])){add(sp[1],sp[2]);continue}
    if(!latOnly&&hasK(line)&&!/\p{L}/u.test(line.replace(RK,''))&&lines[i+1]&&lat(lines[i+1])&&!normPos(lines[i+1])){add(line,lines[i+1]);i++;continue}
    for(const w of line.match(RW)||[])if(!seen.has(w)){seen.add(w);items.push({ko:w,uz:'',pos:cur||defPos,px:!!cur,ctx:line.slice(0,70),lang:guessLang(w,ls)})}
  }
  if(!final&&lines.length)carry=(i>lim)?null:lines[lines.length-1]};
  const finish=()=>{if(auto)for(const it of items)if(!it.px&&it.lang==='ko'&&/다$/.test(it.ko))it.pos='fel'};
  return {items,feed,finish}}

const TXTEXT=new Set(['txt','csv','tsv','json','md','srt','vtt','log','html','htm','xml','lst','dic','text','tab','ass','sub']),BINEXT=new Set(['xlsx','xls','ods','docx','doc','rtf','pptx','odt','odp','epub','hwpx','hwp','pdf','zip','rar','7z','tar','gz','exe','iso','db','sqlite']);
async function looksText(path,ext){if(TXTEXT.has(ext))return true;if(BINEXT.has(ext)||GEMMIME[ext])return false;
  const fd=await fs.promises.open(path,'r');try{const b=Buffer.alloc(8192),{bytesRead}=await fd.read(b,0,8192,0);if(!bytesRead)return false;const h=b.subarray(0,bytesRead);if((h[0]===0xFF&&h[1]===0xFE)||(h[0]===0xFE&&h[1]===0xFF))return true;return !h.includes(0)}finally{await fd.close()}}
async function streamExtract(file,defPos,auto,job,size){
  const MAXW=MAXW_G,nm=file.originalname.toLowerCase();
  const fd=await fs.promises.open(file.path,'r');const hb=Buffer.alloc(65536);const {bytesRead}=await fd.read(hb,0,65536,0);await fd.close();const head=hb.subarray(0,bytesRead);let enc='utf-8';
  if(head[0]===0xFF&&head[1]===0xFE)enc='utf-16le';else if(head[0]===0xFE&&head[1]===0xFF)enc='utf-16be';
  else{try{new TextDecoder('utf-8',{fatal:true}).decode(head)}catch{try{new TextDecoder('utf-8',{fatal:true}).decode(head.subarray(0,Math.max(0,head.length-3)))}catch{enc=legacyEnc((job&&job.langs)||['ko'])}}}
  const dec=new TextDecoder(enc,{stream:true}),P=mkParser(defPos,auto,/\.(csv|tsv)$/.test(nm),(job&&job.langs)||['ko']);let rest='',read=0,last=0,cut=false;
  for await(const chunk of fs.createReadStream(file.path,{highWaterMark:+process.env.STREAM_CHUNK||(4<<20)})){
    read+=chunk.length;const t=rest+dec.decode(chunk,{stream:true}),ls=t.split(/\r?\n/);rest=ls.pop();if(rest.length>2e6){ls.push(rest);rest=''}
    P.feed(ls,false);
    if(job&&Date.now()-last>800){last=Date.now();job.stage="Katta fayl o'qilmoqda ("+Math.round(read/size*100)+"%) — "+P.items.length+" ta so'z topildi"}
    if(P.items.length>=MAXW){cut=true;break}}
  if(!cut)P.feed([rest+dec.decode()],true);else P.feed([],true);
  P.finish();if(job){if(cut)job.warn.push("Fayl juda katta: dastlabki "+MAXW+" ta so'z olindi (MAX_WORDS o'zgaruvchisi bilan oshirish mumkin).");job.warn.push("Katta matn fayli bo'lak-bo'lak o'qildi: «so'z - tarjima» juftliklari va tanlangan tillardagi so'zlar olindi, tarjimasizlari alohida tarjima qilinadi.")}
  return P.items.slice(0,MAXW)}
async function extract(file,defPos,auto,job){return await extract0(file,defPos,auto,job)}
const rmF=F=>{try{F&&F.path&&fs.unlinkSync(F.path)}catch{}};
// PDF matnini alohida jarayonda o'qiymiz: murakkab/katta PDF serverni o'chirib yubormasin (xotira yetmasa faqat o'sha jarayon to'xtaydi)
const PDF_CHILD=`const fs=require('fs');(async()=>{try{const buf=fs.readFileSync(process.argv[1]);const pdf=require('pdf-parse/lib/pdf-parse.js');const pg=[];const r=await pdf(buf,{pagerender:p=>p.getTextContent().then(tc=>{let t='',ly=null;for(const it of tc.items){if(ly!==null&&Math.abs(it.transform[5]-ly)>2)t+='\\n';t+=it.str;ly=it.transform[5]}pg.push(t);return t})});process.stdout.write(JSON.stringify({pages:r.numpages||pg.length,pg,text:pg.length?'':(r.text||'')}))}catch(e){process.stderr.write(String(e&&e.message||e));process.exit(2)}})()`;
function pdfChild(path,job){return new Promise(res=>{let out=[],err='',done=0,tm=null;const fin=x=>{if(!done){done=1;clearTimeout(tm);res(x)}};
  let cp;try{cp=require('child_process').spawn(process.execPath,['--max-old-space-size='+(+process.env.PDF_MEM||1024),'-e',PDF_CHILD,path],{cwd:__dirname,env:{...process.env,NODE_PATH:require('path').join(__dirname,'node_modules')},stdio:['ignore','pipe','pipe']})}catch(e){return fin(null)}
  tm=setTimeout(()=>{try{cp.kill('SIGKILL')}catch{}if(job)job.pdfNote="PDF juda uzoq o'qildi (vaqt tugadi)";fin(null)},+process.env.PDF_TIMEOUT||180000);
  cp.stdout.on('data',d=>out.push(d));cp.stderr.on('data',d=>{err+=d});cp.on('error',()=>fin(null));
  cp.on('close',(code,sig)=>{if(code!==0){console.error('pdf-child to\'xtadi:',code,sig,err.slice(0,200));if(job)job.pdfNote="PDF o'qilmadi ("+(sig||code===null?"xotira yetmadi":err.slice(0,80)||'xato')+")";return fin(null)}
    try{fin(JSON.parse(Buffer.concat(out).toString()))}catch{fin(null)}})})}
async function extract0(file,defPos,auto,job){
  const nm=file.originalname.toLowerCase(),size=fs.statSync(file.path).size,ext=(nm.match(/\.([a-z0-9]+)$/)||[])[1]||'',gm=GEMMIME[ext],bigVis=!!(gm&&USE_GEMINI&&size>6e6&&(ext!=='pdf'||size>150e6));
  if(ext==='hwp'){if(job)job.readErr="eski .hwp formati o'qilmaydi — Hangul'da «Boshqacha saqlash» orqali PDF, HWPX yoki DOCX qilib saqlang";return null}
  if(!bigVis&&size>(+process.env.STREAM_MIN||50e6)&&await looksText(file.path,ext))return await streamExtract(file,defPos,auto,job,size);
  let buf=null;if(!bigVis){if(size>150e6){if(job)job.readErr="fayl juda katta ("+Math.round(size/1e6)+" MB). "+(GEMMIME[ext]?"PDF/rasm/audio/video uchun GEMINI_API_KEY kerak.":"Word/Excel/arxiv kabi fayllar bunchalik katta bo'lsa o'qilmaydi — uni TXT yoki CSV qilib saqlab yuklang (TXT/CSV 8 GB gacha o'qiladi).");return null}buf=fs.readFileSync(file.path)}
  let txt='',visual=null,pages=0,vpl=null;const emptyP=[];
  try{
    if(bigVis){visual=gm;if(ext==='pdf'){pages=countPdfPages(file.path);if(job)job.pages=pages}}
    else if(/\.pdf$/.test(nm)){try{if(job)job.stage="PDF o'qilmoqda...";const R=await pdfChild(file.path,job);if(!R)throw new Error('pdf-child');const pg=R.pg||[];
      pages=R.pages||pg.length;txt=pg.length?pg.join('\n'):(R.text||'');if(job){job.pages=pages}
      pg.forEach((t,i)=>{if(t.replace(/\s/g,'').length<15)emptyP.push(i+1)});if(job)job.emptyPages=emptyP.slice()}catch{txt='';if(job&&!job.readErr)job.readErr=job.pdfNote||"PDF matnini o'qib bo'lmadi";pages=(buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g)||[]).length;if(job)job.pages=pages}
      if((txt.replace(/\s/g,'').length<40||!srcAny(txt,(job&&job.langs)||['ko']))&&(buf.length<14e6||USE_GEMINI))visual='application/pdf';
      else if(emptyP.length&&(buf.length<14e6||USE_GEMINI)){visual='application/pdf';vpl=emptyP.slice()}}
    else if(/\.(xlsx|xls|ods)$/.test(nm)){const X=require('xlsx'),wb=X.read(buf);txt=wb.SheetNames.map(n=>X.utils.sheet_to_csv(wb.Sheets[n])).join('\n')}
    else if(/\.docx$/.test(nm))txt=(await require('mammoth').extractRawText({buffer:buf})).value;
    else if(/\.(html?|xml)$/.test(nm))txt=buf.toString('utf8').replace(/<(script|style)[\s\S]*?<\/\1>/gi,'').replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d)>/gi,'\n').replace(/<[^>]+>/g,' ');
    else if(/\.(pptx|odt|odp|epub|hwpx)$/.test(nm)){const z=await require('jszip').loadAsync(buf);let o='';for(const n of Object.keys(z.files).sort()){if(!z.files[n].dir&&/^ppt\/slides\/slide\d+\.xml$|^content\.xml$|^Contents\/section\d+\.xml$|\.x?html?$/.test(n))o+=(await z.files[n].async('string')).replace(/<\/(a:p|hp:p|text:p|text:h|p|div|h\d|li|tr)>|<br\s*\/?>/gi,'\n').replace(/<\/(td|th|a:tc|table:table-cell)>/gi,'\t').replace(/<[^>]+>/g,'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'")+'\n'}txt=o}
    else if(/\.rtf$/.test(nm)){const dc=new TextDecoder('euc-kr');txt=buf.toString('latin1').replace(/(?:\\'[0-9a-f]{2})+/gi,m=>dc.decode(Buffer.from(m.replace(/\\'/g,''),'hex'))).replace(/\\u(-?\d+)\??/g,(m,n)=>String.fromCharCode(n<0?+n+65536:+n)).replace(/\\pard?\b/g,'\n').replace(/\\[a-z]+-?\d* ?|[{}]/gi,'')}
    else if(/\.doc$/.test(nm)){txt=(buf.toString('utf16le').match(/[\u0009\u000d\u0020-\u007e\u00a0-\u052f\u0590-\u06ff\u0900-\u097f\u1100-\u11ff\u3040-\u30ff\u4e00-\u9fff\u3130-\u318f\uac00-\ud7af\u2018-\u201f\u2013\u2014]{2,}/g)||[]).map(x=>x.replace(/\r/g,'\n')).join('\n')}
    else if(/\.(png|jpe?g|webp|heic|heif)$/.test(nm)){if(buf.length<14e6)visual='image/'+(/jpe?g$/.test(nm)?'jpeg':nm.split('.').pop())}
    else if(gm&&!/^image\//.test(gm)&&gm!=='application/pdf'){if(buf.length<14e6)visual=gm}
    else{let t=buf.toString('utf8');if(buf[0]===0xFF&&buf[1]===0xFE)t=buf.toString('utf16le');else if((t.match(/\uFFFD/g)||[]).length>3){try{t=new TextDecoder(legacyEnc((job&&job.langs)||['ko'])).decode(buf)}catch{}}txt=t.replace(/^\uFEFF/,'')}
  }catch(e){if(job)job.readErr=String((e&&e.message)||e).slice(0,200);return null}
  if(job&&!visual&&!txt.trim()&&buf.length>=14e6)job.readErr="fayl juda katta (skan/rasm PDF 14 MB dan oshmasin) — uni bo'lib yuklang";
  const P=mkParser(defPos,auto,/\.(xlsx|xls|ods|csv|tsv)$/.test(nm),(job&&job.langs)||['ko']);P.feed(txt.split(/\r?\n/),true);P.finish();const items=P.items;
  const vis=visual&&{buf:(buf&&buf.length<14e6)?buf:null,path:file.path,size,mime:visual,pages,pageList:vpl,partial:!!vpl};try{return await aiWords(items,txt,vis,defPos,auto,job)}finally{if(vis&&vis.ref)geminiDelete(vis.ref)}}
async function addWords(job,d,items,levelOf,auto){
  job.stage="Tekshirilmoqda...";
  const todo=items.slice(0,MAXW_G).filter(it=>!one('select 1 from words where dict_id=? and ko=?',d.id,it.ko));
  job.dups=Math.max(0,Math.min(items.length,MAXW_G)-todo.length);todo.forEach((it,i)=>it.idx=i);job.found=items.length;job.total=todo.length;job.done=0;
  const wl=['b','o','y'].includes(job.wlvl)?job.wlvl:(['b','o','y'].includes(d.lvl)?d.lvl:''),ins=db.prepare('insert into words(dict_id,level,pos,section,ko,uz,lvl,form) values(?,?,?,?,?,?,?,?)'),cnt={};
  const put=list=>{db.transaction(()=>{for(const it of list){const lv=levelOf(it.idx,todo.length,it),k=lv+'|'+it.pos;
    if(cnt[k]==null)cnt[k]=one('select count(*) n from words where dict_id=? and level=? and pos=?',d.id,lv,it.pos).n;
    const rr=ins.run(d.id,lv,it.pos,Math.floor(cnt[k]/d.sec)+1,it.ko,it.uz,(job.wlBy&&job.wlBy[lv])||wl,it.form||'');(job.ids=job.ids||[]).push(rr.lastInsertRowid);cnt[k]++;
    job.perLevel[lv]=(job.perLevel[lv]||0)+1;job.perPos[it.pos]=(job.perPos[it.pos]||0)+1;job.added++}})()};
  const aiOn=!!AI_KEY,needAI=it=>!it.uz||(auto&&!it.px);
  const first=todo.filter(it=>it.uz&&!(aiOn&&needAI(it)));put(first);job.done=first.length;
  const fs0=new Set(first);let rest=todo.filter(it=>!fs0.has(it));
  if(aiOn&&rest.length){job.stage="Tarjima va tur aniqlash (AI)...";
    const bs=[];for(let i=0;i<rest.length;i+=120)bs.push(rest.slice(i,i+120));let bi=0;
    const worker=async()=>{while(bi<bs.length){const b=bs[bi++];let o={};try{o=await claudeTranslate(b,d.lang)}catch{}
      const ok=[];for(const it of b){const x=o[it.ko];if(x){if(!it.uz&&x.uz){it.uz=x.uz;job.translated++}if(auto&&!it.px&&x.pos){it.pos=x.pos;it.px=true}}if(it.uz)ok.push(it);else it.left=1}
      put(ok);job.done+=b.length}};
    await Promise.all(Array.from({length:Math.min(5,bs.length)},worker));rest=rest.filter(it=>it.left)}
  if(aiOn&&rest.length){job.stage="Tarjima (qayta urinish)...";const bs2=[];for(let i=0;i<rest.length;i+=20)bs2.push(rest.slice(i,i+20));let bj=0;
    const w3=async()=>{while(bj<bs2.length){const b=bs2[bj++];let o={};for(let a=0;a<3&&!Object.keys(o).length;a++){try{o=await claudeTranslate(b,d.lang)}catch{await new Promise(z=>setTimeout(z,1500))}}
      const ok=[];for(const it of b){const x=o[it.ko];if(x&&x.uz){it.uz=x.uz;job.translated++;if(auto&&!it.px&&x.pos){it.pos=x.pos;it.px=true}it.left=0;ok.push(it)}}put(ok)}};
    await Promise.all(Array.from({length:Math.min(4,bs2.length)},w3));rest=rest.filter(it=>it.left)}
  if(rest.length){job.stage="Tarjima (tarjima xizmati)...";const lim=rest.slice(0,3000);let ri=0;
    const w2=async()=>{while(ri<lim.length){const it=lim[ri++];it.uz=await tr(it.ko,d.lang);if(it.uz){job.translated++;put([it])}if(!aiOn)job.done++}};
    await Promise.all(Array.from({length:8},w2));rest=rest.filter(it=>!it.uz)}
  if(rest.length){for(const it of rest)it.uz=PENDING;put(rest);job.pending=rest.length;setTimeout(trFill,5000)}
  if(job.ids&&job.ids.length)ttsEnqueue(job.ids);
  if(job.expected&&job.found<job.expected*.5)job.warn.push("Faylda ~"+job.expected+" ta qator bor, lekin faqat "+job.found+" ta so'z ajratildi. Fayl to'liq o'qilmagan bo'lishi mumkin — tekshirib ko'ring.");
  if(job.pending)job.warn.push(job.pending+" ta so'z tarjimasi kutilmoqda (fonda tarjima qilinadi).");
  job.incomplete=job.warn.some(w=>/o'qilmadi|to'liq o'qilmagan|topilmadi/.test(w));
  job.done=job.total;job.stage="Tayyor (ovozlar fonda avtomatik qo'shilmoqda)";return job}
async function classifyLevels(items,job,lang){if(!AI_KEY)return;const bs=[];for(let i=0;i<items.length;i+=150)bs.push(items.slice(i,i+150));let bi=0,dn=0;
  const w=async()=>{while(bi<bs.length){const b=bs[bi++];
    for(let a=0;a<3;a++){try{const t=await callClaude([{role:'user',content:"Quyidagi "+lg(lang).n+" tilidagi so'zlarning qiyinlik darajasini aniqla: b = boshlang'ich (A1-A2 / TOPIK 1-2 / HSK 1-2 / JLPT N5-N4, kundalik oddiy so'zlar), o = o'rta (B1-B2 / TOPIK 3-4 / HSK 3-4 / JLPT N3-N2), y = yuqori (C1-C2 / TOPIK 5-6 / HSK 5-6 / JLPT N1, murakkab/rasmiy/kam uchraydigan). FAQAT JSON massiv qaytar: [{\"ko\":\"...\",\"l\":\"b|o|y\"}]\n\n"+b.map(x=>x.ko).join('\n')}],"Sen "+lg(lang).n+" tili o'qituvchisisan.",8000);
      const m={};JSON.parse(t.match(/\[[\s\S]*\]/)[0]).forEach(o=>{if(o&&o.ko&&/^[boy]$/.test(o.l))m[o.ko]=o.l});b.forEach(x=>{if(m[x.ko])x.dl=m[x.ko]});break}catch{await new Promise(z=>setTimeout(z,1500))}}
    dn++;job.stage="So'zlar darajasi aniqlanmoqda ("+dn+"/"+bs.length+")..."}};
  await Promise.all(Array.from({length:Math.min(4,bs.length)},w));
  if(items.some(x=>!x.dl))job.warn.push("Ba'zi so'zlar darajasi aniqlanmadi — ular teng bo'lib joylandi.")}

const {Readable}=require('stream');
const GEMMIME={pdf:'application/pdf',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',heic:'image/heic',heif:'image/heif',mp3:'audio/mp3',wav:'audio/wav',m4a:'audio/aac',aac:'audio/aac',ogg:'audio/ogg',flac:'audio/flac',aiff:'audio/aiff',mp4:'video/mp4',mov:'video/quicktime',webm:'video/webm',avi:'video/x-msvideo',mpeg:'video/mpeg',mpg:'video/mpg',wmv:'video/wmv',flv:'video/x-flv','3gp':'video/3gpp'};
const GAPI='https://generativelanguage.googleapis.com';
async function geminiUpload(path,mime,name){
  const size=fs.statSync(path).size;if(size>=2*1024**3)throw new Error("Gemini 2 GB dan katta faylni qabul qilmaydi — faylni bir necha qismga bo'lib yuklang");
  const st=await fetch(GAPI+'/upload/v1beta/files',{method:'POST',signal:AbortSignal.timeout(30000),headers:{'x-goog-api-key':GEMINI_API_KEY,'x-goog-upload-protocol':'resumable','x-goog-upload-command':'start','x-goog-upload-header-content-length':String(size),'x-goog-upload-header-content-type':mime,'content-type':'application/json'},body:JSON.stringify({file:{display_name:name||'book'}})});
  const url=st.headers.get('x-goog-upload-url');if(!st.ok||!url){const j=await st.json().catch(()=>({}));throw new Error((j.error&&j.error.message)||('upload '+st.status))}
  const up=await fetch(url,{method:'POST',duplex:'half',signal:AbortSignal.timeout(60*60000),headers:{'content-length':String(size),'x-goog-upload-offset':'0','x-goog-upload-command':'upload, finalize'},body:Readable.toWeb(fs.createReadStream(path))});
  const j=await up.json().catch(()=>({}));if(!up.ok||!j.file)throw new Error((j.error&&j.error.message)||('upload '+up.status));
  let f=j.file;
  for(let i=0;i<200&&f.state&&f.state!=='ACTIVE';i++){if(f.state==='FAILED')throw new Error("Gemini faylni qayta ishlay olmadi");await new Promise(z=>setTimeout(z,3000));const r=await fetch(GAPI+'/v1beta/'+f.name,{headers:{'x-goog-api-key':GEMINI_API_KEY},signal:AbortSignal.timeout(20000)});f=await r.json()}
  if(f.state&&f.state!=='ACTIVE')throw new Error("Gemini faylni vaqtida tayyorlamadi");
  return f}
function geminiDelete(f){try{fetch(GAPI+'/v1beta/'+f.name,{method:'DELETE',headers:{'x-goog-api-key':GEMINI_API_KEY},signal:AbortSignal.timeout(15000)}).catch(()=>{})}catch{}}
function countPdfPages(path){let n=0,tail='';const fd=fs.openSync(path,'r'),b=Buffer.alloc(4<<20);let pos=0,r;try{while((r=fs.readSync(fd,b,0,b.length,pos))>0){const t=tail+b.toString('latin1',0,r);n+=(t.match(/\/Type\s*\/Page[^s]/g)||[]).length;tail=t.slice(-8);pos+=r}}finally{fs.closeSync(fd)}return n}
const jobs={};
db.exec("create table if not exists jobs(id text primary key,j text,ts int)");
const jobJson=(j,full)=>JSON.stringify(j,(k,v)=>(k==='ids'||k==='_sf'||(!full&&k==='params'))?undefined:v);
const saveJob=j=>{try{db.prepare('insert or replace into jobs(id,j,ts) values(?,?,?)').run(j.id,jobJson(j,1),j.ts)}catch{}};
try{db.prepare('delete from jobs where ts<?').run(Date.now()-3*DAY)}catch{}
setInterval(()=>{for(const k in jobs){const j=jobs[k];if(!j._sf){saveJob(j);if(j.fin)j._sf=true}}},2000).unref();
setInterval(()=>{const t=Date.now();for(const k in jobs)if((jobs[k].fin&&t-jobs[k].ts>36e5)||t-jobs[k].ts>432e5)delete jobs[k]},6e5).unref();
const newJob=()=>{const id=crypto.randomBytes(6).toString('hex');return jobs[id]=(j=>(saveJob(j),j))({id,stage:"Fayl o'qilmoqda...",found:0,total:0,done:0,added:0,translated:0,skipped:0,perLevel:{},perPos:{},warn:[],failedPages:[],expected:0,dups:0,pages:0,emptyPages:[],fin:false,err:null,ts:Date.now()})};
app.get('/api/admin/job/:id',adm('import'),(r,s)=>{let j=jobs[r.params.id];
  if(!j){const row=one('select j from jobs where id=?',String(r.params.id));if(row)try{j=JSON.parse(row.j);delete j.params}catch{}}
  if(!j)return s.status(404).json({e:'yoq'});s.json(jobs[r.params.id]?JSON.parse(jobJson(j)):j)});

const MAXUP=8*1024**3,upPath=id=>DATA+'/uploads/up_'+id+'.part',gb=n=>(n/1024**3).toFixed(1);
app.post('/api/admin/up/start',adm('import'),(r,s)=>{const size=+r.body.size||0;
  if(!(size>0))return s.json({e:'Fayl bo\'sh'});if(size>MAXUP)return s.json({e:"Fayl hajmi 8 GB dan oshmasin"});
  try{const st=fs.statfsSync(DATA),free=st.bavail*st.bsize;if(free<size*1.05+2e8)return s.json({e:"Serverda disk joyi yetmaydi: kerak ~"+gb(size)+" GB, bor "+gb(free)+" GB. Railway'da Volume hajmini oshiring."})}catch{}
  const id=crypto.randomBytes(8).toString('hex');fs.writeFileSync(upPath(id),'');s.json({id})});
app.post('/api/admin/up/chunk/:id',adm('import'),express.raw({type:()=>true,limit:'20mb'}),async(r,s)=>{
  const id=String(r.params.id);if(!/^[a-f0-9]{16}$/.test(id)||!fs.existsSync(upPath(id)))return s.json({e:'Yuklash topilmadi, qaytadan boshlang'});
  const off=Math.max(0,Math.floor(+r.query.off||0)),b=r.body;if(!Buffer.isBuffer(b)||!b.length)return s.json({e:"Bo'sh bo'lak"});if(off+b.length>MAXUP)return s.json({e:'Hajm oshib ketdi'});
  try{const fh=await fs.promises.open(upPath(id),'r+');try{await fh.write(b,0,b.length,off)}finally{await fh.close()}s.json({ok:1})}catch(e){s.json({e:"Bo'lakni yozib bo'lmadi: "+(e.code||e.message)})}});
function pickFile(r){if(r.file)return r.file;const id=String(r.body.upload_id||'');if(!/^[a-f0-9]{16}$/.test(id))return null;
  try{const sz=fs.statSync(upPath(id)).size;if(+r.body.upload_size&&sz!==+r.body.upload_size)return {bad:'Fayl to\'liq yuklanmadi ('+sz+' / '+r.body.upload_size+' bayt) — qayta urinib ko\'ring'};return {path:upPath(id),originalname:String(r.body.upload_name||'file'),size:sz}}catch{return null}}
setInterval(()=>{try{for(const f of fs.readdirSync(DATA+'/uploads'))if(/^up_[a-f0-9]{16}\.part$/.test(f)&&Date.now()-fs.statSync(DATA+'/uploads/'+f).mtimeMs>864e5)fs.unlinkSync(DATA+'/uploads/'+f)}catch{}},36e5).unref();
const rdErr=job=>job.readErr?("Faylni o'qib bo'lmadi: "+job.readErr):job.aiErr?("Gemini javob bermadi: "+job.aiErr+" — birozdan keyin qayta urinib ko'ring."):"Faylni o'qib bo'lmadi (.doc bo'lsa, .docx yoki PDF qilib saqlang; rasm/skan faqat Gemini bilan o'qiladi)";
async function runImportJob(job,F,P){try{job.wlvl=P.wlvl;const d=one('select * from dicts where id=?',P.dict_id);if(!d||d.deleted){job.err="Kitob topilmadi";return}
  job.langs=[LANGS[d.lang]?d.lang:'en'];// mavjud kitobga qo'shishda faqat shu kitob tilidagi so'zlar olinadi
  const items=await extract(F,P.pos,P.auto,job);if(!items){job.err=rdErr(job);return}
  items.forEach(it=>{it.lang=job.langs[0]});
  await addWords(job,d,items,()=>+P.level,P.auto)}catch(e){job.err=String(e.message||e)}finally{job.fin=true;rmF(F)}}
async function runBookJob(job,F,P){try{
  const LS=parseLangs(P.langs);job.langs=LS.length?LS:['en'];
  const items=await extract(F,P.pos,P.auto,job);if(!items){job.err=rdErr(job);return}
  // so'zlar tillar bo'yicha guruhlanadi — har bir tanlangan til uchun ALOHIDA kitob yaratiladi
  const groups={};for(const it of items){const c=job.langs.includes(it.lang)?it.lang:guessLang(it.ko,job.langs);if(!okWord(it.ko,c))continue;(groups[c]=groups[c]||[]).push(it)}
  const order=job.langs.filter(c=>groups[c]&&groups[c].length);
  const totalFound=order.reduce((a,c)=>a+groups[c].length,0);job.found=totalFound;
  if(!order.length)return;
  if(job.langs.length>1)job.expected=0;
  job.books=job.books||[];
  for(const c of order){
    const its=groups[c];let L=P.L,levelOf;
    if(P.lvl==='all'){L=3;job.wlBy={1:'b',2:'o',3:'y'};job.stage="So'zlar darajasi aniqlanmoqda (AI)...";await classifyLevels(its,job,c);
      levelOf=(i,n,it)=>({b:1,o:2,y:3})[it&&it.dl]||Math.min(3,Math.floor(i*3/n)+1)}// Hammasi: boshlang'ich / o'rta / yuqori
    else levelOf=(i,n)=>Math.min(L,Math.floor(i*L/n)+1);// daraja soni bo'yicha teng bo'linadi
    let bk=job.books.find(b=>b.lang===c),d=bk&&one('select * from dicts where id=? and deleted=0',bk.id);
    if(!d){const nm=job.langs.length>1?P.name+' — '+lg(c).n:P.name;
      const id=run('insert into dicts(name,levels,sec,lvl,lang) values(?,?,?,?,?)',nm,L,30,P.lvl,c).lastInsertRowid;d=one('select * from dicts where id=?',id);bk={id,name:nm,lang:c,added:0};job.books.push(bk)}
    job.wlvl=P.lvl==='all'?'':P.lvl;job.ids=[];const a0=job.added;
    await addWords(job,d,its,levelOf,P.auto);bk.added=(bk.added||0)+(job.added-a0)}
  job.found=totalFound;job.dict_id=job.books[0].id
}catch(e){job.err=String(e.message||e)}finally{job.fin=true;rmF(F)}}
// ish parametrlari bazaga yoziladi: server qayta ishga tushsa, ish avtomatik davom etadi
const startJob=(job,F,P)=>{job.params={F:{path:F.path,originalname:F.originalname,size:F.size},P,tries:0};saveJob(job);(P.kind==='book'?runBookJob:runImportJob)(job,F,P)};
app.post('/api/admin/import',adm('import'),upBig.single('file'),(r,s)=>{
  const {dict_id,level=1,pos='ot'}=r.body,d=one('select * from dicts where id=?',dict_id);const F=pickFile(r);if(!d||d.deleted||!F||F.bad)return s.status(400).json({e:(F&&F.bad)||'bad'});
  const job=newJob();s.json({job:job.id});startJob(job,F,{kind:'import',dict_id:d.id,level:+level||1,pos,auto:r.body.auto==='1',wlvl:LVL(r.body.wlvl)})});
app.post('/api/admin/book',adm('import'),upBig.single('file'),(r,s)=>{
  const b=r.body,name=(b.name||'').trim(),pos=b.pos||'ot',lvl=LVL(b.lvl),L=Math.max(1,Math.min(+b.levels||1,30)),langs=parseLangs(b.langs);
  if(!name)return s.json({e:"Kitob nomi kelmadi"});if(!langs.length)return s.json({e:"Kamida bitta tilni belgilang"});const F=pickFile(r);if(!F||F.bad)return s.json({e:(F&&F.bad)||"Fayl serverga yetib bormadi"});
  const job=newJob();s.json({job:job.id});startJob(job,F,{kind:'book',name,pos,lvl,L,auto:b.auto==='1',langs})});
function resumeJobs(){try{for(const r of db.prepare('select * from jobs').all()){let j;try{j=JSON.parse(r.j)}catch{continue}if(j.fin||jobs[j.id])continue;
  const pr=j.params;
  if(pr&&pr.F&&pr.P&&fs.existsSync(pr.F.path)&&(pr.tries||0)<2){pr.tries=(pr.tries||0)+1;
    Object.assign(j,{stage:"Server qayta ishga tushdi — ish avtomatik davom ettirilmoqda ("+pr.tries+"/2)...",err:null,fin:false,ts:Date.now()});delete j._sf;jobs[j.id]=j;saveJob(j);
    (pr.P.kind==='book'?runBookJob:runImportJob)(j,{...pr.F},pr.P)}
  else{j.fin=true;j.err="Server qayta ishga tushdi va ishni davom ettirib bo'lmadi (fayl topilmadi yoki ikki marta urinildi). Shu vaqtgacha qo'shilgan so'zlar saqlangan: "+(j.added||0)+" ta. Faylni qayta yuklasangiz, takroriy so'zlar o'tkazib yuboriladi.";db.prepare('update jobs set j=? where id=?').run(JSON.stringify(j),r.id)}}}catch(e){console.error('resume',e)}}
setTimeout(resumeJobs,1500);
console.log('Server ishga tushdi',new Date().toISOString(),'| xotira',Math.round(process.memoryUsage().rss/1048576)+' MB');
setInterval(()=>{const a=Object.values(jobs).filter(j=>!j.fin);if(a.length)console.log('ish davom etmoqda | xotira',Math.round(process.memoryUsage().rss/1048576)+' MB |',a.map(j=>j.stage).join(' / '))},10000).unref();
app.get('/api/admin/status',adm('admins'),(r,s)=>s.json({key:!!AI_KEY,keyLen:(AI_KEY||'').length,provider:USE_GEMINI?'Gemini':'Claude',model:FOXM,bot:!!BOT_TOKEN,webapp:WEBAPP_URL||'',data:DATA}));
app.post('/api/admin/claude-test',adm('admins'),async(r,s)=>{if(!AI_KEY)return s.json({ok:false,error:"GEMINI_API_KEY serverda ko'rinmayapti. Railway → Variables'ga qo'shing va Deploy bosing. Ikkita loyiha bo'lsa, domen bog'langan loyihaga qo'shing."});
  try{const t=await callClaude([{role:'user',content:"Bir so'z bilan javob ber: tayyormisan?"}],"Qisqa javob ber.",50);s.json({ok:true,reply:t,model:FOXM})}catch(e){s.json({ok:false,error:String(e.message||e)})}});

function resection(id){const d=one('select * from dicts where id=?',id);if(!d)return;const rows=q('select id,level,pos from words where dict_id=? order by id',id),c={};const up=db.prepare('update words set section=? where id=?');db.transaction(()=>{for(const w of rows){const k=w.level+'|'+w.pos;c[k]=c[k]||0;up.run(Math.floor(c[k]/d.sec)+1,w.id);c[k]++}})()}
app.post('/api/admin/word/:id',adm('dicts'),(r,s)=>{const b=r.body,w=one('select * from words where id=?',r.params.id);if(!w)return s.status(400).json({e:'bad'});
  if(b.del){if(w.audio)try{fs.unlinkSync(DATA+'/audio/'+w.audio)}catch{}if(w.audio_uz)try{fs.unlinkSync(DATA+'/audio/'+w.audio_uz)}catch{}run('delete from learned where word_id=?',w.id);run('delete from words where id=?',w.id);return s.json({ok:1})}
  run('update words set ko=?,uz=?,pos=?,level=? where id=?',b.ko||w.ko,b.uz||w.uz,b.pos||w.pos,+b.level||w.level,w.id);if(b.uz&&b.uz!==w.uz){if(w.audio_uz)try{fs.unlinkSync(DATA+'/audio/'+w.audio_uz)}catch{}run("update words set audio_uz='' where id=?",w.id)}if(b.pos||b.level)resection(w.dict_id);s.json({ok:1})});
app.post('/api/admin/word/:id/audio',adm('import'),up.single('audio'),(r,s)=>{const w=one('select * from words where id=?',r.params.id);if(!w||!r.file)return s.status(400).json({e:'bad'});
  const mt=r.file.mimetype||'',ext=mt.includes('ogg')?'ogg':/mp4|m4a|aac/.test(mt)?'mp4':/mpeg|mp3/.test(mt)?'mp3':mt.includes('wav')?'wav':'webm';
  const name='w'+w.id+'_'+Date.now()+'.'+ext;fs.renameSync(r.file.path,DATA+'/audio/'+name);
  if(w.audio)try{fs.unlinkSync(DATA+'/audio/'+w.audio)}catch{}
  run('update words set audio=? where id=?',name,w.id);s.json({ok:1,audio:name})});
app.post('/api/admin/task',adm('tasks'),(r,s)=>{run('insert into tasks(dict_id,level,title,pos,section) values(?,?,?,?,?)',r.body.dict_id,r.body.level,r.body.title,r.body.pos||'',+r.body.section||0);s.json({ok:1})});
app.post('/api/admin/task/:id/del',adm('tasks'),(r,s)=>{run('delete from tasks where id=?',r.params.id);s.json({ok:1})});
app.post('/api/admin/plan',adm('plans'),(r,s)=>{const b=r.body;b.del?run('delete from plans where id=?',b.del):run('insert into plans(months,price,dict_id,monthly) values(?,?,?,?)',+b.months||1,+b.price,+b.dict_id||0,b.monthly?1:0);s.json({ok:1})});
app.post('/api/admin/method',adm('methods'),(r,s)=>{const b=r.body;
  if(b.del)run('delete from methods where id=?',b.del);else if(b.id)run('update methods set name=?,number=?,holder=?,on_=? where id=?',b.name,b.number,b.holder,b.on?1:0,b.id);else run('insert into methods(name,number,holder) values(?,?,?)',b.name,b.number,b.holder);s.json({ok:1})});
app.get('/api/admin/methods',adm('methods'),(r,s)=>s.json(q('select * from methods')));
app.get('/api/admin/users',adm('users'),(r,s)=>s.json(q('select id,name,email,is_admin,perms,paid_until,trial,created from users order by created desc')));
app.post('/api/admin/user',adm('users'),(r,s)=>{const {id,months,grant,revoke}=r.body;
  if(+months){const u0=one('select paid_until from users where id=?',id);run('update users set paid_until=? where id=?',addM(Math.max(u0?u0.paid_until:0,Date.now()),Math.round(+months)),id)}
  if(r.body.cancel)run('update users set paid_until=0 where id=?',id);
  if(grant)run('insert or ignore into access(user_id,dict_id) values(?,?)',id,grant);if(revoke)run('delete from access where user_id=? and dict_id=?',id,revoke);s.json({ok:1})});
app.post('/api/admin/admin',adm('admins'),(r,s)=>{const {id,email,admin,perms}=r.body;let u=id?one('select * from users where id=?',id):one('select * from users where email=?',(email||'').toLowerCase());
  if(!u&&email){run('insert into users(name,email,created) values(?,?,?)',email,email.toLowerCase(),Date.now());u=one('select * from users where email=?',email.toLowerCase())}
  if(!u||u.is_admin==2)return s.status(400).json({e:'bad'});
  if(admin!=null)run('update users set is_admin=? where id=?',admin?1:0,u.id);
  if(perms)run('update users set perms=? where id=?',perms.filter(p=>PERMS.includes(p)).join(','),u.id);s.json({ok:1})});
app.get('/api/admin/pending',adm('payments'),(r,s)=>s.json(q("select p.*,u.name,u.email,pl.months pm,pl.price,pl.monthly,dd.name dname,m.name mname from pays p join users u on u.id=p.user_id left join plans pl on pl.id=p.plan_id left join dicts dd on dd.id=pl.dict_id left join methods m on m.id=p.method_id where status='pending' order by p.id")));
app.get('/api/admin/trials',adm('trials'),(r,s)=>s.json(q("select id,name,email,created from users where trial='pending'")));
const tell=(id,t)=>bot&&bot.telegram.sendMessage(id,t).catch(()=>{});
app.post('/api/admin/trial/:id',adm('trials'),(r,s)=>{const ok=!!r.body.ok,id=r.params.id;
  if(ok)run("update users set trial='accepted',paid_until=max(paid_until,?)+? where id=?",Date.now(),30*DAY,id);else run("update users set trial='rejected' where id=?",id);
  tell(id,ok?"✅ So'rov qabul qilindi: 1 oy bepul foydalanasiz!":"❌ Bepul sinov so'rovi rad etildi.");s.json({ok:1})});
app.post('/api/admin/pay/:id',adm('payments'),(r,s)=>{const p=one('select * from pays where id=?',r.params.id),pl=one('select * from plans where id=?',p.plan_id),ok=!!r.body.ok;
  const mo=Math.max(1,Math.min(36,Math.round(+r.body.months||p.months||(pl&&pl.months)||1)));let end=0;
  run('update pays set status=?,months=? where id=?',ok?'accepted':'rejected',mo,p.id);
  if(ok&&pl){if(pl.dict_id){const a=one('select until from access where user_id=? and dict_id=?',p.user_id,pl.dict_id);
    if(!a){end=addM(Date.now(),mo);run('insert into access(user_id,dict_id,until) values(?,?,?)',p.user_id,pl.dict_id,end)}
    else if(a.until!==0){end=addM(Math.max(a.until,Date.now()),mo);run('update access set until=? where user_id=? and dict_id=?',end,p.user_id,pl.dict_id)}}
  else{const u0=one('select paid_until from users where id=?',p.user_id);end=addM(Math.max(u0?u0.paid_until:0,Date.now()),mo);run('update users set paid_until=? where id=?',end,p.user_id)}}
  tell(p.user_id,ok?"✅ To'lov qabul qilindi. Obuna "+mo+" oyga faollashtirildi"+(end?" ("+new Date(end).toLocaleDateString('ru-RU')+" gacha)":"")+"!":"❌ To'lov rad etildi. Qayta yuboring.");s.json({ok:1})});
// xonalar
app.use((err,req,res,next)=>{res.status(200).json({e:err&&err.code==='LIMIT_FILE_SIZE'?"Fayl juda katta":String((err&&err.message)||err)})});
const server=http.createServer(app),io=new Server(server),rooms={};
const shuffle=a=>a.map(x=>[Math.random(),x]).sort((a,b)=>a[0]-b[0]).map(x=>x[1]);
function buildQs(mode,w,n){
  if(GRAM[mode])return shuffle(GRAM[mode]).slice(0,n).map(g=>({kind:'g',p:g.q,h:g.h,opts:shuffle(g.o),ans:g.a}));
  return shuffle(w).slice(0,n).map(x=>({kind:mode,p:x.ko,lang:x.lang||'ko',audio:x.audio||'',opts:shuffle([x.uz,...shuffle(w.filter(y=>y.id!==x.id)).slice(0,3).map(y=>y.uz)]),ans:x.uz}))}
const roomView=r=>({code:r.code,host:r.host,meta:r.meta,players:Object.entries(r.players).map(([id,p])=>({id:+id,name:p.name,score:p.score,i:p.i,done:p.done}))});
function endRoom(r){if(r.over)return;r.over=true;clearTimeout(r.timer);
  const list=Object.entries(r.players).map(([id,p])=>({id:+id,name:p.name,score:p.score,fin:p.fin||9e15})).sort((a,b)=>b.score-a.score||a.fin-b.fin);
  list.forEach(p=>addScore(p.id,p.name,Math.round(p.score/2)));
  io.to(r.code).emit('end',{players:list.map(({id,name,score})=>({id,name,score})),meta:r.meta});delete rooms[r.code]}
io.on('connection',sock=>{
  const u=auth(sock.handshake.auth);if(!u)return sock.disconnect();
  sock.on('create',({dict,level,mode,n,sec},cb)=>{
    n=Math.max(3,Math.min(+n||10,30));sec=Math.max(5,Math.min(+sec||15,60));mode=mode||'speed';
    let w=[],book='Grammatika',lv=0;
    if(!GRAM[mode]){const d=one('select * from dicts where id=?',dict);if(!d||d.deleted||!can(u,d))return cb({e:"Bu kitob sizga ochiq emas"});book=d.name;lv=+level||0;
      w=q('select w.*,d.lang lang from words w join dicts d on d.id=w.dict_id where w.dict_id=?'+(lv?' and w.level=?':''),...(lv?[dict,lv]:[dict]));if(w.length<4)return cb({e:"Kamida 4 ta so'z kerak"})}
    const qs=buildQs(mode,w,n);let code;do code=String(Math.floor(100000+Math.random()*900000));while(rooms[code]);
    rooms[code]={code,host:u.id,qs,sec,meta:{book,level:lv,n:qs.length,sec,mode},started:false,players:{}};cb({code})});
  sock.on('join',(code,cb)=>{code=String(code||'').trim();const r=rooms[code];if(!r)return cb({e:'Xona topilmadi'});if(r.started)return cb({e:"O'yin boshlangan"});
    r.players[u.id]={name:u.name,score:0,i:0,done:false};sock.join(code);sock.data.code=code;cb({ok:1});io.to(code).emit('room',roomView(r))});
  sock.on('start',()=>{const r=rooms[sock.data.code];if(!r||r.host!==u.id||r.started)return;
    if(Object.keys(r.players).length<2)return sock.emit('err',"Kamida 2 o'yinchi kerak");
    r.started=true;const now=Date.now();Object.values(r.players).forEach(p=>p.t0=now);
    r.timer=setTimeout(()=>endRoom(r),(r.qs.length*r.sec+25)*1000);
    io.to(r.code).emit('start',{qs:r.qs.map(({kind,p,h,opts,audio,lang})=>({kind,p,h,opts,audio,lang})),meta:r.meta})});
  sock.on('answer',({i,c},cb)=>{const r=rooms[sock.data.code],p=r&&r.players[u.id];if(!r||!p||p.done||i!==p.i)return;
    const qn=r.qs[i],now=Date.now(),el=(now-p.t0)/1000,ok=c!=null&&c===qn.ans&&el<=r.sec+1.5;
    if(ok)p.score+=10+Math.max(0,Math.round((r.sec-el)/r.sec*5));
    p.t0=now;p.i++;if(p.i>=r.qs.length){p.done=true;p.fin=now}
    if(typeof cb==='function')cb({ok,ans:qn.ans});io.to(r.code).emit('room',roomView(r));
    if(Object.values(r.players).every(x=>x.done))endRoom(r)});
  sock.on('disconnect',()=>{const r=rooms[sock.data.code];if(!r||r.over)return;delete r.players[u.id];
    if(!Object.keys(r.players).length){clearTimeout(r.timer);delete rooms[r.code];return}
    if(r.host===u.id)r.host=+Object.keys(r.players)[0];
    if(r.started&&Object.values(r.players).every(x=>x.done))endRoom(r);else io.to(r.code).emit('room',roomView(r))})});
let bot;const hist={};
if(BOT_TOKEN){bot=new Telegraf(BOT_TOKEN);
  const open=Markup.button.webApp("📚 Ilovani ochish",WEBAPP_URL);
  bot.start(c=>c.reply("Assalomu alaykum, "+c.from.first_name+"! 🦊\nMen Kori — til o'rganish yordamchingizman.\nSizga qanday yordam bera olaman?",Markup.inlineKeyboard([[open],[Markup.button.callback("💬 Savol berish",'ask'),Markup.button.callback("ℹ️ Nimalar qila olaman?",'help')]])));
  bot.action('ask',c=>{c.answerCbQuery().catch(()=>{});c.reply("Savolingizni yozing, men javob beraman 🦊\n(masalan: «thank you» yoki «고맙습니다» nima degani?)")});
  bot.action('help',c=>{c.answerCbQuery().catch(()=>{});c.reply("Men:\n• so'z va grammatikani tushuntiraman\n• misollar keltiraman\n• mashq va suhbat qilaman\n\nIlovada kartochka, o'yinlar va mashqlar ham bor 👇",Markup.inlineKeyboard([open]))});
  bot.on('text',async c=>{const t=c.message.text;if(t.startsWith('/'))return;const id=c.from.id;
    run('insert or ignore into users(id,name,created) values(?,?,?)',id,c.from.first_name,Date.now());const u=fin(id);
    const k=id+':chat:'+Math.floor(Date.now()/DAY);if((foxUse[k]||0)>=foxLimit(u,'chat'))return c.reply("Bugungi bepul savollar tugadi 🦊 Obuna bo'lsangiz ko'proq yozishingiz mumkin.");
    foxUse[k]=(foxUse[k]||0)+1;const h=hist[id]=hist[id]||[];h.push({role:'user',content:t});c.sendChatAction('typing').catch(()=>{});
    const r=await askFox(h,[]);
    if(r.reply){h.push({role:'assistant',content:r.reply});if(h.length>12)h.splice(0,h.length-12);c.reply(r.reply)}
    else{h.pop();c.reply(r.e==='nokey'?"Men hozircha javob bera olmayman. Ilovani oching 👇":"Xatolik yuz berdi, birozdan keyin urinib ko'ring.",Markup.inlineKeyboard([open]))}});
  bot.launch().catch(console.error);
  bot.telegram.setChatMenuButton({menuButton:{type:'web_app',text:'Ochish',web_app:{url:WEBAPP_URL}}}).catch(()=>{})}

server.listen(PORT,()=>console.log('http://localhost:'+PORT));
