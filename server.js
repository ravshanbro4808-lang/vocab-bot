const express=require('express'),crypto=require('crypto'),fs=require('fs'),http=require('http');
const Database=require('better-sqlite3'),multer=require('multer'),{Telegraf,Markup}=require('telegraf'),{Server}=require('socket.io');
const {OAuth2Client}=require('google-auth-library');
const {BOT_TOKEN,WEBAPP_URL,ADMIN_IDS='',ADMIN_EMAILS='',GOOGLE_CLIENT_ID,SECRET='change-me',DEV,PORT=3000,TRANSLATE_URL,TRANSLATE_KEY,TRANSLATE_TARGET='uz',ANTHROPIC_API_KEY,GEMINI_API_KEY,GEMINI_MODEL='gemini-3.8-flash',FOX_MODEL='claude-haiku-5-5',GOOGLE_TRANSLATE_KEY,BOT_USERNAME='Koreys_lugat_2026_bot'}=process.env;
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
for(const m0 of ["alter table dicts add column lvl text default ''","alter table words add column form text default ''","alter table words add column audio_uz text default ''","alter table words add column lvl text default ''",'alter table words add column audio text','alter table access add column until int default 0','alter table plans add column dict_id int default 0',"alter table tasks add column pos text default ''",'alter table tasks add column section int default 0','alter table plans add column monthly int default 0','alter table pays add column months int default 0','alter table dicts add column deleted int default 0','alter table dicts add column del_ts int default 0','create index if not exists words_dict_ko on words(dict_id,ko)'])try{db.exec(m0)}catch{}
db.exec(`create table if not exists lvnames(dict_id int,level int,name text,primary key(dict_id,level));
create table if not exists poss(key text primary key,name text,ko text default '',ord int default 0);`);
if(!db.prepare('select 1 from poss').get()){const ip=db.prepare('insert into poss(key,name,ko,ord) values(?,?,?,?)');[['ot','Ot','명사'],['fel',"Fe'l (harakat)",'동사'],['sifat','Sifat (holat)','형용사'],['ravish','Ravish','부사'],['olmosh','Olmosh','대명사'],['son','Son','수사'],['yordamchi',"Ko'makchi / yordamchi",'조사']].forEach((p,i)=>ip.run(p[0],p[1],p[2],i))}
if(!one0('select 1 from methods'))for(const n of['Click','Payme','Karta'])db.prepare('insert into methods(name,number,holder) values(?,?,?)').run(n,'','');
function one0(s){return db.prepare(s).get()}
let possC=0,possL=[];const getPoss=()=>{if(Date.now()>possC){possL=db.prepare('select * from poss order by ord,rowid').all();possC=Date.now()+3000}return possL};
const DEFLV=["Boshlang'ich","O'rta","Yuqori"];
// ===== Ko'p tilli bot: tillar va CEFR darajalari =====
const LANGS=[["en", "Ingliz", "English", "🇬🇧", "en-US"], ["ko", "Koreys", "한국어", "🇰🇷", "ko-KR"], ["ja", "Yapon", "日本語", "🇯🇵", "ja-JP"], ["zh", "Xitoy", "中文", "🇨🇳", "zh-CN"], ["ru", "Rus", "Русский", "🇷🇺", "ru-RU"], ["tr", "Turk", "Türkçe", "🇹🇷", "tr-TR"], ["ar", "Arab", "العربية", "🇸🇦", "ar-SA"], ["de", "Nemis", "Deutsch", "🇩🇪", "de-DE"], ["fr", "Fransuz", "Français", "🇫🇷", "fr-FR"], ["es", "Ispan", "Español", "🇪🇸", "es-ES"], ["it", "Italyan", "Italiano", "🇮🇹", "it-IT"], ["pt", "Portugal", "Português", "🇵🇹", "pt-PT"], ["nl", "Golland", "Nederlands", "🇳🇱", "nl-NL"], ["pl", "Polyak", "Polski", "🇵🇱", "pl-PL"], ["uk", "Ukrain", "Українська", "🇺🇦", "uk-UA"], ["kk", "Qozoq", "Қазақша", "🇰🇿", "kk-KZ"], ["ky", "Qirg'iz", "Кыргызча", "🇰🇬", "ky-KG"], ["tg", "Tojik", "Тоҷикӣ", "🇹🇯", "tg-TJ"], ["tk", "Turkman", "Türkmençe", "🇹🇲", "tk-TM"], ["az", "Ozarbayjon", "Azərbaycanca", "🇦🇿", "az-AZ"], ["fa", "Fors", "فارسی", "🇮🇷", "fa-IR"], ["hi", "Hind", "हिन्दी", "🇮🇳", "hi-IN"], ["ur", "Urdu", "اردو", "🇵🇰", "ur-PK"], ["bn", "Bengal", "বাংলা", "🇧🇩", "bn-BD"], ["id", "Indonez", "Bahasa Indonesia", "🇮🇩", "id-ID"], ["ms", "Malay", "Bahasa Melayu", "🇲🇾", "ms-MY"], ["th", "Tay", "ไทย", "🇹🇭", "th-TH"], ["vi", "Vyetnam", "Tiếng Việt", "🇻🇳", "vi-VN"], ["tl", "Filipin", "Tagalog", "🇵🇭", "fil-PH"], ["he", "Ivrit", "עברית", "🇮🇱", "he-IL"], ["el", "Yunon", "Ελληνικά", "🇬🇷", "el-GR"], ["sv", "Shved", "Svenska", "🇸🇪", "sv-SE"], ["no", "Norveg", "Norsk", "🇳🇴", "nb-NO"], ["da", "Dat", "Dansk", "🇩🇰", "da-DK"], ["fi", "Fin", "Suomi", "🇫🇮", "fi-FI"], ["cs", "Chex", "Čeština", "🇨🇿", "cs-CZ"], ["sk", "Slovak", "Slovenčina", "🇸🇰", "sk-SK"], ["hu", "Venger", "Magyar", "🇭🇺", "hu-HU"], ["ro", "Rumin", "Română", "🇷🇴", "ro-RO"], ["bg", "Bolgar", "Български", "🇧🇬", "bg-BG"], ["sr", "Serb", "Српски", "🇷🇸", "sr-RS"], ["hr", "Xorvat", "Hrvatski", "🇭🇷", "hr-HR"], ["sl", "Sloven", "Slovenščina", "🇸🇮", "sl-SI"], ["lt", "Litva", "Lietuvių", "🇱🇹", "lt-LT"], ["lv", "Latish", "Latviešu", "🇱🇻", "lv-LV"], ["et", "Eston", "Eesti", "🇪🇪", "et-EE"], ["ka", "Gruzin", "ქართული", "🇬🇪", "ka-GE"], ["hy", "Arman", "Հայերեն", "🇦🇲", "hy-AM"], ["mn", "Mo'g'ul", "Монгол", "🇲🇳", "mn-MN"], ["ne", "Nepal", "नेपाली", "🇳🇵", "ne-NP"], ["ta", "Tamil", "தமிழ்", "🇮🇳", "ta-IN"], ["te", "Telugu", "తెలుగు", "🇮🇳", "te-IN"], ["sw", "Suaxili", "Kiswahili", "🇰🇪", "sw-KE"], ["af", "Afrikaans", "Afrikaans", "🇿🇦", "af-ZA"], ["la", "Lotin", "Latina", "🏛️", "la"], ["is", "Island", "Íslenska", "🇮🇸", "is-IS"], ["ga", "Irland", "Gaeilge", "🇮🇪", "ga-IE"], ["ca", "Katalan", "Català", "🏴", "ca-ES"], ["sq", "Alban", "Shqip", "🇦🇱", "sq-AL"], ["mk", "Makedon", "Македонски", "🇲🇰", "mk-MK"]].map(x=>({code:x[0],name:x[1],native:x[2],flag:x[3],tts:x[4]}));
const LANGM=Object.fromEntries(LANGS.map(l=>[l.code,l]));
const CEFR=['A1','A2','B1','B2','C1','C2'];
for(const m0 of ["alter table words add column lang text default 'ko'","alter table dicts add column langs text default ''","create index if not exists words_lang on words(dict_id,lang)"])try{db.exec(m0)}catch{}

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
app.get('/config',(r,s)=>s.json({google:GOOGLE_CLIENT_ID||null,dev:!!DEV,bot:BOT_USERNAME,fox:!!AI_KEY,voice:USE_GEMINI}));
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
// ===== GRAMMATIKA MA'LUMOTLARI: [shakl, daraja(1-3), turkum, ma'nosi, qachon/qayerda ishlatiladi, [[koreyscha {grammatika qismi}, o'zbekcha], ...]] =====
const GRM_LV=["","Boshlang'ich","O'rta","Yuqori"];
const GRM=[
// ---------- YUKLAMALAR
["은/는",1,"Yuklamalar","Mavzu yuklamasi: «...-ga kelsak», «...esa»","Gap mavzusini bildiradi yoki ikki narsani qarama-qarshi qo'yadi. Unli bilan tugagan so'zdan keyin 는, undosh bilan tugaganidan keyin 은 qo'yiladi.",[["{저는} 학생이에요.","Men talabaman."],["이것{은} 책이에요.","Bu — kitob."],["저는 커피{는} 좋아하지만 차는 안 좋아해요.","Men kofeni yoqtiraman, ammo choyni yoqtirmayman."]]],
["이/가",1,"Yuklamalar","Ega yuklamasi","Gapning egasini bildiradi; yangi axborot yoki «kim/nima» savoliga javob beradi. Unli bilan tugasa 가, undosh bilan tugasa 이.",[["비{가} 와요.","Yomg'ir yog'yapti."],["동생{이} 학교에 가요.","Ukam maktabga boradi."],["누{가} 왔어요?","Kim keldi?"]]],
["을/를",1,"Yuklamalar","Tushum kelishigi (-ni)","Harakat yo'nalgan narsani (to'ldiruvchi) bildiradi. Unli bilan tugasa 를, undosh bilan tugasa 을.",[["저는 밥{을} 먹어요.","Men ovqat yeyman."],["영화{를} 봐요.","Kino ko'raman."],["어제 친구{를} 만났어요.","Kecha do'stim bilan uchrashdim."]]],
["에 (joy, vaqt)",1,"Yuklamalar","-ga, -da (vaqt va yo'nalish)","Borish/kelish yo'nalishi, mavjudlik joyi (있다/없다) va aniq vaqt (soat, kun, oy) bilan ishlatiladi.",[["학교{에} 가요.","Maktabga boraman."],["아침 일곱 시{에} 일어나요.","Ertalab soat yettida turaman."],["책상 위{에} 책이 있어요.","Stol ustida kitob bor."]]],
["에서 (joyda)",1,"Yuklamalar","-da (harakat bajariladigan joy), -dan","Harakat sodir bo'ladigan joyni yoki boshlanish nuqtasini («...dan») bildiradi.",[["도서관{에서} 공부해요.","Kutubxonada o'qiyman."],["저는 우즈베키스탄{에서} 왔어요.","Men O'zbekistondan keldim."],["집{에서} 쉬어요.","Uyda dam olaman."]]],
["에게/한테/께",1,"Yuklamalar","-ga (kishiga)","Harakat qaratilgan kishi yoki jonzotni bildiradi. 한테 — og'zaki, 께 — hurmat shakli.",[["친구{에게} 선물을 줬어요.","Do'stimga sovg'a berdim."],["엄마{한테} 전화했어요.","Onamga qo'ng'iroq qildim."],["선생님{께} 질문했어요.","Ustozdan so'radim."]]],
["에게서/한테서",2,"Yuklamalar","-dan (kishidan)","Biror narsa olingan, eshitilgan yoki kelgan kishini bildiradi.",[["친구{에게서} 편지를 받았어요.","Do'stimdan xat oldim."],["엄마{한테서} 선물을 받았어요.","Onamdan sovg'a oldim."],["선생님{께} 배웠어요.","Ustozdan o'rgandim."]]],
["도",1,"Yuklamalar","-ham","Ustiga qo'shish yoki o'xshashlikni bildiradi. 은/는, 이/가, 을/를 o'rniga turadi.",[["저{도} 학생이에요.","Men ham talabaman."],["커피{도} 마셔요.","Kofe ham ichaman."],["오늘{도} 비가 와요.","Bugun ham yomg'ir yog'yapti."]]],
["와/과, (이)랑, 하고",1,"Yuklamalar","-va, -bilan","Ikki narsani sanash yoki «birga» ma'nosida. 와/과 — yozma, (이)랑·하고 — og'zaki.",[["사과{와} 배를 샀어요.","Olma va nok sotib oldim."],["친구{랑} 영화를 봤어요.","Do'stim bilan kino ko'rdim."],["엄마{하고} 시장에 갔어요.","Onam bilan bozorga bordim."]]],
["의",1,"Yuklamalar","-ning (egalik)","Egalik yoki tegishlilikni bildiradi; og'zaki nutqda ko'pincha tushib qoladi.",[["이것은 저{의} 가방이에요.","Bu mening sumkam."],["친구{의} 집에 갔어요.","Do'stimning uyiga bordim."],["한국{의} 음식은 맛있어요.","Koreya ovqatlari mazali."]]],
["(으)로",1,"Yuklamalar","-bilan (vosita), -ga (yo'nalish)","Transport, vosita, material yoki yo'nalishni bildiradi. Undosh bilan tugasa 으로, unli yoki ㄹ bilan tugasa 로.",[["버스{로} 가요.","Avtobusda boraman."],["오른쪽{으로} 가세요.","O'ngga boring."],["연필{로} 써요.","Qalam bilan yozaman."]]],
["부터 ~ 까지",1,"Yuklamalar","-dan ... -gacha","Vaqt yoki joyning boshlanishi (부터) va tugashi (까지)ni bildiradi.",[["아홉 시{부터} 다섯 시까지 일해요.","Soat to'qqizdan beshgacha ishlayman."],["월요일{부터} 금요일까지 학교에 가요.","Dushanbadan jumagacha maktabga boraman."],["여기{부터} 저기까지 걸었어요.","Bu yerdan u yergacha yurdim."]]],
["만",1,"Yuklamalar","faqat","Boshqasini chiqarib tashlab, faqat shu narsani ajratadi.",[["물{만} 마셔요.","Faqat suv ichaman."],["저{만} 몰라요.","Faqat men bilmayman."],["하나{만} 주세요.","Faqat bittasini bering."]]],
["보다",1,"Yuklamalar","-dan ko'ra, -dan (taqqoslash)","Ikki narsani taqqoslaganda, solishtirilayotgan narsadan keyin qo'yiladi. Ko'pincha 더 («yana ham») bilan keladi.",[["저는 언니{보다} 키가 커요.","Men opamdan balandman."],["커피{보다} 차를 더 좋아해요.","Kofedan ko'ra choyni ko'proq yoqtiraman."],["어제{보다} 오늘이 더 추워요.","Bugun kechagidan sovuqroq."]]],
["처럼/같이",2,"Yuklamalar","-day, -dek, kabi","Biror narsaga o'xshatish uchun ishlatiladi.",[["아기{처럼} 웃어요.","Chaqaloqdek kuladi."],["가수{처럼} 노래해요.","Xonanda kabi kuylaydi."],["눈{같이} 하얘요.","Qordek oppoq."]]],
["마다",2,"Yuklamalar","har bir","Takrorlanuvchi vaqt yoki guruhdagi har bir birlikni bildiradi.",[["날{마다} 운동해요.","Har kuni sport qilaman."],["주말{마다} 영화를 봐요.","Har dam olishda kino ko'raman."],["사람{마다} 생각이 달라요.","Har kishining fikri boshqa."]]],
["쯤/정도",2,"Yuklamalar","taxminan","Vaqt, miqdor yoki o'lchovni taxminiy aytishda.",[["열 시{쯤} 만나요.","Soat o'nlarda uchrashamiz."],["한 시간{정도} 걸려요.","Taxminan bir soat ketadi."],["삼십 분{쯤} 기다렸어요.","Taxminan o'ttiz daqiqa kutdim."]]],
["밖에 (+ inkor)",2,"Yuklamalar","faqat, ...dan boshqa yo'q","Doim inkor fe'l bilan keladi: «faqat shuncha bor, boshqa yo'q» (kamlik, yetishmaslik).",[["천 원{밖에} 없어요.","Mingdan boshqa pulim yo'q (faqat ming von bor)."],["한 명{밖에} 안 왔어요.","Faqat bitta odam keldi."],["시간이 십 분{밖에} 안 남았어요.","Vaqt atigi o'n daqiqa qoldi."]]],
["(이)나",2,"Yuklamalar","yoki; -cha (ko'pligi)","Tanlov («yoki») yoki miqdor kutilganidan ko'pligini («-cha ham») bildiradi.",[["커피{나} 차를 마셔요.","Kofe yoki choy ichaman."],["세 시간{이나} 기다렸어요.","Uch soat ham kutdim."],["주스{나} 물을 주세요.","Sharbat yoki suv bering."]]],
["(이)라도",3,"Yuklamalar","hech bo'lmasa ...","Eng yaxshi tanlov bo'lmasa ham «hech bo'lmasa shuni» degan ma'noda.",[["커피{라도} 마시자.","Hech bo'lmasa kofe ichaylik."],["물{이라도} 주세요.","Hech bo'lmasa suv bering."],["지금{이라도} 가자.","Hozir bo'lsa ham boraylik."]]],
["조차",3,"Yuklamalar","hatto ...ham (inkor bilan)","Eng kutilmagan narsa ham shunday ekanini bildiradi, odatda inkor ma'noli gapda.",[["이름{조차} 몰라요.","Hatto ismini ham bilmayman."],["물{조차} 마실 수 없었어요.","Hatto suv ham ichib bo'lmadi."],["가족{조차} 믿지 않았어요.","Hatto oilasiga ham ishonmadi."]]],
["(이)야말로",3,"Yuklamalar","aynan, ayni ...","Biror narsani alohida ta'kidlash uchun: «aynan shu».",[["건강{이야말로} 가장 중요해요.","Aynan sog'liq eng muhim."],["지금{이야말로} 기회예요.","Aynan hozir imkoniyat."],["너{야말로} 내 친구야.","Aynan sen mening do'stimsan."]]],
// ---------- TUGATUVCHI SHAKLLAR
["-(이)에요 / 이다",1,"Tugatuvchi shakllar","...dir, ...man/-san (ega-kesim)","«Ega — ot» tuzilmasi uchun bog'lama. Unli bilan tugasa 예요, undosh bilan tugasa 이에요; o'tgan zamon — (이)었어요.",[["저는 학생{이에요}.","Men talabaman."],["이것은 책{이에요}.","Bu — kitob."],["어제는 월요일{이었어요}.","Kecha dushanba edi."]]],
["있다 / 없다",1,"Tugatuvchi shakllar","bor / yo'q","Mavjudlik: 있다 — bor, 없다 — yo'q. Ega + 이/가 bilan keladi; egalikni ham bildiradi.",[["책이 {있어요}.","Kitob bor."],["돈이 {없어요}.","Pul yo'q."],["지금 시간 {있어요}?","Hozir vaqtingiz bormi?"]]],
["-아/어요 (hurmatli norasmiy)",1,"Tugatuvchi shakllar","Xushmuomala kundalik uslub","Kundalik hayotda hamma bilan (ustoz va yoshi kattalarga ham) gaplashganda eng ko'p ishlatiladigan tugatuvchi shakl.",[["밥을 {먹어요}.","Ovqat yeyman."],["날씨가 {좋아요}.","Ob-havo yaxshi."],["지금 {가요}.","Hozir ketyapman."]]],
["-ㅂ/습니다",1,"Tugatuvchi shakllar","Rasmiy hurmatli uslub","Rasmiy joylar: ish, yig'ilish, yangiliklar, taqdimot. So'roq shakli — -ㅂ/습니까?",[["저는 학생{입니다}.","Men talabaman (rasmiy)."],["감사{합니다}.","Rahmat (rasmiy)."],["밥을 {먹습니다}.","Ovqat yeyman (rasmiy)."]]],
["반말 (-아/어, -야)",2,"Tugatuvchi shakllar","Norasmiy (do'stlar orasida) uslub","Do'stlar, o'zidan kichiklar va yaqinlar bilan. Kattalarga ishlatilmaydi.",[["밥 {먹었어}?","Ovqat yedingmi?"],["지금 {가}.","Hozir ketyapman."],["이거 {뭐야}?","Bu nima?"]]],
["-(으)세요",1,"Tugatuvchi shakllar","Hurmatli buyruq / so'rov","Kattalarga hurmat bilan buyruq, iltimos yoki oddiy hurmatli gap.",[["안녕히 {가세요}.","Xayr (ketuvchiga)."],["여기 {앉으세요}.","Marhamat, shu yerga o'tiring."],["선생님은 책을 {읽으세요}.","Ustoz kitob o'qiyaptilar."]]],
["-(으)시-",2,"Tugatuvchi shakllar","Hurmat infiksi","Gap egasi (hurmatli shaxs) uchun fe'lga qo'shiladi; hurmat qiluvchi shaklning asosi.",[["선생님께서 {오셨어요}.","Ustoz keldilar."],["어머니는 지금 {주무세요}.","Onam hozir uxlayaptilar."],["사장님은 {바쁘세요}.","Direktor band."]]],
["-았/었/였-",1,"Zamon va sifatdosh","O'tgan zamon","Fe'l yoki sifat asosiga qo'shilib, o'tgan zamonni ifodalaydi.",[["어제 영화를 {봤어요}.","Kecha kino ko'rdim."],["밥을 {먹었어요}.","Ovqat yedim."],["숙제를 {했어요}.","Uy vazifasini qildim."]]],
["-(으)ㄹ 거예요",1,"Zamon va sifatdosh","Kelasi zamon, taxmin","Rejani yoki taxminni bildiradi: «...aman», «...ar».",[["내일 {갈 거예요}.","Ertaga boraman."],["주말에 {쉴 거예요}.","Dam olishda dam olaman."],["아마 비가 {올 거예요}.","Ehtimol yomg'ir yog'adi."]]],
["-고 있다",1,"Zamon va sifatdosh","...yapti (davom etayotgan harakat)","Hozir davom etayotgan harakatni bildiradi.",[["지금 밥을 {먹고 있어요}.","Hozir ovqat yeyapman."],["친구를 {기다리고 있어요}.","Do'stimni kutyapman."],["한국어를 {공부하고 있어요}.","Koreys tilini o'rganyapman."]]],
["-는 (hozirgi sifatdosh)",2,"Zamon va sifatdosh","...yotgan / ...adigan (fe'l + ot)","Fe'lni otga bog'lab, hozirgi yoki odatiy harakatni tasvirlaydi.",[["제가 {좋아하는} 음식은 김치예요.","Men yoqtiradigan ovqat — kimchi."],["{공부하는} 학생이 많아요.","O'qiyotgan talabalar ko'p."],["{자는} 아기를 보세요.","Uxlayotgan chaqaloqqa qarang."]]],
["-(으)ㄴ (o'tgan / sifat sifatdoshi)",2,"Zamon va sifatdosh","...gan (o'tgan) / ...li (sifat + ot)","Fe'l asosida o'tgan zamon sifatdoshi, sifat asosida esa oddiy sifat+ot birikmasi.",[["어제 {본} 영화가 재미있었어요.","Kecha ko'rgan kinom qiziqarli edi."],["{예쁜} 꽃을 샀어요.","Chiroyli gul sotib oldim."],["친구가 {준} 선물이에요.","Do'stim bergan sovg'a."]]],
["-(으)ㄹ (kelasi sifatdosh)",2,"Zamon va sifatdosh","...adigan, ...ajak (kelasi)","Kelajakdagi yoki hali bo'lmagan harakatni otga bog'laydi.",[["내일 {먹을} 음식이에요.","Ertaga yeydigan ovqat."],["{읽을} 책을 샀어요.","O'qiydigan kitob sotib oldim."],["{갈} 곳이 많아요.","Boradigan joylar ko'p."]]],
["-겠-",2,"Zamon va sifatdosh","niyat / taxmin / kamtarlik","Gapirayotganning niyati, yaqin kelajak taxmini yoki xushmuomala-rasmiy ifodalarda ishlatiladi.",[["제가 {하겠습니다}.","Men qilaman."],["내일은 비가 {오겠어요}.","Ertaga yomg'ir yog'sa kerak."],["정말 맛있{겠어요}.","Juda mazali ko'rinadi."]]],
// ---------- BOG'LOVCHILAR
["-고",1,"Bog'lovchilar","va (sanash, ketma-ketlik)","Ikki fe'l/sifatni bog'laydi: «va», «keyin».",[["저는 밥을 {먹고} 학교에 가요.","Men ovqat yeb maktabga boraman."],["이 옷은 {예쁘고} 싸요.","Bu kiyim chiroyli va arzon."],["친구를 {만나고} 영화를 봤어요.","Do'stim bilan uchrashib, kino ko'rdim."]]],
["-아/어서",1,"Bog'lovchilar","...ib; ...gani uchun","Ketma-ket harakat yoki sabab. Buyruq va taklif bilan ishlatilmaydi.",[["시장에 {가서} 과일을 샀어요.","Bozorga borib meva sotib oldim."],["비가 {와서} 집에 있어요.","Yomg'ir yog'ayotgani uchun uydaman."],["늦게 {일어나서} 지각했어요.","Kech turganim uchun kechikdim."]]],
["-(으)니까",1,"Bog'lovchilar","chunki; ...gani uchun","Sabab ko'rsatadi va buyruq/taklif bilan ham kela oladi.",[["비가 {오니까} 우산을 가져가세요.","Yomg'ir yog'ayotgani uchun soyabon olib keting."],["시간이 {없으니까} 택시를 탑시다.","Vaqt yo'q, taksiga o'tiraylik."],["날씨가 {추우니까} 옷을 입으세요.","Havo sovuq, kiyining."]]],
["-지만",1,"Bog'lovchilar","lekin, ammo","Qarama-qarshi fikrni bog'laydi.",[["{비싸지만} 맛있어요.","Qimmat, lekin mazali."],["한국어는 {어렵지만} 재미있어요.","Koreys tili qiyin, lekin qiziqarli."],["열심히 {했지만} 시험에 떨어졌어요.","Astoydil harakat qildim, lekin imtihondan yiqildim."]]],
["-(으)면",1,"Bog'lovchilar","agar ...sa","Shart bildiradi.",[["시간이 {있으면} 같이 가요.","Vaqtingiz bo'lsa birga boraylik."],["비가 {오면} 집에 있을 거예요.","Yomg'ir yog'sa, uyda bo'laman."],["{피곤하면} 쉬세요.","Charchasangiz, dam oling."]]],
["-(으)면서",2,"Bog'lovchilar","...gancha, ...ib turib (bir vaqtda)","Bir kishi ikki harakatni bir vaqtda bajarishini bildiradi.",[["음악을 {들으면서} 공부해요.","Musiqa tinglab o'qiyman."],["{걸으면서} 전화해요.","Yurib turib gaplashaman."],["{웃으면서} 이야기했어요.","Kulib turib gapirdi."]]],
["-(으)ㄴ/는데",2,"Bog'lovchilar","...ib, ...-u/-yu (fon yoki qarama-qarshilik)","Keyingi gap uchun fon beradi, taklif/savolga zamin yaratadi yoki yumshoq qarama-qarshilik bildiradi.",[["비가 {오는데} 우산이 없어요.","Yomg'ir yog'yapti-yu, soyabonim yo'q."],["한국어를 {배우는데} 재미있어요.","Koreys tilini o'rganyapman va qiziqarli."],["어제 영화를 {봤는데} 정말 슬펐어요.","Kecha kino ko'rdim, juda qayg'uli ekan."]]],
["-거나",2,"Bog'lovchilar","yoki (harakatlar orasida tanlov)","Ikki yoki undan ko'p harakatdan birini tanlashni bildiradi.",[["주말에 영화를 {보거나} 책을 읽어요.","Dam olishda kino ko'raman yoki kitob o'qiyman."],["커피를 {마시거나} 차를 마셔요.","Kofe yoki choy ichaman."],["{걷거나} 버스를 타요.","Piyoda yuraman yoki avtobusga o'tiraman."]]],
["-다가",2,"Bog'lovchilar","...yotib (to'xtab, boshqasiga o'tish)","Davom etayotgan harakat to'xtab, boshqa harakat boshlanganini bildiradi.",[["학교에 {가다가} 친구를 만났어요.","Maktabga ketayotib do'stimni uchratdim."],["{공부하다가} 잠들었어요.","O'qiyotib uxlab qoldim."],["{자다가} 깼어요.","Uxlab yotib uyg'onib ketdim."]]],
["-자마자",2,"Bog'lovchilar","...ishi bilan (zumda)","Bir harakat tugashi bilanoq keyingisi boshlanadi.",[["집에 {오자마자} 샤워했어요.","Uyga kelishim bilan dushga tushdim."],["{일어나자마자} 커피를 마셔요.","Turishim bilan kofe ichaman."],["수업이 {끝나자마자} 갔어요.","Dars tugashi bilan ketdi."]]],
["-(으)ㄹ 때",1,"Bog'lovchilar","...ganda, ...payti","Harakat yoki holat sodir bo'ladigan vaqt.",[["{어릴 때} 서울에 살았어요.","Bolaligimda Seulda yashaganman."],["밥을 {먹을 때} 말하지 마세요.","Ovqat yeyayotganda gapirmang."],["시간이 {있을 때} 전화하세요.","Vaqtingiz bo'lganda qo'ng'iroq qiling."]]],
["-기 전에",1,"Bog'lovchilar","...dan oldin","Biror harakatdan oldin nima qilinishini bildiradi.",[["{자기 전에} 이를 닦아요.","Uxlashdan oldin tish yuvaman."],["밥을 {먹기 전에} 손을 씻어요.","Ovqatdan oldin qo'l yuvaman."],["{출발하기 전에} 전화하세요.","Yo'lga chiqishdan oldin qo'ng'iroq qiling."]]],
["-(으)ㄴ 후에 / 다음에",1,"Bog'lovchilar","...dan keyin","Bir harakatdan keyin nima bo'lishini bildiradi.",[["밥을 {먹은 후에} 커피를 마셔요.","Ovqatdan keyin kofe ichaman."],["수업이 {끝난 후에} 만나요.","Dars tugagach uchrashamiz."],["{운동한 다음에} 샤워해요.","Mashqdan keyin dushga tushaman."]]],
["-는 동안",2,"Bog'lovchilar","...davomida","Bir harakat davom etayotgan vaqt oralig'i.",[["제가 {자는 동안} 비가 왔어요.","Men uxlab yotganimda yomg'ir yog'di."],["{방학 동안} 여행했어요.","Ta'til davomida sayohat qildim."],["{기다리는 동안} 책을 읽었어요.","Kutib turgan vaqtimda kitob o'qidim."]]],
["-(으)ㄹ수록",3,"Bog'lovchilar","qanchalik ...sa, shunchalik","Bir narsa oshgani sari boshqasi ham o'zgarishini bildiradi.",[["한국어는 {배울수록} 재미있어요.","Koreys tilini o'rgangan sari qiziqarli."],["{먹을수록} 더 먹고 싶어요.","Yegan sari yana yegim keladi."],["{볼수록} 예뻐요.","Qaragan sari chiroyli."]]],
["-는 대로",3,"Bog'lovchilar","...ganday; ...ishi bilan","Biror narsa qanday bo'lsa shundayligini yoki harakat tugashi bilanoq keyingisi boshlanishini bildiradi.",[["제가 {말하는 대로} 하세요.","Men aytgandek qiling."],["도착하{는 대로} 연락할게요.","Yetib borishim bilan aloqaga chiqaman."],["{생각한 대로} 됐어요.","O'ylaganimdek bo'ldi."]]],
["-(으)ㄴ 채로",3,"Bog'lovchilar","...gan holda","Bir holat o'zgarmagan holda boshqa harakat bajarilishi.",[["불을 {켠 채로} 잤어요.","Chiroqni yoqib qo'yib uxlab qoldim."],["신발을 {신은 채로} 들어갔어요.","Poyabzal bilan kirib ketdim."],["{앉은 채로} 졸았어요.","O'tirgan holda mudrab qoldim."]]],
["-(으)ㄹ 뿐만 아니라",3,"Bog'lovchilar","nafaqat ..., balki ...","Birinchi ma'noga ikkinchisini qo'shadi.",[["그는 {친절할 뿐만 아니라} 똑똑해요.","U nafaqat mehribon, balki aqlli ham."],["이 음식은 {맛있을 뿐만 아니라} 건강에도 좋아요.","Bu ovqat nafaqat mazali, balki sog'liq uchun ham foydali."],["노래를 {잘할 뿐만 아니라} 춤도 잘 춰요.","Nafaqat yaxshi kuylaydi, balki yaxshi raqsga ham tushadi."]]],
["-(으)ㄴ/는 데다가",3,"Bog'lovchilar","bundan tashqari, ustiga ustak","Yaxshi yoki yomon holatga yana bir shu xildagi holat qo'shiladi.",[["이 식당은 {맛있는 데다가} 싸요.","Bu restoran mazali, ustiga arzon."],["그 사람은 {똑똑한 데다가} 친절해요.","U aqlli, bundan tashqari mehribon."],["비도 {오는 데다가} 바람도 불어요.","Yomg'ir yog'yapti, ustiga shamol ham esyapti."]]],
["-기도 하고 -기도 하다",3,"Bog'lovchilar","ham ..., ham ...","Bir kishi bajaradigan bir necha harakat yoki holatni sanaydi.",[["주말에는 {책을 읽기도 하고} 영화도 봐요.","Dam olishda ham kitob o'qiyman, ham kino ko'raman."],["그는 {웃기도 하고} 울기도 했어요.","U ham kuldi, ham yig'ladi."],["{춥기도 하고} 배도 고파요.","Ham sovuq, ham qornim och."]]],
// ---------- SABAB VA MAQSAD
["-(으)려고",2,"Sabab va maqsad","...moqchi bo'lib (niyat bilan)","Harakat nima maqsadda qilinishini bildiradi. Birinchi qismning egasi va ikkinchi qismning egasi bir xil bo'ladi.",[["한국어를 {배우려고} 한국에 왔어요.","Koreys tilini o'rganish uchun Koreyaga keldim."],["친구를 {만나려고} 왔어요.","Do'stim bilan uchrashish uchun keldim."],["살을 {빼려고} 운동해요.","Ozish uchun sport qilaman."]]],
["-(으)러 가다/오다",1,"Sabab va maqsad","...gani (bormoq/kelmoq)","Borish yoki kelish maqsadini bildiradi.",[["밥을 {먹으러} 가요.","Ovqat yegani boraman."],["책을 {사러} 서점에 갔어요.","Kitob sotib olgani kitob do'koniga bordim."],["친구를 {만나러} 왔어요.","Do'stim bilan uchrashgani keldim."]]],
["-기 때문에",2,"Sabab va maqsad","...gani uchun (rasmiyroq sabab)","Aniq sababni bildiradi, yozma va rasmiy nutqda ko'p uchraydi.",[["비가 {오기 때문에} 안 갔어요.","Yomg'ir yog'gani uchun bormadim."],["{바쁘기 때문에} 못 가요.","Bandligim sababli bora olmayman."],["{아프기 때문에} 쉬었어요.","Kasal bo'lgani uchun dam oldim."]]],
["-느라고",3,"Sabab va maqsad","...ish bilan band bo'lib (salbiy oqibat)","Bir ish bilan band bo'lganligi sababli yomon natija chiqqanini bildiradi.",[["숙제를 {하느라고} 못 잤어요.","Uy vazifasini qilib uxlay olmadim."],["{게임하느라고} 늦었어요.","O'yin o'ynab kechikdim."],["{준비하느라고} 바빴어요.","Tayyorgarlik bilan band edim."]]],
["-(으)ㄹ까 봐",3,"Sabab va maqsad","...mikan deb (xavotir bilan)","Biror yomon narsa bo'lishidan qo'rqib, oldindan qilingan harakat.",[["{늦을까 봐} 택시를 탔어요.","Kechikib qolmayin deb taksiga o'tirdim."],["{비가 올까 봐} 우산을 가져왔어요.","Yomg'ir yog'masin deb soyabon oldim."],["{잊어버릴까 봐} 적어 놨어요.","Unutmayin deb yozib qo'ydim."]]],
["-(으)ㄴ/는 바람에",3,"Sabab va maqsad","...gani sababli (kutilmagan yomon oqibat)","Kutilmagan voqea sababli yomon natija chiqqanini bildiradi.",[["길이 {막히는 바람에} 늦었어요.","Yo'l tiqilib qolgani uchun kechikdim."],["{넘어지는 바람에} 다쳤어요.","Yiqilib tushib, jarohat oldim."],["감기에 {걸리는 바람에} 못 갔어요.","Shamollab qolganim sababli bora olmadim."]]],
["-도록",3,"Sabab va maqsad","...sin deb; ...guncha","Maqsad («...sin deb») yoki daraja/chegara («...gunga qadar») ni bildiradi.",[["잊지 {않도록} 메모하세요.","Unutmaslik uchun yozib qo'ying."],["잘 {들리도록} 크게 말하세요.","Yaxshi eshitilishi uchun baland gapiring."],["늦지 {않도록} 일찍 나왔어요.","Kechikmaslik uchun erta chiqdim."]]],
["-게",2,"Sabab va maqsad","-lik bilan; ...qilib (ravish yasovchi)","Sifatni ravishga aylantirib, harakat qanday bajarilishini bildiradi.",[["{예쁘게} 웃어요.","Chiroyli kuladi."],["{맛있게} 드세요.","Yoqimli ishtaha!"],["{크게} 말하세요.","Baland gapiring."]]],
["-(으)ㄹ 겸",3,"Sabab va maqsad","...ham ...ham (ikki maqsad)","Bir harakat bilan ikki maqsadni birdaniga amalga oshirishni bildiradi.",[["운동도 {할 겸} 걸어서 갔어요.","Mashq ham bo'lsin deb piyoda bordim."],["친구도 {만날 겸} 여행을 갔어요.","Do'stlarim bilan ham ko'rishay deb sayohatga bordim."],["바람도 {쐴 겸} 나갔어요.","Shamolga ham chiqay deb tashqariga chiqdim."]]],
["-는 김에",3,"Sabab va maqsad","...ayotgan ekan (qulay fursatda)","Bir ish bilan chiqqan paytda yana boshqasini ham bajarishni bildiradi.",[["서점에 {가는 김에} 책도 샀어요.","Kitob do'koniga borganda kitob ham sotib oldim."],["{나가는 김에} 우유 좀 사다 주세요.","Chiqqan joyingda sut ham olib kel."],["{청소하는 김에} 빨래도 했어요.","Tozalayotib kir ham yuvdim."]]],
["-(으)ㄹ 정도로",3,"Sabab va maqsad","...darajada","Biror holat qanchalik kuchli ekanini misol bilan ko'rsatadi.",[["{죽을 정도로} 피곤해요.","O'lgudek charchadim."],["믿기 {어려울 정도로} 예뻐요.","Ishonish qiyin darajada chiroyli."],["눈물이 {날 정도로} 웃었어요.","Ko'zimdan yosh chiqquncha kuldim."]]],
["-아/어 가지고",3,"Sabab va maqsad","...ib, ...gani uchun (og'zaki)","Og'zaki nutqda -아/어서 o'rnida: ketma-ketlik yoki sabab.",[["늦게 {일어나 가지고} 지각했어요.","Kech turganim uchun kechikdim."],["돈을 {모아 가지고} 샀어요.","Pul yig'ib sotib oldim."],["배가 {아파 가지고} 못 갔어요.","Qornim og'rib bora olmadim."]]],
// ---------- SHART VA TAXMIN
["-아/어도",2,"Shart va taxmin","...sa ham, ...gan bo'lsa ham","Shartga qaramay natija o'zgarmasligini bildiradi.",[["비가 {와도} 갈 거예요.","Yomg'ir yog'sa ham boraman."],["{아파도} 학교에 가요.","Kasal bo'lsam ham maktabga boraman."],["많이 {먹어도} 살이 안 쪄요.","Ko'p yesam ham semirmayman."]]],
["-(으)ㄹ 것 같다",2,"Shart va taxmin","...ga o'xshaydi, ...sa kerak (kelasi taxmin)","Hali sodir bo'lmagan narsani taxmin qiladi.",[["비가 {올 것 같아요}.","Yomg'ir yog'adiganga o'xshaydi."],["그 사람이 {바쁠 것 같아요}.","U band bo'lsa kerak."],["이 음식은 {맛있을 것 같아요}.","Bu ovqat mazali bo'lsa kerak."]]],
["-(으)ㄴ/는 것 같다",2,"Shart va taxmin","...ganga o'xshaydi (hozirgi/o'tgan taxmin)","Ko'rgan-bilganiga asoslanib taxmin qilish.",[["지금 비가 {오는 것 같아요}.","Hozir yomg'ir yog'ayotganga o'xshaydi."],["친구가 {피곤한 것 같아요}.","Do'stim charchaganga o'xshaydi."],["어제 {잔 것 같아요}.","Kecha uxlagan bo'lsa kerak."]]],
["-(으)ㄹ지도 모르다",3,"Shart va taxmin","...ehtimol, ...bo'lishi ham mumkin","Biror narsa bo'lishi mumkinligini, ammo aniq emasligini bildiradi.",[["내일 비가 {올지도 몰라요}.","Ertaga yomg'ir yog'ishi ham mumkin."],["{늦을지도 몰라요}.","Kechikishim ham mumkin."],["그 사람은 {모를지도 몰라요}.","U bilmasligi ham mumkin."]]],
["-(으)ㄹ 텐데",3,"Shart va taxmin","...ishi kerak edi-ku (taxmin + ta'sir)","Taxmin qilib, so'ng uning ustiga maslahat yoki afsus qo'shadi.",[["지금쯤 {도착했을 텐데} 연락이 없어요.","Hozir yetib kelgan bo'lishi kerak edi-ku, xabar yo'q."],["{피곤할 텐데} 쉬세요.","Charchagan bo'lsangiz kerak, dam oling."],["비가 {올 텐데} 우산 가져가세요.","Yomg'ir yog'sa kerak, soyabon oling."]]],
["-(으)ㄴ/는 모양이다",3,"Shart va taxmin","...shekilli, ...ga o'xshab","Ko'rinib turgan belgilarga ko'ra xulosa chiqaradi.",[["비가 {오는 모양이에요}.","Yomg'ir yog'ayotgan shekilli."],["그가 {아픈 모양이에요}.","U kasal shekilli."],["친구가 벌써 {떠난 모양이에요}.","Do'stim allaqachon ketgan shekilli."]]],
["-(으)ㄴ/는 듯하다",3,"Shart va taxmin","...ga o'xshaydi (yozma uslubroq)","Taxminni yozma yoki rasmiy uslubda ifodalaydi.",[["비가 {올 듯해요}.","Yomg'ir yog'adiganga o'xshaydi."],["그는 {피곤한 듯해요}.","U charchagan ko'rinadi."],["아무도 {없는 듯해요}.","Hech kim yo'qdek."]]],
["-(으)ㄹ 뻔하다",3,"Shart va taxmin","ozgina qolib ...adigan edi","Biror narsa bo'lishiga oz qolganini, ammo bo'lmaganini bildiradi.",[["{넘어질 뻔했어요}.","Yiqilib ketay dedim."],["버스를 {놓칠 뻔했어요}.","Avtobusdan kechikib qolay dedim."],["{지각할 뻔했어요}.","Kechikib qolay dedim."]]],
["-더니",3,"Shart va taxmin","...gan edi-yu (o'zi kuzatgan o'tgan holat)","Gapiruvchi o'zi kuzatgan o'tgan holat va uning keyingi o'zgarishini bog'laydi.",[["어제는 {덥더니} 오늘은 춥네요.","Kecha issiq edi-yu, bugun sovuq ekan."],["열심히 {공부하더니} 합격했어요.","Astoydil o'qigan edi, o'tib ketdi."],["아까는 {웃더니} 지금은 울어요.","Hozirgina kulgan edi, endi yig'layapti."]]],
["-았/었더라면",3,"Shart va taxmin","agar ... bo'lganida (pushaymon)","O'tmishda bo'lmagan narsa haqida afsus bilan «agar shunday bo'lganida» deydi.",[["일찍 {왔더라면} 좋았을 텐데.","Erta kelganimda yaxshi bo'lardi."],["공부를 {했더라면} 합격했을 거예요.","O'qiganimda o'tgan bo'lardim."],["너를 {만났더라면} 달랐을 거예요.","Seni uchratganimda boshqacha bo'lardi."]]],
["-(느)ㄴ다면 / -다면",3,"Shart va taxmin","agar ...sa (taxminiy shart)","Haqiqatga unchalik to'g'ri kelmaydigan yoki taxminiy shartni bildiradi.",[["복권에 {당첨된다면} 여행할 거예요.","Lotereyadan yutsam, sayohat qilaman."],["내가 {새라면} 날아가고 싶어요.","Qush bo'lsam uchib ketgim keladi."],["시간이 {있다면} 도와주세요.","Vaqtingiz bo'lsa, yordam bering."]]],
["-(으)ㄹ 걸 그랬다",3,"Shart va taxmin","...ganimda yaxshi bo'lardi (afsus)","Qilmagan ishi uchun afsuslanishni bildiradi.",[["일찍 {잘 걸 그랬어요}.","Erta uxlagan bo'lsam bo'lardi."],["공부를 {할 걸 그랬어요}.","Dars qilsam bo'lardi."],["우산을 {가져올 걸 그랬어요}.","Soyabon olib kelsam bo'lardi."]]],
// ---------- ISTAK, REJA VA TAKLIF
["-고 싶다",1,"Istak, reja va taklif","...gim keladi, ...moqchiman","Gapiruvchining (1- shaxs) istagini bildiradi.",[["한국에 {가고 싶어요}.","Koreyaga borgim keladi."],["커피를 {마시고 싶어요}.","Kofe ichgim keladi."],["친구를 {만나고 싶어요}.","Do'stim bilan uchrashgim keladi."]]],
["-고 싶어 하다",2,"Istak, reja va taklif","...moqchi (boshqaning istagi)","3- shaxsning istagini bildiradi.",[["동생이 한국에 {가고 싶어 해요}.","Ukam Koreyaga bormoqchi."],["아이가 장난감을 {사고 싶어 해요}.","Bola o'yinchoq sotib olmoqchi."],["친구는 의사가 {되고 싶어 해요}.","Do'stim vrach bo'lmoqchi."]]],
["-기로 하다",2,"Istak, reja va taklif","...ishga qaror qildi/kelishdi","Qaror yoki kelishuvni bildiradi.",[["내일 {만나기로 했어요}.","Ertaga uchrashishga kelishdik."],["담배를 {끊기로 했어요}.","Chekishni tashlashga qaror qildim."],["같이 {가기로 했어요}.","Birga borishga kelishdik."]]],
["-(으)려고 하다",2,"Istak, reja va taklif","...moqchi bo'lyapman","Hozirgina boshlanayotgan yoki rejalangan harakatni bildiradi.",[["지금 {나가려고 해요}.","Hozir chiqmoqchiman."],["한국어를 {배우려고 해요}.","Koreys tilini o'rganmoqchiman."],["다음 달에 이사{하려고 해요}.","Kelasi oy ko'chmoqchiman."]]],
["-(으)ㄹ까 하다",3,"Istak, reja va taklif","...sam deb o'ylayapman","Hali aniq qaror qilinmagan niyatni bildiradi.",[["주말에 여행을 {갈까 해요}.","Dam olishda sayohatga borsam deb o'ylayapman."],["새 차를 {살까 해요}.","Yangi mashina olsam deb o'ylayapman."],["집에서 {쉴까 해요}.","Uyda dam olsam deb o'ylayapman."]]],
["-(으)ㄹ 예정이다",3,"Istak, reja va taklif","...ishi rejalashtirilgan","Oldindan belgilangan rejani bildiradi.",[["다음 달에 {떠날 예정이에요}.","Kelasi oy ketishim rejalashtirilgan."],["회의는 세 시에 {시작할 예정이에요}.","Yig'ilish soat uchda boshlanadi."],["내년에 {결혼할 예정이에요}.","Kelasi yil turmush qurishni rejalashtirganman."]]],
["-(으)ㄹ까요?",2,"Istak, reja va taklif","...aylikmi? (taklif/fikr so'rash)","Birgalikda biror ish qilishni taklif qiladi yoki fikrni so'raydi.",[["같이 점심 {먹을까요}?","Birga tushlik qilaylikmi?"],["어디에서 {만날까요}?","Qayerda uchrashamiz?"],["우리 영화 {볼까요}?","Kino ko'raylikmi?"]]],
["-(으)ㅂ시다 / -자",2,"Istak, reja va taklif","...aylik (taklif)","Birgalikda qilishga taklif: -(으)ㅂ시다 — hurmatli, -자 — norasmiy.",[["같이 {갑시다}.","Birga boraylik."],["우리 {가자}.","Ketdik."],["열심히 {공부합시다}.","Astoydil o'qiylik."]]],
["-(으)ㄹ게요",2,"Istak, reja va taklif","...aman (va'da, qaror)","Gapiruvchi o'z ixtiyori bilan biror ishni qilishni va'da qiladi yoki aytadi.",[["제가 {할게요}.","Men qilaman."],["내일 {올게요}.","Ertaga kelaman."],["먼저 {갈게요}.","Men avval ketaman."]]],
["-(으)ㄹ래요?",2,"Istak, reja va taklif","...mi? / ...aman (xohlash)","Ikkinchi shaxsning xohishini so'rash yoki o'z qarorini aytish (og'zaki).",[["커피 {마실래요}?","Kofe ichasizmi?"],["저는 집에 {갈래요}.","Men uyga ketaman."],["같이 {갈래요}?","Birga boramizmi?"]]],
// ---------- RUXSAT, TAQIQ VA MAJBURIYAT
["-(으)ㄹ 수 있다/없다",1,"Ruxsat, taqiq va majburiyat","...a olaman / ...a olmayman","Qobiliyat yoki imkoniyatni bildiradi.",[["한국어를 {할 수 있어요}.","Koreys tilida gapira olaman."],["수영을 {할 수 없어요}.","Suza olmayman."],["내일 {올 수 있어요}?","Ertaga kela olasizmi?"]]],
["-아/어도 되다",1,"Ruxsat, taqiq va majburiyat","...sa bo'ladi (ruxsat)","Biror ish qilishga ruxsat so'rash yoki berish.",[["지금 {가도 돼요}?","Hozir ketsam bo'ladimi?"],["여기 {앉아도 돼요}.","Bu yerga o'tirsangiz bo'ladi."],["창문을 {열어도 됩니다}.","Derazani ochsangiz bo'ladi."]]],
["-(으)면 안 되다",1,"Ruxsat, taqiq va majburiyat","...masa kerak (taqiq)","Biror ishni qilish mumkin emasligini bildiradi.",[["여기서 담배를 {피우면 안 돼요}.","Bu yerda chekish mumkin emas."],["늦게 {자면 안 돼요}.","Kech uxlash mumkin emas."],["사진을 {찍으면 안 됩니다}.","Rasmga olish mumkin emas."]]],
["-아/어야 하다/되다",1,"Ruxsat, taqiq va majburiyat","...ishi kerak, ...ishga majbur","Majburiyat yoki zaruratni bildiradi.",[["숙제를 {해야 해요}.","Uy vazifasini qilishim kerak."],["일찍 {일어나야 돼요}.","Erta turishim kerak."],["약을 {먹어야 합니다}.","Dori ichish kerak."]]],
["-지 마세요",1,"Ruxsat, taqiq va majburiyat","...mang (man etuvchi buyruq)","Biror ishni qilmaslikni iltimos qiladi yoki buyuradi.",[["여기서 {먹지 마세요}.","Bu yerda ovqatlanmang."],["걱정{하지 마세요}.","Xavotir olmang."],["{늦지 마세요}.","Kechikmang."]]],
["안 / -지 않다",1,"Ruxsat, taqiq va majburiyat","emas, ...ma (inkor)","Oddiy inkor. 안 — fe'l oldidan, -지 않다 — fe'l asosidan keyin.",[["저는 커피를 {안 마셔요}.","Men kofe ichmayman."],["오늘은 학교에 {가지 않아요}.","Bugun maktabga bormayman."],["이 음식은 {맵지 않아요}.","Bu ovqat achchiq emas."]]],
["못 / -지 못하다",1,"Ruxsat, taqiq va majburiyat","qila olmaslik (imkonsizlik)","Qobiliyat yo'qligi yoki sharoit tufayli bajara olmaslikni bildiradi.",[["저는 수영을 {못 해요}.","Men suza olmayman."],["시간이 없어서 {가지 못했어요}.","Vaqt yo'qligi uchun bora olmadim."],["매워서 {못 먹어요}.","Achchiq bo'lgani uchun yeya olmayman."]]],
["-(으)ㄴ 적이 있다/없다",2,"Ruxsat, taqiq va majburiyat","...gan (tajriba bor/yo'q)","Hayotda biror ishni qilgan yoki qilmaganini bildiradi.",[["한국에 {간 적이 있어요}.","Koreyada bo'lganman."],["김치를 {먹은 적이 없어요}.","Kimchi yeb ko'rmaganman."],["그 영화를 {본 적이 있어요}?","Bu kinoni ko'rganmisiz?"]]],
["-(으)ㄹ 만하다",3,"Ruxsat, taqiq va majburiyat","...ishga arziydi","Biror ish qilishga arzishini bildiradi.",[["이 영화는 {볼 만해요}.","Bu kinoni ko'rishga arziydi."],["한번 {먹을 만해요}.","Bir marta yeb ko'rsa arziydi."],["{가 볼 만한} 곳이에요.","Borib ko'rishga arziydigan joy."]]],
["-(으)ㄹ 줄 알다/모르다",2,"Ruxsat, taqiq va majburiyat","...ishni bilish/uddalash (usulni bilish)","Biror ishni qilishni bilish yoki bilmaslik (ko'nikma); -(으)ㄹ 줄 알았다 — «shunday deb o'ylagan edim».",[["한국어를 {할 줄 알아요}.","Koreys tilida gapirishni bilaman."],["수영을 {할 줄 몰라요}.","Suzishni bilmayman."],["비가 {올 줄 알았어요}.","Yomg'ir yog'sa kerak deb o'ylagan edim."]]],
// ---------- YORDAMCHI FE'LLAR
["-아/어 주다",1,"Yordamchi fe'llar","birovga ...ib bermoq","Harakat boshqa kishi uchun bajarilishini bildiradi.",[["문을 {열어 주세요}.","Eshikni ochib bering."],["친구가 사진을 {찍어 줬어요}.","Do'stim rasmga olib berdi."],["천천히 {말해 주세요}.","Sekinroq gapirib bering."]]],
["-아/어 보다",1,"Yordamchi fe'llar","...ib ko'rmoq","Biror narsani sinab ko'rishni bildiradi.",[["이 음식을 {먹어 보세요}.","Bu ovqatni yeb ko'ring."],["한국에 {가 봤어요}.","Koreyaga borib ko'rganman."],["한번 {입어 보세요}.","Bir kiyib ko'ring."]]],
["-아/어 있다",2,"Yordamchi fe'llar","...gan holatda turibdi","Harakat natijasida paydo bo'lgan holatni bildiradi (o'timsiz fe'llar bilan).",[["문이 {열려 있어요}.","Eshik ochiq turibdi."],["의자에 {앉아 있어요}.","Stulda o'tiribman."],["창문이 {닫혀 있어요}.","Deraza yopiq turibdi."]]],
["-아/어 버리다",3,"Yordamchi fe'llar","...ib bo'ldi (tugallanish yoki afsus)","Ishning to'liq tugagani yoki afsus/yengillikni bildiradi.",[["케이크를 다 {먹어 버렸어요}.","Tortni butunlay yeb bo'ldim."],["지갑을 {잃어버렸어요}.","Hamyonimni yo'qotib qo'ydim."],["숙제를 다 {해 버렸어요}.","Uy vazifasini hammasini qilib tashladim."]]],
["-아/어 놓다/두다",3,"Yordamchi fe'llar","...ib qo'ymoq (oldindan)","Keyingi maqsad uchun harakatni bajarib qo'yishni bildiradi.",[["문을 {열어 놓으세요}.","Eshikni ochib qo'ying."],["미리 {예약해 놓았어요}.","Oldindan band qilib qo'ydim."],["불을 {켜 놓았어요}.","Chiroqni yoqib qo'ydim."]]],
["-아/어지다",2,"Yordamchi fe'llar","...ib bormoq, ...bo'lib qolmoq","Sifatga qo'shilib, holat o'zgarishini bildiradi.",[["날씨가 {따뜻해졌어요}.","Havo isib ketdi."],["점점 {예뻐져요}.","Tobora chiroyli bo'lyapti."],["길이 {좋아졌어요}.","Yo'l yaxshi bo'lib qoldi."]]],
["-게 되다",2,"Yordamchi fe'llar","...ib qolmoq, ...ga kelmoq","Vaziyat o'zgarishi natijasida biror holatga kelishni bildiradi.",[["한국에서 {살게 됐어요}.","Koreyada yashab qoldim."],["한국어를 {좋아하게 됐어요}.","Koreys tilini yaxshi ko'rib qoldim."],["내일 이사{하게 되었어요}.","Ertaga ko'chib o'tadigan bo'ldim."]]],
["-(으)ㄴ/는 편이다",3,"Yordamchi fe'llar","...ga moyil, ...roq","Umumiy moyillik yoki o'rtacha baholashni bildiradi.",[["저는 키가 {큰 편이에요}.","Men baland bo'ylilar qatoriga kiraman."],["그는 말이 {많은 편이에요}.","U ko'p gapiradigan tomonda."],["한국 음식은 {매운 편이에요}.","Koreys ovqatlari achchiqroq."]]],
["-(으)ㄴ/는 척하다",3,"Yordamchi fe'llar","...gan bo'lib ko'rinmoq","Aslida unday bo'lmasa ham shunday ko'rsatishni bildiradi.",[["{자는 척했어요}.","Uxlayotgandek ko'rindim."],["모르는 {척하지} 마세요.","Bilmaganga olmang."],["아픈 {척해요}.","Kasalga o'xshab ko'rinadi."]]],
// ---------- GAP ICHIDAGI NUTQ VA BOSHQALAR
["-잖아요",2,"Gap ichidagi nutq","axir, ma'lumku","Ikkala tomon ham biladigan narsani eslatadi, ba'zan e'tiroz bildiradi.",[["오늘 {일요일이잖아요}.","Axir bugun yakshanba-ku."],["내가 {말했잖아요}.","Axir men aytgan edim-ku."],["어제 {봤잖아요}.","Axir kecha ko'rgan edik-ku."]]],
["-군요 / -네요",2,"Gap ichidagi nutq","-ku! (hayrat, yangi bilingan narsa)","Yangi bilib olingan yoki hozir ko'rilgan narsaga hayrat bildiradi.",[["한국어를 정말 {잘하시네요}.","Koreys tilini juda yaxshi gapirar ekansiz."],["눈이 {오네요}.","Qor yog'yapti-ku."],["정말 {예쁘군요}.","Naqadar chiroyli!"]]],
["-거든요",2,"Gap ichidagi nutq","...ku (sabab-izoh berish)","Oldingi gapga izoh yoki sabab qo'shadi (og'zaki).",[["오늘은 못 가요. 약속이 {있거든요}.","Bugun bora olmayman. Va'dam bor-da."],["배가 {고프거든요}.","Qornim och-da."],["어제 비가 {왔거든요}.","Kecha yomg'ir yog'gan edi-da."]]],
["-(으)ㄴ/는데요",2,"Gap ichidagi nutq","...-u (yumshoq tugatish)","Gapni yarimta qoldirib, yumshoq qarama-qarshilik yoki kutilgan javobga ishora qiladi.",[["지금 {바쁜데요}.","Hozir bandman-u..."],["그 영화 {봤는데요}.","Bu kinoni ko'rgan edim-u."],["이거 {맛있는데요}.","Bu mazali-ku."]]],
["-(으)ㄴ/는지",3,"Gap ichidagi nutq","...ligini (bilvosita savol)","Gap ichida savolni bildiradi: «qayerga ketayotganini», «nima yeyishini».",[["어디에 {가는지} 알아요?","Qayerga ketayotganini bilasizmi?"],["무엇을 {먹을지} 모르겠어요.","Nima yeyishni bilmayapman."],["그 사람이 누구{인지} 알아요?","U kimligini bilasizmi?"]]],
["-다고 하다 (bilvosita nutq)",3,"Gap ichidagi nutq","...deb aytdi (boshqa birovning gapi)","Boshqa kishining gapini keltiradi: fe'lda -ㄴ/는다고, sifatda -다고, ot bilan -(이)라고.",[["친구가 내일 {온다고 했어요}.","Do'stim ertaga kelaman dedi."],["선생님이 {바쁘시다고 했어요}.","Ustoz band ekanlarini aytdilar."],["그는 학생{이라고 했어요}.","U talabaman dedi."]]],
["-냐고/-자고/-(으)라고 하다",3,"Gap ichidagi nutq","savol/taklif/buyruqni keltirish","Savolni (-냐고), taklifni (-자고) va buyruqni (-(으)라고) boshqa kishiga yetkazish.",[["그가 어디에 {가냐고 했어요}.","U qayerga ketayotganingni so'radi."],["친구가 같이 {가자고 했어요}.","Do'stim birga boraylik dedi."],["엄마가 빨리 {오라고 했어요}.","Onam tezroq kel dedi."]]],
["피동 (-이/히/리/기-)",3,"Gap ichidagi nutq","majhul nisbat (bo'lishlik)","Ega harakatning bajaruvchisi emas, ta'sirga uchrovchi bo'ladi: «ochildi», «yeyildi».",[["문이 {열렸어요}.","Eshik ochildi."],["아이가 엄마에게 {안겼어요}.","Bola onasining quchog'iga olindi."],["이 책은 많이 {읽혀요}.","Bu kitob ko'p o'qiladi."]]],
["-게 하다 (orttirma nisbat)",3,"Gap ichidagi nutq","...tirmoq, ...dirmoq","Boshqa kishini biror ishni qilishga majbur qilish yoki yo'l qo'yish.",[["선생님이 학생에게 책을 {읽게 했어요}.","Ustoz o'quvchiga kitob o'qitdi."],["엄마가 아이를 일찍 {자게 해요}.","Onam bolani erta uxlatadi."],["부모님이 저를 한국에서 {공부하게 했어요}.","Ota-onam meni Koreyada o'qishga yubordi."]]],
["-(으)ㄴ/는 대신에",3,"Gap ichidagi nutq","...o'rniga","Biror narsa o'rniga boshqasini qilishni bildiradi.",[["커피{대신에} 차를 마셨어요.","Kofe o'rniga choy ichdim."],["영화를 {보는 대신에} 책을 읽었어요.","Kino ko'rish o'rniga kitob o'qidim."],["설거지를 {하는 대신에} 청소해요.","Idish yuvish o'rniga tozalayman."]]],
["-기만 하다",3,"Gap ichidagi nutq","faqat ...ibgina turibdi","Faqat bitta harakatni takror-takror qilishni bildiradi.",[["그는 {먹기만 해요}.","U faqat yeyaveradi."],["걱정{하기만 하지} 마세요.","Faqat xavotir olavermang."],["아이가 {울기만 해요}.","Bola faqat yig'layveradi."]]],
["-(으)ㄹ 뿐이다",3,"Gap ichidagi nutq","...gandan boshqa narsa emas","Boshqa hech narsa qilmaganini yoki yo'qligini ta'kidlaydi.",[["저는 열심히 {했을 뿐이에요}.","Men shunchaki astoydil harakat qildim."],["그냥 {웃을 뿐이에요}.","Shunchaki kulib qo'yaman."],["사실을 {말했을 뿐이에요}.","Haqiqatni aytdim, xolos."]]],
// ---------- QO'SHIMCHA GRAMMATIKALAR (yuklamalar, bog'lovchilar, tartibsiz fe'llar, sonlar, hurmat va h.k.)
["에다(가)",2,"Yuklamalar","-ga (qo'yish, qo'shish)","Biror narsani biror joyga qo'yish yoki ustiga qo'shishni bildiradi; og'zaki nutqda 에 o'rniga ham keladi.",[["책상 위{에다가} 책을 놓았어요.","Kitobni stol ustiga qo'ydim."],["커피{에다} 설탕을 넣었어요.","Kofega shakar soldim."],["여기{에다} 이름을 쓰세요.","Mana bu yerga ismingizni yozing."]]],
["에 대해(서) / 에 관해(서)",2,"Yuklamalar","...haqida, ...ga doir","Gap mavzusini bildiradi: nima haqida gapirilayotgani yoki o'ylanayotgani. Otdan oldin 에 대한 / 에 관한 shaklida keladi.",[["한국 문화{에 대해} 배워요.","Koreys madaniyati haqida o'rganaman."],["이 문제{에 대해서} 어떻게 생각해요?","Bu masala haqida qanday fikrdasiz?"],["여행{에 관한} 책을 읽었어요.","Sayohatga oid kitob o'qidim."]]],
["(으)로서",3,"Yuklamalar","...sifatida (maqom, vazifa)","Kishining lavozimi, maqomi yoki roli haqida gapirganda ishlatiladi.",[["저는 학생{으로서} 열심히 공부해야 해요.","Men talaba sifatida astoydil o'qishim kerak."],["친구{로서} 충고할게요.","Do'st sifatida maslahat beraman."],["그는 의사{로서} 존경받아요.","U shifokor sifatida hurmatga sazovor."]]],
["(으)로써",3,"Yuklamalar","...bilan, ...orqali (vosita)","Biror ishni bajarish usuli yoki vositasini bildiradi; yozma nutqda ko'p uchraydi.",[["대화{로써} 문제를 해결해요.","Muammoni suhbat orqali hal qilamiz."],["노력{으로써} 꿈을 이뤘어요.","Mehnat bilan orzuga erishdim."],["이 방법{으로써} 시간을 아낄 수 있어요.","Shu usul bilan vaqtni tejash mumkin."]]],
["에 비해(서)",3,"Yuklamalar","...ga nisbatan, ...bilan solishtirganda","Ikki narsani taqqoslab, farqini ko'rsatadi.",[["작년{에 비해서} 올해가 더 더워요.","O'tgan yilga nisbatan bu yil issiqroq."],["키{에 비해} 몸무게가 많이 나가요.","Bo'yiga nisbatan vazni ko'p."],["서울은 다른 도시{에 비해} 물가가 비싸요.","Seul boshqa shaharlarga nisbatan qimmat."]]],
["에 따라(서)",3,"Yuklamalar","...ga qarab, ...ga ko'ra","Biror narsa boshqasiga bog'liq holda o'zgarishini bildiradi.",[["사람{에 따라} 생각이 달라요.","Odamga qarab fikr boshqacha."],["날씨{에 따라서} 계획을 바꿀 거예요.","Ob-havoga qarab rejani o'zgartiraman."],["경우{에 따라} 다를 수 있어요.","Holatga qarab farq qilishi mumkin."]]],
["을/를 위해(서)",2,"Yuklamalar","...uchun (foyda, maqsad)","Kimning foydasi uchun yoki qanday maqsadda harakat qilinayotganini bildiradi.",[["가족{을 위해} 열심히 일해요.","Oila uchun astoydil ishlayman."],["건강{을 위해서} 운동해요.","Sog'liq uchun mashq qilaman."],["친구{를 위해} 선물을 샀어요.","Do'stim uchun sovg'a oldim."]]],
["에 의해(서)",3,"Yuklamalar","...tomonidan, ...ga ko'ra","Majhul nisbatdagi gaplarda ish bajaruvchisini ko'rsatadi; yozma uslubda.",[["이 그림은 유명한 화가{에 의해} 그려졌어요.","Bu rasm mashhur rassom tomonidan chizilgan."],["규칙{에 의해} 결정됩니다.","Qoidaga ko'ra hal qilinadi."],["사고는 부주의{에 의해} 일어났어요.","Voqea ehtiyotsizlik tufayli sodir bo'ldi."]]],
["께서 / 께서는",2,"Yuklamalar","(hurmatli) ega yuklamasi","Hurmat qilinadigan kishi gapning egasi bo'lsa 이/가 o'rniga 께서 ishlatiladi; fe'lga -(으)시- qo'shiladi.",[["선생님{께서} 오셨어요.","Ustoz keldilar."],["할아버지{께서는} 신문을 읽으세요.","Bobom gazeta o'qiyaptilar."],["어머니{께서} 요리하세요.","Onam ovqat pishiryaptilar."]]],
["에도 / 에는 / 에서는 / 에서도",2,"Yuklamalar","qo'shma yuklamalar: ...da ham / ...da esa","Joy-vaqt yuklamalariga 도 (ham) yoki 는 (esa) qo'shilib, ma'noni kuchaytiradi yoki qarama-qarshi qo'yadi.",[["주말{에도} 일해요.","Dam olish kunlari ham ishlayman."],["서울{에는} 사람이 많아요.","Seulda esa odam ko'p."],["이 식당{에서도} 김치를 팔아요.","Bu restoranda ham kimchi sotishadi."]]],
["(이)든지 / (이)든",3,"Yuklamalar","...bo'lsa ham, xohlagan (tanlov cheklanmagan)","Tanlov cheklanmasligini bildiradi: «xohlagan», «qaysi bo'lmasin».",[["언제{든지} 전화하세요.","Istagan paytda qo'ng'iroq qiling."],["뭐{든지} 먹을 수 있어요.","Hamma narsani yeyishim mumkin."],["누구{든지} 올 수 있어요.","Xohlagan kishi kelishi mumkin."]]],
["마저",3,"Yuklamalar","...ham (oxirgisi ham)","Oxirgi umidni yoki so'nggi narsani ham qo'shib, afsus bilan aytiladi.",[["너{마저} 떠나면 어떡해?","Sen ham ketsang nima qilaman?"],["비{마저} 오네요.","Yomg'ir ham yog'yapti-ya."],["마지막 기차{마저} 놓쳤어요.","Oxirgi poyezddan ham qoldim."]]],
["은/는커녕",3,"Yuklamalar","...u yoqda tursin","Birinchi narsa u yoqda tursin, undan ham oddiysi ham bo'lmaganini bildiradi.",[["밥{은커녕} 물도 못 마셨어요.","Ovqat u yoqda tursin, suv ham ichmadim."],["저금{은커녕} 빚만 있어요.","Jamg'arma u yoqda tursin, faqat qarzim bor."],["칭찬{은커녕} 야단만 맞았어요.","Maqtov u yoqda tursin, faqat koyish eshitdim."]]],
["(이)나마",3,"Yuklamalar","...bo'lsa ham (kam bo'lsa-da)","Mukammal bo'lmasa ham, borini qabul qilishni bildiradi.",[["늦게{나마} 사과드립니다.","Kech bo'lsa ham uzr so'rayman."],["조금{이나마} 도움이 되길 바라요.","Ozgina bo'lsa ham foydasi tegsin."],["잠깐{이나마} 쉬세요.","Qisqa bo'lsa ham dam oling."]]],
["만큼",2,"Yuklamalar","...chalik, ...darajasida","Biror narsaning darajasi boshqasiga teng ekanini bildiradi.",[["저도 형{만큼} 키가 커요.","Men ham akam kabi baland bo'yliman."],["노력한 {만큼} 결과가 나와요.","Qancha harakat qilsang, shuncha natija chiqadi."],["아는 {만큼} 보여요.","Bilganingcha ko'rasan."]]],
["대로",2,"Yuklamalar","...ga ko'ra, ...dek (aynan)","Biror narsaga aynan mos ravishda yoki «har biri o'zicha» ma'nosida.",[["제 말{대로} 하세요.","Mening aytganimday qiling."],["계획{대로} 진행됐어요.","Reja bo'yicha o'tdi."],["생각{대로} 안 돼요.","O'ylaganimdek bo'lmayapti."]]],
["뿐 (ot)",3,"Yuklamalar","faqat ..., ...dan boshqa emas","Faqat bitta narsa borligini bildiradi; ko'pincha -(이)다 bilan keladi.",[["이 방법{뿐}이에요.","Faqat shu usul bor."],["저에게는 당신{뿐}이에요.","Menda faqat siz borsiz."],["시간이 한 시간{뿐}이에요.","Vaqt faqat bir soat."]]],
["씩",2,"Yuklamalar","...dan (har biriga)","Har bir narsa yoki odamga teng miqdor to'g'ri kelishini bildiradi.",[["하루에 두 번{씩} 약을 먹어요.","Kuniga ikki martadan dori ichaman."],["한 사람{씩} 들어오세요.","Birin-ketin kiring."],["사과를 세 개{씩} 나눠 줬어요.","Olmani uchtadan bo'lib berdim."]]],
["만에",2,"Yuklamalar","...dan keyin (oraliq o'tib)","Uzoq vaqtdan keyin biror ish yana sodir bo'lganini yoki ish qancha vaqtda bitganini bildiradi.",[["오랜{만에} 친구를 만났어요.","Uzoq vaqtdan keyin do'stimni uchratdim."],["십 년{만에} 고향에 갔어요.","O'n yildan keyin vatanimga bordim."],["삼 일{만에} 일을 끝냈어요.","Uch kunda ishni tugatdim."]]],
["째",3,"Yuklamalar","...-chi, ...-dir (ketma-ket)","Tartib yoki davom etayotgan muddatni bildiradi.",[["오늘이 일주일{째}예요.","Bugun bir haftadir."],["이 책은 벌써 세 번{째}예요.","Bu kitob allaqachon uchinchi marta."],["저는 둘{째} 딸이에요.","Men ikkinchi qizman."]]],
["에서부터 / 으로부터",3,"Yuklamalar","...dan boshlab; ...dan (manba)","Boshlanish nuqtasi yoki biror narsaning kelib chiqish manbasini bildiradi.",[["여기{에서부터} 걸어가요.","Shu yerdan boshlab piyoda boramiz."],["친구{로부터} 편지를 받았어요.","Do'stimdan xat oldim."],["서울{에서부터} 부산까지 달렸어요.","Seuldan Pusangacha yugurdim."]]],
["같은 (ot oldidan)",2,"Yuklamalar","...kabi, ...ga o'xshash","Otdan oldin kelib, shunga o'xshash narsalarni sanashda ishlatiladi.",[["김치 {같은} 한국 음식을 좋아해요.","Kimchi kabi koreys taomlarini yoqtiraman."],["너 {같은} 친구가 있어서 좋아요.","Senga o'xshash do'stim borligidan xursandman."],["꿈 {같은} 이야기예요.","Tush kabi voqea."]]],
["(이)란 / (이)라는",3,"Yuklamalar","...degan (ta'rif, nom)","Biror narsaning ta'rifini beradi yoki nomini keltiradi: «...deganda ... nazarda tutiladi».",[["사랑{이란} 무엇일까요?","Sevgi nima ekan?"],["서울{이라는} 도시에 살아요.","Seul degan shaharda yashayman."],["'김민수'{라는} 사람을 알아요?","Kim Minsu degan odamni taniysizmi?"]]],
["들 (ko'plik)",1,"Yuklamalar","-lar (ko'plik qo'shimchasi)","Ot yoki olmoshga qo'shilib ko'plikni bildiradi; sonli gaplarda shart emas.",[["학생{들}이 공부해요.","O'quvchilar o'qiyapti."],["친구{들}과 놀았어요.","Do'stlarim bilan o'ynadim."],["아이{들}이 놀고 있어요.","Bolalar o'ynayapti."]]],
["이/가 아니다",1,"Yuklamalar","...emas (inkor bog'lama)","«Ot + 이/가 아니다» — «bu ... emas» ma'nosini beradi; -(이)다 ning inkori.",[["저는 학생{이 아니에요}.","Men talaba emasman."],["이것은 제 책{이 아니에요}.","Bu mening kitobim emas."],["그 사람은 의사{가 아니에요}.","U shifokor emas."]]],
["이/가 되다",1,"Yuklamalar","...bo'lmoq (holat o'zgarishi)","Biror kishi yoki narsaning boshqa holatga o'tishi: «bo'lmoq, aylanmoq».",[["저는 의사{가 되고} 싶어요.","Men shifokor bo'lmoqchiman."],["물이 얼음{이 됐어요}.","Suv muzga aylandi."],["벌써 봄{이 됐어요}.","Bahor ham kirdi."]]],
["때문에 (ot)",1,"Yuklamalar","...tufayli, ...sababli","Ot bilan sababni bildiradi; ko'pincha salbiy oqibatda.",[["비 {때문에} 못 갔어요.","Yomg'ir sababli bora olmadim."],["감기 {때문에} 학교에 안 갔어요.","Shamollash tufayli maktabga bormadim."],["너 {때문에} 행복해요.","Sen tufayli baxtliman."]]],
["중에 / 중에서",2,"Yuklamalar","...orasida, ...ichidan; ...paytida","Bir necha narsa ichidan tanlashni yoki harakat davom etayotgan paytni bildiradi.",[["과일 {중에서} 뭘 제일 좋아해요?","Mevalar ichida nimani eng yoqtirasiz?"],["회의 {중}이에요.","Majlis ketyapti."],["친구들 {중에} 제가 제일 어려요.","Do'stlarim orasida eng kichigi menman."]]],
["동안 (ot)",2,"Yuklamalar","...davomida","Vaqt oralig'ini bildiradi: «bir soat davomida», «ta'til davomida».",[["한 시간 {동안} 기다렸어요.","Bir soat kutdim."],["방학 {동안} 한국에 있었어요.","Ta'til davomida Koreyada edim."],["오랫{동안} 못 만났어요.","Uzoq vaqt uchrasha olmadik."]]],
["-고 나서",2,"Bog'lovchilar","...ib bo'lgach, ...gandan so'ng","Bitta harakat tugagandan keyin ikkinchisi boshlanishini bildiradi.",[["밥을 {먹고 나서} 커피를 마셨어요.","Ovqat yeb bo'lgach kofe ichdim."],["숙제를 {하고 나서} 놀아요.","Uy vazifasini qilib bo'lib, o'ynayman."],["샤워{하고 나서} 잤어요.","Dush qabul qilib bo'lgach uxladim."]]],
["-고서",3,"Bog'lovchilar","...ib (keyin), ...gach","Birinchi harakatdan keyin ikkinchisi sodir bo'lishini bildiradi; ko'pincha sabab ma'nosi ham bor.",[["옷을 {입고서} 나갔어요.","Kiyinib chiqdim."],["그 말을 {듣고서} 놀랐어요.","Bu gapni eshitib hayron bo'ldim."],["책을 {읽고서} 느낀 점을 썼어요.","Kitob o'qib, taassurotimni yozdim."]]],
["-(으)려면",2,"Bog'lovchilar","...moqchi bo'lsang, ...sang","Niyat yoki maqsadga erishish uchun nima qilish kerakligini aytadi.",[["한국어를 {잘하려면} 매일 연습하세요.","Koreyschani yaxshi bilmoqchi bo'lsangiz, har kuni mashq qiling."],["서울에 {가려면} 기차를 타세요.","Seulga bormoqchi bo'lsangiz, poyezdga chiqing."],["표를 {사려면} 줄을 서야 해요.","Chipta olmoqchi bo'lsangiz, navbatga turish kerak."]]],
["-(으)ㄴ 지 ... 되다",2,"Bog'lovchilar","...ganiga ... bo'ldi (o'tgan vaqt)","Biror ish boshlanganidan beri qancha vaqt o'tganini bildiradi.",[["한국어를 {배운 지} 일 년 됐어요.","Koreys tilini o'rganganimga bir yil bo'ldi."],["여기 {온 지} 한 달 됐어요.","Bu yerga kelganimga bir oy bo'ldi."],["결혼{한 지} 오 년 됐어요.","Turmush qurganimizga besh yil bo'ldi."]]],
["-(으)ㄴ/는 이상 / -는 한",3,"Bog'lovchilar","...ekan, ...ar ekan (shart-sabab)","Muayyan holat borligi tufayli ikkinchi harakat shart bo'lishini bildiradi.",[["약속을 {한 이상} 지켜야 해요.","Va'da berganing ekan, bajarishing kerak."],["학생{인 이상} 공부해야 해요.","Talaba ekansan, o'qishing kerak."],["내가 {살아 있는 한} 걱정하지 마세요.","Men tirik ekanman, tashvishlanmang."]]],
["-(으)ㄹ 경우에",3,"Bog'lovchilar","...ar bo'lsa, ...holatda","Biror holat yuz berishi mumkin bo'lgan taqdirda nima qilishni aytadi.",[["비가 {올 경우에} 취소돼요.","Yomg'ir yog'sa, bekor qilinadi."],["문제가 {생길 경우에} 연락하세요.","Muammo bo'lsa, aloqaga chiqing."],["늦을 {경우에는} 미리 말해 주세요.","Kech qolsangiz, oldindan ayting."]]],
["-거든",3,"Bog'lovchilar","...sang (keyin buyruq/taklif)","Shart bildiradi va keyin odatda buyruq yoki taklif keladi; og'zaki nutq.",[["시간이 {있거든} 전화해.","Vaqting bo'lsa, qo'ng'iroq qil."],["집에 {도착하거든} 문자 보내.","Uyga yetib borsang, xabar yoz."],["배고프{거든} 먼저 먹어.","Och qolsang, avval yeb ol."]]],
["-다 보니(까)",3,"Bog'lovchilar","...ib turib, ...gach (natija ma'lum bo'ldi)","Biror ishni davom ettirib turganda yangi natija yoki holat paydo bo'lganini bildiradi.",[["매일 {먹다 보니} 질렸어요.","Har kuni yeyaverib, bezib qoldim."],["일{하다 보니} 시간이 지났어요.","Ishlayverib, vaqt o'tib ketibdi."],["이야기{하다 보니까} 친해졌어요.","Gaplashaverib, yaqinlashib qoldik."]]],
["-다 보면",3,"Bog'lovchilar","...averib, ...sang (keyin albatta)","Biror ishni davom ettirsa, albatta biror natijaga olib kelishini bildiradi.",[["계속 {하다 보면} 잘하게 될 거예요.","Davom ettiraversangiz, yaxshi bo'lib ketasiz."],["{살다 보면} 힘든 날도 있어요.","Yashayversang, qiyin kunlar ham bo'ladi."],["{걷다 보면} 도착할 거예요.","Yuraversangiz, yetib borasiz."]]],
["-고도",3,"Bog'lovchilar","...bo'lsa ham, ...ib turib ham","Birinchi harakatdan keyin kutilmagan holat borligini bildiradi.",[["알{고도} 말하지 않았어요.","Bilsa ham aytmadi."],["밥을 많이 {먹고도} 배고파요.","Ko'p yeb ham qornim to'ymadi."],["보{고도} 못 본 척했어요.","Ko'rib ham ko'rmaganga oldi."]]],
["-(으)ㄴ/는데도",3,"Bog'lovchilar","...bo'lsa ham, ...ga qaramay","Kutilganning aksi bo'lganini bildiradi.",[["공부를 {열심히 했는데도} 시험에 떨어졌어요.","Astoydil o'qigan bo'lsam ham, imtihondan yiqildim."],["{추운데도} 반바지를 입었어요.","Sovuq bo'lsa ham shortik kiydi."],["{바쁜데도} 와 줬어요.","Band bo'lsa ham kelib berdi."]]],
["-더라도 / -(으)ㄹ지라도",3,"Bog'lovchilar","...sa ham, ...gan taqdirda ham","Taxminiy holatni tan olgan holda baribir qarorni o'zgartirmaslikni bildiradi.",[["비가 {오더라도} 갈 거예요.","Yomg'ir yog'sa ham boraman."],["힘{들더라도} 포기하지 마세요.","Qiyin bo'lsa ham taslim bo'lmang."],["실패{할지라도} 도전할 거예요.","Muvaffaqiyatsiz bo'lsam ham urinaman."]]],
["-(으)ㄴ/는 반면에",3,"Bog'lovchilar","...bo'lsa, boshqa tomondan...","Bir narsaning ikki qarama-qarshi tomonini ko'rsatadi.",[["이 집은 {넓은 반면에} 비싸요.","Bu uy keng, ammo qimmat."],["형은 {조용한 반면에} 저는 활발해요.","Akam jim, men esa jo'shqinman."],["도시는 {편리한 반면에} 복잡해요.","Shahar qulay, ammo gavjum."]]],
["-(으)ㄴ/는 만큼",3,"Bog'lovchilar","...ganicha, ...ganiga yarasha","Bir ishning darajasi ikkinchisiga mos bo'lishini bildiradi.",[["{노력한 만큼} 결과가 나와요.","Harakatingizga yarasha natija chiqadi."],["{먹는 만큼} 운동하세요.","Yegancha mashq qiling."],["{아는 만큼} 말해요.","Bilganicha gapiraman."]]],
["-(으)ㄹ 때마다",2,"Bog'lovchilar","...ganda har safar","Har gal shu holat sodir bo'lganda takrorlanadigan ishni bildiradi.",[["{볼 때마다} 웃어요.","Har ko'rganimda kulaman."],["{비가 올 때마다} 우산을 잊어요.","Har yomg'ir yog'ganda soyabonni unutaman."],["{갈 때마다} 사람이 많아요.","Har borganimda odam ko'p."]]],
["-(으)ㄹ 때까지",2,"Bog'lovchilar","...guncha, ...gungacha","Harakat yoki holat qaysi paytgacha davom etishini bildiradi.",[["{올 때까지} 기다릴게요.","Kelguningizcha kutaman."],["{졸업할 때까지} 열심히 할 거예요.","Bitirgunimcha astoydil harakat qilaman."],["{끝날 때까지} 가지 마세요.","Tugagunicha ketmang."]]],
["-는 길에",3,"Bog'lovchilar","...ayotgan yo'lda","Biror joyga ketayotgan yo'lda boshqa ishni qilishni bildiradi.",[["집에 {가는 길에} 빵을 샀어요.","Uyga ketayotib non oldim."],["학교에 {오는 길에} 친구를 만났어요.","Maktabga kelayotib do'stimni uchratdim."],["{나가는 길에} 쓰레기 좀 버려 주세요.","Chiqayotib axlatni tashlab qo'ying."]]],
["-는 중이다",2,"Bog'lovchilar","...yotgan paytida, ...moqda","Harakat aynan hozir davom etayotganini bildiradi.",[["지금 회의{하는 중이에요}.","Hozir majlis o'tyapti."],["밥을 {먹는 중이에요}.","Ovqat yeyapman."],["길이 {막히는 중이에요}.","Yo'l tiqilib turibdi."]]],
["-아/어야",3,"Bog'lovchilar","...gandagina, ...sagina","Ikkinchi ishning amalga oshishi uchun birinchisi shart ekanini bildiradi.",[["{노력해야} 성공할 수 있어요.","Harakat qilgandagina muvaffaqiyatga erishish mumkin."],["{먹어야} 힘이 나요.","Yesagina kuch keladi."],["{가 봐야} 알겠어요.","Borib ko'rsamgina bilaman."]]],
["-(으)ㄹ 바에는",3,"Bog'lovchilar","...gandan ko'ra","Ikki yomon variantdan ko'ra yaxshisini tanlashni bildiradi.",[["{기다릴 바에는} 걸어가겠어요.","Kutgandan ko'ra piyoda ketaman."],["{포기할 바에는} 끝까지 해 볼래요.","Taslim bo'lgandan ko'ra oxirigacha urinaman."],["{혼자 갈 바에는} 안 가겠어요.","Yolg'iz borgandan ko'ra bormayman."]]],
["-(으)ㄴ/는 듯이",3,"Bog'lovchilar","...gandek, ...gan kabi","Biror holatni boshqasiga o'xshatib ifodalaydi.",[["아무 일도 없었다는 {듯이} 웃었어요.","Hech narsa bo'lmagandek kuldi."],["{본 듯이} 이야기해요.","Ko'rgandek gapiryapti."],["{아는 듯이} 말했어요.","Bilgandek gapirdi."]]],
["-기는 하지만 / -기는 하는데",3,"Bog'lovchilar","...-ku, lekin (qisman tan olish)","Fikrga qisman rozilik bildirib, so'ng e'tiroz qo'shadi.",[["맛있{기는 하지만} 비싸요.","Mazali-ku, lekin qimmat."],["좋{기는 한데} 너무 멀어요.","Yaxshi-ku, lekin juda uzoq."],["가{기는 가는데} 오래 못 있어요.","Boraman-u, lekin uzoq tura olmayman."]]],
["-(으)므로",3,"Sabab va maqsad","...ligi uchun, ...gani sababli (rasmiy)","Yozma va rasmiy matnlarda sabab-oqibat aloqasini bildiradi.",[["비가 {오므로} 행사를 취소합니다.","Yomg'ir yog'ayotgani uchun tadbir bekor qilinadi."],["시간이 {없으므로} 서두르세요.","Vaqt yo'qligi sababli shoshiling."],["학생{이므로} 할인받을 수 있습니다.","Talaba bo'lgani uchun chegirma olish mumkin."]]],
["-는 탓에 / -는 덕분에",3,"Sabab va maqsad","...ligi sababli (yomon) / ...ligi tufayli (yaxshi)","탓에 — salbiy sababni, 덕분에 — yaxshi sababni bildiradi.",[["늦게 {잔 탓에} 지각했어요.","Kech yotganim sababli kechikdim."],["친구가 {도와준 덕분에} 끝냈어요.","Do'stim yordam bergani tufayli tugatdim."],["날씨가 {좋은 덕분에} 소풍이 즐거웠어요.","Ob-havo yaxshi bo'lgani tufayli sayr yoqimli o'tdi."]]],
["-아/어서 그런지",3,"Sabab va maqsad","...gani uchun bo'lsa kerak","Sababni aniq bilmagan holda taxmin qiladi.",[["{피곤해서 그런지} 졸려요.","Charchaganim uchunmi, uyqum kelyapti."],["{비가 와서 그런지} 사람이 없어요.","Yomg'ir yog'gani uchunmi, odam yo'q."],["{날씨가 추워서 그런지} 감기에 걸렸어요.","Havo sovuq bo'lgani uchunmi, shamollab qoldim."]]],
["-기 위해(서)",2,"Sabab va maqsad","...ish uchun (maqsad)","Harakatning maqsadini bildiradi: «... maqsadida».",[["한국에서 {일하기 위해서} 한국어를 배워요.","Koreyada ishlash uchun koreys tilini o'rganaman."],["건강해지{기 위해} 운동해요.","Sog'lom bo'lish uchun mashq qilaman."],["꿈을 이루{기 위해} 노력해요.","Orzuga yetish uchun harakat qilaman."]]],
["-고자",3,"Sabab va maqsad","...moqchi bo'lib (niyat, rasmiy)","Niyat yoki maqsadni rasmiy uslubda ifodalaydi.",[["의견을 {말하고자} 합니다.","Fikrimni bildirmoqchiman."],["문제를 {해결하고자} 노력했어요.","Muammoni hal qilish maqsadida harakat qildim."],["{배우고자} 하는 마음이 중요해요.","O'rganishga intilish muhim."]]],
["-(으)려다가",3,"Sabab va maqsad","...moqchi edi-yu, (keyin boshqa ish qildi)","Boshlangan yoki niyat qilingan ishdan voz kechilganini bildiradi.",[["{가려다가} 그만뒀어요.","Bormoqchi edim, lekin to'xtadim."],["전화{하려다가} 문자를 보냈어요.","Qo'ng'iroq qilmoqchi edim, xabar yubordim."],["{사려다가} 너무 비싸서 안 샀어요.","Sotib olmoqchi edim, juda qimmat bo'lgani uchun olmadim."]]],
["-(으)려던 참이다",3,"Sabab va maqsad","...moqchi bo'lib turgan edim","Aynan shu ishni qilish arafasida turganini bildiradi.",[["지금 {나가려던 참이에요}.","Hozir chiqmoqchi bo'lib turgandim."],["마침 {전화하려던 참이었어요}.","Aynan qo'ng'iroq qilmoqchi bo'lib turgandim."],["{자려던 참}에 전화가 왔어요.","Uxlamoqchi bo'lib turganimda qo'ng'iroq keldi."]]],
["-(이)라서 / -(이)니까",2,"Sabab va maqsad","...ligi uchun (ot + sabab)","Ot bilan sabab bildiradi: otga 이라서 (undosh) yoki 라서 (unli) qo'shiladi.",[["학생{이라서} 돈이 없어요.","Talaba bo'lgani uchun pulim yo'q."],["주말{이라서} 사람이 많아요.","Dam olish kuni bo'lgani uchun odam ko'p."],["친구{니까} 도와줄게요.","Do'sting bo'lgani uchun yordam beraman."]]],
["-(으)ㄹ 수도 있다",2,"Shart va taxmin","...ishi ham mumkin","Biror narsaning bo'lishi ehtimoldan xoli emasligini bildiradi.",[["내일 비가 {올 수도 있어요}.","Ertaga yomg'ir yog'ishi ham mumkin."],["길이 {막힐 수도 있어요}.","Yo'l tiqilib qolishi ham mumkin."],["제가 {틀릴 수도 있어요}.","Men xato qilishim ham mumkin."]]],
["-(으)ㄹ 수밖에 없다",3,"Shart va taxmin","...dan boshqa iloj yo'q","Boshqa tanlov qolmaganini bildiradi.",[["길이 막혀서 {늦을 수밖에 없어요}.","Yo'l tiqilib, kechikishdan boshqa iloj yo'q."],["그렇게 {말할 수밖에 없었어요}.","Shunday deyishdan boshqa iloj yo'q edi."],["{기다릴 수밖에 없어요}.","Kutishdan boshqa iloj yo'q."]]],
["-지 않을 수 없다",3,"Shart va taxmin","...may iloji yo'q","Qilmaslikning iloji yo'qligini, albatta qilish kerakligini ta'kidlaydi.",[["너무 웃겨서 {웃지 않을 수 없었어요}.","Juda kulgili bo'lgani uchun kulmay iloj yo'q edi."],["그 말을 {듣지 않을 수 없었어요}.","Bu gapni eshitmay iloj yo'q edi."],["{인정하지 않을 수 없어요}.","Tan olmay iloj yo'q."]]],
["-(으)ㄹ 리가 없다",3,"Shart va taxmin","...ishi mumkin emas","Biror narsa bo'lishi aslo ehtimoldan yiroq ekanini bildiradi.",[["그가 {거짓말할 리가 없어요}.","U yolg'on gapirishi mumkin emas."],["벌써 {끝났을 리가 없어요}.","Allaqachon tugagan bo'lishi mumkin emas."],["그 사람이 {모를 리가 없어요}.","U bilmasligi mumkin emas."]]],
["-나 보다 / -(으)ㄴ가 보다",2,"Shart va taxmin","...ga o'xshaydi (ko'rib taxmin qilish)","Ko'rgan yoki eshitgan narsasiga asoslanib taxmin qilishni bildiradi.",[["비가 {오나 봐요}.","Yomg'ir yog'yotganga o'xshaydi."],["그 사람이 {바쁜가 봐요}.","U band bo'lsa kerak."],["아직 안 {왔나 봐요}.","Hali kelmaganga o'xshaydi."]]],
["-아/어 보이다",2,"Shart va taxmin","...ga o'xshab ko'rinadi","Tashqi ko'rinishga qarab fikr bildiradi.",[["오늘 기분이 {좋아 보여요}.","Bugun kayfiyatingiz yaxshi ko'rinadi."],["피곤{해 보여요}.","Charchagan ko'rinasiz."],["이 음식은 {맛있어 보여요}.","Bu taom mazali ko'rinadi."]]],
["-(으)ㄹ/(으)ㄴ/는 줄 알았다",3,"Shart va taxmin","...ar deb o'ylagan edim","Kutganidek bo'lmaganini yoki taxmin to'g'ri chiqmaganini bildiradi.",[["당신이 {올 줄 알았어요}.","Siz kelasiz deb o'ylagan edim."],["{합격할 줄 알았는데} 떨어졌어요.","O'tadi deb o'ylagandim, yiqildim."],["{비싼 줄 알았는데} 싸요.","Qimmat deb o'ylagan edim, arzon ekan."]]],
["-(으)ㄹ까 싶다",3,"Shart va taxmin","...sammikin deb o'ylayman","Ozgina ikkilanib, rejani yoki taxminni aytadi.",[["이번 휴가에 {여행 갈까 싶어요}.","Bu ta'tilda sayohatga chiqsammikin deb o'ylayapman."],["{포기할까 싶었어요}.","Taslim bo'lsammikin degan o'yda edim."],["뭘 {먹을까 싶어서} 물어봤어요.","Nima yesammikin deb so'radim."]]],
["-(으)ㄹ걸요 / -(으)ㄴ/는걸요",3,"Shart va taxmin","...ishi mumkin (taxmin) / ...-ku (taajjub, norozilik)","(으)ㄹ걸요 — taxmin; -(으)ㄴ/는걸요 — yumshoq inkor yoki taajjub.",[["지금쯤 {도착했을걸요}.","Hozirgacha yetib borgandir."],["그 사람은 벌써 {갔는걸요}.","U allaqachon ketib bo'ldi-ku."],["저보다 {잘하는걸요}.","Mendan yaxshi qilyapsiz-ku."]]],
["-(ㄴ/는)다고 해서",3,"Shart va taxmin","...deb ... degani emas","Birinchi holat ikkinchisini albatta keltirib chiqarmasligini bildiradi.",[["{돈이 많다고 해서} 행복한 것은 아니에요.","Pul ko'p deb baxtli bo'lish shart emas."],["{비싸다고 해서} 좋은 것은 아니에요.","Qimmat deb yaxshi degani emas."],["{어리다고 해서} 모르는 것은 아니에요.","Yosh deb bilmaydi degani emas."]]],
["아무리 -아/어도",2,"Shart va taxmin","qanchalik ...sa ham","Qanchalik harakat qilsa ham natija o'zgarmasligini bildiradi.",[["{아무리 바빠도} 밥은 먹어요.","Qanchalik band bo'lsam ham ovqat yeyman."],["{아무리 노력해도} 안 돼요.","Qanchalik harakat qilsam ham bo'lmayapti."],["{아무리 비싸도} 사고 싶어요.","Qanchalik qimmat bo'lsa ham olgim keladi."]]],
["-도록 하다",3,"Istak, reja va taklif","...sin (talab, maslahat)","Muloyim yoki rasmiy tarzda biror ishni bajarishni buyuradi yoki maslahat beradi.",[["내일은 일찍 {오도록 하세요}.","Ertaga erta keling."],["다음부터는 {조심하도록 하겠습니다}.","Keyingi safar ehtiyot bo'lishga harakat qilaman."],["약을 {먹도록 하세요}.","Dorini ichib turing."]]],
["-는 게 좋겠다 / -(으)ㄴ/는 것이 좋다",2,"Istak, reja va taklif","...gani yaxshi (maslahat)","Maslahat yoki tavsiya berishda ishlatiladi.",[["일찍 {자는 게 좋겠어요}.","Erta yotgan yaxshi bo'ladi."],["우산을 {가져가는 게 좋아요}.","Soyabonni olib ketgan yaxshi."],["지금 {출발하는 것이 좋겠어요}.","Hozir yo'lga chiqsak yaxshi bo'ladi."]]],
["-(으)ㄹ까 말까 하다",3,"Istak, reja va taklif","...sammikin yo'qmikin","Qaror qilolmay ikkilanishni bildiradi.",[["{갈까 말까} 고민해요.","Boraymi-yo'qmi deb o'ylanib yuribman."],["{살까 말까} 망설이고 있어요.","Sotib olsammikin yo'qmikin deb ikkilanyapman."],["{할까 말까} 생각 중이에요.","Qilsammikin yo'qmikin deb o'ylayapman."]]],
["-(으)ㄹ 필요가 있다/없다",2,"Ruxsat, taqiq va majburiyat","...ish kerak / kerak emas","Biror ishning zarur yoki zarur emasligini bildiradi.",[["더 {연습할 필요가 있어요}.","Yana mashq qilish kerak."],["{걱정할 필요가 없어요}.","Xavotirlanishning keragi yo'q."],["지금 {갈 필요는 없어요}.","Hozir borishning keragi yo'q."]]],
["-기 시작하다",1,"Yordamchi fe'llar","...a boshladi","Harakatning boshlanishini bildiradi.",[["비가 {내리기 시작했어요}.","Yomg'ir yog'a boshladi."],["한국어를 {배우기 시작했어요}.","Koreys tilini o'rgana boshladim."],["아기가 {걷기 시작했어요}.","Chaqaloq yura boshladi."]]],
["-기 쉽다 / -기 어렵다",2,"Yordamchi fe'llar","...ish oson / qiyin","Biror ishni bajarish qanchalik oson yoki qiyinligini bildiradi.",[["이 책은 {읽기 쉬워요}.","Bu kitobni o'qish oson."],["한국어 발음은 {하기 어려워요}.","Koreys talaffuzi qiyin."],["이 길은 {찾기 어려워요}.","Bu yo'lni topish qiyin."]]],
["-기 좋다 / -기 편하다",2,"Yordamchi fe'llar","...ish uchun yaxshi / qulay","Biror ish uchun qulay yoki yaxshi sharoit borligini bildiradi.",[["이 신발은 {걷기 편해요}.","Bu oyoq kiyim yurish uchun qulay."],["여기는 {살기 좋아요}.","Bu yer yashash uchun yaxshi."],["날씨가 {놀기 좋아요}.","Ob-havo sayr qilish uchun yaxshi."]]],
["-게 만들다",3,"Yordamchi fe'llar","...ga majbur qilmoq, ...tirmoq","Biror kishini yoki narsani muayyan holatga keltirishni bildiradi.",[["그 말이 저를 {울게 만들었어요}.","O'sha gap meni yig'latdi."],["선생님이 학생들을 {웃게 만들었어요}.","Ustoz o'quvchilarni kuldirdi."],["이 노래가 사람을 {행복하게 만들어요}.","Bu qo'shiq odamni baxtli qiladi."]]],
["-아/어 가다 / -아/어 오다",3,"Yordamchi fe'llar","...ib bormoq / ...ib kelmoq (jarayon)","Jarayonning davomiyligini bildiradi: 가다 — kelajak sari, 오다 — o'tmishdan hozirgacha.",[["숙제가 {끝나 가요}.","Uy vazifasi tugab bormoqda."],["지금까지 열심히 {살아 왔어요}.","Hozirgacha astoydil yashab keldim."],["점점 {좋아져 가요}.","Asta-sekin yaxshilanib bormoqda."]]],
["-아/어 대다",3,"Yordamchi fe'llar","...averadi, ...ib turadi (tinimsiz)","Biror ishni tinmay, ortiqcha takrorlashni bildiradi.",[["아이가 {울어 대요}.","Bola tinmay yig'layapti."],["밤새 {떠들어 댔어요}.","Tun bo'yi shovqin qilishdi."],["{먹어 대서} 배탈이 났어요.","Tinmay yeb, qornim og'rib qoldi."]]],
["-아/어 내다",3,"Yordamchi fe'llar","...ib chiqmoq, uddalamoq","Qiyinchilikni yengib, ishni oxiriga yetkazganini bildiradi.",[["힘든 일을 {해냈어요}.","Qiyin ishni uddaladim."],["문제를 {풀어 냈어요}.","Masalani yechib chiqdim."],["끝까지 {참아 냈어요}.","Oxirigacha chidadim."]]],
["-곤 하다",3,"Yordamchi fe'llar","...ib turadi, ...ardi (odat)","Vaqti-vaqti bilan takrorlanadigan odatni bildiradi.",[["주말에는 공원에서 {산책하곤 해요}.","Dam olish kunlari parkda sayr qilib turaman."],["어릴 때 이 길에서 {놀곤 했어요}.","Bolaligimda bu yo'lda o'ynardim."],["가끔 친구에게 {전화하곤 해요}.","Ba'zan do'stimga qo'ng'iroq qilib turaman."]]],
["-아/어 하다",3,"Yordamchi fe'llar","...yapti (his-tuyg'uni ko'rsatish)","Sifatni (his) fe'lga aylantiradi: boshqa kishining tuyg'usini bildirish uchun.",[["동생이 강아지를 {좋아해요}.","Ukam kuchukchani yoqtiradi."],["아이가 주사를 {무서워해요}.","Bola ukoldan qo'rqadi."],["친구가 시험을 {걱정해요}.","Do'stim imtihondan xavotirda."]]],
["-고 보니",3,"Gap ichidagi nutq","...ib qarasam, ...gandan keyin bildim","Biror ishni qilgandan keyin yangi narsani anglaganini bildiradi.",[["{먹고 보니} 맛있었어요.","Yeb ko'rsam, mazali ekan."],["{가고 보니} 문이 닫혀 있었어요.","Borib qarasam, eshik yopiq ekan."],["{알고 보니} 우리는 친척이었어요.","Bilsam, qarindosh ekanmiz."]]],
["-다시피",3,"Gap ichidagi nutq","...ganingizdek","Tinglovchi ham biladigan narsaga tayanib gapirishni bildiradi.",[["{아시다시피} 내일은 휴일이에요.","O'zingiz bilganingizdek, ertaga dam olish kuni."],["{보시다시피} 아주 바빠요.","Ko'rib turganingizdek, juda bandman."],["{알다시피} 그는 정직해요.","Bilganingizdek, u halol."]]],
["-기 마련이다 / -는 법이다",3,"Gap ichidagi nutq","...ish tabiiy; ...ar ekan","Hayotdagi umumiy qonuniyat yoki tabiiy holatni bildiradi.",[["사람은 누구나 {실수하기 마련이에요}.","Har kim xato qilishi tabiiy."],["겨울이 가면 봄이 {오는 법이에요}.","Qish o'tsa, bahor keladi."],["처음에는 {어렵기 마련이에요}.","Boshida qiyin bo'lishi tabiiy."]]],
["-(으)ㄹ 지경이다",3,"Gap ichidagi nutq","...darajaga yetdi","Holat shu darajaga yetganini kuchli ifodalaydi.",[["배고파서 {죽을 지경이에요}.","Ochlikdan o'lay deyapman."],["너무 바빠서 {쓰러질 지경이에요}.","Shunchalik bandmanki, yiqilib tushay deyapman."],["{울고 싶을 지경이에요}.","Yig'lagim kelib turibdi."]]],
["-(으)ㄹ 따름이다",3,"Gap ichidagi nutq","...gandan boshqa narsa emas; ...ish xolos","Faqat shuni qilganini yoki shu holda ekanini kamtarlik bilan bildiradi.",[["제 일을 {했을 따름이에요}.","Men o'z ishimni qildim, xolos."],["감사{할 따름이에요}.","Faqat minnatdorman."],["그저 {웃을 따름이에요}.","Shunchaki kulib qo'yaman."]]],
["-(ㄴ/는)다면서요?",3,"Gap ichidagi nutq","...ekan-ku? (eshitgan gapni tasdiqlash)","Boshqalardan eshitgan ma'lumotni tasdiqlash uchun so'raydi.",[["내일 {비가 온다면서요}?","Ertaga yomg'ir yog'adi degan, shundaymi?"],["한국에 {간다면서요}?","Koreyaga borarkansiz-ku?"],["그 식당이 {맛있다면서요}?","O'sha restoran mazali deyishadi, to'g'rimi?"]]],
["(이)라고 하다",2,"Gap ichidagi nutq","...deb ataladi / ...deydi (ism, nom)","Biror narsaning nomini yoki kimning ismini aytganda ishlatiladi.",[["제 이름은 민수{라고 해요}.","Mening ismim Minsu."],["이것을 한국어로 '사과'{라고 해요}.","Buni koreyscha «sagwa» deyishadi."],["친구가 '안녕'{이라고 했어요}.","Do'stim «salom» dedi."]]],
["-는 데 (걸리다/들다/필요하다)",3,"Gap ichidagi nutq","...ish uchun (vaqt/pul sarflanadi)","Biror ishni qilish uchun qancha vaqt yoki pul kerakligini aytadi.",[["여기까지 {오는 데} 두 시간 걸렸어요.","Bu yerga kelishga ikki soat ketdi."],["책을 {만드는 데} 돈이 많이 들어요.","Kitob tayyorlash uchun ko'p pul ketadi."],["한국어를 {배우는 데} 도움이 돼요.","Koreys tilini o'rganishda yordam beradi."]]],
["-(으)ㄴ/는 것 / -기 / -(으)ㅁ (otlashtirish)",2,"Gap ichidagi nutq","fe'lni otga aylantirish","Fe'lga -기, -는 것 yoki -(으)ㅁ qo'shib, uni ot sifatida ishlatish mumkin.",[["{읽는 것}을 좋아해요.","O'qishni yoqtiraman."],["{말하기}가 어려워요.","Gapirish qiyin."],["{웃음}이 최고의 약이에요.","Kulgi eng yaxshi dori."]]],
["얼마나 -(으)ㄴ/는지 모르다",3,"Gap ichidagi nutq","naqadar ...ligini bilmaysiz (ta'kid)","Hissiyotni kuchaytirib, «naqadar ...» ma'nosini beradi.",[["그 영화는 {얼마나 재미있는지 몰라요}.","O'sha kino naqadar qiziq, bilmaysiz."],["오늘 {얼마나 추운지 몰라요}.","Bugun naqadar sovuq, bilmaysiz."],["{얼마나 기쁜지 몰라요}.","Naqadar xursandman, bilmaysiz."]]],
["-ㅂ니까? / -습니까?",1,"Tugatuvchi shakllar","...mi? (rasmiy so'roq)","Rasmiy uslubdagi savol shakli; xabar, intervyu va xizmat sohasida ishlatiladi.",[["어디에 {갑니까}?","Qayerga borasiz?"],["무엇을 {먹습니까}?","Nima yeysiz?"],["학생{입니까}?","Talabamisiz?"]]],
["-(으)십시오 (rasmiy buyruq)",2,"Tugatuvchi shakllar","...ing (rasmiy buyruq)","Eng hurmatli rasmiy buyruq: bildirishnoma va xizmat so'zlarida.",[["여기에 {앉으십시오}.","Marhamat, mana bu yerga o'tiring."],["천천히 {말씀하십시오}.","Sekin gapiring."],["안전벨트를 {매십시오}.","Xavfsizlik kamarini taqing."]]],
["-지요 / -죠",2,"Tugatuvchi shakllar","...-a? ...-ku (tasdiqlash so'rovi)","Ikkala suhbatdosh biladigan narsani tasdiqlash yoki yumshoq so'rash uchun.",[["날씨가 {좋지요}?","Ob-havo yaxshi, shunday emasmi?"],["이 노래 {알죠}?","Bu qo'shiqni bilasiz-a?"],["정말 {예쁘죠}!","Rostan ham chiroyli-da!"]]],
["-나요? / -(으)ㄴ가요?",2,"Tugatuvchi shakllar","...mi? (yumshoq so'roq)","Muloyim va yumshoq so'roq shakli; ko'pincha tinglovchiga hurmat bilan.",[["지금 {바쁜가요}?","Hozir bandmisiz?"],["어디에 {가나요}?","Qayerga borasiz?"],["이거 {맛있나요}?","Bu mazalimi?"]]],
["-네 / -구나 (norasmiy ajablanish)",2,"Tugatuvchi shakllar","...ekan-ku! (yangi narsani payqash)","Yangi bilgan yoki payqagan narsasiga ajablanishni bildiradi (반말).",[["와, 눈이 {오네}!","Voy, qor yog'yapti-ku!"],["너 정말 {예쁘구나}.","Sen rostan ham chiroylisan-ku."],["벌써 시간이 {이렇게 됐네}.","Vaqt shunday bo'lib qoptiyu."]]],
["-더라",3,"Tugatuvchi shakllar","...ekan (o'zim ko'rgan/eshitgan)","Ko'rgan yoki boshidan kechirgan narsasini yangi ma'lumot sifatida yetkazadi.",[["어제 본 영화가 {재미있더라}.","Kecha ko'rgan kinom qiziq ekan."],["동생이 키가 {크더라}.","Ukang bo'yi baland ekan."],["거기 사람이 {많더라}.","U yerda odam ko'p ekan."]]],
["-ㄴ/는다 (yozma oddiy shakl)",2,"Tugatuvchi shakllar","-di, -adi (kundalik va maqola uslubi)","Kundalik daftar, maqola va kitoblarda ishlatiladigan neytral hikoya shakli.",[["나는 매일 학교에 {간다}.","Men har kuni maktabga boraman."],["어제 친구를 {만났다}.","Kecha do'stimni uchratdim."],["날씨가 {좋다}.","Ob-havo yaxshi."]]],
["-아/어 주세요 / -아/어 주시겠어요?",1,"Tugatuvchi shakllar","...ib bering / ...ib berolasizmi?","Muloyim iltimos; 주시겠어요 yanada hurmatli.",[["문 좀 {열어 주세요}.","Eshikni ochib bering."],["사진 좀 {찍어 주시겠어요}?","Rasmga tushirib berolasizmi?"],["천천히 {말해 주세요}.","Sekinroq gapirib bering."]]],
["ㅂ 불규칙 (ㅂ tartibsiz fe'llar)",2,"Tartibsiz fe'llar","ㅂ → 우/오 (춥다 → 추워요)","ㅂ bilan tugagan ayrim sifat/fe'llarda unlidan oldin ㅂ tushib 우 qo'shiladi (돕다 → 도와요).",[["날씨가 {추워요}.","Havo sovuq."],["이 음식은 {매워요}.","Bu ovqat achchiq."],["친구를 {도와요}.","Do'stimga yordam beraman."]]],
["ㄷ 불규칙",2,"Tartibsiz fe'llar","ㄷ → ㄹ (듣다 → 들어요)","ㄷ bilan tugagan ayrim fe'llarda unli oldidan ㄷ ㄹ ga almashadi: 듣다, 걷다, 묻다 (so'ramoq).",[["음악을 {들어요}.","Musiqa tinglayman."],["매일 공원에서 {걸어요}.","Har kuni parkda yuraman."],["선생님께 {물어요}.","Ustozdan so'rayman."]]],
["ㅅ 불규칙",2,"Tartibsiz fe'llar","ㅅ tushadi (낫다 → 나아요)","ㅅ bilan tugagan ayrim fe'llarda unlidan oldin ㅅ tushib qoladi: 짓다, 낫다.",[["감기가 {나아요}.","Shamollash tuzaldi."],["집을 {지어요}.","Uy quryapman."],["이름을 {지었어요}.","Ism qo'ydim."]]],
["ㅎ 불규칙",3,"Tartibsiz fe'llar","ㅎ tushadi (빨갛다 → 빨개요)","Rang sifatlari ㅎ bilan tugaydi: unli oldidan ㅎ tushadi va 아/어 → 애/얘 ga o'zgaradi.",[["사과가 {빨개요}.","Olma qizil."],["하늘이 {파래요}.","Osmon ko'k."],["이 케이크는 {어때요}?","Bu tort qanday?"]]],
["르 불규칙",2,"Tartibsiz fe'llar","르 → ㄹ라/ㄹ러 (모르다 → 몰라요)","르 bilan tugagan fe'llarda ㅡ tushib, oldingi bo'g'inga ㄹ qo'shiladi.",[["생각이 {달라요}.","Fikr boshqacha."],["노래를 {불러요}.","Qo'shiq aytaman."],["답을 {몰라요}.","Javobni bilmayman."]]],
["ㄹ 탈락",2,"Tartibsiz fe'llar","ㄹ tushishi (살다 → 사세요)","ㄹ bilan tugagan fe'llarga ㄴ, ㅂ, ㅅ bilan boshlanuvchi qo'shimcha qo'shilganda ㄹ tushib ketadi.",[["어디에 {사세요}?","Qayerda yashaysiz?"],["저는 서울에 {삽니다}.","Men Seulda yashayman."],["그분을 {아세요}?","Ular bilan tanishmisiz?"]]],
["ㅡ 탈락",2,"Tartibsiz fe'llar","ㅡ tushishi (쓰다 → 써요, 바쁘다 → 바빠요)","ㅡ bilan tugagan fe'llarda 아/어 qo'shilganda ㅡ tushib ketadi.",[["편지를 {써요}.","Xat yozaman."],["요즘 많이 {바빠요}.","Hozir juda bandman."],["배가 {고파요}.","Qornim och."]]],
["Sof koreys sonlari (하나, 둘, 셋...)",1,"Sonlar va sanash","bir, ikki, uch... (sof koreys)","Soat (시), yosh (살), dona (개) va ko'plab sanoq so'zlari bilan ishlatiladi: 하나, 둘, 셋, 넷, 다섯...",[["지금 {세 시}예요.","Hozir soat uch."],["저는 {스무 살}이에요.","Men yigirma yoshdaman."],["사과 {두 개}를 샀어요.","Ikkita olma sotib oldim."]]],
["Xitoy-koreys sonlari (일, 이, 삼...)",1,"Sonlar va sanash","bir, ikki, uch... (xitoy-koreys)","Sana, pul, telefon raqami, daqiqa va narx uchun ishlatiladi.",[["오늘은 {삼월 오일}이에요.","Bugun 5-mart."],["이 가방은 {삼만 원}이에요.","Bu sumka 30 ming von."],["지금 {십 분} 남았어요.","Hozir o'n daqiqa qoldi."]]],
["Sanoq so'zlari (명, 마리, 권, 잔, 장...)",1,"Sonlar va sanash","...nafar, ...bosh, ...jild (sanoq birliklari)","Ot turiga qarab sanoq so'zi tanlanadi: 명 (odam), 마리 (hayvon), 권 (kitob), 잔 (kosa/stakan), 장 (qog'oz).",[["학생이 {다섯 명} 있어요.","Besh nafar talaba bor."],["고양이가 {두 마리} 있어요.","Ikkita mushugim bor."],["책을 {세 권} 샀어요.","Uchta kitob oldim."]]],
["So'roq so'zlar (누구, 무엇, 어디, 언제, 왜...)",1,"So'roq va inkor","kim, nima, qayer, qachon, nega...","So'roq so'z gapda o'z o'rnida turadi va -(이)에요 yoki -아/어요 bilan birga ishlatiladi.",[["{누가} 왔어요?","Kim keldi?"],["{어디에} 가요?","Qayerga borasiz?"],["{왜} 늦었어요?","Nega kech qoldingiz?"]]],
["이/그/저 (ko'rsatish olmoshlari)",1,"So'roq va inkor","bu / shu / u (ko'rsatish)","이 — so'zlovchiga yaqin, 그 — tinglovchiga yaqin yoki ma'lum, 저 — ikkalasidan uzoq.",[["{이} 책은 제 거예요.","Bu kitob meniki."],["{그} 사람이 누구예요?","U odam kim?"],["{저} 건물이 도서관이에요.","Anavi bino kutubxona."]]],
["가장 / 제일 / 더 / 덜 / 훨씬",2,"So'roq va inkor","eng / ko'proq / kamroq / ancha (darajalash)","Solishtirish va daraja ifodalaydi: 가장 va 제일 — eng, 더 — yana ko'proq, 덜 — kamroq, 훨씬 — ancha.",[["이게 {제일} 맛있어요.","Bu eng mazali."],["오늘이 어제보다 {더} 추워요.","Bugun kechagidan sovuqroq."],["여기가 {훨씬} 조용해요.","Bu yer ancha jim."]]],
["아직 / 이미 / 벌써 / 이제",2,"So'roq va inkor","hali / allaqachon / endi","Vaqt ravishlari: 아직 — hali; 이미/벌써 — allaqachon; 이제 — endi.",[["{아직} 안 먹었어요.","Hali yemadim."],["{벌써} 다 했어요.","Hammasini allaqachon qildim."],["{이제} 집에 갈래요.","Endi uyga ketaman."]]],
["그리고 / 그래서 / 그런데 / 하지만 / 그러나",1,"So'roq va inkor","va, shuning uchun, ammo, lekin (bog'lovchi ravishlar)","Gaplarni bir-biriga bog'laydigan ravish va bog'lovchilar: ketma-ketlik, sabab, qarama-qarshilik.",[["비가 와요. {그래서} 집에 있어요.","Yomg'ir yog'yapti. Shuning uchun uyda turibman."],["커피를 좋아해요. {하지만} 밤에는 안 마셔요.","Kofeni yoqtiraman. Ammo kechqurun ichmayman."],["밥을 먹었어요. {그리고} 공부했어요.","Ovqatlandim. Va keyin o'qidim."]]],
["Hurmat so'zlari (드시다, 주무시다, 계시다...)",2,"Hurmat va uslub","hurmat shaklidagi maxsus so'zlar","Hurmatli kishi haqida ba'zi fe'llar boshqa so'z bilan almashadi: 먹다→드시다, 자다→주무시다, 있다→계시다, 말하다→말씀하시다.",[["할아버지께서 진지를 {드세요}.","Bobom ovqat yeyaptilar."],["아버지는 지금 {주무세요}.","Dadam hozir uxlayaptilar."],["선생님은 교실에 {계세요}.","Ustoz sinfda turibdilar."]]],
["드리다 / 말씀드리다",2,"Hurmat va uslub","bermoq (kamtarona), aytmoq (kamtarona)","O'zini pasaytirib, hurmatli kishiga biror narsa berish yoki aytishni bildiradi.",[["선생님께 선물을 {드렸어요}.","Ustozga sovg'a berdim."],["부모님께 전화{드렸어요}.","Ota-onamga qo'ng'iroq qildim."],["제가 먼저 {말씀드릴게요}.","Avval o'zim aytaman."]]],
["Hurmatli otlar (분, 댁, 성함, 연세)",2,"Hurmat va uslub","kishi, uy, ism, yosh (hurmat shakli)","Hurmatli kishiga nisbatan oddiy ot o'rniga maxsus ot ishlatiladi: 사람→분, 집→댁, 이름→성함, 나이→연세.",[["이 {분}은 우리 선생님이세요.","Bu zot bizning ustozimiz."],["{성함}이 어떻게 되세요?","Ismingiz nima?"],["할머니는 {연세}가 많으세요.","Buvim yoshi ulug'lar."]]],
["-님 / -씨 (murojaat)",1,"Hurmat va uslub","hurmatli murojaat qo'shimchalari","씨 — tengdosh yoki yoshi yaqin kishiga; 님 — hurmatli lavozim va ustozga.",[["민수 {씨}, 안녕하세요?","Minsu, assalomu alaykum!"],["사장{님}, 안녕하세요?","Direktor, assalomu alaykum!"],["김 선생{님}, 감사합니다.","Kim ustoz, rahmat."]]],
["Ot + 하다 (fe'l yasash)",1,"So'z yasash","...lamoq (ot → fe'l)","Ko'p otlarga 하다 qo'shilib fe'l yasaladi: 공부 → 공부하다, 운동 → 운동하다.",[["매일 {공부해요}.","Har kuni o'qiyman."],["저녁에 {운동해요}.","Kechqurun mashq qilaman."],["친구와 {이야기해요}.","Do'stim bilan gaplashaman."]]],
["-이 / -히 / -게 (ravish yasash)",2,"So'z yasash","sifat → ravish","Ko'p sifatlarga -이/-히/-게 qo'shilib ravish yasaladi: 조용하다 → 조용히, 많다 → 많이, 예쁘다 → 예쁘게.",[["{조용히} 해 주세요.","Jim bo'ling."],["{많이} 드세요.","Ko'proq oling."],["{열심히} 공부해요.","Astoydil o'qiyman."]]],
["-적 (sifat yasash)",3,"So'z yasash","-iy, -viy (xususiyat)","Ot + 적 — sifat yoki ravish: 경제적 (iqtisodiy), 일반적 (umumiy); ko'pincha 인 yoki 으로 bilan keladi.",[["{경제적인} 문제가 있어요.","Iqtisodiy muammo bor."],["{일반적으로} 아침에 운동해요.","Odatda ertalab mashq qilaman."],["{개인적인} 생각이에요.","Bu shaxsiy fikrim."]]],
];

