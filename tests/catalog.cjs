const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const data = JSON.parse(fs.readFileSync('data/episodes.json','utf8'));
assert.equal(data.episodes.length,86);
assert.equal(new Set(data.episodes.map(e=>e.slug)).size,86);
for(let n=55;n<=89;n++) assert(data.episodes.some(e=>e.number===n),`Missing episode ${n}`);
assert(!data.episodes.some(e=>/demo\.wav|לדוגמה/.test(JSON.stringify(e))));
const sandbox = { window:{}, document:{addEventListener(){}}, navigator:{}, location:{href:'https://example.com/'}, Intl, URL, URLSearchParams, setTimeout, clearTimeout };
vm.runInNewContext(fs.readFileSync('assets/js/ui.js','utf8'),sandbox);
const {driveId} = sandbox.window.RoshUI;
for(const e of data.episodes) assert(driveId(e),`No playback source: ${e.title}`);
assert.equal(driveId({audio:'https://drive.google.com.evil.test/file/d/abc/view'}),null);
assert.equal(driveId({audio:'javascript:alert(1)'}),null);
assert.equal(driveId({audio:'https://cdn.example.com/song.mp3',links:data.episodes[0].links}),null);

// Interrupt the transfer after the server stores a chunk, then reselect the
// same file. The HEAD offset must prevent duplicate or missing bytes.
async function uploadCheck() {
 const memory = new Map(); let offset=0, posts=0, fail=true; const received=[];
 const file=new Blob([new Uint8Array(7*1024*1024).fill(73)],{type:'audio/mpeg'});
 file.name='test.mp3'; file.lastModified=123;
 const sb={cfg:{url:'https://test.supabase.co',anonKey:'public'},user:{id:'admin'},session:{access_token:'test'},isAdmin:async()=>true,refresh:async()=>{}};
 const ctx={window:{RoshStore:{sb}},crypto:webcrypto,TextEncoder,URL,Uint8Array,btoa,localStorage:{getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)},fetch:async(url,opts)=>{
  if(opts.method==='POST'){posts++;return new Response(null,{status:201,headers:{Location:'https://test.supabase.co/storage/v1/upload/resumable/id'}});}
  if(opts.method==='HEAD') return new Response(null,{headers:{'Upload-Offset':String(offset)}});
  assert.equal(+opts.headers['Upload-Offset'],offset);
  if(offset>0 && fail){fail=false;throw Error('Connection interrupted');}
  received.push(Buffer.from(await opts.body.arrayBuffer())); offset+=opts.body.size;
  return new Response(null,{status:204,headers:{'Upload-Offset':String(offset)}});
 }};
 vm.runInNewContext(fs.readFileSync('assets/js/upload.js','utf8'),ctx);
 await assert.rejects(ctx.window.RoshUpload(file,'ep-90','audio',()=>{}),/interrupted/);
 const url=await ctx.window.RoshUpload(file,'ep-90','audio',()=>{});
 assert.equal(posts,1); assert.equal(memory.size,0); assert(url.includes('/object/public/rosh-media/episodes/ep-90/'));
 assert.deepEqual(Buffer.concat(received),Buffer.from(await file.arrayBuffer()));
 sb.isAdmin=async()=>false;
 await assert.rejects(ctx.window.RoshUpload(file,'ep-90','audio',()=>{}),/מנהל/);
 console.log('Catalog, Drive URL validation, upload authorization and interrupted upload resume passed.');
}
uploadCheck().catch(e=>{console.error(e);process.exitCode=1;});
