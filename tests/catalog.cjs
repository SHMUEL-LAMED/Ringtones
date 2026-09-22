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
const {driveId, streamUrl, publicLinks, isDriveUrl} = sandbox.window.RoshUI;
for(const e of data.episodes) assert(driveId(e),`No playback source: ${e.title}`);
assert.equal(driveId({audio:'https://drive.google.com.evil.test/file/d/abc/view'}),null);
assert.equal(driveId({audio:'javascript:alert(1)'}),null);
assert.equal(driveId({audio:'https://cdn.example.com/song.mp3',links:data.episodes[0].links}),null);

// Every recording streams straight into the site's own player: a Drive file becomes a
// direct usercontent download URL (206 ranges, CORS *), a direct file stays as is, and
// nothing that is not http(s) ever reaches an <audio> or <a download>.
for(const e of data.episodes){
 const url=streamUrl(e);
 assert.match(url,/^https:\/\/drive\.usercontent\.google\.com\/download\?id=[\w-]+&export=download&confirm=t$/,`Bad stream URL: ${e.title}`);
 assert.equal(new URL(url).searchParams.get('id'),driveId(e));
 assert.equal(publicLinks(e).length,0,`Drive link would be shown publicly: ${e.title}`);
}
assert.equal(streamUrl({audio:'https://cdn.example.com/song.mp3',links:data.episodes[0].links}),'https://cdn.example.com/song.mp3');
assert.equal(streamUrl({audio:'assets/audio/demo.wav'}),'assets/audio/demo.wav');
assert.equal(streamUrl({audio:'javascript:alert(1)'}),'');
assert.equal(streamUrl({audio:'',links:[{label:'x',url:'https://example.com'}]}),'');
assert(isDriveUrl('https://drive.google.com/file/d/abc/view')&&isDriveUrl('https://docs.google.com/uc?id=abc')&&!isDriveUrl('https://example.com'));
assert.deepEqual(publicLinks({links:[{label:'d',url:'https://drive.google.com/file/d/abc/view'},{label:'x',url:'https://example.com'}]}).map(l=>l.label),['x']);
// The public pages never mention the storage provider.
for(const f of ['assets/js/home.js','assets/js/archive.js','assets/js/episode.js','assets/js/me.js','assets/js/player.js','index.html','archive.html','episode.html','me.html']){
 const src=fs.readFileSync(f,'utf8').replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*$/gm,'');
 assert(!/drive\.google|Google Drive|דרייב|Drive/.test(src),`Storage provider leaks into ${f}`);
}

// Cloudflare uploads must require an administrator, send the bearer token and
// preserve the exact file bytes while reporting progress.
async function uploadCheck() {
 const file=new Blob([new Uint8Array(1024).fill(73)],{type:'audio/mpeg'});
 file.name='test.mp3'; file.lastModified=123;
 let request;
 class XHR {
  constructor(){this.headers={};this.upload={};}
  open(method,url){this.method=method;this.url=url;}
  setRequestHeader(k,v){this.headers[k]=v;}
  async send(body){request={method:this.method,url:this.url,headers:this.headers,body:Buffer.from(await body.arrayBuffer())};this.upload.onprogress?.({lengthComputable:true,loaded:body.size,total:body.size});this.status=200;this.responseText=JSON.stringify({url:'https://api.example/media/program/ep-90/file.mp3'});this.onload();}
 }
 const sb={session:{token:'secret'},base:p=>'https://api.example'+p,isAdmin:async()=>true};
 const ctx={window:{RoshStore:{sb}},XMLHttpRequest:XHR,encodeURIComponent,Promise};
 vm.runInNewContext(fs.readFileSync('assets/js/upload.js','utf8'),ctx);
 const progress=[];
 const url=await ctx.window.RoshUpload(file,'ep-90','audio',p=>progress.push(p));
 assert.equal(url,'https://api.example/media/program/ep-90/file.mp3');
 assert.equal(request.method,'POST'); assert.equal(request.headers.Authorization,'Bearer secret');
 assert.deepEqual(request.body,Buffer.from(await file.arrayBuffer())); assert(progress.includes(100));
 sb.isAdmin=async()=>false;
 await assert.rejects(ctx.window.RoshUpload(file,'ep-90','audio',()=>{}),/מנהל/);
 console.log('Catalog, stream URLs, public links, Cloudflare upload authorization and byte integrity passed.');
}
uploadCheck().catch(e=>{console.error(e);process.exitCode=1;});