db.exec(`create table if not exists wex(id integer primary key autoincrement,word_id int,ko text,uz text);create index if not exists wex_w on wex(word_id);
create table if not exists gex(id integer primary key autoincrement,gid int,ko text,uz text);create index if not exists gex_g on gex(gid);`);
function parseEx(t){const out=[];t=String(t||'');let a=[];try{a=JSON.parse(t.match(/\[[\s\S]*\]/)[0])}catch{for(const m of t.match(/\{[^{}]*\}/g)||[])try{a.push(JSON.parse(m))}catch{}}
  for(const o of a)if(o&&/[가-힣]/.test(o.ko||'')&&o.uz)out.push({ko:String(o.ko).trim().slice(0,160),uz:String(o.uz).trim().slice(0,200)});return out.slice(0,5)}
// So'z kartochkasi uchun misol gaplar (bir marta AI yozadi, keyin bazadan beriladi)
app.get('/api/wex/:id',async(r,s)=>{const id=+r.params.id;if(!id||id<1)return s.json([]);
  let a=q('select ko,uz from wex where word_id=? limit 12',id);
  if(a.length<3){const w=one('select ko,uz from words where id=?',id);
    if(w&&AI_KEY){try{const t=await callClaude([{role:'user',content:`Koreyscha so'z: «${w.ko}» (o'zbekcha: ${w.uz}). Shu so'zni ishlatib, TOPIK 1-2 darajasidagi 3 ta TURLI, oddiy va tabiiy koreys gapi yoz. Har birining o'zbekcha tarjimasi ham bo'lsin. FAQAT JSON qaytar: [{"ko":"...","uz":"..."}]`}],"Sen koreys tili o'qituvchisisan. Faqat JSON massiv qaytarasan.",600);
      const n=parseEx(t);for(const e of n)run('insert into wex(word_id,ko,uz) values(?,?,?)',id,e.ko,e.uz);a=q('select ko,uz from wex where word_id=? limit 12',id)}catch(e){console.log('wex',e.message)}}}
  s.json(a)});
