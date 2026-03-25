import crypto from "node:crypto";

const secret = process.env.AUTH_TOKEN_SECRET || "accounting-ai-dev-secret";
const ttlSeconds = Number(process.env.AUTH_TOKEN_TTL_SECONDS || 60 * 60 * 8);

const b64url = (value) => Buffer.from(value).toString("base64url");
const parseB64 = (value) => JSON.parse(Buffer.from(value, "base64url").toString("utf8"));

const sign = (payload) => {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
};

export const authTokenService = {
  createToken(claims) {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      ...claims,
      iat: now,
      exp: now + ttlSeconds
    };

    const payloadEncoded = b64url(JSON.stringify(payload));
    const signature = sign(payloadEncoded);
    return `${payloadEncoded}.${signature}`;
  },

  verifyToken(token) {
    if (!token || !token.includes(".")) return null;

    const [payloadEncoded, signature] = token.split(".");
    if (!payloadEncoded || !signature) return null;

    const expected = sign(payloadEncoded);
    if (expected !== signature) return null;

    const payload = parseB64(payloadEncoded);
    const now = Math.floor(Date.now() / 1000);

    if (typeof payload.exp !== "number" || payload.exp < now) {
      return null;
    }

    return payload;
  }
};
