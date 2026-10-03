import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const path = process.argv[2];
if (!path) throw Error("Usage: node scripts/verify-evidence.mjs export.json");
const evidence = JSON.parse(readFileSync(path, "utf8"));
if (!Array.isArray(evidence.audit) || !evidence.audit.length)
  throw Error("No audit records");
let previous = "GENESIS";
for (const r of [...evidence.audit].sort((a, b) => a.seq - b.seq)) {
  const hash = createHash("sha256")
    .update(
      JSON.stringify({
        id: r.id,
        at: r.at,
        actor: r.actor,
        action: r.action,
        target: r.target,
        detail: r.detail,
        previousHash: r.previous_hash,
      }),
    )
    .digest("hex");
  if (r.previous_hash !== previous || r.hash !== hash)
    throw Error(`Audit chain mismatch at seq ${r.seq}`);
  previous = hash;
}
console.log(
  `${evidence.audit.length} records verified from GENESIS. Internal consistency only; an operator can rewrite and rehash the full chain.`,
);