// Grammatika (pullik: obuna yoki bepul sinov)
const gramGate=(r,s,n)=>active(r.u)?n():s.status(402).json({e:'pay'});
db.exec(`create table if not exists gcustom(id integer primary key autoincrement,p text,l int,c text,m text,u text,ex text,created int)`);
const GBASE=100000;// admin qo'shgan grammatikalar ID si: GBASE + qator raqami (ichki grammatikalar bilan aralashmaydi)
const customGram=()=>q('select * from gcustom order by id').map(r=>{let e=[];try{e=JSON.parse(r.ex||'[]')}catch{}return {id:GBASE+r.id,g:[r.p,r.l,r.c,r.m,r.u,e]}});
const gramById=i=>i>=GBASE?((customGram().find(x=>x.id===i)||{}).g):GRM[i];
app.get('/api/gram',gramGate,(r,s)=>{const ex={};for(const e of q('select gid,ko,uz from gex'))(ex[e.gid]=ex[e.gid]||[]).push([e.ko,e.uz]);
  const all=GRM.map((g,i)=>({id:i,g})).concat(customGram());
  s.json({lv:GRM_LV,g:all.map(x=>({id:x.id,p:x.g[0],l:x.g[1],c:x.g[2],m:x.g[3],u:x.g[4],e:x.g[5].concat(ex[x.id]||[])}))})});
