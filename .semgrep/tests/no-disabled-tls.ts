// ruleid: domaine-no-disabled-tls
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
// ruleid: domaine-no-disabled-tls
const insecure = { rejectUnauthorized: false, host: "example.test" };
// ruleid: domaine-no-disabled-tls
options.rejectUnauthorized = false;
// ok: domaine-no-disabled-tls
const secure = { rejectUnauthorized: true };
// ok: domaine-no-disabled-tls
const localEmulator = "http://127.0.0.1:8080";
