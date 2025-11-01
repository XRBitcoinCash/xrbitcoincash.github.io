// scripts/build-audit-bundle.mjs
import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";

const ROOT = process.cwd();
const OUT  = path.join(ROOT, "ai", "audit-bundle.json");

// List the public files we want me to review (extend anytime)
const TARGETS = [
  "index.html",
  "trade.html",
  "stop-loss.html",
  "extract-orders.html",
  "XRBitcoin/diag.html",
  "ai/ai/health.html",
  "XRBitcoin/ai/ai-auditor.html"
];

function sha256(buf){ return crypto.createHash("sha256").update(buf).digest("hex"); }

async function fileEntry(rel){
  const abs = path.join(ROOT, rel);
  try{
    const stat = await fs.stat(abs);
    if (!stat.isFile()) return null;
    const buf  = await fs.readFile(abs);
    return {
      path: rel,
      size: stat.size,
      mtime_ms: stat.mtimeMs,
      sha256: sha256(buf),
      content_base64: buf.toString("base64")
    };
  }catch{
    return null; // skip missing
  }
}

async function main(){
  const files = [];
  for (const t of TARGETS){
    const e = await fileEntry(t);
    if (e) files.push(e);
  }
  await fs.mkdir(path.dirname(OUT), { recursive: true });
  const payload = {
    version: 1,
    generated_at: new Date().toISOString(),
    files
  };
  await fs.writeFile(OUT, JSON.stringify(payload, null, 2));
  console.log(`Wrote ${OUT} with ${files.length} file(s).`);
}

main().catch(err => { console.error(err); process.exit(1); });