app.post('/api/gram/more',gramGate,async(r,s)=>{const i=+r.body.id,g=gramById(i);if(!g)return s.status(400).json({e:'bad'});
  if(!AI_KEY)return s.json({e:"Sun'iy intellekt ulanmagan",ex:[]});
  try{const have=g[5].concat(q('select ko,uz from gex where gid=?',i).map(x=>[x.ko,x.uz])).map(x=>x[0]).join(' | ');
    const t=await callClaude([{role:'user',content:`Koreys grammatikasi: «${g[0]}» — ${g[3]}. Qachon ishlatiladi: ${g[4]}\nShu grammatikani ishlatgan 3 ta YANGI, turli vaziyatdagi oddiy gap yoz (bular bo'lmasin: ${have}). Grammatik qismni {figurali qavs} ichiga ol. Tarjima o'zbekcha. FAQAT JSON: [{"ko":"...{...}...","uz":"..."}]`}],"Sen koreys tili o'qituvchisisan. Faqat JSON massiv qaytarasan.",700);
    const n=parseEx(t).filter(e=>/\{.+\}/.test(e.ko));for(const e of n)run('insert into gex(gid,ko,uz) values(?,?,?)',i,e.ko,e.uz);
    s.json({ex:n.map(e=>[e.ko,e.uz])})}catch(e){s.json({e:'AI xatosi',ex:[]})}});
