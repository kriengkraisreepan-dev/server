const crypto = require("crypto");
const path = require("path");
const { ProductionReleaseBuilder } = require("../services/production-release-builder");
const { FirmwareProductionTrustStore, publicKeyFingerprint } = require("../services/firmware-production-trust-store");
const { ProductionFirmwarePackageService } = require("../services/production-firmware-package-service");
const fs = require("fs");

const root = path.resolve(__dirname, ".."), pair = crypto.generateKeyPairSync("ed25519"), fingerprint = publicKeyFingerprint(pair.publicKey);
const year = new Date().getUTCFullYear(), keyId = `lrc-prod-${year}-01-${fingerprint.slice(0,12)}`;
const approvals = { releaseOperatorConfirmed:true, productionApproverConfirmed:true, licenseDistributionApproved:true, antivirusApproved:true, windowsExecutionApproved:true, cp210xApproved:true, ch340Approved:true, esp32HardwareApproved:true, releaseOperatorId:"EPHEMERAL_TEST_OPERATOR", productionApproverId:"EPHEMERAL_TEST_APPROVER" };
const events=[];
const builder = new ProductionReleaseBuilder({ workspaceRoot:root, mode:"production-like-test", keyProvider:()=>({privateKey:pair.privateKey,publicKey:pair.publicKey,keyId}), approvals, audit:(event,data)=>events.push({event,data}) });
const result=builder.build({releaseNotes:"Automated production-like verification with an ephemeral key. This package is not approved for production distribution."});
const trustDirectory=path.join(root,"runtime","firmware-packages","production-like-test",".ephemeral-public-keys");fs.mkdirSync(trustDirectory,{recursive:true});const publicKeyPath=path.join(trustDirectory,`${result.manifest.buildId}.public.pem`),publicKeyPem=pair.publicKey.export({type:"spki",format:"pem"});fs.writeFileSync(publicKeyPath,publicKeyPem,{mode:0o600});const trustStore=new FirmwareProductionTrustStore({registry:{schemaVersion:1,status:"EPHEMERAL_PRODUCTION_LIKE_TEST",keys:[{keyId,publicKeyPem,fingerprintSha256:fingerprint,validFrom:new Date(Date.parse(result.manifest.createdAt)-1000).toISOString(),validUntil:new Date(Date.parse(result.manifest.createdAt)+86400000).toISOString()}],revokedKeys:[]}});new ProductionFirmwarePackageService({packageRoot:result.packageRoot,trustStore,mode:"production-like-test",managerVersion:"1.0.0"}).verify();
process.stdout.write(`${JSON.stringify({packageRoot:result.packageRoot,publicVerificationKey:publicKeyPath,firmwareVersion:result.manifest.firmwareVersion,buildId:result.manifest.buildId,signingKeyId:result.signingKeyId,manifestFormatVersion:2,releaseChannel:"production",signingEnvironment:"production-like-test",distributionStatus:"PRODUCTION DISTRIBUTION NOT YET APPROVED",verified:true,privateKeyPersisted:false,auditEvents:events.map(item=>item.event)},null,2)}\n`);
