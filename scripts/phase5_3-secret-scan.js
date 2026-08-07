const fs=require("fs");
const path=require("path");
const root=path.resolve(__dirname,".."),scanRoots=[path.join(root,"runtime","firmware-packages","production-like-test"),path.join(root,"config")];
const forbiddenContent=["-----BEGIN PRIVATE KEY-----","-----BEGIN OPENSSH PRIVATE KEY-----","lucky-relay-1234","\"deviceKey\":","\"setupCode\":","\"wifiPassword\":","\"privateKey\":"],forbiddenName=/(?:private|secret).*(?:\.pem|\.key|\.der|\.p12|\.pfx)$|\.(?:key|p12|pfx)$/i;
let files=0,bytes=0;
function walk(directory){if(!fs.existsSync(directory))return;for(const entry of fs.readdirSync(directory,{withFileTypes:true})){const full=path.join(directory,entry.name);if(entry.isSymbolicLink())throw Error(`SYMLINK_REJECTED: ${full}`);if(entry.isDirectory())walk(full);else{if(forbiddenName.test(entry.name))throw Error(`SECRET_FILENAME_REJECTED: ${full}`);const content=fs.readFileSync(full);files+=1;bytes+=content.length;for(const marker of forbiddenContent)if(content.includes(Buffer.from(marker)))throw Error(`SECRET_CONTENT_REJECTED: ${entry.name}`);}}}
for(const directory of scanRoots)walk(directory);
process.stdout.write(`${JSON.stringify({status:"PASS",filesScanned:files,bytesScanned:bytes,productionPrivateKeyFound:false,credentialMaterialFound:false},null,2)}\n`);