// ===== Admin: yangi grammatika qo'shish (bo'lim, nomi, ma'nosi, qayerda ishlatilishi; misol gaplarni AI yozadi) =====
app.get('/api/admin/gram',adm('dicts'),(r,s)=>{const cg=customGram();
  s.json({lv:GRM_LV,cats:[...new Set(GRM.map(g=>g[2]).concat(cg.map(x=>x.g[2])))],items:cg.map(x=>({id:x.id,p:x.g[0],c:x.g[2],n:x.g[5].length}))})});
app.post('/api/admin/gram',adm('dicts'),async(r,s)=>{
  const b=r.body||{},cl=(v,n)=>String(v||'').replace(/[{}]/g,'').trim().slice(0,n);
  const p=cl(b.p,80),c=cl(b.c,60),l=Math.min(3,Math.max(1,+b.l||1));let m=cl(b.m,160),u=cl(b.u,500);
  if(!p||!c)return s.json({e:"Grammatika nomi va bo'limini kiriting"});
  if(!AI_KEY)return s.json({e:"Sun'iy intellekt ulanmagan — misol gaplarni yozib bo'lmaydi"});
  try{const t=await callClaude([{role:'user',content:`Koreys grammatikasi: «${p}». Daraja: ${l} (1 boshlang'ich, 3 yuqori). Bo'lim: ${c}.${m?` Ma'nosi: ${m}.`:''}${u?` Qachon va qayerda ishlatiladi: ${u}.`:''}
Quyidagilarni yoz:
"m" — grammatikaning qisqa o'zbekcha ma'nosi${m?' (foydalanuvchi yozgan, shuni o\'zgartirmay qaytar)':''},
"u" — qachon va qayerda ishlatilishi, 1-2 gap, o'zbekcha${u?' (foydalanuvchi yozgan, shuni o\'zgartirmay qaytar)':''},
"ex" — shu grammatikani ishlatgan 5 ta TURLI vaziyatdagi oddiy va tabiiy koreys gapi. Grammatik qismini {figurali qavs} ichiga ol. Har birining o'zbekcha tarjimasi bo'lsin.
Izohlar o'zbek tilida (lotin yozuvi). FAQAT JSON qaytar: {"m":"","u":"","ex":[{"ko":"...{...}...","uz":"..."}]}`}],"Sen koreys tili o'qituvchisisan. Faqat JSON qaytarasan.",1800);
    let o={};try{o=JSON.parse(String(t).match(/\{[\s\S]*\}/)[0])}catch{}
    const ex=parseEx(JSON.stringify(o.ex||[])).filter(e=>/\{.+\}/.test(e.ko));
    if(!ex.length)return s.json({e:"AI misol gaplarni yozib bera olmadi, qayta urinib ko'ring"});
    m=m||cl(o.m,160);u=u||cl(o.u,500);
    const id=run('insert into gcustom(p,l,c,m,u,ex,created) values(?,?,?,?,?,?,?)',p,l,c,m,u,JSON.stringify(ex.map(e=>[e.ko,e.uz])),Date.now()).lastInsertRowid;
    s.json({ok:1,id:GBASE+Number(id),n:ex.length,m,u})}
  catch(e){console.log('gram qo\'shish',String(e.message||e).slice(0,200));s.json({e:friendlyErr(e.message||e)})}});
app.post('/api/admin/gram/del',adm('dicts'),(r,s)=>{const id=+r.body.id;if(!(id>GBASE))return s.status(400).json({e:'bad'});
  run('delete from gcustom where id=?',id-GBASE);run('delete from gex where gid=?',id);s.json({ok:1})});
app.get('/api/rating',(r,s)=>s.json(q('select name,pts from scores where week=? order by pts desc limit 20',wk())));
app.get('/api/plans',(r,s)=>s.json(q('select p.*,d.name dname from plans p left join dicts d on d.id=p.dict_id where coalesce(d.deleted,0)=0 order by p.dict_id,p.months')));
app.get('/api/methods',(r,s)=>s.json(q('select * from methods where on_=1')));
app.get('/api/dicts',(r,s)=>s.json(q('select * from dicts where deleted=0').map(d=>({...d,free:PAID_ONLY?0:d.free,ok:can(r.u,d)}))));
app.get('/api/langs',(r,s)=>s.json(LANGS));
app.get('/api/tree/:id',(r,s)=>{const d=one('select * from dicts where id=?',r.params.id);
  if(!d||d.deleted||!can(r.u,d))return s.status(402).json({e:'pay'});
  s.json({d,levels:lvList(d),rows:q('select lang,level,pos,section,count(*) n from words where dict_id=? group by 1,2,3,4',d.id)})});
app.get('/api/poss',(r,s)=>s.json(getPoss()));
app.get('/api/words',(r,s)=>{const {dict,level,pos,section,mode,lang}=r.query;
  const d=one('select * from dicts where id=?',dict);if(!d||d.deleted||!can(r.u,d))return s.status(402).json({e:'pay'});
  let sql='select w.*,(l.word_id is not null) learned from words w left join learned l on l.word_id=w.id and l.user_id=? where w.dict_id=?';
  const a=[r.u.id,dict];
  for(const [k,v] of [['level',level],['pos',pos],['section',section],['lang',lang]])if(v){sql+=` and w.${k}=?`;a.push(v)}
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
const foxUse={},FOXSYS="Sen Kori — «Tillar lug'ati» botining do'stona va bilimdon tulki yordamchisan 🦊. O'zbek tilida (lotin yozuvida) javob ber. Foydalanuvchi har qanday til (ingliz, koreys, yapon, xitoy, rus, nemis va boshqalar) bo'yicha yoki boshqa mavzuda savol bersa, to'liq, aniq va foydali javob ber: oddiy savolga qisqa, murakkabiga batafsilroq. Chet tildagi so'zlarni o'z yozuvida yoz va kerak bo'lsa o'qilishini lotinda qavs ichida ko'rsat. Mashq so'ralsa, bitta savol ber va javobni kut. Tibbiy, huquqiy yoki xavfli mavzularda ehtiyotkor bo'l.";
function fallbackFox(ms){
  const last=String(ms[ms.length-1].content).trim(),prev=ms.length>1?String(ms[ms.length-2].content):'';
  const qm=prev.match(/^🧠 «(.+?)» nima degani\?/);
  if(qm){const w=one('select * from words where ko=? limit 1',qm[1]);if(w){const first=w.uz.split(/[,;]/)[0].trim().toLowerCase(),ok=last.toLowerCase().includes(first);
    return {lite:1,reply:(ok?'Ajoyib! 🎉 ':'Deyarli! ')+'«'+w.ko+'» — '+w.uz+".\n\nYana mashq qilamizmi? «Meni sina» deb yozing."}}}
  if(/sina/i.test(last)){const w=one('select * from words order by random() limit 1');if(w)return {lite:1,reply:'🧠 «'+w.ko+'» nima degani?'}}
  let rows=[];const hang=last.match(/\p{L}{2,}/gu);
  if(hang)for(const h of hang.slice(0,3))rows.push(...q('select ko,uz from words where ko like ? limit 3','%'+h+'%'));
  if(!rows.length){const t=last.replace(/[^\p{L}' ]/gu,'').trim().toLowerCase();if(t.length>=2)rows=q('select ko,uz from words where lower(uz) like ? limit 5','%'+t+'%')}
  if(rows.length)return {lite:1,reply:rows.slice(0,5).map(w=>'📖 '+w.ko+' — '+w.uz).join('\n')};
  return {lite:1,reply:"Men hozircha lug'atdagi so'zlarni topib bera olaman 🦊 Istalgan tildagi yoki o'zbekcha so'z yozing (masalan: school yoki maktab) yoki «Meni sina» deb yozing."}}
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
  const r=await fetch('https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl='+encodeURIComponent(((LANGM[lang||'ko']||{}).tts||'ko-KR').split('-')[0])+'&q='+encodeURIComponent(ko),{headers:{'user-agent':'Mozilla/5.0'},signal:AbortSignal.timeout(10000)});if(!r.ok)throw new Error('tts '+r.status);const b=Buffer.from(await r.arrayBuffer());if(b.length<500)throw new Error('tts bosh');return {b,ext:'mp3'}}
const PENDING="⏳ tarjima kutilmoqda";let trBusy=0;
async function trFill(){if(trBusy)return;trBusy=1;try{const rows=q("select id,ko from words where uz=? limit 80",PENDING);if(!rows.length)return;let o={};if(AI_KEY){try{o=await claudeTranslate(rows.map(x=>({ko:x.ko})))}catch{}}
  let tc=0;for(const w of rows){let uz=o[w.ko]&&o[w.ko].uz;if(!uz&&tc<12&&(!AI_KEY||!Object.keys(o).length)){tc++;uz=await tr(w.ko)}if(uz)run('update words set uz=? where id=? and uz=?',uz,w.id,PENDING)}}catch{}finally{trBusy=0}}
setInterval(trFill,20000).unref();setTimeout(trFill,20000).unref();
setInterval(()=>{if(ttsQ.length<10){ttsEnqueue(q("select id from words where audio is null or audio='' limit 40").map(x=>x.id).filter(id=>(ttsTry[id]||0)<8))}},120000).unref();
const ttsQ=[],ttsTry={},ttsSet=new Set();let ttsRun=0,ttsPause=0;
function ttsEnqueue(ids){for(const id of ids)if(!ttsSet.has(id)){ttsSet.add(id);ttsQ.push(id)}ttsPump()}
async function ttsPump(){
  if(ttsRun>=6||Date.now()<ttsPause)return;const id=ttsQ.shift();if(!id)return;ttsSet.delete(id);ttsRun++;
  try{const w=one('select ko,lang,audio from words where id=?',id);if(w&&w.ko&&!w.audio){const a=await wordAudio(w.ko,w.lang);const name='w'+id+'_'+Date.now()+'.'+a.ext;fs.writeFileSync(DATA+'/audio/'+name,a.b);run("update words set audio=? where id=? and (audio is null or audio='')",name,id)}}
  catch(e){ttsTry[id]=(ttsTry[id]||0)+1;if(ttsTry[id]<8){if(!ttsSet.has(id)){ttsSet.add(id);ttsQ.push(id)}const d=/quota|429|demand|503|exceed/i.test(String(e.message))?20000:5000;ttsPause=Date.now()+d;setTimeout(ttsPump,d+100)}}
  finally{ttsRun--;setTimeout(ttsPump,250)}
  ttsPump()}
app.post('/api/admin/autovoice',adm('import'),(r,s)=>{const d=+r.body.dict_id;const ids=(d?q('select id from words where dict_id=? and (audio is null or audio=\'\')',d):q("select id from words where audio is null or audio=''")).map(x=>x.id);ttsEnqueue(ids);s.json({ok:1,n:ids.length})});
const ttsBusy=new Map();
app.post('/api/word-voice/:id',async(r,s)=>{const w=one('select id,ko,lang,audio from words where id=?',r.params.id);if(!w)return s.json({e:'yoq'});if(w.audio)return s.json({audio:w.audio});
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
const EDGE_TOKEN='6A5AA1D4EAFF4E9FB37E23D68491D6F4',EDGE_VER=process.env.EDGE_TTS_VER||'143.0.3650.75',EDGE_VOICE={ko:process.env.EDGE_VOICE_KO||'ko-KR-SunHiNeural',uz:process.env.EDGE_VOICE_UZ||'uz-UZ-MadinaNeural'};
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
function ttsSegs(t,n){t=t.replace(/\p{Extended_Pictographic}/gu,' ').replace(/️/g,'');const segs=[];
  for(const m of t.matchAll(/([가-힣ㄱ-ㅎㅏ-ㅣ]+(?:[\s,.!?~·]+[가-힣ㄱ-ㅎㅏ-ㅣ]+)*)|([^가-힣ㄱ-ㅎㅏ-ㅣ]+)/g)){const x=m[0].replace(/\s+/g,' ').trim();if(!x||!/[\p{L}\p{N}]/u.test(x))continue;const lang=m[1]?'ko':'uz';
    for(let i=0;i<x.length;i+=400){segs.push([lang==='uz'?uzNorm(x.slice(i,i+400).trim()):x.slice(i,i+400).trim(),lang])}}
  return segs.slice(0,n||10)}
let edgeVerOk=null;
async function foxEdgeTts(t){const segs=ttsSegs(t);if(!segs.length)throw new Error('matn yoq');
  const vers=[...new Set([edgeVerOk,EDGE_VER,'143.0.3650.75','130.0.2849.68','140.0.3485.14','120.0.2210.91'].filter(Boolean))];let le;
  for(const v of vers){try{const b=Buffer.concat(await Promise.all(segs.map(([x,l])=>edgeTts(x,EDGE_VOICE[l],v))));edgeVerOk=v;return b}catch(e){le=e;if(!/403|401|ws moduli/.test(String(e.message)))throw e}}throw le}
// Gemini ovozi bo'lmasa/limit tugasa: Google ovozi (koreyscha va o'zbekcha qismlar alohida o'qiladi)
async function gTts(text,lang){let le;for(const u of ['https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=','https://translate.googleapis.com/translate_tts?ie=UTF-8&client=gtx&tl=']){try{const r=await fetch(u+lang+'&q='+encodeURIComponent(text),{headers:{'user-agent':'Mozilla/5.0'},signal:AbortSignal.timeout(6000)});if(!r.ok)throw new Error('tts '+r.status);const b=Buffer.from(await r.arrayBuffer());if(b.length<300)throw new Error('tts bosh');return b}catch(e){le=e}}throw le}
async function foxGoogleTts(t){t=t.replace(/\p{Extended_Pictographic}/gu,' ').replace(/\uFE0F/g,'');const segs=[];
  for(const m of t.matchAll(/([가-힣ㄱ-ㅎㅏ-ㅣ]+(?:[\s,.!?~·]+[가-힣ㄱ-ㅎㅏ-ㅣ]+)*)|([^가-힣ㄱ-ㅎㅏ-ㅣ]+)/g)){const x=m[0].replace(/\s+/g,' ').trim();if(!x||!/[\p{L}\p{N}]/u.test(x))continue;const lang=m[1]?'ko':'tr';
    for(let i=0;i<x.length;i+=170){let e=Math.min(x.length,i+170);if(e<x.length){const sp=x.lastIndexOf(' ',e);if(sp>i+60)e=sp}segs.push([lang==='tr'?uzTr(x.slice(i,e).trim()):x.slice(i,e).trim(),lang]);i=e-170}}
  if(!segs.length)throw new Error('matn yoq');const bufs=[];for(const [x,l] of segs.slice(0,14))bufs.push(await gTts(x,l));return Buffer.concat(bufs)}
app.post('/api/fox-tts',async(r,s)=>{const k=foxKey(r.u,'tts'),cap=r.u.is_admin?1e9:active(r.u)?400:60,errs=[];
  const t=String(r.body.text||'').replace(/[*_#`]/g,'').trim().slice(0,600);if(!t)return s.json({e:'tts'});
  fs.mkdirSync(DATA+'/audio/cache',{recursive:true});const ck=crypto.createHash('sha1').update(t).digest('hex'),cf=DATA+'/audio/cache/'+ck;
  try{if(fs.existsSync(cf+'.wav'))return s.json({a:fs.readFileSync(cf+'.wav').toString('base64')})}catch{}
  if(USE_GEMINI&&(foxUse[k]||0)<cap){foxUse[k]=(foxUse[k]||0)+1;try{const a=await geminiTTSany(t);try{fs.writeFileSync(cf+'.wav',Buffer.from(a,'base64'))}catch{}return s.json({a})}catch(e){foxUse[k]--;errs.push('gemini: '+friendlyErr(e.message||e).slice(0,80));console.error('fox-tts xato:',String(e.message||e).slice(0,300))}}
  try{s.json({a:(await foxGoogleTts(t)).toString('base64'),mime:'audio/mpeg'})}catch(e){errs.push('google: '+String(e.message||e).slice(0,60));console.error('fox-tts google xato:',errs.join(' | '));s.json({e:'tts',msg:errs.join(' | ')})}});
app.post('/api/fox',async(r,s)=>{const k=foxKey(r.u,'chat');if((foxUse[k]||0)>=foxLimit(r.u,'chat'))return s.json({e:'limit',left:0});foxUse[k]=(foxUse[k]||0)+1;
  const ms=(r.body.messages||[]).filter(m=>m&&m.content);const o=await askFox(ms,Array.isArray(r.body.words)?r.body.words:[]);if(o.e==='api')foxUse[k]--;o.left=foxLeft(r.u,'chat');s.json(o)});
// ===== Misol gap va tahlil ovozi: bir marta yasaladi va keshlanadi (Edge → Gemini → Google) =====
async function edgeLong(t){const segs=ttsSegs(t,30);if(!segs.length)throw new Error('matn yoq');
  const vers=[...new Set([edgeVerOk,EDGE_VER,'143.0.3650.75','130.0.2849.68','140.0.3485.14','120.0.2210.91'].filter(Boolean))];let le;
  for(const v of vers){try{const out=[];for(let i=0;i<segs.length;i+=6)out.push(...await Promise.all(segs.slice(i,i+6).map(([x,l])=>edgeTts(x,EDGE_VOICE[l],v))));edgeVerOk=v;return Buffer.concat(out)}catch(e){le=e;if(!/403|401|ws moduli/.test(String(e.message)))throw e}}throw le}
async function textAudio(text,gate){
  text=String(text||'').replace(/[{}*_#`]/g,'').replace(/\s+/g,' ').trim().slice(0,900);if(!text)throw new Error('matn yoq');
  fs.mkdirSync(DATA+'/audio/cache',{recursive:true});
  const ck='t_'+crypto.createHash('sha1').update(text).digest('hex');
  for(const x of ['mp3','wav'])if(fs.existsSync(DATA+'/audio/cache/'+ck+'.'+x))return 'cache/'+ck+'.'+x;
  if(gate)gate();
  let b=null,ext='mp3',le;
  try{b=await edgeLong(text)}catch(e){le=e}
  if(!b&&USE_GEMINI&&Date.now()>gemTtsOff){try{b=Buffer.from(await geminiTTSany(text),'base64');ext='wav'}catch(e){le=e;if(/quota|exceed|429|demand|404|not found/i.test(String(e.message)))gemTtsOff=Date.now()+30*60000}}
  if(!b){try{b=await foxGoogleTts(text);ext='mp3'}catch(e){le=e}}
  if(!b||b.length<500)throw le||new Error('tts bosh');
  fs.writeFileSync(DATA+'/audio/cache/'+ck+'.'+ext,b);return 'cache/'+ck+'.'+ext}
// ===== Qo'lda yozilgan ovozlar (matn bo'yicha): grammatika, misol gap, o'zbekcha/koreyscha matn =====
db.exec("create table if not exists voice_over(h text primary key,t text,a text,ts int)");
const nzT=t=>String(t||'').replace(/[{}*_#`]/g,'').replace(/\s+/g,' ').trim().slice(0,900);
const voH=t=>crypto.createHash('sha1').update(nzT(t)).digest('hex');
const voOne=t=>{const r=one('select a from voice_over where h=?',voH(t));return (r&&r.a)||''};
const audExt=mt=>mt.includes('ogg')?'ogg':/mp4|m4a|aac/.test(mt)?'mp4':/mpeg|mp3/.test(mt)?'mp3':mt.includes('wav')?'wav':'webm';
app.post('/api/admin/voice-text',adm('import'),up.single('audio'),(r,s)=>{const t=nzT(r.body.text);if(!t||!r.file){try{r.file&&fs.unlinkSync(r.file.path)}catch{}return s.status(400).json({e:'bad'})}
  const h=voH(t),old=one('select a from voice_over where h=?',h),name='vo_'+h.slice(0,12)+'_'+Date.now()+'.'+audExt(r.file.mimetype||'');
  fs.renameSync(r.file.path,DATA+'/audio/'+name);if(old&&old.a)try{fs.unlinkSync(DATA+'/audio/'+old.a)}catch{}
  run('insert or replace into voice_over(h,t,a,ts) values(?,?,?,?)',h,t,name,Date.now());s.json({ok:1,audio:name})});
app.post('/api/admin/voice-text/del',adm('import'),(r,s)=>{const h=voH(r.body.text),old=one('select a from voice_over where h=?',h);
  if(old&&old.a)try{fs.unlinkSync(DATA+'/audio/'+old.a)}catch{}run('delete from voice_over where h=?',h);s.json({ok:1})});
app.get('/api/admin/voice-gram',adm('import'),(r,s)=>{const ex={};for(const e of q('select gid,ko,uz from gex'))(ex[e.gid]=ex[e.gid]||[]).push([e.ko,e.uz]);
  const all=GRM.map((g,i)=>({id:i,g})).concat(customGram()),vo={};for(const x of q('select t,a from voice_over'))vo[x.t]=x.a;
  s.json({lv:GRM_LV,g:all.map(x=>({id:x.id,p:x.g[0],l:x.g[1],c:x.g[2],m:x.g[3],u:x.g[4],e:x.g[5].concat(ex[x.id]||[])})),vo})});
app.post('/api/admin/word/:id/audio-uz',adm('import'),up.single('audio'),(r,s)=>{const w=one('select * from words where id=?',r.params.id);if(!w||!r.file)return s.status(400).json({e:'bad'});
  const name='u'+w.id+'_'+Date.now()+'.'+audExt(r.file.mimetype||'');fs.renameSync(r.file.path,DATA+'/audio/'+name);
  if(w.audio_uz)try{fs.unlinkSync(DATA+'/audio/'+w.audio_uz)}catch{}run('update words set audio_uz=? where id=?',name,w.id);s.json({ok:1,audio_uz:name})});
app.post('/api/say',async(r,s)=>{const t=String(r.body.text||'').trim().slice(0,900);if(!t)return s.json({e:'bad'});
  const vo0=voOne(t);if(vo0)return s.json({audio:vo0});
  const k=foxKey(r.u,'say'),cap=r.u.is_admin?1e9:active(r.u)?500:80;
  try{s.json({audio:await textAudio(t,()=>{if((foxUse[k]||0)>=cap)throw new Error('limit');foxUse[k]=(foxUse[k]||0)+1})})}
  catch(e){console.error('say xato:',String(e.message||e).slice(0,200));s.json({e:/limit/.test(String(e.message))?'limit':'tts'})}});
// Misol gapni so'zma-so'z tahlil qilish (bir marta AI yozadi, keyin bazadan beriladi)
db.exec("create table if not exists wan(h text primary key,js text)");
function parseAn(t){let a=[];t=String(t||'');try{a=JSON.parse(t.match(/\[[\s\S]*\]/)[0])}catch{for(const m of t.match(/\{[^{}]*\}/g)||[])try{a.push(JSON.parse(m))}catch{}}
  const f=(v,n)=>String(v==null?'':v).replace(/[{}]/g,'').trim().slice(0,n);
  return a.filter(o=>o&&o.w&&o.mean).slice(0,14).map(o=>({w:f(o.w,40),base:f(o.base,120),mean:f(o.mean,120),gram:f(o.gram,200),tense:f(o.tense,80),when:f(o.when,260),where:f(o.where,200)}))}
app.post('/api/wex-tahlil',async(r,s)=>{
  const ko=String(r.body.ko||'').replace(/[{}]/g,'').trim().slice(0,160);if(!ko)return s.json({e:'bad'});
  const h=crypto.createHash('sha1').update(ko).digest('hex'),c=one('select js from wan where h=?',h);
  if(c){try{return s.json({a:JSON.parse(c.js)})}catch{}}
  const ex=one('select uz from wex where ko=?',ko);if(!ex)return s.json({e:'bad'});
  if(!AI_KEY)return s.json({e:"Sun'iy intellekt ulanmagan"});
  try{const t=await callClaude([{role:'user',content:`Koreys gapi: «${ko}» (o'zbekcha: ${ex.uz}).
Gapni so'zma-so'z tahlil qil: bo'sh joy bilan ajratilgan har bir bo'lak alohida, gapdagi tartibda. Har bir bo'lak uchun maydonlar:
"w" — bo'lak hangulda (gapdagidek),
"base" — lug'at shakli va tarkibi (masalan «가다 + -았어요» yoki «학교 + 에»),
"mean" — o'zbekcha ma'nosi,
"gram" — qanday grammatika/yuklama/tugatma ishlatilgan va u nima vazifa bajaradi (qo'shimchasiz oddiy so'z bo'lsa «oddiy so'z, qo'shimchasiz»),
"tense" — zamon: o'tgan / hozirgi / kelasi / zamonga aloqasiz (ot, yuklama, ravish uchun «zamon yo'q»),
"when" — shu grammatika yoki shakl umuman qaysi vaqt va vaziyatlarda ishlatiladi (1-2 gap),
"where" — aynan shu gapda bu so'z qaysi vazifada kelgan: ega, to'ldiruvchi, kesim, hol va h.k. (1 gap).
Barcha izoh o'zbek tilida (lotin yozuvi). Koreyscha so'z va qo'shimchalarni faqat hangulda yoz, lotincha o'qilishini yozma. Har maydon qisqa va aniq bo'lsin.
FAQAT JSON massiv qaytar: [{"w":"","base":"","mean":"","gram":"","tense":"","when":"","where":""}]`}],"Sen koreys tili o'qituvchisisan. Faqat JSON massiv qaytarasan.",2500);
    const a=parseAn(t);if(!a.length)throw new Error('bosh');
    run('insert or replace into wan(h,js) values(?,?)',h,JSON.stringify(a));s.json({a})}
  catch(e){console.log('tahlil',String(e.message||e).slice(0,200));s.json({e:"Tahlil olinmadi, birozdan keyin qayta urinib ko'ring"})}});
const VOICESYS="\nFoydalanuvchi ovozli xabar yubordi (o'zbek yoki koreys tilida). Avval u nima deganini aniq yozib ol, keyin unga javob ber. FAQAT JSON qaytar: {\"heard\":\"foydalanuvchi aytgan gap (o'z tilida)\",\"reply\":\"javobing\"}. Javob ovoz bilan o'qiladi: 1-3 qisqa gap yoz, *, #, emoji ishlatma, koreys so'zining lotincha o'qilishini qavs ichida yozma. Agar hech narsa eshitilmasa yoki faqat shovqin bo'lsa, heard ni bo'sh qoldir.";
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
  try{const a=await geminiTTSany("안녕하세요. Salom!");s.json({ok:true,a,model:TTSM})}catch(e){s.json({ok:false,error:friendlyErr(e.message||e)})}});
app.post('/api/admin/dict',adm('dicts'),(r,s)=>{run('insert into dicts(name,levels,sec,lvl) values(?,?,?,?)',r.body.name,Math.max(1,+r.body.levels||1),+r.body.sec||30,LVL(r.body.lvl));s.json({ok:1})});
app.post('/api/admin/dict/:id',adm('dicts'),(r,s)=>{const b=r.body;
  if('free'in b)run('update dicts set free=? where id=?',b.free?1:0,r.params.id);
  if(b.levels)run('update dicts set levels=? where id=?',+b.levels,r.params.id);
  if(b.name)run('update dicts set name=? where id=?',b.name,r.params.id);
  if('lvl'in b)run('update dicts set lvl=? where id=?',LVL(b.lvl),r.params.id);
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
const mlPrompt=langs=>"Bu fayldan quyidagi tillardagi BARCHA so'z va iboralarni lug'at yozuvi sifatida ajratib ol — birortasini ham tashlab ketma, matnni boshidan oxirigacha to'liq o'qi:\n"+langs.map(c=>(LANGM[c]?c+' — '+LANGM[c].name+' ('+LANGM[c].native+')':c)).join('\n')+"\nFaylda boshqa tillar ham bo'lishi mumkin — ularni olma (o'zbekcha tarjimalarni ham so'z sifatida olma). Har bir yozuv uchun: \"ko\" — so'zning lug'at (asosiy) shakli o'sha tilning o'z yozuvida (fe'l — infinitiv/lug'at shakli, ot — bosh kelishik, artikl va yuklamalarsiz); \"form\" — so'z matnda qanday ko'rinishda uchragan bo'lsa shu (lug'at shakli bilan bir xil bo'lsa bo'sh qoldir); \"lang\" — so'z tilining kodi (faqat yuqoridagi ro'yxatdagi kodlardan); \"uz\" — to'g'ri o'zbek tilidagi (lotin yozuvi) tarjima, 1-3 ta qisqa ekvivalent vergul bilan (faylda tarjima bo'lsa shuni o'zbekchaga o'tkazib ol; ruscha yoki inglizcha so'z ishlatma); \"pos\" — ot|fel|sifat|ravish|olmosh|son|yordamchi|boshqa; \"cefr\" — so'zning qiyinlik darajasi: A1, A2, B1, B2, C1 yoki C2 (CEFR bo'yicha, aniq baholab qo'y). FAQAT fayldagi so'zlarni ol: faylda yo'q so'zni o'zingdan qo'shma. Takrorlama. FAQAT JSON massiv qaytar: [{\"ko\":\"...\",\"form\":\"...\",\"lang\":\"en\",\"uz\":\"...\",\"pos\":\"ot\",\"cefr\":\"A1\"}]";
const wp=j=>j&&j.ml?mlPrompt(j.ml.langs):WPROMPT.replace("ot|fel|sifat|ravish|boshqa",posKeys());
const WPROMPT="Bu fayldan koreys tilidagi BARCHA so'z va iboralarni lug'at yozuvi sifatida ajratib ol — birortasini ham tashlab ketma, matnni boshidan oxirigacha to'liq o'qi. Faylda so'zlar ro'yxat, jadval yoki gap-matn shaklida bo'lishi mumkin: gap ichidagi har bir ma'noli so'zni (ot, fe'l, sifat, ravish, son, olmosh, iboralar) alohida yozuv qilib ol. Otlarni yuklama va qo'shimchalarsiz (은/는/이/가/을/를/에/에서/의/도/와 kabilarsiz), fe'l va sifatlarni lug'at shaklida (-다) yoz — bu \"ko\" (oddiy ko'rinish). So'z matnda qanday ko'rinishda uchragan bo'lsa (masalan 학교에서, 먹었어요), aynan shuni \"form\" (o'z ko'rinishi) maydoniga yoz; ikkalasi bir xil bo'lsa form ni bo'sh qoldir. Faqat sof grammatik yuklama va tugatmalarning o'zini olma. Tarjima faylning o'zida bo'lsa (so'z yonida, keyingi qatorda, jadval ustunida, qavs ichida; o'zbekcha, ruscha yoki inglizcha, qayerda yozilgan bo'lmasin) shuni to'g'ri o'zbek tiliga (lotin yozuvi) o'tkazib ol; fayl ichida tarjima bo'lmasa, so'zning matndagi ma'nosiga qarab o'zing aniq va qisqa (1-3 ta ekvivalent, vergul bilan) o'zbekcha tarjima qil. Ruscha yoki inglizcha so'z ishlatma. FAQAT fayldagi so'zlarni ol: fayl ichida yo'q so'zni o'zingdan qo'shma, sinonim yoki misol keltirma. Har bir yozuvda uz bo'sh bo'lmasin. Takrorlama. FAQAT JSON massiv qaytar: [{\"ko\":\"...\",\"form\":\"...\",\"uz\":\"...\",\"pos\":\"ot|fel|sifat|ravish|boshqa\"}]";
function parseWords(t){const out=[],add=o=>{if(o&&o.ko&&(o.lang||/[가-힣]/.test(o.ko))&&o.uz)out.push({ko:String(o.ko).trim(),uz:String(o.uz).trim(),pos:normPos(o.pos),form:String(o.form||'').trim().slice(0,60),lang:o.lang?String(o.lang).toLowerCase().trim().slice(0,8):'',cefr:o.cefr?String(o.cefr).toUpperCase().trim():''})};t=String(t||'');
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
  const kL=txt.split(/\n/).filter(l=>/[가-힣]/.test(l)).length,good=items.filter(i=>i.uz).length;
  if(job)job.expected=kL;
  if(!AI_KEY||(!vis&&(kL===0||good>=kL*.95))){if(!AI_KEY&&vis&&vis.partial&&job)job.warn.push((vis.pageList||[]).length+" ta sahifada matn topilmadi (skan/rasm bo'lishi mumkin): sahifalar "+(vis.pageList||[]).slice(0,30).join(', ')+". Ularni o'qish uchun GEMINI_API_KEY kerak.");return (vis&&!vis.partial)?null:items}
  let got=[],failed=0;
  try{
    if(vis){if(!USE_GEMINI){if(job)job.aiErr="GEMINI_API_KEY topilmadi";return vis.partial?items:null}if(!vis.buf){try{if(job)job.stage="Fayl AI'ga yuklanmoqda ("+Math.round(vis.size/1e6)+" MB)...";vis.ref=await geminiUpload(vis.path,vis.mime,'book');
        if(vis.mime==='application/pdf'&&!vis.pages){vis.pages=parseInt(await geminiFile(vis.ref,vis.mime,"Bu PDF faylda nechta sahifa bor? Faqat bitta butun son yoz.",50))||0;if(job)job.pages=vis.pages}}
        catch(e){if(job)job.aiErr=friendlyErr(e&&e.message||e);return vis.partial?items:null}}
      if(job)job.stage="AI fayldan so'zlarni qidiryapti...";
      const rgs=[];
      if(vis.pageList&&vis.pageList.length){for(let i=0;i<vis.pageList.length;i+=8)rgs.push(vis.pageList.slice(i,i+8))}
      else if(vis.mime==='application/pdf'&&vis.pages>8){for(let p=1;p<=vis.pages;p+=8){const g=[];for(let k=p;k<p+8&&k<=vis.pages;k++)g.push(k);rgs.push(g)}}else rgs.push(null);
      let ri=0,dn=0,lastE='';const wv=async()=>{while(ri<rgs.length){const rg=rgs[ri++],pr=wp(job)+(rg?"\n\nFAQAT PDFning quyidagi sahifalaridagi so'zlarni ol (sahifa raqamlari): "+rg.join(', ')+". Har bir sahifani to'liq o'qi, hech bir so'zni tashlab ketma.":"");let okc=0;
        for(let a=0;a<3&&!okc;a++){try{const w=parseWords(await geminiFile(vis.ref||vis.b64||(vis.b64=vis.buf.toString('base64')),vis.mime,pr,30000));got.push(...w);okc=1}catch(e){lastE=friendlyErr(e&&e.message||e);await new Promise(z=>setTimeout(z,2000))}}
        if(!okc){failed++;if(job)job.failedPages.push(...(rg||[]))}
        dn++;if(job){job.stage="AI fayldan so'zlarni qidiryapti ("+dn+"/"+rgs.length+")...";rd(job,'AI',dn,rgs.length,got.length,'qism')}}};
      await Promise.all(Array.from({length:Math.min(4,rgs.length)},wv));if(!got.length&&job)job.aiErr=lastE||"AI fayldan so'z topa olmadi"}
    else{const cs=[];for(let i=0;i<txt.length&&i<20000000;i+=8000){let e=Math.min(txt.length,i+8000);const nl=txt.indexOf('\n',e);if(nl>0&&nl-e<400)e=nl;cs.push(txt.slice(i,e));i=e-8000}
      if(txt.length>20000000&&job)job.warn.push("Fayl juda katta: faqat dastlabki 20 000 000 belgi qayta ishlandi.");
      let ci=0,dn=0;const bad=[];
      const w=async()=>{while(ci<cs.length){const c=cs[ci++];if((job&&job.ml?/\p{L}/u:/[가-힣]/).test(c)){let okc=0;for(let a=0;a<2&&!okc;a++){try{got.push(...parseWords(await callClaude([{role:'user',content:wp(job)+"\n\n"+c}],"Sen koreys-o'zbek lug'at tuzuvchisan.",12000)));okc=1}catch(e){if(job)job.aiErr=friendlyErr(e&&e.message||e);await new Promise(z=>setTimeout(z,1500))}}if(!okc){failed++;bad.push(c)}}dn++;if(job){job.stage="AI fayldan so'zlarni qidiryapti ("+dn+"/"+cs.length+")...";rd(job,'AI',dn,cs.length,got.length,'qism')}}};
      await Promise.all(Array.from({length:Math.min(8,cs.length)},w));if(failed&&job)job.warn.push(failed+" ta matn bo'lagi AI tomonidan o'qilmadi; ular oddiy usulda ajratildi (tarjimasi/turi to'liq bo'lmasligi mumkin).");
      // qamrov tekshiruvi: matndagi so'zlar olingan so'zlar bilan qoplanganmi; qoplanmagan qatorlar AI'ga qayta beriladi
      if(got.length&&txt.length<8e6&&!(job&&job.ml)){try{
        const stems=new Set(),vst=new Set();for(const g of got.concat(items.filter(i=>i.uz))){stems.add(g.ko);if(/다$/.test(g.ko)&&g.ko.length>1){stems.add(g.ko.slice(0,-1));vst.add(g.ko.slice(0,-1))}}
        const cov=t=>{for(let n=t.length;n>=1;n--){const p=t.slice(0,n);if((n>=2||n===t.length)?stems.has(p):vst.has(p))return true}return false};
        const seenT=new Set(),unc=[];let tot=0,miss=0;
        for(const l of txt.split(/\r?\n/)){if(!/[가-힣]/.test(l))continue;let lm=false;for(const t of (l.match(/[가-힣]{2,}/g)||[])){if(seenT.has(t))continue;seenT.add(t);tot++;if(!cov(t)){miss++;lm=true}}if(lm)unc.push(l)}
        if(job)job.cover=tot?Math.round((tot-miss)/tot*100):100;
        if(tot>20&&miss>tot*.12&&unc.length){
          const gcs=[];let cur2='';for(const l of unc){if(cur2.length+l.length>4500){gcs.push(cur2);cur2=''}cur2+=l+'\n'}if(cur2)gcs.push(cur2);const lim=gcs.slice(0,40);
          let gi=0,gd=0;const before=got.length;
          const gw=async()=>{while(gi<lim.length){const c=lim[gi++];for(let a=0;a<2;a++){try{got.push(...parseWords(await callClaude([{role:'user',content:wp(job)+"\n\nDiqqat: bu qatorlardagi so'zlar oldingi o'qishda tushib qolgan. Har bir ma'noli so'zni to'liq ajratib ol.\n\n"+c}],"Sen koreys-o'zbek lug'at tuzuvchisan.",12000)));break}catch(e){await new Promise(z=>setTimeout(z,1500))}}gd++;if(job){job.stage="Yetishmagan so'zlar qidirilmoqda ("+gd+"/"+lim.length+")...";rd(job,'AI',gd,lim.length,got.length,'qism')}}};
          await Promise.all(Array.from({length:Math.min(6,lim.length)},gw));
          if(job)job.warn.push("Birinchi o'qishda ~"+Math.round(miss/tot*100)+"% so'z tushib qolgan edi; qayta o'qib "+(got.length-before)+" ta qo'shimcha so'z topildi."+(gcs.length>lim.length?" Fayl katta bo'lgani uchun qayta o'qish qisman bajarildi.":""))}
      }catch{}}
    }
  }catch(e){if(job)job.aiErr=friendlyErr(e&&e.message||e)}
  if(failed&&job&&vis)job.warn.push(failed+" ta sahifa guruhi o'qilmadi: "+[...new Set(job.failedPages)].sort((a,b)=>a-b).join(', ')+" sahifalar.");
  if(!vis&&got.length&&txt&&!(job&&job.ml)&&txt.length*got.length<4e9){const T=txt.replace(/\s+/g,'');const ok=g=>{const k=String(g.ko).replace(/\s+/g,'');if(g.form&&T.includes(String(g.form).replace(/\s+/g,'')))return true;if(T.includes(k))return true;return /다$/.test(k)&&k.length>1&&T.includes(k[0])};
    const keep=got.filter(ok),drop=got.length-keep.length;got.length=0;for(const x of keep)got.push(x);if(drop&&job)job.warn.push("Faylda uchramagan "+drop+" ta so'z (AI o'zidan qo'shgan) olib tashlandi.")}
  if(!got.length)return (vis&&!vis.partial)?null:items;
  const seen=new Set(),out=[];
  for(const g of got){if(job&&job.ml&&!job.ml.langs.includes(g.lang))continue;const kk=g.ko+'|'+(g.lang||'');if(seen.has(kk))continue;seen.add(kk);out.push({ko:g.ko,uz:g.uz,pos:(auto&&g.pos)||defPos,px:!!(auto&&g.pos),form:g.form&&g.form!==g.ko?g.form:'',lang:g.lang||'',cefr:g.cefr||''})}
  for(const it of items)if(!seen.has(it.ko+'|'+(it.lang||''))){seen.add(it.ko+'|'+(it.lang||''));out.push(it)}
  return out}
async function tr(t){
  const tryit=async f=>{try{const v=await f();return v&&v!==t?v:''}catch{return ''}},sg=()=>AbortSignal.timeout(7000);
  let r='';
  if(TRANSLATE_URL)r=await tryit(async()=>{const x=await fetch(TRANSLATE_URL,{method:'POST',signal:sg(),headers:{'content-type':'application/json'},body:JSON.stringify({q:t,source:'ko',target:TRANSLATE_TARGET,api_key:TRANSLATE_KEY||undefined})});return (await x.json()).translatedText});
  if(!r&&GOOGLE_TRANSLATE_KEY)r=await tryit(async()=>{const x=await fetch('https://translation.googleapis.com/language/translate/v2?key='+GOOGLE_TRANSLATE_KEY,{method:'POST',signal:sg(),headers:{'content-type':'application/json'},body:JSON.stringify({q:t,source:'ko',target:TRANSLATE_TARGET,format:'text'})});return (await x.json()).data.translations[0].translatedText});
  if(!r)r=await tryit(async()=>{const x=await fetch('https://api.mymemory.translated.net/get?q='+encodeURIComponent(t)+'&langpair=ko|'+TRANSLATE_TARGET,{signal:sg()});const j=await x.json();const v=j.responseData&&j.responseData.translatedText;return v&&!/MYMEMORY WARNING|QUERY LENGTH/i.test(v)?v:''});
  return r}
async function claudeTranslate(part){
  const txt=await callClaude([{role:'user',content:"Quyidagi koreys so'zlarini o'zbek tiliga (lotin yozuvi) tarjima qil va so'z turini aniqla (ot, fel=harakat 동사, sifat=holat 형용사, ravish, olmosh, son, yordamchi yoki boshqa; sifat va fe'lni aralashtirma). Har bir so'zning eng keng tarqalgan ma'nosini 1-3 ta qisqa o'zbekcha ekvivalent bilan ber (vergul bilan). Fe'llarni bosh shaklda (-moq) yoz. Ruscha yoki inglizcha so'z ishlatma. Ba'zi so'zlar oldida ← belgisidan keyin ular uchragan gap (kontekst) berilgan: ma'noni shu kontekstga qarab tanla; ko ni aynan berilganidek (← gacha bo'lgan qismini) o'zgartirmay qaytar. Ma'nosiga ishonching komil bo'lmasa, uz ni bo'sh qoldir, taxmin qilma. FAQAT JSON massiv qaytar: [{\"ko\":\"...\",\"uz\":\"...\",\"pos\":\""+posKeys()+"\"}]\n\n"+part.map(x=>x.ko+(x.ctx?'  ← '+x.ctx:'')).join('\n')}],"Sen tajribali koreys-o'zbek lug'at tuzuvchisan. Tarjimalar aniq, qisqa va to'g'ri o'zbek tilida bo'lsin.",6000);
  const out={};try{JSON.parse(txt.match(/\[[\s\S]*\]/)[0]).forEach(o=>{if(o&&o.ko)out[o.ko]={uz:String(o.uz||'').trim(),pos:normPos(o.pos)}})}catch{}
  return out}
const POSMAP=[[/^(ot|otlar|noun|nouns|명사|isim)$/i,'ot'],[/^(fe['’‘`]?l|fe['’‘`]?llar|verb|verbs|동사)$/i,'fel'],[/^(sifat|sifatlar|adjective|adjectives|형용사)$/i,'sifat'],[/^(ravish|ravishlar|adverb|adverbs|부사)$/i,'ravish']];
POSMAP.push([/^(olmosh|olmoshlar|pronoun|pronouns|대명사)$/i,'olmosh'],[/^(son|sonlar|numeral|numerals|number|수사)$/i,'son'],[/^(ko['’‘`]?makchi|yordamchi|particle|particles|조사)$/i,'yordamchi']);
const normPos=x=>{x=String(x||'').trim().replace(/[()\[\]{}.:]/g,'');if(!x)return '';const ps=getPoss(),has0=k=>ps.some(p=>p.key===k);
  for(const [re,p] of POSMAP)if(re.test(x)&&has0(p))return p;
  const l=x.toLowerCase();for(const p of ps)if(l===p.key||l===String(p.name).toLowerCase()||(p.ko&&x===p.ko))return p.key;return ''};
const posKeys=()=>getPoss().map(p=>p.key).join('|')+'|boshqa';
function mkParser(defPos,auto,isTab){
  const items=[],seen=new Set();let cur='',carry=null;
  const hasK=x=>/[가-힣]/.test(x),lat=x=>/\p{L}/u.test(x)&&!hasK(x);
  const add=(ko,uz)=>{ko=ko.trim();uz=uz.trim();let p=cur,px=!!cur;
    const tg=uz.match(/\s*[(\[]\s*([^)\]]+?)\s*[)\]]\s*$/);if(tg&&normPos(tg[1])){p=normPos(tg[1]);px=true;uz=uz.slice(0,tg.index).trim()}
    uz=uz.replace(/^["“”«»]+|["“”«»]+$/g,'').trim();
    const ps=uz.split(/\s*[,;|\t]\s*/);if(ps.length>1&&normPos(ps[ps.length-1])){p=normPos(ps.pop());px=true;uz=ps.join(', ')}
    if(ko&&uz&&!seen.has(ko)){seen.add(ko);items.push({ko,uz,pos:p||defPos,px})}};
  const csvSplit=(l,c)=>{const o=[];let b='',q=0;for(let i=0;i<l.length;i++){const ch=l[i];if(ch==='"'){if(q&&l[i+1]==='"'){b+='"';i++}else q=!q}else if(!q&&(ch==='\t'||ch===';'||ch==='|'||(c&&ch===','))){o.push(b);b=''}else b+=ch}o.push(b);return o.map(x=>x.trim())};
  const feed=(raw,final)=>{const fresh=raw.map(l=>l.replace(/^\s*(\d+[.)]?|[•*·])\s+/,'').trim()).filter(Boolean);
    const lines=carry!==null?[carry,...fresh]:fresh;carry=null;const lim=final?lines.length:lines.length-1;let i=0;
  for(i=0;i<lim;i++){const line=lines[i];
    const hd=normPos(line.replace(/^[^A-Za-z가-힣'’‘`]+|[^A-Za-z가-힣'’‘`]+$/g,''));if(hd&&line.length<30){cur=hd;continue}
    if(/[\t;|]/.test(line)||(isTab&&line.includes(','))){const cells=csvSplit(line,isTab),ki=cells.findIndex(c=>hasK(c));
      if(cells.length>=2&&ki>=0){const rest=cells.filter((c,j)=>j!==ki&&c&&!hasK(c)&&/\p{L}/u.test(c)&&!normPos(c)),ps=cells.map(c=>normPos(c)).find(Boolean);
        if(rest.length){const keep=cur;if(ps)cur=ps;add(cells[ki],rest[0]);cur=keep;continue}}}
    let m=line.match(/^([가-힣][^\-–—:=,;\t|]*?)\s*[\-–—:=]\s*(.+)$/)||line.match(/^([가-힣][^,;\t|]*?)\s*[,;\t|]\s*(.+)$/);
    if(m&&!hasK(m[2])){add(m[1],m[2]);continue}
    const rv=line.match(/^([\p{L}'’‘ʻʼ][^가-힣]*?)\s*[\-–—:=\t,;|]\s*([가-힣].*)$/u);if(rv&&!hasK(rv[1])){add(rv[2],rv[1]);continue}
    const pr=line.match(/^([가-힣][가-힣\s~]*?)\s*[(（]\s*([^가-힣()（）]+?)\s*[)）]\s*$/);if(pr&&!normPos(pr[2])){add(pr[1],pr[2]);continue}
    const sp=line.match(/^([가-힣][가-힣~\s]*?)\s+([\p{L}'’‘ʻʼ].*)$/u);if(sp&&!hasK(sp[2])){add(sp[1],sp[2]);continue}
    if(hasK(line)&&!/[A-Za-z\u0400-\u04FF]/.test(line)&&lines[i+1]&&lat(lines[i+1])&&!normPos(lines[i+1])){add(line,lines[i+1]);i++;continue}
    for(const w of line.match(/[가-힣]{1,20}/g)||[])if(!seen.has(w)){seen.add(w);items.push({ko:w,uz:'',pos:cur||defPos,px:!!cur,ctx:line.slice(0,70)})}
  }
  if(!final&&lines.length)carry=(i>lim)?null:lines[lines.length-1]};
  const finish=()=>{if(auto)for(const it of items)if(!it.px&&/다$/.test(it.ko))it.pos='fel'};
  return {items,feed,finish}}

const TXTEXT=new Set(['txt','csv','tsv','json','md','srt','vtt','log','html','htm','xml','lst','dic','text','tab','ass','sub']),BINEXT=new Set(['xlsx','xls','ods','docx','doc','rtf','pptx','odt','odp','epub','hwpx','hwp','pdf','zip','rar','7z','tar','gz','exe','iso','db','sqlite']);
async function looksText(path,ext){if(TXTEXT.has(ext))return true;if(BINEXT.has(ext)||GEMMIME[ext])return false;
  const fd=await fs.promises.open(path,'r');try{const b=Buffer.alloc(8192),{bytesRead}=await fd.read(b,0,8192,0);if(!bytesRead)return false;const h=b.subarray(0,bytesRead);if((h[0]===0xFF&&h[1]===0xFE)||(h[0]===0xFE&&h[1]===0xFF))return true;return !h.includes(0)}finally{await fd.close()}}
function uzNorm(t){return String(t||'').replace(/([oOgG])[\u2018\u2019\u02BB\u02BC\u0060\u00B4\u2032\u02B9']/g,'$1\u02BB').replace(/[\u2018\u2019\u02BC\u0060\u00B4\u2032\u02B9']/g,'\u02BC')}
function uzTr(t){t=String(t||'').replace(/[\u2018\u2019\u02BB\u02BC\u0060\u00B4\u2032\u02B9]/g,"'").toLowerCase();
 return t.replace(/o'/g,'o').replace(/g'/g,'g').replace(/'/g,'').replace(/sh/g,'ş').replace(/ch/g,'ç').replace(/x/g,'h').replace(/q/g,'k').replace(/j/g,'c').replace(/w/g,'v')}
function uzRu(t){t=String(t||'').replace(/[\u2018\u2019\u02BB\u02BC\u0060\u00B4\u2032\u02B9]/g,"'").toLowerCase();
 return t.replace(/o'/g,'о').replace(/g'/g,'г').replace(/yo/g,'ё').replace(/yu/g,'ю').replace(/ya/g,'я').replace(/sh/g,'ш').replace(/ch/g,'ч').replace(/ng/g,'нг').replace(/'/g,'').replace(/[a-z]/g,c=>({a:'а',b:'б',d:'д',e:'э',f:'ф',g:'г',h:'х',i:'и',j:'дж',k:'к',l:'л',m:'м',n:'н',o:'о',p:'п',q:'к',r:'р',s:'с',t:'т',u:'у',v:'в',x:'х',y:'й',z:'з'}[c]||c))}
function rd(j,ph,cur,tot,words,unit){if(!j)return;j.rd={ph,cur,tot,unit:unit||'',pct:tot?Math.min(100,Math.round(cur/tot*100)):0,words:words==null?((j.rd&&j.rd.words)||0):words}}
async function streamExtract(file,defPos,auto,job,size){
  const MAXW=MAXW_G,nm=file.originalname.toLowerCase();
  const fd=await fs.promises.open(file.path,'r');const hb=Buffer.alloc(65536);const {bytesRead}=await fd.read(hb,0,65536,0);await fd.close();const head=hb.subarray(0,bytesRead);let enc='utf-8';
  if(head[0]===0xFF&&head[1]===0xFE)enc='utf-16le';else if(head[0]===0xFE&&head[1]===0xFF)enc='utf-16be';
  else{try{new TextDecoder('utf-8',{fatal:true}).decode(head)}catch{try{new TextDecoder('utf-8',{fatal:true}).decode(head.subarray(0,Math.max(0,head.length-3)))}catch{enc='euc-kr'}}}
  const dec=new TextDecoder(enc,{stream:true}),P=mkParser(defPos,auto,/\.(csv|tsv)$/.test(nm));let rest='',read=0,last=0,cut=false;
  for await(const chunk of fs.createReadStream(file.path,{highWaterMark:+process.env.STREAM_CHUNK||(4<<20)})){
    read+=chunk.length;const t=rest+dec.decode(chunk,{stream:true}),ls=t.split(/\r?\n/);rest=ls.pop();if(rest.length>2e6){ls.push(rest);rest=''}
    P.feed(ls,false);
    if(job&&Date.now()-last>800){last=Date.now();job.stage="Katta fayl o'qilmoqda ("+Math.round(read/size*100)+"%) — "+P.items.length+" ta so'z topildi";rd(job,"Fayl o'qilmoqda",Math.round(read/1048576),Math.round(size/1048576),P.items.length,'MB')}
    if(P.items.length>=MAXW){cut=true;break}}
  if(!cut)P.feed([rest+dec.decode()],true);else P.feed([],true);
  P.finish();if(job){if(cut)job.warn.push("Fayl juda katta: dastlabki "+MAXW+" ta so'z olindi (MAX_WORDS o'zgaruvchisi bilan oshirish mumkin).");job.warn.push("Katta matn fayli bo'lak-bo'lak o'qildi: «koreys - tarjima» juftliklari va koreyscha so'zlar olindi, tarjimasizlari alohida tarjima qilinadi.")}
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
  if(!bigVis&&!(job&&job.ml)&&size>(+process.env.STREAM_MIN||50e6)&&await looksText(file.path,ext))return await streamExtract(file,defPos,auto,job,size);
  let buf=null;if(!bigVis){if(size>150e6){if(job)job.readErr="fayl juda katta ("+Math.round(size/1e6)+" MB). "+(GEMMIME[ext]?"PDF/rasm/audio/video uchun GEMINI_API_KEY kerak.":"Word/Excel/arxiv kabi fayllar bunchalik katta bo'lsa o'qilmaydi — uni TXT yoki CSV qilib saqlab yuklang (TXT/CSV 8 GB gacha o'qiladi).");return null}buf=fs.readFileSync(file.path)}
  let txt='',visual=null,pages=0,vpl=null;const emptyP=[];
  try{
    if(bigVis){visual=gm;if(ext==='pdf'){pages=countPdfPages(file.path);if(job)job.pages=pages}}
    else if(/\.pdf$/.test(nm)){try{if(job){job.stage="PDF o'qilmoqda...";rd(job,'PDF',0,1,0,'')}const R=await pdfChild(file.path,job);if(!R)throw new Error('pdf-child');const pg=R.pg||[];
      pages=R.pages||pg.length;txt=pg.length?pg.join('\n'):(R.text||'');if(job){job.pages=pages;rd(job,'PDF',1,1,0,'')}
      pg.forEach((t,i)=>{if(t.replace(/\s/g,'').length<15)emptyP.push(i+1)});if(job)job.emptyPages=emptyP.slice()}catch{txt='';if(job&&!job.readErr)job.readErr=job.pdfNote||"PDF matnini o'qib bo'lmadi";pages=(buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g)||[]).length;if(job)job.pages=pages}
      if((txt.replace(/\s/g,'').length<40||!(job&&job.ml?/\p{L}{3}/u:/[가-힣]/).test(txt))&&(buf.length<14e6||USE_GEMINI))visual='application/pdf';
      else if(emptyP.length&&(buf.length<14e6||USE_GEMINI)){visual='application/pdf';vpl=emptyP.slice()}}
    else if(/\.(xlsx|xls|ods)$/.test(nm)){const X=require('xlsx'),wb=X.read(buf);txt=wb.SheetNames.map(n=>X.utils.sheet_to_csv(wb.Sheets[n])).join('\n')}
    else if(/\.docx$/.test(nm))txt=(await require('mammoth').extractRawText({buffer:buf})).value;
    else if(/\.(html?|xml)$/.test(nm))txt=buf.toString('utf8').replace(/<(script|style)[\s\S]*?<\/\1>/gi,'').replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d)>/gi,'\n').replace(/<[^>]+>/g,' ');
    else if(/\.(pptx|odt|odp|epub|hwpx)$/.test(nm)){const z=await require('jszip').loadAsync(buf);let o='';for(const n of Object.keys(z.files).sort()){if(!z.files[n].dir&&/^ppt\/slides\/slide\d+\.xml$|^content\.xml$|^Contents\/section\d+\.xml$|\.x?html?$/.test(n))o+=(await z.files[n].async('string')).replace(/<\/(a:p|hp:p|text:p|text:h|p|div|h\d|li|tr)>|<br\s*\/?>/gi,'\n').replace(/<\/(td|th|a:tc|table:table-cell)>/gi,'\t').replace(/<[^>]+>/g,'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'")+'\n'}txt=o}
    else if(/\.rtf$/.test(nm)){const dc=new TextDecoder('euc-kr');txt=buf.toString('latin1').replace(/(?:\\'[0-9a-f]{2})+/gi,m=>dc.decode(Buffer.from(m.replace(/\\'/g,''),'hex'))).replace(/\\u(-?\d+)\??/g,(m,n)=>String.fromCharCode(n<0?+n+65536:+n)).replace(/\\pard?\b/g,'\n').replace(/\\[a-z]+-?\d* ?|[{}]/gi,'')}
    else if(/\.doc$/.test(nm)){txt=(buf.toString('utf16le').match(/[\u0009\u000d\u0020-\u007e\u00a0-\u052f\u1100-\u11ff\u3130-\u318f\uac00-\ud7af\u2018-\u201f\u2013\u2014]{2,}/g)||[]).map(x=>x.replace(/\r/g,'\n')).join('\n')}
    else if(/\.(png|jpe?g|webp|heic|heif)$/.test(nm)){if(buf.length<14e6)visual='image/'+(/jpe?g$/.test(nm)?'jpeg':nm.split('.').pop())}
    else if(gm&&!/^image\//.test(gm)&&gm!=='application/pdf'){if(buf.length<14e6)visual=gm}
    else{let t=buf.toString('utf8');if(buf[0]===0xFF&&buf[1]===0xFE)t=buf.toString('utf16le');else if((t.match(/\uFFFD/g)||[]).length>3){try{t=new TextDecoder('euc-kr').decode(buf)}catch{}}txt=t.replace(/^\uFEFF/,'')}
  }catch(e){if(job)job.readErr=String((e&&e.message)||e).slice(0,200);return null}
  if(job&&!visual&&!txt.trim()&&buf.length>=14e6)job.readErr="fayl juda katta (skan/rasm PDF 14 MB dan oshmasin) — uni bo'lib yuklang";
  const P=mkParser(defPos,auto,/\.(xlsx|xls|ods|csv|tsv)$/.test(nm));P.feed(txt.split(/\r?\n/),true);P.finish();const items=(job&&job.ml)?[]:P.items;
  const vis=visual&&{buf:(buf&&buf.length<14e6)?buf:null,path:file.path,size,mime:visual,pages,pageList:vpl,partial:!!vpl};try{return await aiWords(items,txt,vis,defPos,auto,job)}finally{if(vis&&vis.ref)geminiDelete(vis.ref)}}
async function addWords(job,d,items,levelOf,auto){
  job.stage="Tekshirilmoqda...";
  const todo=items.slice(0,MAXW_G).filter(it=>(!job.ml||it.uz)&&!one('select 1 from words where dict_id=? and ko=? and lang=?',d.id,it.ko,it.lang||'ko'));
  job.dups=Math.max(0,Math.min(items.length,MAXW_G)-todo.length);todo.forEach((it,i)=>it.idx=i);job.found=items.length;job.total=todo.length;job.done=0;if(job.rd){job.rd.pct=100;job.rd.cur=job.rd.tot;job.rd.words=items.length}
  const wl=['b','o','y'].includes(job.wlvl)?job.wlvl:(['b','o','y'].includes(d.lvl)?d.lvl:''),ins=db.prepare('insert into words(dict_id,level,pos,section,ko,uz,lvl,form,lang) values(?,?,?,?,?,?,?,?,?)'),cnt={};
  const put=list=>{db.transaction(()=>{for(const it of list){const lv=levelOf(it.idx,todo.length,it),k=(it.lang||'ko')+'|'+lv+'|'+it.pos;
    if(cnt[k]==null)cnt[k]=one('select count(*) n from words where dict_id=? and level=? and pos=? and lang=?',d.id,lv,it.pos,it.lang||'ko').n;
    const rr=ins.run(d.id,lv,it.pos,Math.floor(cnt[k]/d.sec)+1,it.ko,it.uz,(job.wlBy&&job.wlBy[lv])||wl,it.form||'',it.lang||'ko');(job.ids=job.ids||[]).push(rr.lastInsertRowid);cnt[k]++;
    job.perLevel[lv]=(job.perLevel[lv]||0)+1;job.perPos[it.pos]=(job.perPos[it.pos]||0)+1;job.added++}})()};
  const aiOn=!!AI_KEY,needAI=it=>!it.uz||(auto&&!it.px);
  const first=todo.filter(it=>it.uz&&!(aiOn&&needAI(it)));put(first);job.done=first.length;
  const fs0=new Set(first);let rest=todo.filter(it=>!fs0.has(it));
  if(aiOn&&rest.length){job.stage="Tarjima va tur aniqlash (AI)...";
    const bs=[];for(let i=0;i<rest.length;i+=120)bs.push(rest.slice(i,i+120));let bi=0;
    const worker=async()=>{while(bi<bs.length){const b=bs[bi++];let o={};try{o=await claudeTranslate(b)}catch{}
      const ok=[];for(const it of b){const x=o[it.ko];if(x){if(!it.uz&&x.uz){it.uz=x.uz;job.translated++}if(auto&&!it.px&&x.pos){it.pos=x.pos;it.px=true}}if(it.uz)ok.push(it);else it.left=1}
      put(ok);job.done+=b.length}};
    await Promise.all(Array.from({length:Math.min(5,bs.length)},worker));rest=rest.filter(it=>it.left)}
  if(aiOn&&rest.length){job.stage="Tarjima (qayta urinish)...";const bs2=[];for(let i=0;i<rest.length;i+=20)bs2.push(rest.slice(i,i+20));let bj=0;
    const w3=async()=>{while(bj<bs2.length){const b=bs2[bj++];let o={};for(let a=0;a<3&&!Object.keys(o).length;a++){try{o=await claudeTranslate(b)}catch{await new Promise(z=>setTimeout(z,1500))}}
      const ok=[];for(const it of b){const x=o[it.ko];if(x&&x.uz){it.uz=x.uz;job.translated++;if(auto&&!it.px&&x.pos){it.pos=x.pos;it.px=true}it.left=0;ok.push(it)}}put(ok)}};
    await Promise.all(Array.from({length:Math.min(4,bs2.length)},w3));rest=rest.filter(it=>it.left)}
  if(rest.length){job.stage="Tarjima (tarjima xizmati)...";const lim=rest.slice(0,3000);let ri=0;
    const w2=async()=>{while(ri<lim.length){const it=lim[ri++];it.uz=await tr(it.ko);if(it.uz){job.translated++;put([it])}if(!aiOn)job.done++}};
    await Promise.all(Array.from({length:8},w2));rest=rest.filter(it=>!it.uz)}
  if(rest.length){for(const it of rest)it.uz=PENDING;put(rest);job.pending=rest.length;setTimeout(trFill,5000)}
  if(job.ids&&job.ids.length)ttsEnqueue(job.ids);
  if(job.expected&&job.found<job.expected*.5)job.warn.push("Faylda ~"+job.expected+" ta koreyscha qator bor, lekin faqat "+job.found+" ta so'z ajratildi. Fayl to'liq o'qilmagan bo'lishi mumkin — tekshirib ko'ring.");
  if(job.pending)job.warn.push(job.pending+" ta so'z tarjimasi kutilmoqda (fonda tarjima qilinadi).");
  job.incomplete=job.warn.some(w=>/o'qilmadi|to'liq o'qilmagan|topilmadi/.test(w));
  job.done=job.total;job.stage="Tayyor (ovozlar fonda avtomatik qo'shilmoqda)";return job}
async function classifyLevels(items,job){if(!AI_KEY)return;const bs=[];for(let i=0;i<items.length;i+=150)bs.push(items.slice(i,i+150));let bi=0,dn=0;
  const w=async()=>{while(bi<bs.length){const b=bs[bi++];
    for(let a=0;a<3;a++){try{const t=await callClaude([{role:'user',content:"Quyidagi koreys so'zlarining qiyinlik darajasini aniqla: b = boshlang'ich (TOPIK 1-2, kundalik oddiy so'zlar), o = o'rta (TOPIK 3-4), y = yuqori (TOPIK 5-6, murakkab/rasmiy/kam uchraydigan). FAQAT JSON massiv qaytar: [{\"ko\":\"...\",\"l\":\"b|o|y\"}]\n\n"+b.map(x=>x.ko).join('\n')}],"Sen koreys tili o'qituvchisisan.",8000);
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
  const items=await extract(F,P.pos,P.auto,job);if(!items){job.err=rdErr(job);return}
  await addWords(job,d,items,()=>+P.level,P.auto)}catch(e){job.err=String(e.message||e)}finally{job.fin=true;rmF(F)}}
async function runBookJob(job,F,P){try{const items=await extract(F,P.pos,P.auto,job);if(!items){job.err=rdErr(job);return}
  let L=P.L,levelOf;
  if(P.lvl==='all'){L=3;job.wlBy={1:'b',2:'o',3:'y'};job.stage="So'zlar darajasi aniqlanmoqda (AI)...";await classifyLevels(items,job);
    levelOf=(i,n,it)=>({b:1,o:2,y:3})[it&&it.dl]||Math.min(3,Math.floor(i*3/n)+1)}// Hammasi: boshlang'ich / o'rta / yuqori
  else levelOf=(i,n)=>Math.min(L,Math.floor(i*L/n)+1);// daraja soni bo'yicha teng bo'linadi
  let d=job.dict_id&&one('select * from dicts where id=? and deleted=0',job.dict_id);
  if(!d){const id=run('insert into dicts(name,levels,sec,lvl) values(?,?,?,?)',P.name,L,30,P.lvl).lastInsertRowid;d=one('select * from dicts where id=?',id);job.dict_id=id}
  job.wlvl=P.lvl==='all'?'':P.lvl;
  await addWords(job,d,items,levelOf,P.auto)}catch(e){job.err=String(e.message||e)}finally{job.fin=true;rmF(F)}}
async function runMBookJob(job,F,P){try{const sel=(P.cefr&&P.cefr.length)?P.cefr:CEFR;job.ml={langs:P.langs,cefr:sel};let items=await extract(F,'',false,job);if(!items)return void(job.err=rdErr(job));
  if(!items.length)return void(job.err=job.aiErr||job.readErr||"Fayldan tanlangan tillardagi so'z topilmadi");
  items.forEach(it=>{if(!CEFR.includes(it.cefr))it.cefr='A1'});const all=items.length;items=items.filter(it=>sel.includes(it.cefr));
  if(!items.length)return void(job.err="Fayldan "+all+" ta so'z topildi, lekin ular tanlangan darajalarga ("+sel.join(', ')+") to'g'ri kelmadi. Boshqa darajalarni ham belgilab qayta urinib ko'ring.");
  job.lvlSkip=all-items.length;
  let d=job.dict_id&&one('select * from dicts where id=? and deleted=0',job.dict_id);
  if(!d){const id=run('insert into dicts(name,levels,sec,lvl,langs) values(?,?,?,?,?)',P.name,6,30,'',JSON.stringify(P.langs)).lastInsertRowid;CEFR.forEach((n,i)=>run('insert or replace into lvnames(dict_id,level,name) values(?,?,?)',id,i+1,n));d=one('select * from dicts where id=?',id);job.dict_id=id}
  await addWords(job,d,items,(i,n,it)=>Math.max(1,CEFR.indexOf(it&&it.cefr)+1),false)}catch(e){job.err=String(e.message||e)}finally{job.fin=true;rmF(F)}}
// ish parametrlari bazaga yoziladi: server qayta ishga tushsa, ish avtomatik davom etadi
const startJob=(job,F,P)=>{job.params={F:{path:F.path,originalname:F.originalname,size:F.size},P,tries:0};saveJob(job);(P.kind==='mbook'?runMBookJob:P.kind==='book'?runBookJob:runImportJob)(job,F,P)};
app.post('/api/admin/import',adm('import'),upBig.single('file'),(r,s)=>{
  const {dict_id,level=1,pos='ot'}=r.body,d=one('select * from dicts where id=?',dict_id);const F=pickFile(r);if(!d||d.deleted||!F||F.bad)return s.status(400).json({e:(F&&F.bad)||'bad'});
  const job=newJob();s.json({job:job.id});startJob(job,F,{kind:'import',dict_id:d.id,level:+level||1,pos,auto:r.body.auto==='1',wlvl:LVL(r.body.wlvl)})});
app.post('/api/admin/mbook',adm('import'),upBig.single('file'),(r,s)=>{
  const b=r.body,name=(b.name||'').trim();let langs=[];try{langs=JSON.parse(b.langs||'[]')}catch{}langs=[...new Set(langs)].filter(c=>LANGM[c]);
  if(!name)return s.json({e:"Kitob nomi kelmadi"});if(!langs.length)return s.json({e:"Kamida bitta til tanlang"});
  const F=pickFile(r);if(!F||F.bad)return s.json({e:(F&&F.bad)||"Fayl serverga yetib bormadi"});
  let cf=[];try{cf=JSON.parse(b.cefr||'[]')}catch{}cf=[...new Set(cf)].filter(c=>CEFR.includes(c));if(!cf.length)cf=CEFR.slice();
  const job=newJob();job.ml={langs,cefr:cf};s.json({job:job.id});startJob(job,F,{kind:'mbook',name,langs,cefr:cf})});
app.post('/api/admin/book',adm('import'),upBig.single('file'),(r,s)=>{
  const b=r.body,name=(b.name||'').trim(),pos=b.pos||'ot',lvl=LVL(b.lvl),L=Math.max(1,Math.min(+b.levels||1,30));
  if(!name)return s.json({e:"Kitob nomi kelmadi"});const F=pickFile(r);if(!F||F.bad)return s.json({e:(F&&F.bad)||"Fayl serverga yetib bormadi"});
  const job=newJob();s.json({job:job.id});startJob(job,F,{kind:'book',name,pos,lvl,L,auto:b.auto==='1'})});
function resumeJobs(){try{for(const r of db.prepare('select * from jobs').all()){let j;try{j=JSON.parse(r.j)}catch{continue}if(j.fin||jobs[j.id])continue;
  const pr=j.params;
  if(pr&&pr.F&&pr.P&&fs.existsSync(pr.F.path)&&(pr.tries||0)<2){pr.tries=(pr.tries||0)+1;
    Object.assign(j,{stage:"Server qayta ishga tushdi — ish avtomatik davom ettirilmoqda ("+pr.tries+"/2)...",err:null,fin:false,ts:Date.now()});delete j._sf;jobs[j.id]=j;saveJob(j);
    (pr.P.kind==='mbook'?runMBookJob:pr.P.kind==='book'?runBookJob:runImportJob)(j,{...pr.F},pr.P)}
  else{j.fin=true;j.err="Server qayta ishga tushdi va ishni davom ettirib bo'lmadi (fayl topilmadi yoki ikki marta urinildi). Shu vaqtgacha qo'shilgan so'zlar saqlangan: "+(j.added||0)+" ta. Faylni qayta yuklasangiz, takroriy so'zlar o'tkazib yuboriladi.";db.prepare('update jobs set j=? where id=?').run(JSON.stringify(j),r.id)}}}catch(e){console.error('resume',e)}}
setTimeout(resumeJobs,1500);
console.log('Server ishga tushdi',new Date().toISOString(),'| xotira',Math.round(process.memoryUsage().rss/1048576)+' MB');
setInterval(()=>{const a=Object.values(jobs).filter(j=>!j.fin);if(a.length)console.log('ish davom etmoqda | xotira',Math.round(process.memoryUsage().rss/1048576)+' MB |',a.map(j=>j.stage).join(' / '))},10000).unref();
app.get('/api/admin/status',adm('admins'),(r,s)=>s.json({key:!!AI_KEY,keyLen:(AI_KEY||'').length,provider:USE_GEMINI?'Gemini':'Claude',model:FOXM,bot:!!BOT_TOKEN,webapp:WEBAPP_URL||'',data:DATA}));
app.post('/api/admin/claude-test',adm('admins'),async(r,s)=>{if(!AI_KEY)return s.json({ok:false,error:"GEMINI_API_KEY serverda ko'rinmayapti. Railway → Variables'ga qo'shing va Deploy bosing. Ikkita loyiha bo'lsa, domen bog'langan loyihaga qo'shing."});
  try{const t=await callClaude([{role:'user',content:"Bir so'z bilan javob ber: tayyormisan?"}],"Qisqa javob ber.",50);s.json({ok:true,reply:t,model:FOXM})}catch(e){s.json({ok:false,error:String(e.message||e)})}});

function resection(id){const d=one('select * from dicts where id=?',id);if(!d)return;const rows=q('select id,level,pos,lang from words where dict_id=? order by id',id),c={};const up=db.prepare('update words set section=? where id=?');db.transaction(()=>{for(const w of rows){const k=w.lang+'|'+w.level+'|'+w.pos;c[k]=c[k]||0;up.run(Math.floor(c[k]/d.sec)+1,w.id);c[k]++}})()}
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
  return shuffle(w).slice(0,n).map(x=>({kind:mode,p:x.ko,audio:x.audio||'',opts:shuffle([x.uz,...shuffle(w.filter(y=>y.id!==x.id)).slice(0,3).map(y=>y.uz)]),ans:x.uz}))}
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
      w=q('select * from words where dict_id=?'+(lv?' and level=?':''),...(lv?[dict,lv]:[dict]));if(w.length<4)return cb({e:"Kamida 4 ta so'z kerak"})}
    const qs=buildQs(mode,w,n);let code;do code=String(Math.floor(100000+Math.random()*900000));while(rooms[code]);
    rooms[code]={code,host:u.id,qs,sec,meta:{book,level:lv,n:qs.length,sec,mode},started:false,players:{}};cb({code})});
  sock.on('join',(code,cb)=>{code=String(code||'').trim();const r=rooms[code];if(!r)return cb({e:'Xona topilmadi'});if(r.started)return cb({e:"O'yin boshlangan"});
    r.players[u.id]={name:u.name,score:0,i:0,done:false};sock.join(code);sock.data.code=code;cb({ok:1});io.to(code).emit('room',roomView(r))});
  sock.on('start',()=>{const r=rooms[sock.data.code];if(!r||r.host!==u.id||r.started)return;
    if(Object.keys(r.players).length<2)return sock.emit('err',"Kamida 2 o'yinchi kerak");
    r.started=true;const now=Date.now();Object.values(r.players).forEach(p=>p.t0=now);
    r.timer=setTimeout(()=>endRoom(r),(r.qs.length*r.sec+25)*1000);
    io.to(r.code).emit('start',{qs:r.qs.map(({kind,p,h,opts,audio})=>({kind,p,h,opts,audio})),meta:r.meta})});
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
  bot.start(c=>c.reply("Assalomu alaykum, "+c.from.first_name+"! 🦊\nMen Kori — til lug'atlari yordamchingizman.\nSizga qanday yordam bera olaman?",Markup.inlineKeyboard([[open],[Markup.button.callback("💬 Savol berish",'ask'),Markup.button.callback("ℹ️ Nimalar qila olaman?",'help')]])));
  bot.action('ask',c=>{c.answerCbQuery().catch(()=>{});c.reply("Savolingizni yozing, men javob beraman 🦊\n(masalan: «고맙습니다» nima degani?)")});
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
