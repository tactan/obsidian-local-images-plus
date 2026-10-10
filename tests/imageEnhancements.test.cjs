const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const ts = require("typescript");
const src = fs.readFileSync("src/imageEnhancements.ts", "utf8");
const js = ts.transpileModule(src, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
const m={exports:{}};
new Function("module","exports",js)(m,m.exports);
const h=m.exports;
test("counter token recognition and width",()=>{
  assert.equal(h.hasCounterVariable("\${notename}-\${counter:001}"),true);
  assert.equal(h.hasCounterVariable("\${notename}-\${md5:8}"),false);
  assert.equal(h.hasCounterVariable("{counter:001}"),false);
});
test("highest existing counter matches the same note and arbitrary digits",()=>{
  const f=["My Note-001.webp","My Note-012.png","Other-099.jpg","My Note-7.png","My Note-c.webm"];
  assert.equal(h.highestExistingCounter("\${notename}-\${counter:001}","My Note",f),12);
  assert.equal(h.highestExistingCounter("\${notename}-\${counter:0001}","Other",f),99);
  assert.equal(h.highestExistingCounter("\${notename}-\${counter:0001}","Unrelated",f),0);
});
test("sequences continue for each note independently",()=>{
  const t="\${notename}-\${counter:001}";
  assert.equal(h.nextCounterForNote("a.md",t,"a",["a-009.png"]),10);
  assert.equal(h.nextCounterForNote("a.md",t,"a",[]),11);
  assert.equal(h.nextCounterForNote("b.md",t,"b",[]),1);
});
test("conversion allowlist and GIF, SVG and WebP safety",()=>{
  for(const ext of ["png","PNG","jpg","jpeg","avif","bmp","tiff","ico"])assert.equal(h.isWebpConvertible(ext),true,ext);
  for(const ext of ["gif","GIF","svg","webp","pdf","mp4","unknown"])assert.equal(h.isWebpConvertible(ext),false,ext);
  assert.equal(h.isWebpConvertible("jpeg","jpg|avif"),false);
  assert.equal(h.isWebpConvertible("tif","tiff"),false);
});
test("excluded formats never allocate or attempt decoding",async()=>{
  const before=global.Image;global.Image=class {constructor(){throw Error("must not instantiate")}};
  try{assert.equal(await h.convertImageToWebp(new ArrayBuffer(0),"gif"),null);
   assert.equal(await h.convertImageToWebp(new ArrayBuffer(0),"pdf"),null);}
  finally{global.Image=before;}
});
test("decode/encoder failure falls back to untouched original",async()=>{
  const oldURL=global.URL,oldImage=global.Image,oldBlob=global.Blob;
  global.URL={createObjectURL:()=> "blob:test",revokeObjectURL:()=>{}};
  global.Blob=class{constructor(){} };
  global.Image=class{set src(_){this.onerror();}};
  try {assert.equal(await h.convertImageToWebp(new ArrayBuffer(16),"avif"),null);}
  finally{global.URL=oldURL;global.Image=oldImage;global.Blob=oldBlob;}
});
