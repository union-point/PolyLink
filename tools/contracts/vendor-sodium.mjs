import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root=new URL('../../',import.meta.url);
const output=new URL('js/crypto/vendor/',root);await mkdir(output,{recursive:true});
const entries=[['libsodium-wrappers-sumo','libsodium-wrappers'],['libsodium-sumo','libsodium-sumo']];
const manifest={version:'0.8.4',files:{}};
for(const [pkg,file] of entries){
  const path=new URL(`node_modules/${pkg}/`,import.meta.url);
  const metadata=JSON.parse(await readFile(new URL('package.json',path)));
  if(metadata.version!==manifest.version)throw new Error('Unexpected sodium package version');
  const original=await readFile(new URL(`dist/modules-sumo-esm/${file}.mjs`,path),'utf8');
  const vendored=original.replace('from"libsodium-sumo"','from"./libsodium-sumo.mjs"');
  await writeFile(new URL(`${file}.mjs`,output),vendored);
  const hash=value=>createHash('sha256').update(value).digest('hex');
  manifest.files[file]={sourceSha256:hash(original),vendoredSha256:hash(vendored)};
}
await copyFile(new URL('node_modules/libsodium-wrappers-sumo/LICENSE',import.meta.url),new URL('LICENSE',output));
await writeFile(new URL('manifest.json',output),JSON.stringify(manifest,null,2)+'\n');
