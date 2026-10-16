'use strict';
const {HermesClient}=require('./hermes_client'),{uuid,hash}=require('./chat_store');
const LIMIT=9_500_000,ID='([a-f0-9-]{36})';
function imageType(b){if(b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';if(b[0]===255&&b[1]===216&&b[2]===255)return 'image/jpeg';if(b.subarray(0,6).toString().match(/^GIF8[79]a$/))return 'image/gif';if(b.subarray(0,4).toString()==='RIFF'&&b.subarray(8,12).toString()==='WEBP')return 'image/webp';return null;}
async function bytes(req,limit){let n=0,chunks=[];for await(const c of req){n+=c.length;if(n<=limit)chunks.push(c);}if(n>limit)throw Error('photo_too_large');return Buffer.concat(chunks);}
function createPhotos({authorized=()=>true}={}){
 const client=new HermesClient();
 return async(req,res,url)=>{
  const json=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
  try{
   const p=url.pathname,m=new RegExp('^/api/photos/'+ID+'(?:/(file|annotations)(?:/'+ID+')?)?$','i').exec(p),isList=p==='/api/photos',isDays=p==='/api/photos/days';
   if(!isList&&!isDays&&!m)return json(404,{error:'not_found'});
   if(m&&(!uuid(m[1])||m[3]&&!uuid(m[3])))return json(400,{error:'invalid_photo_id'});
   let method=req.method,options={method,headers:{}},route='/ziwei/web'+p.slice(4),query=new URLSearchParams();
   const allowed=isDays?['from','to']:isList?['date','limit','cursor']:m?.[2]==='file'?['thumb','rev']:[];
   if([...url.searchParams.keys()].some(k=>!allowed.includes(k)))return json(400,{error:'invalid_query'});
   for(const [key,value] of url.searchParams){if(value.length>200)return json(400,{error:'invalid_query'});query.set(key,value);}
   if(method==='GET'){
    if(isList||isDays||m&&!m[3]){}else return json(405,{error:'method_not_allowed'});
   }else if(isList&&method==='POST'){
    const data=await bytes(req,LIMIT),mime=imageType(data),id=req.headers['x-photo-id'],suffix={ 'image/jpeg':'.jpg','image/png':'.png','image/webp':'.webp','image/gif':'.gif'}[mime];
    if(!mime||!uuid(id))return json(400,{error:'invalid_photo'});
    const name=req.headers['x-photo-name']||('photo'+suffix);if(typeof name!=='string'||name.length>512||/[\r\n\x00]/.test(name))return json(400,{error:'invalid_photo_name'});
    options.body=data;options.headers={'Content-Type':mime,'X-Photo-Name':name,'X-Photo-Id':id,'X-Photo-Suffix':suffix};
    for(const header of ['x-photo-at','x-photo-caption'])if(req.headers[header]){if(typeof req.headers[header]!=='string'||req.headers[header].length>1200||/[\r\n\x00]/.test(req.headers[header]))return json(400,{error:'invalid_photo_header'});options.headers[header]=req.headers[header];}
   }else if(m&&m[2]==='annotations'&&((method==='POST'&&!m[3])||(method==='PATCH'&&m[3]))){
    const body=JSON.parse((await bytes(req,8192)).toString('utf8')),fields=method==='POST'?['id','text','at']:['text'];
    if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!fields.includes(k))||typeof body.text!=='string'||![...body.text.trim()].length||[...body.text].length>280||method==='POST'&&!uuid(body.id))return json(400,{error:'invalid_annotation'});
    // Identity belongs to this authenticated BFF route. Native HTTP handlers inject USER;
    // ziwei's own tools run under ZIWEI. Never forward caller-controlled author/owner.
    options.headers={'Content-Type':'application/json'};options.body=JSON.stringify(body);
   }else if(m&&method==='DELETE'&&(!m[2]||m[2]==='annotations'&&m[3])){
    const input=await bytes(req,1024);if(input.toString().trim()&&!['{}','null'].includes(input.toString().trim()))return json(400,{error:'invalid_body'});
   }else return json(405,{error:'method_not_allowed'});
   if(!authorized(req))return json(401,{error:'unauthorized'});
   if(query.size)route+='?'+query;
   const upstream=await client.fetch(route,options);
   if(!authorized(req))return json(401,{error:'unauthorized'});
   if(method==='GET'&&m?.[2]==='file'&&upstream.ok){
    const data=await bytes(upstream.body,LIMIT),mime=imageType(data),expected=upstream.headers.get('x-content-sha256');
    if(!mime||!expected||!/^[a-f0-9]{64}$/.test(expected)||hash(data)!==expected)throw Error('photo_integrity_failed');
    if(!authorized(req))return json(401,{error:'unauthorized'});
    res.writeHead(200,{'Content-Type':mime,'Content-Length':data.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Disposition':'inline','X-Content-Sha256':expected});return res.end(data);
   }
   const raw=await bytes(upstream.body,8*1024*1024);let value;try{value=JSON.parse(raw.toString());}catch{throw Error('photos_invalid_response');}
   const status=[200,201,400,403,404,409,413,429].includes(upstream.status)?upstream.status:503;
   if(!authorized(req))return json(401,{error:'unauthorized'});
   return json(status,status===503?{error:'photos_unavailable'}:value);
  }catch(e){return json(e.message==='photo_too_large'?413:e instanceof SyntaxError?400:503,{error:e.message==='photo_too_large'?'photo_too_large':e instanceof SyntaxError?'invalid_json':'photos_unavailable'});}
 };
}
module.exports={createPhotos,imageType,LIMIT};
