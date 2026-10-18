'use strict';
// Operator-selected, exact Railway service host. Never accept a URL, wildcard,
// arbitrary private IP, alternate port, or silent public fallback in this mode.
const PRIVATE_HOST=/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.railway\.internal$/;
function hermesEndpoint(env=process.env){
 const selected=env.ZIWEI_HERMES_PRIVATE_HOST;
 if(selected!==undefined){
  return typeof selected==='string'&&PRIVATE_HOST.test(selected)?'http://'+selected+':8642/':null;
 }
 const base=env.ZIWEI_HERMES_URL||'';
 try{
  const u=new URL(base),test=env.NODE_ENV==='test'&&env.ZIWEI_BRIDGE_ALLOW_HTTP_FOR_TESTS==='true';
  return (u.protocol==='https:'||test&&u.protocol==='http:'&&['127.0.0.1','localhost'].includes(u.hostname))&&!u.username&&!u.password&&!u.search&&!u.hash&&u.pathname==='/'?u.href:null;
 }catch{return null;}
}
function hermesRoute(endpoint,route){
 if(!endpoint||typeof route!=='string'||!route.startsWith('/')||route.startsWith('//')||/[\\\r\n\t#]/.test(route))throw Error('hermes_route_rejected');
 const target=new URL(route,endpoint);
 if(target.origin!==new URL(endpoint).origin||target.username||target.password)throw Error('hermes_route_rejected');
 return target;
}
module.exports={hermesEndpoint,hermesRoute};
