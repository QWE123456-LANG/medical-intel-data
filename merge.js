const fs=require('fs'),path=require('path');
const S=process.argv[2]||'.';
const P=f=>path.join(S,f);
function rd(f,fb){try{return JSON.parse(fs.readFileSync(P(f),'utf8'));}catch(e){console.warn('WARN skip '+f+': '+e.message);return fb;}}
let data;
try{data=JSON.parse(fs.readFileSync(P('data.json'),'utf8'));}
catch(e){console.error('FATAL data.json 无法解析（可能下载被截断），中止，勿发布。'+e.message);process.exit(1);}
if(!data||!data.categories||!Array.isArray(data.daily)||!Array.isArray(data.weekly)){console.error('FATAL data.json 结构不完整（daily/weekly/categories 缺失），中止，勿发布。');process.exit(1);}
const before={d:data.daily.length,w:data.weekly.length};
const nd=rd('new_daily.json',null),nw=rd('new_weekly.json',null),ne=rd('new_entries.json',[]);
const dl=Array.isArray(nd)?nd:(nd&&nd.date?[nd]:[]);
for(const it of dl){if(!it||!it.date)continue;const i=data.daily.findIndex(x=>x.date===it.date);if(i>=0)data.daily[i]=it;else data.daily.unshift(it);}
data.daily.sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')));
if(nw&&nw.weekId){const i=data.weekly.findIndex(x=>x.weekId===nw.weekId);if(i>=0)data.weekly[i]=nw;else data.weekly.unshift(nw);}
let n=0;for(const it of(ne||[])){const c=data.categories[it&&it.cat];if(c&&it.entry&&it.entry.title&&!c.entries.find(e=>e.title===it.entry.title)){c.entries.push(it.entry);n++;}}
if(data.daily.length&&data.daily[0].date)data.updated=data.daily[0].date;
try{fs.copyFileSync(P('data.json'),P('data.json.bak'));}catch(e){}
const t=P('data.json.tmp');
fs.writeFileSync(t,JSON.stringify(data,null,2),'utf8');
try{JSON.parse(fs.readFileSync(t,'utf8'));}catch(e){console.error('FATAL 写回校验失败，保留原文件。'+e.message);process.exit(1);}
fs.renameSync(t,P('data.json'));
console.log('merged | updated='+data.updated+' | daily '+before.d+'->'+data.daily.length+' | weekly '+before.w+'->'+data.weekly.length+' | entries+'+n);
