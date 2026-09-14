const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {cleanHistory,recordHistory,setHistoryLike}=require('../src/history.cjs');
const {Store,cleanState}=require('../src/core.cjs');
const id=n=>`video${String(n).padStart(6,'0')}`;
test('histórico limita a 100 vídeos recentes e reassistir move ao topo sem duplicar',()=>{
  let history=[];
  for(let i=0;i<105;i++)history=recordHistory(history,{id:id(i),title:`Vídeo ${i}`},i+1);
  assert.equal(history.length,100);assert.equal(history[0].id,id(104));assert.equal(history[99].id,id(5));
  history=recordHistory(history,{id:id(20),title:'Título atualizado'},200);
  assert.equal(history.length,100);assert.equal(history[0].id,id(20));assert.equal(history[0].title,'Título atualizado');
  assert.equal(history.filter(v=>v.id===id(20)).length,1);
});
test('histórico valida IDs, ordena entradas e reconstrói URLs e miniaturas seguras',()=>{
  const history=cleanHistory([{id:id(1),title:'Antigo',watchedAt:1},{id:id(1),title:'Novo',watchedAt:3},{id:'invalid'},{id:id(2),watchedAt:2,thumbnail:'https://evil.test/img',url:'javascript:evil'}]);
  assert.equal(history.length,2);assert.equal(history[0].title,'Novo');
  assert.equal(history[1].thumbnail,`https://i.ytimg.com/vi/${id(2)}/mqdefault.jpg`);
  assert.equal(history[1].url,`https://www.youtube.com/watch?v=${id(2)}`);
  assert.deepEqual(cleanHistory(null),[]);assert.throws(()=>recordHistory([],null));assert.throws(()=>recordHistory([],{id:'invalid'}));
  assert.deepEqual(cleanState({library:[]}).history,[]);
});
test('histórico persiste após reabrir e não se perde ao alterar configurações ou biblioteca',()=>{
  const testRoot=path.resolve(process.env.LUMEN_TEST_DIR||path.join(__dirname,'..','test-results'));
  fs.mkdirSync(testRoot,{recursive:true});const dir=fs.mkdtempSync(path.join(testRoot,'history-'));
  try{
    let store=new Store(dir);store.save({...store.value,history:setHistoryLike(recordHistory([],{id:id(1),title:'Persistido'},123),id(1),true)});
    store.save({...store.value,settings:{theme:'space'},library:[{id:'UCaaaaaaaaaaaaaaaaaaaaaa',title:'Canal'}]});
    store=new Store(dir);assert.equal(store.value.history[0].title,'Persistido');assert.equal(store.value.history[0].watchedAt,123);assert.equal(store.value.library.length,1);assert.equal(store.value.settings.theme,'space');
    assert.equal(store.value.history[0].liked,true);
  }finally{if(path.resolve(dir).startsWith(testRoot+path.sep))fs.rmSync(dir,{recursive:true,force:true});}
});
test('curtida preserva ordem e data, sobrevive à reprodução e pode ser removida',()=>{
  let history=recordHistory(recordHistory([],{id:id(1)},1),{id:id(2)},2);
  history=setHistoryLike(history,id(1),true);
  assert.equal(history[0].id,id(2));assert.equal(history[1].watchedAt,1);
  history=recordHistory(history,{id:id(1),title:'Novo título'},3);
  assert.equal(history[0].liked,true);assert.equal(history[0].title,'Novo título');
  history=setHistoryLike(history,id(1),false);assert.equal(history[0].liked,false);
  assert.equal(cleanHistory([{id:id(3),liked:'true'}])[0].liked,false);
  assert.throws(()=>setHistoryLike(history,id(3),true));assert.throws(()=>setHistoryLike(history,id(1),'true'));
});
