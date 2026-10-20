// 固定官方 18.3.1 的静态数值核验；不从本地实现反推预期。
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const official = process.env.REACT18_SOURCE || '/Users/wangcheng/Documents/workSpace/frontEnd/referenceProjects/repos/react/react';
const git=(args)=>execFileSync('git',['-C',official,...args],{encoding:'utf8'}).trim();
const commit='f1338f8080abd1386454a10bbf93d67bfe37ce85';
assert.equal(git(['rev-parse','HEAD']),commit);
assert.equal(git(['rev-parse','v18.3.1']),commit);
assert.equal(git(['branch','--show-current']),'codex/react-18.3.1');
assert.equal(git(['status','--porcelain']),'','official reference must remain unchanged');
const checks=[];
for(const [localName,officialName] of [['ReactFiberFlags.ts','ReactFiberFlags.js'],['ReactFiberLane.ts','ReactFiberLane.new.js'],['ReactTypeOfMode.ts','ReactTypeOfMode.js'],['ReactWorkTags.ts','ReactWorkTags.js']]){
 const local=fs.readFileSync(path.resolve(__dirname,'../../packages/react-reconciler/src',localName),'utf8');
 const source=git(['show',`v18.3.1:packages/react-reconciler/src/${officialName}`]);
 const constants=(text)=>Object.fromEntries([...text.replace(/\/\*[\s\S]*?\*\//g,'').matchAll(/export const (\w+)(?:\s*:\s*\w+)?\s*=\s*(0b[01]+|\d+)\s*;/g)].map(m=>[m[1],Number(m[2])]));
 const expected=constants(source);
 for(const [name,value] of Object.entries(constants(local))){
   assert.ok(name in expected,`${localName}.${name} must have an official definition`);
   assert.equal(value,expected[name],`${localName}.${name}`);checks.push({file:localName,name,value,official:officialName});
 }
}
console.log(JSON.stringify({official,commit,checks,status:'PASS'},null,2));
